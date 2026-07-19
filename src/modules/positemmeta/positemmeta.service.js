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

  prepareInsertParams(id, data, tenantId, userEmail) {
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
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.ItemDetailId !== undefined ? data.ItemDetailId : existing.ItemDetailId,
      data.FoodTypeId !== undefined ? data.FoodTypeId : existing.FoodTypeId,
      data.CostInfoId !== undefined ? data.CostInfoId : existing.CostInfoId,
      data.Channels !== undefined ? toJson(data.Channels) : toJson(existing.Channels),
      data.Prices !== undefined ? toJson(data.Prices) : toJson(existing.Prices),
      data.Variants !== undefined ? toJson(data.Variants) : toJson(existing.Variants),
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }

  // Replace all channel/variant link rows for an item within an open connection.
  async syncLinks(connection, itemMetaId, tenantId, userEmail, channelIds, variantIds) {
    if (Array.isArray(channelIds)) {
      await connection.execute(this.queries.DELETE_CHANNEL_LINKS, [itemMetaId, tenantId]);
      for (const channelId of channelIds) {
        await connection.execute(this.queries.INSERT_CHANNEL_LINK, [
          uuidv4(), itemMetaId, channelId, tenantId, userEmail,
        ]);
      }
    }
    if (Array.isArray(variantIds)) {
      await connection.execute(this.queries.DELETE_VARIANT_LINKS, [itemMetaId, tenantId]);
      for (const variantId of variantIds) {
        await connection.execute(this.queries.INSERT_VARIANT_LINK, [
          uuidv4(), itemMetaId, variantId, tenantId, userEmail,
        ]);
      }
    }
  }

  // Create the item + its channel/variant links atomically.
  async create(data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const id = uuidv4();
      const params = this.prepareInsertParams(id, data, tenantId, userEmail);
      await connection.execute(this.queries.INSERT, params);
      await this.syncLinks(
        connection, id, tenantId, userEmail, data.ChannelIds, data.VariantIds,
      );
      return { id, ...data };
    });
  }

  // Update the item + re-sync links atomically.
  async update(id, data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const [existingRows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      if (!existingRows || existingRows.length === 0) {
        throw new HttpError('POS Item Meta not found', MESSAGES.HTTP_STATUS.NOT_FOUND);
      }
      const existing = existingRows[0];
      const params = this.prepareUpdateParams(data, existing, userEmail, id, tenantId)
        .map((p) => (p === undefined ? null : p));
      await connection.execute(this.queries.UPDATE, params);
      await this.syncLinks(
        connection, id, tenantId, userEmail, data.ChannelIds, data.VariantIds,
      );
      const [rows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      return this.normalizeRow(rows[0]);
    });
  }

  normalizeRow(row) {
    if (!row) return row;
    return { ...row, ChannelIds: toIdArray(row.ChannelIds), VariantIds: toIdArray(row.VariantIds) };
  }

  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand);
    return { ...result, data: (result.data || []).map((r) => this.normalizeRow(r)) };
  }

  async getById(id, tenantId, expand) {
    const row = await super.getById(id, tenantId, expand);
    return this.normalizeRow(row);
  }
}

const service = new PosItemMetaService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
