// src/modules/menu/menu.clear.js
// Clearing the menu — the fresh start after a wrong import, or before loading
// a new one. Admins only (see menu.routes).
//
// TWO LEVELS
//   hide  — every dish off every menu (till, QR, portals). Nothing deleted;
//           hours and counts kept, so un-hiding brings the menu back whole.
//   empty — start from an empty menu: delete what can be deleted, hide what
//           cannot, and clear the old menu's category hours and today's
//           portion counts. Optionally remove categories, tags, variants and
//           add-on groups nothing uses any more.
//
// WHAT CAN NEVER BE DELETED
// A dish on a bill line (transactionitemdetail.ItemId), named by an offer, or
// on a table's open order. Deleting the first two would leave invoices, GST
// returns and campaign reports pointing at nothing; deleting the third would
// leave a seated table with a dish that cannot be billed. Those are hidden.
// The tags every tenancy is provisioned with are kept too: they carry their
// types (cuisine, beverage), which a re-import would not recreate.
//
// PREVIEW = APPLY, ROLLED BACK — the same trick as the menu import, so the
// counts in the confirm dialog are exactly what clearing will do.

const { withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const { MENU_TAGS } = require('../mastersetup/posMasters.provision');

const CONFIRM_PHRASE = 'CLEAR MENU';
const CHUNK = 500;
const STANDARD_TAG_CODES = MENU_TAGS.map(([, code]) => code);

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
};

const chunks = (ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
};

/** Run `sql` (with `:ids`) over every chunk of ids; total affected rows. */
const eachChunk = async (conn, sql, tenantId, ids) => {
  let n = 0;
  for (const part of chunks(ids)) {
    const [r] = await conn.execute(sql.replace(':ids', part.map(() => '?').join(', ')), [tenantId, ...part]);
    n += r.affectedRows || 0;
  }
  return n;
};

const SQL = {
  ITEMS: 'SELECT Id FROM itemdetail WHERE TenantId = ?',
  METAS: 'SELECT Id, ItemDetailId FROM pos_item_meta WHERE TenantId = ?',
  SOLD: `SELECT DISTINCT t.ItemId AS Id FROM transactionitemdetail t
          WHERE t.TenantId = ? AND t.ItemId IS NOT NULL`,
  IN_OFFERS: `SELECT TriggerItemId AS Id FROM pos_offer WHERE TenantId = ? AND TriggerItemId IS NOT NULL
              UNION SELECT RewardItemId FROM pos_offer WHERE TenantId = ? AND RewardItemId IS NOT NULL`,
  OPEN_ORDERS: `SELECT Items FROM pos_order
                 WHERE TenantId = ? AND LOWER(COALESCE(Status, '')) NOT IN ('closed', 'settled', 'cancelled')`,
  DELETE_METAS: 'DELETE FROM pos_item_meta WHERE TenantId = ? AND ItemDetailId IN (:ids)',
  DELETE_ITEMS: 'DELETE FROM itemdetail WHERE TenantId = ? AND Id IN (:ids)',
  HIDE_ITEMS: 'UPDATE itemdetail SET Active = 0, UpdatedOn = NOW() WHERE TenantId = ? AND Id IN (:ids)',
  HIDE_METAS: 'UPDATE pos_item_meta SET Active = 0, UpdatedOn = NOW() WHERE TenantId = ? AND ItemDetailId IN (:ids)',
  UNLIST: `UPDATE pos_portal_listing l JOIN pos_item_meta m ON m.Id = l.ItemMetaId
              SET l.Active = 0, l.SyncStatus = 'pending', l.UpdatedOn = NOW()
            WHERE l.TenantId = ? AND l.Active = 1 AND m.ItemDetailId IN (:ids)`,
  CLEAR_COUNTS: 'DELETE FROM pos_item_daily_stock WHERE TenantId = ?',
  CLEAR_HOURS: 'DELETE FROM pos_category_schedule WHERE TenantId = ?',
  // Leaf first: a category with children is kept until its children go, so
  // this runs until it removes nothing.
  UNUSED_CATEGORIES: `DELETE FROM categorydetail
     WHERE TenantId = ?
       AND Id NOT IN (SELECT x.CategoryId FROM (SELECT CategoryId FROM itemdetail WHERE TenantId = ? AND CategoryId IS NOT NULL) x)
       AND Id NOT IN (SELECT y.ParentId FROM (SELECT ParentId FROM categorydetail WHERE TenantId = ? AND ParentId IS NOT NULL) y)
       AND Id NOT IN (SELECT z.TriggerCategoryId FROM (SELECT TriggerCategoryId FROM pos_offer WHERE TenantId = ? AND TriggerCategoryId IS NOT NULL) z)`,
  UNUSED_TAGS: `DELETE FROM pos_menu_tag
     WHERE TenantId = ?
       AND Id NOT IN (SELECT TagId FROM pos_item_meta_tag WHERE TenantId = ?)
       AND Id NOT IN (SELECT TagId FROM pos_category_tag WHERE TenantId = ?)
       AND Code NOT IN (:codes)`,
  UNUSED_VARIANTS: `DELETE FROM pos_variant
     WHERE TenantId = ?
       AND Id NOT IN (SELECT VariantId FROM pos_item_meta_variant WHERE TenantId = ?)
       AND Id NOT IN (SELECT VariantId FROM pos_portal_listing_variant WHERE TenantId = ?)`,
  UNUSED_ADDON_GROUPS: `DELETE FROM pos_addon_group
     WHERE TenantId = ?
       AND Id NOT IN (SELECT AddonGroupId FROM pos_item_meta_addon_group WHERE TenantId = ?)`,
};

class DryRun extends Error {
  constructor(result) { super('dry run'); this.result = result; }
}

/**
 * Clear the menu, or say what clearing would do.
 *
 * @param {{mode: 'hide'|'empty', removeUnused?: boolean, confirm?: string}} options
 * @param {{dryRun: boolean}} run
 * @param {string} tenantId
 * @returns {Promise<Object>} What was (or would be) deleted, hidden and removed.
 */
const clearMenu = async ({ mode, removeUnused = false, confirm }, { dryRun }, tenantId) => {
  if (!['hide', 'empty'].includes(mode)) throw new HttpError('Choose how far to clear the menu.', 400);
  if (!dryRun && String(confirm || '').trim().toUpperCase() !== CONFIRM_PHRASE) {
    throw new HttpError(`Type ${CONFIRM_PHRASE} to confirm.`, 400);
  }

  const work = async (conn) => {
    const ids = (await conn.execute(SQL.ITEMS, [tenantId]))[0].map((r) => r.Id);
    const result = {
      mode, dishes: ids.length, deleted: 0, hidden: 0,
      keptBecause: { sold: 0, offers: 0, openOrders: 0 },
      listingsRemoved: 0, hoursCleared: 0, countsCleared: 0,
      removed: { categories: 0, tags: 0, variants: 0, addonGroups: 0 },
    };
    if (!ids.length) {
      if (dryRun) throw new DryRun(result);
      return result;
    }

    if (mode === 'hide') {
      result.listingsRemoved = await eachChunk(conn, SQL.UNLIST, tenantId, ids);
      await eachChunk(conn, SQL.HIDE_METAS, tenantId, ids);
      result.hidden = await eachChunk(conn, SQL.HIDE_ITEMS, tenantId, ids);
      if (dryRun) throw new DryRun(result);
      return result;
    }

    // ── empty: decide what may go ───────────────────────────────────────────
    const sold = new Set((await conn.execute(SQL.SOLD, [tenantId]))[0].map((r) => r.Id));
    const inOffers = new Set((await conn.execute(SQL.IN_OFFERS, [tenantId, tenantId]))[0].map((r) => r.Id));
    const metaToItem = new Map((await conn.execute(SQL.METAS, [tenantId]))[0].map((r) => [r.Id, r.ItemDetailId]));
    const onOpenOrders = new Set();
    (await conn.execute(SQL.OPEN_ORDERS, [tenantId]))[0].forEach((o) => asArray(o.Items).forEach((line) => {
      const item = metaToItem.get(line?.id ?? line?.Id);
      if (item) onOpenOrders.add(item);
    }));

    const keep = [];
    const remove = [];
    ids.forEach((id) => {
      if (sold.has(id)) { result.keptBecause.sold += 1; keep.push(id); } else if (inOffers.has(id)) { result.keptBecause.offers += 1; keep.push(id); } else if (onOpenOrders.has(id)) { result.keptBecause.openOrders += 1; keep.push(id); } else remove.push(id);
    });

    result.listingsRemoved = await eachChunk(conn, SQL.UNLIST, tenantId, keep);
    await eachChunk(conn, SQL.HIDE_METAS, tenantId, keep);
    result.hidden = await eachChunk(conn, SQL.HIDE_ITEMS, tenantId, keep);
    // Menu entries first; their links, nutrition, counts and portal listings
    // go with them (ON DELETE CASCADE), then the items and their photos.
    const [listed] = remove.length
      ? await conn.execute(
        `SELECT COUNT(*) AS n FROM pos_portal_listing l JOIN pos_item_meta m ON m.Id = l.ItemMetaId
          WHERE l.TenantId = ? AND l.Active = 1 AND m.ItemDetailId IN (${remove.map(() => '?').join(', ')})`,
        [tenantId, ...remove],
      )
      : [[{ n: 0 }]];
    result.listingsRemoved += Number(listed[0].n) || 0;
    await eachChunk(conn, SQL.DELETE_METAS, tenantId, remove);
    result.deleted = await eachChunk(conn, SQL.DELETE_ITEMS, tenantId, remove);

    // The old menu's hours and today's counts.
    result.countsCleared = (await conn.execute(SQL.CLEAR_COUNTS, [tenantId]))[0].affectedRows || 0;
    result.hoursCleared = (await conn.execute(SQL.CLEAR_HOURS, [tenantId]))[0].affectedRows || 0;

    if (removeUnused) {
      for (let pass = 0; pass < 10; pass += 1) {
        const [r] = await conn.execute(SQL.UNUSED_CATEGORIES, [tenantId, tenantId, tenantId, tenantId]);
        result.removed.categories += r.affectedRows || 0;
        if (!r.affectedRows) break;
      }
      const codes = STANDARD_TAG_CODES.length ? STANDARD_TAG_CODES : ['-'];
      result.removed.tags = (await conn.execute(
        SQL.UNUSED_TAGS.replace(':codes', codes.map(() => '?').join(', ')),
        [tenantId, tenantId, tenantId, ...codes],
      ))[0].affectedRows || 0;
      result.removed.variants = (await conn.execute(SQL.UNUSED_VARIANTS, [tenantId, tenantId, tenantId]))[0].affectedRows || 0;
      result.removed.addonGroups = (await conn.execute(SQL.UNUSED_ADDON_GROUPS, [tenantId, tenantId]))[0].affectedRows || 0;
    }

    if (dryRun) throw new DryRun(result);
    return result;
  };

  try {
    const result = await withTransaction(work);
    logger.warn('Menu cleared', { tenantId, ...result, keptBecause: undefined, removed: undefined });
    return result;
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    throw err;
  }
};

module.exports = { clearMenu, CONFIRM_PHRASE };
