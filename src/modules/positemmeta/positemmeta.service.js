// src/modules/positemmeta/positemmeta.service.js
// POS Item Meta service — business logic extending BaseCRUDService (SRP + DIP).
// Channels/Variants are stored in normalized join tables (pos_item_meta_channel,
// pos_item_meta_variant); price references a costinfo row via CostInfoId. The
// legacy Channels/Prices/Variants JSON columns are kept (nullable) for backward
// compatibility with Billing's price fallback.

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { attachBreakdown, attachBreakdownToOne } = require('../pricing/pricing.enrich');

const PRICING_OPTS = { idField: 'CostInfoId' };

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// Normalize a JSON_ARRAYAGG result (string | array | null) into a plain array.
const toIdArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((x) => x != null) : [];
    } catch {
      return [];
    }
  }
  return [];
};

class PosItemMetaService extends BaseCRUDService {
  constructor() {
    super('POS Item Meta', QUERIES.POS_ITEM_META);
  }

  /**
   * Resolves which costinfo row this menu item should point at.
   *
   * Price belongs to the master item (itemdetail.CostInfoId → costinfo), not to
   * the POS menu entry — the menu entry only mirrors it. So when the caller does
   * not supply a CostInfoId we read it off the selected item, which keeps the
   * two in step even when the item is switched on edit.
   *
   * An EXPLICIT CostInfoId always wins, including an explicit null. That keeps
   * every existing API client working exactly as before; only callers that omit
   * the field (as the Menu Items screen now does) get the derived value.
   *
   * @param {Object} connection - Open transaction connection.
   * @param {Object} data - Incoming create/update payload.
   * @param {Object|null} existing - Current row on update, null on create.
   * @param {string} tenantId - Tenant ID.
   * @returns {Promise<string|null>} CostInfoId to persist.
   */
  async resolveCostInfoId(connection, data, existing, tenantId) {
    if (data.CostInfoId !== undefined) return data.CostInfoId;

    const itemDetailId = data.ItemDetailId ?? existing?.ItemDetailId ?? null;
    if (!itemDetailId) return existing?.CostInfoId ?? null;

    const [rows] = await connection.execute(
      QUERIES.ITEM_DETAIL.SELECT_BY_ID,
      [itemDetailId, tenantId],
    );
    // Unknown item, or an item with no price configured — fall back to whatever
    // the row already had rather than inventing a value.
    if (!rows || rows.length === 0) return existing?.CostInfoId ?? null;
    return rows[0].CostInfoId ?? null;
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.ItemDetailId ?? null,
      data.FoodTypeId ?? null,
      data.CostInfoId ?? null,
      toJson(data.Channels),
      toJson(data.Prices),
      toJson(data.Variants),
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.ItemDetailId !== undefined ? data.ItemDetailId : existing.ItemDetailId,
      data.FoodTypeId !== undefined ? data.FoodTypeId : existing.FoodTypeId,
      data.CostInfoId !== undefined ? data.CostInfoId : existing.CostInfoId,
      data.Channels !== undefined ? toJson(data.Channels) : toJson(existing.Channels),
      data.Prices !== undefined ? toJson(data.Prices) : toJson(existing.Prices),
      data.Variants !== undefined ? toJson(data.Variants) : toJson(existing.Variants),
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  // Replace all channel/variant link rows for an item within an open connection.
  async syncLinks(connection, itemMetaId, tenantId, userPhone, channelIds, variantIds) {
    if (Array.isArray(channelIds)) {
      await connection.execute(this.queries.DELETE_CHANNEL_LINKS, [itemMetaId, tenantId]);
      for (const channelId of channelIds) {
        await connection.execute(this.queries.INSERT_CHANNEL_LINK, [
          uuidv4(), itemMetaId, channelId, tenantId, userPhone,
        ]);
      }
    }
    if (Array.isArray(variantIds)) {
      await connection.execute(this.queries.DELETE_VARIANT_LINKS, [itemMetaId, tenantId]);
      for (const variantId of variantIds) {
        await connection.execute(this.queries.INSERT_VARIANT_LINK, [
          uuidv4(), itemMetaId, variantId, tenantId, userPhone,
        ]);
      }
    }
  }

  // Create the item + its channel/variant links atomically.
  async create(data, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      const id = uuidv4();
      const resolved = {
        ...data,
        CostInfoId: await this.resolveCostInfoId(connection, data, null, tenantId),
      };
      const params = this.prepareInsertParams(id, resolved, tenantId, userPhone);
      await connection.execute(this.queries.INSERT, params);
      await this.syncLinks(
        connection, id, tenantId, userPhone, data.ChannelIds, data.VariantIds,
      );
      // `resolved`, not `data`, so the response reports the CostInfoId that was
      // actually stored rather than the (absent) one the client sent.
      return { id, ...resolved };
    });
  }

  // Update the item + re-sync links atomically.
  async update(id, data, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      const [existingRows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      if (!existingRows || existingRows.length === 0) {
        throw new HttpError('POS Item Meta not found', MESSAGES.HTTP_STATUS.NOT_FOUND);
      }
      const existing = existingRows[0];
      // Re-derived on every update so switching the item also moves the price.
      const resolved = {
        ...data,
        CostInfoId: await this.resolveCostInfoId(connection, data, existing, tenantId),
      };
      const params = this.prepareUpdateParams(resolved, existing, userPhone, id, tenantId)
        .map((p) => (p === undefined ? null : p));
      await connection.execute(this.queries.UPDATE, params);
      await this.syncLinks(
        connection, id, tenantId, userPhone, data.ChannelIds, data.VariantIds,
      );
      const [rows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      return this.normalizeRow(rows[0]);
    });
  }

  normalizeRow(row) {
    if (!row) return row;
    return { ...row, ChannelIds: toIdArray(row.ChannelIds), VariantIds: toIdArray(row.VariantIds) };
  }

  // Menu rows always carry the tax breakdown — the price they show is the one a
  // customer pays, so net/tax/gross is more useful here than a raw amount. The
  // SELECTs already join costinfo, so this adds one batched chain query, not N.
  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand);
    const rows = (result.data || []).map((r) => this.normalizeRow(r));
    return { ...result, data: await attachBreakdown(rows, tenantId, PRICING_OPTS) };
  }

  async getById(id, tenantId, expand) {
    const row = this.normalizeRow(await super.getById(id, tenantId, expand));
    return attachBreakdownToOne(row, tenantId, PRICING_OPTS);
  }
}

const service = new PosItemMetaService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
