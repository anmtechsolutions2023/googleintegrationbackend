// src/modules/posdine/dine.menu.service.js
// The menu a guest sees at one table: this branch's dishes, on the QR channel,
// priced exactly as the till prices them, with trading hours applied.
//
// WHICH DISHES. A restaurant that has linked dishes to the QR channel gets
// exactly those (plus dishes linked to no channel at all, which the till treats
// as sold everywhere). One that has not yet gets the dine-in menu, so switching
// the feature on needs no extra setup. QR_TABLE_ORDERING_DESIGN.md §3.4.
//
// Prices come from pricing.priceCostInfos — the same breakdown Menu Master and
// the till show — and availability from the category schedule, evaluated at
// ONE instant for the whole menu. Nothing here is trusted later: the order path
// re-prices and re-checks every line on its own.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const pricingService = require('../pricing/pricing.service');
const categorySchedule = require('../poscategoryschedule/poscategoryschedule.service');
const dailyStock = require('../posdailystock/posdailystock.service');
const dailyStockRepo = require('../posdailystock/posdailystock.repository');
const { resolve: resolveStock } = require('../posdailystock/posdailystock.resolver');
const qrChannel = require('../posqr/posqr.channel');

const Q = QUERIES.POS_DINE;

const toArray = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; }
  }
  return [];
};

const placeholders = (n) => new Array(n).fill('?').join(', ');

/**
 * Keeps the dishes a guest at a table may order.
 * @param {Array<Object>} rows - MENU_FOR_BRANCH rows.
 * @param {string|null} qrChannelId
 * @param {string|null} fallbackChannelId - Dine-in.
 * @returns {Array<Object>}
 */
const filterForQrChannel = (rows, qrChannelId, fallbackChannelId) => {
  const withChannels = rows.map((r) => ({ ...r, channels: toArray(r.ChannelIds) }));
  const anyOnQr = qrChannelId && withChannels.some((r) => r.channels.includes(qrChannelId));
  const wanted = anyOnQr ? qrChannelId : fallbackChannelId;
  return withChannels.filter((r) => r.channels.length === 0 || (wanted && r.channels.includes(wanted)));
};

const loadOptionsTx = async (conn, ids, tenantId) => {
  if (ids.length === 0) return { variants: new Map(), addons: new Map() };
  const inList = placeholders(ids.length);
  const [[variantRows], [addonRows]] = await Promise.all([
    conn.execute(Q.VARIANTS_FOR_ITEMS.replace(':ids', inList), [tenantId, ...ids]),
    conn.execute(Q.ADDONS_FOR_ITEMS.replace(':ids', inList), [tenantId, ...ids]),
  ]);

  const variants = new Map();
  variantRows.forEach((r) => {
    const list = variants.get(r.ItemMetaId) || [];
    list.push({ id: r.Id, name: r.Name, price: Number(r.Price) || 0 });
    variants.set(r.ItemMetaId, list);
  });

  // item → group → options, keeping the SQL order.
  const addons = new Map();
  addonRows.forEach((r) => {
    const groups = addons.get(r.ItemMetaId) || new Map();
    const group = groups.get(r.GroupId) || {
      id: r.GroupId,
      name: r.GroupName,
      min: Number(r.MinSelection) || 0,
      max: Number(r.MaxSelection) || 0,
      options: [],
    };
    group.options.push({ id: r.AddonId, name: r.AddonName, price: Number(r.Price) || 0 });
    groups.set(r.GroupId, group);
    addons.set(r.ItemMetaId, groups);
  });
  return { variants, addons };
};

/**
 * @param {Object} ctx - The diner's session context (tenantId, branchId).
 * @returns {Promise<{categories: Array<{id, name, items: Array}>}>}
 */
const getMenu = async ({ tenantId, branchId }) => {
  const { rows, variants, addons } = await withConnection(async (conn) => {
    const [all] = await conn.execute(Q.MENU_FOR_BRANCH, [tenantId, branchId]);
    const qrChannelId = await qrChannel.ensureQrChannelTx(conn, tenantId);
    const fallbackId = await qrChannel.findFallbackChannelIdTx(conn, tenantId);
    const kept = filterForQrChannel(all, qrChannelId, fallbackId);
    const options = await loadOptionsTx(conn, kept.map((r) => r.Id), tenantId);
    return { rows: kept, ...options };
  });

  const [prices, rules, timeZone] = await Promise.all([
    pricingService.priceCostInfos(rows.map((r) => r.CostInfoId).filter(Boolean), tenantId),
    categorySchedule.getAllForTenant(tenantId),
    categorySchedule.getTimeZone(),
  ]);
  const byCategory = categorySchedule.indexByCategory(rules);
  const when = new Date();

  // Today's portion counts, ONE read for the whole menu — same shape as the
  // schedule rules above and for the same reason.
  const day = dailyStock.dayOf();
  const stockById = await withConnection((conn) => dailyStockRepo.findForItems(
    conn, { itemMetaIds: rows.map((r) => r.Id), businessDate: day }, tenantId,
  ));

  const categories = new Map();
  rows.forEach((r) => {
    const price = r.CostInfoId ? prices.get(r.CostInfoId) : null;
    // A dish with no price is not something a guest can order from a phone.
    if (!price || !price.found) return;
    const { available, opensAt } = categorySchedule.availabilityOf(
      byCategory.get(r.CategoryId), when, timeZone,
    );
    const stock = resolveStock(stockById.get(r.Id) || { StockTracked: r.StockTracked ? 1 : 0 });
    const key = r.CategoryId || 'uncategorised';
    const category = categories.get(key) || {
      id: r.CategoryId || null, name: r.CategoryName || 'More', items: [],
    };
    category.items.push({
      id: r.Id,
      name: r.ItemName,
      description: r.Description || null,
      isVeg: r.FoodTypeIsVeg === null || r.FoodTypeIsVeg === undefined ? null : !!r.FoodTypeIsVeg,
      foodType: r.FoodTypeName || null,
      portionSize: r.PortionSize || null,
      serves: r.ServesCount || null,
      // What the guest pays for one, before options: the gross the till shows.
      price: Number(price.grossAmount) || 0,
      taxIncluded: !!price.isTaxIncluded,
      // `available` now means orderable: on the menu, its section open, AND
      // portions left. A guest cannot act on the difference between a dish that
      // ran out and one nobody counted — but `stockState` carries it for the
      // label, because "Sold out" and "Not available today" read differently.
      available: available && stock.stockState !== 'sold_out'
        && stock.stockState !== 'unavailable',
      opensAt: available ? null : (opensAt ? String(opensAt).slice(0, 5) : null),
      stockState: stock.stockState,
      // Null unless the dish keeps a count. Shown as "Only 3 left" by the app.
      remaining: stock.remaining,
      maxPerOrder: stock.maxPerOrder,
      variants: variants.get(r.Id) || [],
      addonGroups: [...(addons.get(r.Id) || new Map()).values()],
    });
    categories.set(key, category);
  });

  return { categories: [...categories.values()] };
};

module.exports = { getMenu, filterForQrChannel };
