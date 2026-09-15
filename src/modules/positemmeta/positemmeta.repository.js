// src/modules/positemmeta/positemmeta.repository.js
// Light lookups over pos_item_meta that other modules need without pulling in
// the full CRUD service.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');

/**
 * Maps menu-row ids to the cost record each one prices from.
 *
 * POS order lines reference a pos_item_meta id (the menu row), not a costinfo.
 * Pricing needs the costinfo, so this bridges the two in a single batched query
 * — an order with 20 lines costs one round trip, not 20.
 *
 * @param {string[]} itemMetaIds
 * @param {string} tenantId
 * @returns {Promise<Map<string, string|null>>} itemMetaId → CostInfoId
 */
const getCostInfoIdsByItemMetaIds = async (itemMetaIds, tenantId) => {
  const ids = [...new Set((itemMetaIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return withConnection(async (conn) => {
    const sql = QUERIES.POS_ITEM_META.SELECT_COSTINFO_BY_IDS.replace(
      ':ids',
      new Array(ids.length).fill('?').join(', '),
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    return new Map(rows.map((r) => [r.Id, r.CostInfoId ?? null]));
  });
};

/**
 * Resolves selected variant ids to their master name + surcharge.
 *
 * Prices come from pos_variant, never from the request, so a client cannot
 * decide what "Large" costs. Inactive variants are excluded — a retired option
 * must stop adding to new orders even if a stale cart still references it.
 *
 * @param {string[]} variantIds
 * @param {string} tenantId
 * @returns {Promise<Map<string, {id:string,name:string,code:string,price:number}>>}
 */
const getVariantPricesByIds = async (variantIds, tenantId) => {
  const ids = [...new Set((variantIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return withConnection(async (conn) => {
    const sql = QUERIES.POS_ITEM_META.SELECT_VARIANT_PRICES_BY_IDS.replace(
      ':ids',
      new Array(ids.length).fill('?').join(', '),
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    return new Map(
      rows.map((r) => [
        r.Id,
        { id: r.Id, name: r.Name, code: r.Code, price: Number(r.Price) || 0 },
      ]),
    );
  });
};

/**
 * Resolves selected add-on ids to their master name, price and owning group.
 *
 * Same contract as `getVariantPricesByIds` — the price is the master's, never
 * the request's, and an inactive add-on (or one whose whole group was retired)
 * simply drops out rather than failing the quote. The group's Min/Max travels
 * with each row because the caller validating a line needs both halves and one
 * query can carry them.
 *
 * @param {string[]} addonIds
 * @param {string} tenantId
 * @returns {Promise<Map<string, Object>>} addonId → {id,name,code,price,groupId,groupName,minSelection,maxSelection}
 */
const getAddonPricesByIds = async (addonIds, tenantId) => {
  const ids = [...new Set((addonIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return withConnection(async (conn) => {
    const sql = QUERIES.POS_ITEM_META.SELECT_ADDON_PRICES_BY_IDS.replace(
      ':ids',
      new Array(ids.length).fill('?').join(', '),
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    return new Map(
      rows.map((r) => [
        r.Id,
        {
          id: r.Id,
          name: r.Name,
          code: r.Code,
          price: Number(r.Price) || 0,
          groupId: r.AddonGroupId,
          groupName: r.GroupName,
          minSelection: Number(r.MinSelection) || 0,
          maxSelection: Number(r.MaxSelection) || 0,
        },
      ]),
    );
  });
};

/**
 * Maps menu-row ids to the add-on groups each dish offers, with their rules.
 *
 * The counterpart to the lookup above: that one answers "what did they pick",
 * this one answers "what were they asked". Only this query can catch a required
 * group nobody answered, because an unanswered group leaves no trace on the line.
 *
 * @param {string[]} itemMetaIds
 * @param {string} tenantId
 * @returns {Promise<Map<string, Array<Object>>>} itemMetaId → [{groupId,groupName,minSelection,maxSelection}]
 */
const getAddonRulesByItemMetaIds = async (itemMetaIds, tenantId) => {
  const ids = [...new Set((itemMetaIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return withConnection(async (conn) => {
    const sql = QUERIES.POS_ITEM_META.SELECT_ADDON_RULES_BY_ITEM_IDS.replace(
      ':ids',
      new Array(ids.length).fill('?').join(', '),
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    const result = new Map();
    rows.forEach((r) => {
      const list = result.get(r.ItemMetaId) || [];
      list.push({
        groupId: r.GroupId,
        groupName: r.GroupName,
        minSelection: Number(r.MinSelection) || 0,
        maxSelection: Number(r.MaxSelection) || 0,
      });
      result.set(r.ItemMetaId, list);
    });
    return result;
  });
};

/**
 * Maps menu-row ids to the CATEGORY each one belongs to.
 *
 * A category's trading hours are what gate an order line, but a line carries
 * the menu row's id — the category is two joins away, on itemdetail. One
 * batched read for the whole cart, the same shape the offer engine already
 * uses this query for.
 *
 * @param {string[]} itemMetaIds
 * @param {string} tenantId
 * @returns {Promise<Map<string, string|null>>} itemMetaId → CategoryId
 */
const getCategoryIdsByItemMetaIds = async (itemMetaIds, tenantId) => {
  const ids = [...new Set((itemMetaIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return withConnection(async (conn) => {
    const sql = QUERIES.POS_ITEM_META.SELECT_CATALOGUE_IDS.replace(
      ':ids',
      new Array(ids.length).fill('?').join(', '),
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    return new Map(rows.map((x) => [x.MetaId, x.CategoryId ?? null]));
  });
};

/**
 * Which of these menu rows are turned off (Active = 0).
 *
 * Off is the manager's switch and it beats a section's trading hours: an open
 * section does not make an Off dish orderable. One batched read for the cart.
 *
 * @param {string[]} itemMetaIds
 * @param {string} tenantId
 * @returns {Promise<Set<string>>}
 */
const getInactiveItemMetaIds = async (itemMetaIds, tenantId) => {
  const ids = [...new Set((itemMetaIds || []).filter(Boolean))];
  if (ids.length === 0) return new Set();

  return withConnection(async (conn) => {
    const sql = QUERIES.POS_ITEM_META.SELECT_INACTIVE_BY_IDS.replace(
      ':ids',
      new Array(ids.length).fill('?').join(', '),
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    return new Set(rows.map((r) => r.Id));
  });
};

module.exports = {
  getInactiveItemMetaIds,
  getCostInfoIdsByItemMetaIds,
  getVariantPricesByIds,
  getAddonPricesByIds,
  getAddonRulesByItemMetaIds,
  getCategoryIdsByItemMetaIds,
};
