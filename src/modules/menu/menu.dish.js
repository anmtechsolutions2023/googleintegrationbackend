// src/modules/menu/menu.dish.js
// A dish, read and written as ONE thing.
//
// In the tables a dish is spread over a dozen of them: the catalogue item and
// its cost record, one menu entry per branch with its own cost record, the
// channel / variant / add-on / tag links of each entry, nutrition, and a
// portal listing per entry. The forms made people assemble that by hand, in
// order. Here it is one object — a "dish" — that the editor edits, the menu
// file is converted into, and the export writes out.
//
// THE DISH OBJECT
//   { itemId, code, name, category, description, diet, meatType, unit,
//     sku, barcode, hsn, sac,
//     price, taxGroup, taxComponents, taxIncluded,
//     branches: [{ branchId, channelIds: [], price }],      ← where it is sold
//     variants: [{ name, surcharge }], addonGroups: [name], tags: [name],
//     serves, portion, prepMin, maxPerOrder, stockTracked,
//     nutrition: { ServingSizeG, Calories, … , Allergens } | null,
//     portals: [{ portalId, listed, price, name }],
//     status: 'Active' | 'Hidden', hasPhoto, photoVersion }
//
// PER-DISH, NOT PER-BRANCH
// Diet, options, tags, serving and nutrition are written to every branch
// entry alike. Today they are stored per entry; where two branches differ,
// the editor shows the first branch's and saving makes them the same. The
// old Menu Master grid still edits one branch entry at a time for anyone who
// needs a difference.
//
// PRICES ARE COST RECORDS, NEVER EDITED IN PLACE
// A settled bill line references the cost record it was priced from, so a
// changed price is a NEW cost record and the old one is left as history —
// the rule the item importer and the forms already follow.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const costInfo = require('../costinfo/costinfo.service');
const itemDetail = require('../itemdetail/itemdetail.service');
const itemMeta = require('../positemmeta/positemmeta.service');
const m = require('./menu.masters');

const Q = () => QUERIES.MENU;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const money = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

const NUTRITION_FIELDS = ['ServingSizeG', 'Calories', 'ProteinG', 'CarbohydrateG', 'SugarG',
  'FatG', 'SaturatedFatG', 'FibreG', 'SodiumMg', 'Allergens'];

/** Replace `:items` with an IN list on the given column, or with nothing. */
const scoped = (sql, column, itemIds) => (itemIds
  ? sql.replace(':items', `AND ${column} IN (${itemIds.map(() => '?').join(', ')})`)
  : sql.replace(':items', ''));

const groupBy = (rows, k) => {
  const out = new Map();
  rows.forEach((r) => {
    const list = out.get(r[k]) || [];
    list.push(r);
    out.set(r[k], list);
  });
  return out;
};

/**
 * Every dish (or the given ones) as dish objects, in a fixed ten queries.
 *
 * @param {Object} conn
 * @param {string} tenantId
 * @param {string[]|null} [itemIds] - null for the whole menu.
 * @returns {Promise<Object[]>}
 */
const loadDishes = async (conn, tenantId, itemIds = null) => {
  if (itemIds && itemIds.length === 0) return [];
  const ids = itemIds ? [...new Set(itemIds)] : null;
  const p = ids ? [tenantId, ...ids] : [tenantId];

  const run = async (sqlKey, column) => (await conn.execute(scoped(Q()[sqlKey], column, ids), p))[0];
  const [items, metas, channels, variants, groups, tags, nutrition, listings, [taxRows]] = await Promise.all([
    run('DISH_ITEMS', 'i.Id'),
    run('DISH_METAS', 'm.ItemDetailId'),
    run('DISH_CHANNELS', 'm.ItemDetailId'),
    run('DISH_VARIANTS', 'm.ItemDetailId'),
    run('DISH_ADDON_GROUPS', 'm.ItemDetailId'),
    run('DISH_TAGS', 'm.ItemDetailId'),
    run('DISH_NUTRITION', 'm.ItemDetailId'),
    run('DISH_LISTINGS', 'm.ItemDetailId'),
    conn.execute(Q().TAX_COMPONENTS, [tenantId]),
  ]);

  const metasByItem = groupBy(metas, 'ItemDetailId');
  const channelsByMeta = groupBy(channels, 'ItemMetaId');
  const variantsByMeta = groupBy(variants, 'ItemMetaId');
  const groupsByMeta = groupBy(groups, 'ItemMetaId');
  const tagsByMeta = groupBy(tags, 'ItemMetaId');
  const nutritionByMeta = new Map(nutrition.map((n) => [n.ItemMetaId, n]));
  const listingsByMeta = groupBy(listings, 'ItemMetaId');
  const taxByGroup = groupBy(taxRows, 'TaxGroupId');

  return items.map((i) => {
    const all = metasByItem.get(i.Id) || [];
    const live = all.filter((x) => Number(x.Active) === 1);
    const hidden = Number(i.Active) !== 1;
    // A hidden dish has every entry switched off; the branches it would come
    // back on are the ones it has an entry for.
    const selling = hidden ? all : live;
    // The entry whose options stand for the dish — see PER-DISH above.
    const lead = live[0] || all[0] || null;
    const leadId = lead?.Id;

    const portals = new Map();
    selling.forEach((meta) => (listingsByMeta.get(meta.Id) || []).forEach((l) => {
      const had = portals.get(l.PortalId);
      if (had && had.listed) return;
      portals.set(l.PortalId, {
        portalId: l.PortalId,
        listed: Number(l.Active) === 1,
        price: money(l.OverrideAmount),
        name: l.ListedName || null,
      });
    }));

    const base = money(i.Amount);
    const n = leadId ? nutritionByMeta.get(leadId) : null;
    return {
      itemId: i.Id,
      code: i.Code || null,
      name: i.Name,
      category: i.ParentCategoryName ? `${i.ParentCategoryName} › ${i.CategoryName}` : (i.CategoryName || null),
      description: i.Description || null,
      diet: lead?.FoodTypeName || null,
      meatType: lead?.MeatTypeName || null,
      unit: i.UnitName || null,
      sku: i.SKU || null,
      barcode: i.Barcode || null,
      hsn: i.HSNCode || null,
      sac: i.SACCode || null,
      price: base,
      taxGroup: i.TaxGroupName || null,
      taxComponents: (taxByGroup.get(i.TaxGroupId) || []).map((t) => ({ name: t.Name, value: String(Number(t.Value)) })),
      taxIncluded: !!Number(i.IsTaxIncluded),
      branches: selling.map((meta) => ({
        branchId: meta.BranchDetailId,
        channelIds: (channelsByMeta.get(meta.Id) || []).map((c) => c.ChannelId),
        // Only a price that differs from the base is the branch's own.
        price: meta.CostInfoId && meta.CostInfoId !== i.CostInfoId && money(meta.MetaAmount) !== base
          ? money(meta.MetaAmount) : null,
      })),
      variants: (variantsByMeta.get(leadId) || []).map((v) => ({
        name: v.Name,
        surcharge: money(v.Surcharge !== null && v.Surcharge !== undefined ? v.Surcharge : v.DefaultPrice) || 0,
      })),
      addonGroups: (groupsByMeta.get(leadId) || []).map((g) => g.Name),
      tags: (tagsByMeta.get(leadId) || []).map((t) => t.Name),
      serves: lead?.ServesCount ?? null,
      portion: lead?.PortionSize ?? null,
      prepMin: lead?.PrepTimeMinutes ?? null,
      maxPerOrder: lead?.MaxPerOrder ?? null,
      stockTracked: !!Number(lead?.StockTracked || 0),
      nutrition: n ? Object.fromEntries(NUTRITION_FIELDS.map((f) => [f, n[f] === undefined ? null : (f === 'Allergens' ? n[f] : num(n[f]))])) : null,
      portals: [...portals.values()],
      status: hidden ? 'Hidden' : 'Active',
      hasPhoto: i.PhotoVersion !== null && i.PhotoVersion !== undefined,
      photoVersion: i.PhotoVersion === null || i.PhotoVersion === undefined ? null : Number(i.PhotoVersion),
    };
  });
};

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * The cost record for a price: the current one when nothing changed, else a
 * new one (never edited in place — see the header).
 */
const costRecord = async (conn, ctx, current, { amount, taxGroupId, taxIncluded }) => {
  if (current
    && money(current.Amount) === money(amount)
    && current.TaxGroupId === taxGroupId
    && !!Number(current.IsTaxIncluded) === !!taxIncluded) {
    return current.Id;
  }
  const made = await costInfo.createTx(conn, {
    Amount: String(money(amount)), TaxGroupId: taxGroupId, IsTaxIncluded: !!taxIncluded, Active: true,
  }, ctx.tenantId, ctx.userPhone);
  return made.id;
};

const readCost = async (conn, tenantId, id) => {
  if (!id) return null;
  const [rows] = await conn.execute(QUERIES.COST_INFO.SELECT_BY_ID, [id, tenantId]);
  return rows[0] || null;
};

/** Checks a dish object before anything is written. */
const validate = (dish) => {
  const problems = [];
  if (!m.clean(dish.name)) problems.push('a name');
  if (!m.clean(dish.category)) problems.push('a category');
  if (!m.clean(dish.unit)) problems.push('a unit');
  if (!m.clean(dish.diet)) problems.push('a diet');
  if (dish.price === null || dish.price === undefined || !Number.isFinite(Number(dish.price)) || Number(dish.price) < 0) {
    problems.push('a price of 0 or more');
  }
  if (problems.length) throw new HttpError(`${m.clean(dish.name) || 'This dish'} needs ${problems.join(', ')}.`, 400);
  (dish.variants || []).forEach((v) => {
    if (!m.clean(v.name)) throw new HttpError('Every variant needs a name.', 400);
    if (!Number.isFinite(Number(v.surcharge)) || Number(v.surcharge) < 0) {
      throw new HttpError(`Variant “${v.name}” needs an extra price of 0 or more.`, 400);
    }
  });
};

/**
 * Write a whole dish — creating the masters it names — on the caller's
 * transaction.
 *
 * @param {Object} conn - Open transaction.
 * @param {Object} dish - See the header. Branches, channels and portals by id.
 * @param {Object} ctx - From masters.newContext; collects what was created.
 * @returns {Promise<{itemId: string, created: boolean}>}
 */
const saveDish = async (conn, dish, ctx) => {
  validate(dish);
  const { tenantId, userPhone } = ctx;

  // 1 — the masters it names.
  const categoryId = await m.ensureCategory(conn, ctx, dish.category);
  const uomId = await m.ensureUnit(conn, ctx, dish.unit);
  const taxGroupId = await m.ensureTaxGroup(conn, ctx, dish.taxGroup, dish.taxComponents);
  const foodTypeId = await m.ensureFoodType(conn, ctx, dish.diet);
  const meatTypeId = dish.meatType ? await m.ensureMeatType(conn, ctx, dish.meatType) : null;
  const variantIds = [];
  const variantPrices = {};
  for (const v of dish.variants || []) {
    const id = await m.ensureVariant(conn, ctx, v.name, { price: v.surcharge });
    if (!variantIds.includes(id)) variantIds.push(id);
    variantPrices[id] = money(v.surcharge);
  }
  const addonGroupIds = [];
  for (const g of dish.addonGroups || []) {
    const id = await m.ensureAddonGroup(conn, ctx, g);
    if (id && !addonGroupIds.includes(id)) addonGroupIds.push(id);
  }
  const tagIds = [];
  for (const t of dish.tags || []) {
    const id = await m.ensureTag(conn, ctx, t);
    if (id && !tagIds.includes(id)) tagIds.push(id);
  }

  // 2 — the catalogue item and its base price.
  let existing = null;
  if (dish.itemId) {
    const [rows] = await conn.execute(QUERIES.ITEM_DETAIL.SELECT_BY_ID, [dish.itemId, tenantId]);
    existing = rows[0] || null;
    if (!existing) throw new HttpError('That dish no longer exists.', 404);
  }
  const name = m.clean(dish.name);
  const [sameName] = await conn.execute(Q().ITEM_BY_NAME, [tenantId, name]);
  if (sameName[0] && sameName[0].Id !== existing?.Id) {
    throw new HttpError(`Another dish is already called “${name}”.`, 409);
  }
  const code = m.clean(dish.code) || null;
  if (code) {
    const [sameCode] = await conn.execute(Q().ITEM_BY_CODE, [tenantId, code]);
    if (sameCode[0] && sameCode[0].Id !== existing?.Id) {
      throw new HttpError(`Another dish already has the code “${code}”.`, 409);
    }
  }

  const baseCostId = await costRecord(conn, ctx, await readCost(conn, tenantId, existing?.CostInfoId), {
    amount: dish.price, taxGroupId, taxIncluded: dish.taxIncluded,
  });
  const sac = m.clean(dish.sac) || null;
  const hsn = m.clean(dish.hsn) || null;
  const itemFields = {
    Name: name,
    Code: code,
    Description: m.clean(dish.description) || null,
    CategoryId: categoryId,
    UOMId: uomId,
    CostInfoId: baseCostId,
    SKU: m.clean(dish.sku) || null,
    Barcode: m.clean(dish.barcode) || null,
    HSNCode: hsn,
    SACCode: sac,
    // A SAC is a service; an HSN alone is goods — as the importer decides it.
    SupplyType: sac ? 'SERVICE' : (hsn ? 'GOODS' : (existing?.SupplyType || 'SERVICE')),
    Active: dish.status !== 'Hidden',
  };
  let itemId;
  if (existing) {
    await itemDetail.updateTx(conn, existing.Id, itemFields, tenantId, userPhone);
    itemId = existing.Id;
  } else {
    const made = await itemDetail.createTx(conn, itemFields, tenantId, userPhone);
    itemId = made.id;
  }

  // 3 — portals the dish is listed on bring their channel with them: a
  // listing may only exist for a dish sold on the portal's channel.
  const portalRows = await m.listOf(conn, ctx, 'PORTALS');
  const portalById = new Map(portalRows.map((p) => [p.Id, p]));
  const listedPortals = (dish.portals || []).filter((p) => p.listed);
  const portalChannels = listedPortals.map((p) => portalById.get(p.portalId)?.ChannelId).filter(Boolean);

  // 4 — one menu entry per branch it is sold at.
  const [metaRows] = await conn.execute(
    scoped(Q().DISH_METAS, 'm.ItemDetailId', [itemId]), [tenantId, itemId],
  );
  const metaByBranch = new Map(metaRows.map((r) => [r.BranchDetailId, r]));
  const hidden = dish.status === 'Hidden';
  const keptMetaIds = [];
  for (const b of dish.branches || []) {
    const channelIds = [...new Set([...(b.channelIds || []), ...portalChannels])];
    const current = metaByBranch.get(b.branchId);
    const branchCostId = b.price === null || b.price === undefined || money(b.price) === money(dish.price)
      ? baseCostId
      : await costRecord(conn, ctx, await readCost(conn, tenantId, current?.CostInfoId === baseCostId ? null : current?.CostInfoId), {
        amount: b.price, taxGroupId, taxIncluded: dish.taxIncluded,
      });
    const fields = {
      ItemDetailId: itemId,
      FoodTypeId: foodTypeId,
      MeatTypeId: meatTypeId,
      CostInfoId: branchCostId,
      ServesCount: num(dish.serves),
      PortionSize: m.clean(dish.portion) || null,
      PrepTimeMinutes: num(dish.prepMin),
      StockTracked: !!dish.stockTracked,
      MaxPerOrder: num(dish.maxPerOrder),
      BranchDetailId: b.branchId,
      Active: !hidden,
    };
    let metaId;
    if (current) {
      metaId = current.Id;
      const [full] = await conn.execute(QUERIES.POS_ITEM_META.SELECT_BY_ID, [metaId, tenantId]);
      const params = itemMeta.prepareUpdateParams(fields, full[0], userPhone, metaId, tenantId)
        .map((x) => (x === undefined ? null : x));
      await conn.execute(QUERIES.POS_ITEM_META.UPDATE, params);
    } else {
      metaId = uuidv4();
      await conn.execute(QUERIES.POS_ITEM_META.INSERT, itemMeta.prepareInsertParams(metaId, fields, tenantId, userPhone));
    }
    keptMetaIds.push(metaId);
    await itemMeta.syncLinksTx(conn, metaId, tenantId, userPhone, {
      ChannelIds: channelIds,
      VariantIds: variantIds,
      VariantPrices: variantPrices,
      AddonGroupIds: addonGroupIds,
      TagIds: tagIds,
    });
    await itemMeta.syncNutritionTx(conn, metaId, tenantId, userPhone, dish.nutrition ?? null);
  }

  // A branch no longer listed keeps its entry, switched off: its past orders
  // and counts still point at it.
  for (const r of metaRows) {
    if (!keptMetaIds.includes(r.Id) && Number(r.Active) === 1) {
      await conn.execute(Q().SET_META_ACTIVE, [0, userPhone, r.Id, tenantId]);
    }
  }

  // 5 — portal listings, on each kept entry.
  for (const p of dish.portals || []) {
    if (!portalById.has(p.portalId)) throw new HttpError('That portal no longer exists.', 404);
    for (const metaId of keptMetaIds) {
      const [found] = await conn.execute(QUERIES.POS_PORTAL_LISTING.SELECT_BY_PORTAL_ITEM, [p.portalId, metaId, tenantId]);
      const listing = found[0] || null;
      if (!listing && !p.listed) continue;
      const overrideId = p.price === null || p.price === undefined || p.price === ''
        ? null
        : await costRecord(conn, ctx, await readCost(conn, tenantId, listing?.PriceOverrideCostInfoId), {
          amount: p.price, taxGroupId, taxIncluded: dish.taxIncluded,
        });
      const listedName = m.clean(p.name) || null;
      if (listing) {
        await conn.execute(Q().UPDATE_LISTING, [p.listed ? 1 : 0, listedName, overrideId, userPhone, listing.Id, tenantId]);
      } else {
        await conn.execute(QUERIES.POS_PORTAL_LISTING.INSERT, [
          uuidv4(), tenantId, p.portalId, metaId, null, listedName, null, overrideId,
          1, 0, null, 'pending', null, 1, userPhone, userPhone,
        ]);
      }
    }
  }

  return { itemId, created: !existing };
};

module.exports = { loadDishes, saveDish, validate, NUTRITION_FIELDS, money };
