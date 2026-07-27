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

module.exports = { getCostInfoIdsByItemMetaIds, getVariantPricesByIds };
