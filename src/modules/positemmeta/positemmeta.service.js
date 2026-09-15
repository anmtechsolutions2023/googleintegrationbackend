// src/modules/positemmeta/positemmeta.service.js
// POS Item Meta service — business logic extending BaseCRUDService (SRP + DIP).
// Channels/Variants are stored in normalized join tables (pos_item_meta_channel,
// pos_item_meta_variant); price references a costinfo row via CostInfoId. The
// legacy Channels/Prices/Variants JSON columns are kept (nullable) for backward
// compatibility with Billing's price fallback.

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction, executeQuery } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { attachBreakdown, attachBreakdownToOne } = require('../pricing/pricing.enrich');
// The schedule rule, from the one module that owns it.
const categorySchedule = require('../poscategoryschedule/poscategoryschedule.service');

const PRICING_OPTS = { idField: 'CostInfoId' };

// What a bulk change may touch. Columns come from THIS list, never from the
// request, so a field name can never reach the SQL. Item, Branch and Price are
// absent on purpose: each belongs to the item itself, and setting one on many
// rows at once would make several dishes claim to be the same one.
const BULK_SCALARS = ['Active', 'FoodTypeId', 'MeatTypeId', 'PrepTimeMinutes', 'ServesCount'];
const BULK_LINKS = {
  ChannelIds: 'SELECT_CHANNEL_LINKS_FOR',
  VariantIds: 'SELECT_VARIANT_LINKS_FOR',
  AddonGroupIds: 'SELECT_ADDON_GROUP_LINKS_FOR',
  TagIds: 'SELECT_TAG_LINKS_FOR',
};

/** One dish's link set after an add / remove / replace. Order is kept. */
const applyListChange = (current, { mode, ids }) => {
  if (mode === 'replace') return [...new Set(ids)];
  if (mode === 'remove') {
    const drop = new Set(ids);
    return current.filter((x) => !drop.has(x));
  }
  const out = [...current];
  ids.forEach((x) => { if (!out.includes(x)) out.push(x); });
  return out;
};
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// Normalize a JSON_ARRAYAGG result (string | array | null) into a plain array.
/**
 * The tag objects a menu row carries, from either level.
 *
 * JSON_ARRAYAGG hands back a parsed array on some driver/server combinations
 * and a string on others, and NULL when a dish or its section has no tags.
 * @param {*} v
 * @returns {Array<{id: string, name: string, type: string}>}
 */
const toTagArray = (v) => {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v : (() => {
    try { return JSON.parse(String(v)); } catch { return []; }
  })();
  return Array.isArray(raw) ? raw.filter((t) => t && t.id) : [];
};

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
      data.ServesCount ?? null,
      data.PortionSize ?? null,
      data.MeatTypeId ?? null,
      data.PrepTimeMinutes ?? null,
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
      data.ServesCount !== undefined ? data.ServesCount : existing.ServesCount,
      data.PortionSize !== undefined ? data.PortionSize : existing.PortionSize,
      data.MeatTypeId !== undefined ? data.MeatTypeId : existing.MeatTypeId,
      data.PrepTimeMinutes !== undefined ? data.PrepTimeMinutes : existing.PrepTimeMinutes,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  /**
   * Replace the link sets for an item, within the caller's open connection.
   *
   * Takes a NAMED object rather than positional id arrays: there are four link
   * kinds now, and `syncLinks(conn, id, tid, user, a, b, c, d)` is a call nobody
   * can read and everybody can mis-order — two of the four are uuid arrays that
   * would swap silently.
   *
   * Each key is independent and only acted on when an ARRAY is supplied.
   * `undefined` means "not sent, leave the existing links alone"; an empty array
   * means "detach everything". A PATCH that omits ChannelIds must not silently
   * unpublish the dish from every channel.
   *
   * @param {Object} connection open transaction connection
   * @param {string} itemMetaId
   * @param {string} tenantId
   * @param {string} userPhone
   * @param {{ChannelIds?:string[], VariantIds?:string[], AddonGroupIds?:string[], TagIds?:string[]}} links
   */
  async syncLinks(connection, itemMetaId, tenantId, userPhone, links = {}) {
    const { ChannelIds, VariantIds, AddonGroupIds, TagIds } = links;

    if (Array.isArray(ChannelIds)) {
      await connection.execute(this.queries.DELETE_CHANNEL_LINKS, [itemMetaId, tenantId]);
      for (const channelId of ChannelIds) {
        await connection.execute(this.queries.INSERT_CHANNEL_LINK, [
          uuidv4(), itemMetaId, channelId, tenantId, userPhone,
        ]);
      }
    }

    if (Array.isArray(VariantIds)) {
      await connection.execute(this.queries.DELETE_VARIANT_LINKS, [itemMetaId, tenantId]);
      for (const variantId of VariantIds) {
        await connection.execute(this.queries.INSERT_VARIANT_LINK, [
          uuidv4(), itemMetaId, variantId, tenantId, userPhone,
        ]);
      }
    }

    if (Array.isArray(AddonGroupIds)) {
      await connection.execute(this.queries.DELETE_ADDON_GROUP_LINKS, [itemMetaId, tenantId]);
      // Index carries the display order, so the choice blocks appear on the till
      // in the order the menu editor arranged them rather than by insert time.
      for (const [index, addonGroupId] of AddonGroupIds.entries()) {
        await connection.execute(this.queries.INSERT_ADDON_GROUP_LINK, [
          uuidv4(), itemMetaId, addonGroupId, index, tenantId, userPhone,
        ]);
      }
    }

    if (Array.isArray(TagIds)) {
      await connection.execute(this.queries.DELETE_TAG_LINKS, [itemMetaId, tenantId]);
      for (const tagId of TagIds) {
        await connection.execute(this.queries.INSERT_TAG_LINK, [
          uuidv4(), itemMetaId, tagId, tenantId, userPhone,
        ]);
      }
    }
  }

  /**
   * Write, replace or clear the 1:1 nutrition row.
   *
   * `undefined` leaves it alone. An explicit `null` DELETES the row rather than
   * blanking its columns — a row of nulls claims "somebody recorded this as
   * unknown", which is a different statement from "no nutrition data exists",
   * and a compliance report has to be able to tell them apart.
   *
   * @param {Object} connection open transaction connection
   * @param {string} itemMetaId
   * @param {string} tenantId
   * @param {string} userPhone
   * @param {Object|null|undefined} nutrition
   */
  async syncNutrition(connection, itemMetaId, tenantId, userPhone, nutrition) {
    if (nutrition === undefined) return;

    if (nutrition === null) {
      await connection.execute(this.queries.DELETE_NUTRITION, [itemMetaId, tenantId]);
      return;
    }

    const n = (k) => (nutrition[k] === undefined ? null : nutrition[k]);
    await connection.execute(this.queries.UPSERT_NUTRITION, [
      uuidv4(), itemMetaId,
      n('ServingSizeG'), n('Calories'), n('ProteinG'), n('CarbohydrateG'),
      n('SugarG'), n('FatG'), n('SaturatedFatG'), n('FibreG'), n('SodiumMg'),
      n('Allergens'),
      tenantId, userPhone, userPhone,
    ]);
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
      await this.syncLinks(connection, id, tenantId, userPhone, data);
      await this.syncNutrition(connection, id, tenantId, userPhone, data.Nutrition);
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
      await this.syncLinks(connection, id, tenantId, userPhone, data);
      await this.syncNutrition(connection, id, tenantId, userPhone, data.Nutrition);
      const [rows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      return this.normalizeRow(rows[0]);
    });
  }

  normalizeRow(row) {
    if (!row) return row;
    return {
      ...row,
      ChannelIds: toIdArray(row.ChannelIds),
      VariantIds: toIdArray(row.VariantIds),
      AddonGroupIds: toIdArray(row.AddonGroupIds),
      TagIds: toIdArray(row.TagIds),
      // Kept APART on purpose. The till draws a tag set on the dish differently
      // from one inherited from its section, so it has to know which is which;
      // the union happens where it is displayed and filtered.
      OwnTags: toTagArray(row.OwnTags),
      CategoryTags: toTagArray(row.CategoryTags),
    };
  }

  /**
   * Marks each row with whether its section is on the menu right now.
   *
   * ONE read of the tenancy's rules for the whole page, not one per dish — the
   * shape SELECT_ALL_FOR_TENANT was written for. Evaluated in JS rather than in
   * the menu query because the rule lives in exactly one place: MySQL would
   * apply it on the DATABASE server's clock (UTC here and on Aiven) while the
   * schedule service compares against the APP server's, and the two disagreed
   * by five and a half hours the first time both existed.
   *
   * A category with no rules is absent from the map, and absent reads as
   * available — the default the whole feature rests on.
   *
   * @param {Array<Object>} rows
   * @param {string} tenantId
   * @returns {Promise<Array<Object>>}
   */
  async attachAvailability(rows, tenantId) {
    if (!rows || rows.length === 0) return rows || [];
    const [rules, timeZone] = await Promise.all([
      categorySchedule.getAllForTenant(tenantId),
      categorySchedule.getTimeZone(),
    ]);
    const byCategory = categorySchedule.indexByCategory(rules);
    // ONE instant for the whole page. Calling new Date() per row would let a
    // menu straddle a window boundary and answer inconsistently within itself.
    const when = new Date();
    return rows.map((r) => {
      const { available, opensAt } = categorySchedule.availabilityOf(
        byCategory.get(r.CategoryId), when, timeZone,
      );
      return { ...r, CategoryAvailableNow: available, CategoryOpensAt: opensAt };
    });
  }

  /**
   * One change applied to many menu rows, all or nothing.
   *
   * The whole selection is checked first: if any dish no longer exists the
   * change is refused, rather than landing on the rest and leaving the manager
   * to work out which ones missed. Scalar fields are one UPDATE for every row;
   * a link field is re-synced only on the dishes whose set actually changes.
   *
   * @param {string[]} ids
   * @param {Object} changes - Validated by bulkUpdateSchema.
   * @param {string} tenantId
   * @param {string} userPhone
   * @returns {Promise<{updated: number, items: Array<{Id: string, ItemName: string|null, Active: number}>}>}
   */
  async bulkUpdate(ids, changes, tenantId, userPhone) {
    const unique = [...new Set(ids)];
    const inList = new Array(unique.length).fill('?').join(', ');

    return withTransaction(async (connection) => {
      const [targets] = await connection.execute(
        this.queries.SELECT_BULK_TARGETS.replace(':ids', inList),
        [tenantId, ...unique],
      );
      if (targets.length !== unique.length) {
        const found = new Set(targets.map((t) => t.Id));
        const missing = unique.filter((id) => !found.has(id)).length;
        throw new HttpError(
          `${missing} of the selected items no longer exist. Refresh the list and try again.`,
          MESSAGES.HTTP_STATUS.NOT_FOUND,
        );
      }

      const sets = [];
      const params = [];
      BULK_SCALARS.forEach((column) => {
        if (changes[column] === undefined) return;
        sets.push(`${column} = ?`);
        params.push(column === 'Active' ? (changes[column] ? 1 : 0) : changes[column]);
      });
      if (sets.length > 0) {
        await connection.execute(
          `UPDATE pos_item_meta SET ${sets.join(', ')}, UpdatedOn = NOW(), UpdatedBy = ?`
          + ` WHERE TenantId = ? AND Id IN (${inList})`,
          [...params, userPhone, tenantId, ...unique],
        );
      }

      for (const [field, query] of Object.entries(BULK_LINKS)) {
        const change = changes[field];
        if (!change) continue;
        const [linkRows] = await connection.execute(
          this.queries[query].replace(':ids', inList),
          [tenantId, ...unique],
        );
        const current = new Map(unique.map((id) => [id, []]));
        linkRows.forEach((r) => current.get(r.ItemMetaId)?.push(r.LinkId));
        for (const id of unique) {
          const next = applyListChange(current.get(id), change);
          if (!sameList(current.get(id), next)) {
            await this.syncLinks(connection, id, tenantId, userPhone, { [field]: next });
          }
        }
      }

      return {
        updated: unique.length,
        items: targets.map((t) => ({
          Id: t.Id,
          ItemName: t.ItemName ?? null,
          Active: changes.Active !== undefined ? (changes.Active ? 1 : 0) : t.Active,
        })),
      };
    });
  }

  // Menu rows always carry the tax breakdown — the price they show is the one a
  // customer pays, so net/tax/gross is more useful here than a raw amount. The
  // SELECTs already join costinfo, so this adds one batched chain query, not N.
  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand);
    const rows = (result.data || []).map((r) => this.normalizeRow(r));
    const priced = await attachBreakdown(rows, tenantId, PRICING_OPTS);
    return { ...result, data: await this.attachAvailability(priced, tenantId) };
  }

  /**
   * One menu row, with its nutrition attached.
   *
   * Nutrition is fetched HERE and not in getAll: it is a 1:1 optional row that
   * only the edit form reads, so joining it into the list would add a column
   * block to every page for data no list renders. `null` when the dish has no
   * nutrition recorded, which is the common case.
   */
  async getById(id, tenantId, expand) {
    const row = this.normalizeRow(await super.getById(id, tenantId, expand));
    if (!row) return row;
    const nutritionRows = await executeQuery(this.queries.SELECT_NUTRITION, [id, tenantId]);
    const withNutrition = { ...row, Nutrition: nutritionRows[0] ?? null };
    const priced = await attachBreakdownToOne(withNutrition, tenantId, PRICING_OPTS);
    const [withAvailability] = await this.attachAvailability([priced], tenantId);
    return withAvailability;
  }
}

const service = new PosItemMetaService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  bulkUpdate: (ids, changes, tenantId, userPhone) => service.bulkUpdate(ids, changes, tenantId, userPhone),
  applyListChange,
  remove: (id, tenantId) => service.delete(id, tenantId),
};
