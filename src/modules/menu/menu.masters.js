// src/modules/menu/menu.masters.js
// Names in, ids out — creating what does not exist yet.
//
// The dish editor and the menu file both name things the way a person does:
// "Desserts", "Large", "GST 5%", "Chef special". This module turns each name
// into the id the tables need, and creates the record when there is none, so
// adding a dish never starts with a detour through five other screens.
//
// WHAT IS NEVER CREATED
// Branches, channels and portals are looked up only. A typo there ("Delivary")
// is an error, not a new outlet: those carry store ids, credentials and
// settlement accounts that no file or form field can supply.
//
// Everything runs on the caller's connection, inside its transaction. A row
// that fails leaves nothing behind, and the import's preview — the same code,
// rolled back — reports exactly what applying would create.

const { v4: uuidv4 } = require('uuid');
const { QUERIES, TAX_GROUP_DEFAULTS, IMPORT } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const category = require('../category/category.service');
const uom = require('../uom/uom.service');
const taxGroup = require('../taxgroup/taxgroup.service');
const taxComponents = require('../taxgroup/taxgroup.components');

const Q = () => QUERIES.MENU;

/** "  Chef   special " → "Chef special". */
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Two spellings of one label compare equal: "Non-Veg" = "non veg" = "NONVEG". */
const key = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

const bad = (message) => new HttpError(message, 400);

/**
 * A fresh resolution context — one per save, or one per import file so a
 * hundred rows naming "Mains" find one category.
 */
const newContext = (tenantId, userPhone) => ({
  tenantId,
  userPhone,
  cache: new Map(),
  lists: new Map(),
  // Names this run created, by kind — what the review and the editor's
  // "Saving will also create" panel list.
  created: {},
  // Tax rules carried over from the item importer — see ensureTaxGroup.
  taxAsk: new Map(),
  groupHadRates: new Map(),
});

const noteCreated = (ctx, kind, name) => {
  ctx.created[kind] = ctx.created[kind] || [];
  if (!ctx.created[kind].includes(name)) ctx.created[kind].push(name);
};

/** A whole master list, read once per context. */
const listOf = async (conn, ctx, sqlKey) => {
  if (!ctx.lists.has(sqlKey)) {
    const [rows] = await conn.execute(Q()[sqlKey], [ctx.tenantId]);
    ctx.lists.set(sqlKey, rows);
  }
  return ctx.lists.get(sqlKey);
};

/** Add a row a run just created to its cached list, so later rows see it. */
const remember = (ctx, sqlKey, row) => {
  if (ctx.lists.has(sqlKey)) ctx.lists.get(sqlKey).push(row);
};

/** Find in a list by name (or code), comparing keys. */
const findIn = (rows, name, { byCode = false } = {}) => {
  const k = key(name);
  return rows.find((r) => key(r.Name) === k || (byCode && r.Code && key(r.Code) === k)) || null;
};

/**
 * A unique code for a table that requires one: "Chef special" → "CHEF-SPECIAL",
 * "CHEF-SPECIAL-2" when taken.
 */
const makeCode = async (conn, ctx, table, name) => {
  const base = clean(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'X';
  for (let n = 1; n < 100; n += 1) {
    const code = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    const [rows] = await conn.execute(Q().CODE_TAKEN[table], [ctx.tenantId, code]);
    if (!rows.length) return code;
  }
  return `${base.slice(0, 30)}-${uuidv4().slice(0, 8).toUpperCase()}`;
};

// ── Lookup-only ──────────────────────────────────────────────────────────────

const lookupOnly = (sqlKey, what) => async (conn, ctx, name) => {
  const rows = await listOf(conn, ctx, sqlKey);
  const hit = findIn(rows, name, { byCode: true });
  if (!hit) {
    const known = rows.map((r) => r.Name).join(', ') || 'none set up yet';
    throw bad(`${what} “${clean(name)}” doesn't exist. Known: ${known}. ${what}s are never created from here.`);
  }
  return hit;
};

const findBranch = lookupOnly('BRANCHES', 'Branch');
const findChannel = lookupOnly('CHANNELS', 'Channel');
const findPortal = lookupOnly('PORTALS', 'Portal');

// ── Find or create ───────────────────────────────────────────────────────────

/**
 * A category, by name or "Parent › Child" (also "Parent > Child"). Each level
 * is found or created; a child is matched under its own parent only.
 * @returns {Promise<string>} The leaf's id.
 */
const ensureCategory = async (conn, ctx, path) => {
  const parts = clean(path).split(/\s*(?:›|>)\s*/).map(clean).filter(Boolean);
  if (!parts.length) throw bad('Every dish needs a category.');
  let parentId = null;
  for (const part of parts) {
    const cacheKey = `cat:${parentId || ''}:${key(part)}`;
    if (ctx.cache.has(cacheKey)) {
      parentId = ctx.cache.get(cacheKey);
      continue;
    }
    const [rows] = await conn.execute(Q().CATEGORY_BY_NAME_PARENT, [ctx.tenantId, part, parentId, parentId]);
    let id = rows[0]?.Id;
    if (!id) {
      const made = await category.createTx(conn, { Name: part, ParentId: parentId, Active: true }, ctx.tenantId, ctx.userPhone);
      id = made.id;
      noteCreated(ctx, 'categories', parts.slice(0, parts.indexOf(part) + 1).join(' › '));
    }
    ctx.cache.set(cacheKey, id);
    parentId = id;
  }
  return parentId;
};

const ensureUnit = async (conn, ctx, name) => {
  const n = clean(name);
  if (!n) throw bad('Every dish needs a unit (Plate, Piece, Glass…).');
  const rows = await listOf(conn, ctx, 'UNITS');
  const hit = findIn(rows, n);
  if (hit) return hit.Id;
  const made = await uom.createTx(conn, { UnitName: n, IsPrimary: true, Active: true }, ctx.tenantId, ctx.userPhone);
  remember(ctx, 'UNITS', { Id: made.id, Name: n });
  noteCreated(ctx, 'units', n);
  return made.id;
};

/** A diet (food type). A new one is veg unless its name says otherwise. */
const ensureFoodType = async (conn, ctx, name) => {
  const n = clean(name);
  if (!n) throw bad('Every dish needs a diet (Veg, Non-Veg, Egg…).');
  const rows = await listOf(conn, ctx, 'FOOD_TYPES');
  const hit = findIn(rows, n, { byCode: true });
  if (hit) return hit.Id;
  const isVeg = /veg|vegan|jain/i.test(n) && !/non/i.test(n) ? 1 : 0;
  const id = uuidv4();
  const code = await makeCode(conn, ctx, 'pos_food_type', n);
  await conn.execute(QUERIES.POS_FOOD_TYPE.INSERT,
    [id, ctx.tenantId, n, code, null, rows.length + 1, isVeg, 1, ctx.userPhone, ctx.userPhone]);
  remember(ctx, 'FOOD_TYPES', { Id: id, Name: n, Code: code, IsVeg: isVeg });
  noteCreated(ctx, 'diets', n);
  return id;
};

const simpleEnsure = ({ list, table, insertSql, params, kind }) => async (conn, ctx, name, extra = {}) => {
  const n = clean(name);
  if (!n) return null;
  const rows = await listOf(conn, ctx, list);
  const hit = findIn(rows, n, { byCode: true });
  if (hit) return hit.Id;
  const id = uuidv4();
  const code = await makeCode(conn, ctx, table, n);
  await conn.execute(insertSql(), params({ id, ctx, name: n, code, sort: rows.length + 1, extra }));
  remember(ctx, list, { Id: id, Name: n, Code: code, ...extra.row });
  noteCreated(ctx, kind, n);
  return id;
};

const ensureMeatType = simpleEnsure({
  list: 'MEAT_TYPES', table: 'pos_meat_type', kind: 'meatTypes',
  insertSql: () => QUERIES.POS_MEAT_TYPE.INSERT,
  params: ({ id, ctx, name, code, sort }) => [id, ctx.tenantId, name, code, null, sort, 1, ctx.userPhone, ctx.userPhone],
});

const ensureTag = simpleEnsure({
  list: 'TAGS', table: 'pos_menu_tag', kind: 'tags',
  insertSql: () => QUERIES.POS_MENU_TAG.INSERT,
  // A new tag is filed under CATEGORY, the type the editor offers first.
  params: ({ id, ctx, name, code, sort }) => [id, ctx.tenantId, name, code, 'CATEGORY', sort, 1, ctx.userPhone, ctx.userPhone],
});

/**
 * A variant by name. A new variant's default price is the first surcharge it
 * was created with; every dish still prices it its own way.
 */
const ensureVariant = simpleEnsure({
  list: 'VARIANTS', table: 'pos_variant', kind: 'variants',
  insertSql: () => QUERIES.POS_VARIANT.INSERT,
  params: ({ id, ctx, name, code, sort, extra }) => [
    id, ctx.tenantId, name, code, null, sort, Number(extra.price) || 0, 1, ctx.userPhone, ctx.userPhone,
  ],
});

/** An add-on group by name; a new one lets the guest pick none or one. */
const ensureAddonGroup = simpleEnsure({
  list: 'ADDON_GROUPS', table: 'pos_addon_group', kind: 'addonGroups',
  insertSql: () => QUERIES.POS_ADDON_GROUP.INSERT,
  params: ({ id, ctx, name, code, sort, extra }) => [
    id, ctx.tenantId, name, code, null,
    Number.isFinite(Number(extra.min)) ? Number(extra.min) : 0,
    Number.isFinite(Number(extra.max)) && extra.max !== '' && extra.max !== undefined ? Number(extra.max) : 1,
    sort, 1, ctx.userPhone, ctx.userPhone,
  ],
});

const isExempt = (name) => !clean(name)
  || clean(name).toLowerCase() === String(TAX_GROUP_DEFAULTS.EXEMPT_NAME).toLowerCase();

/**
 * A tax group by name, with its rates — the item importer's rules, unchanged:
 *
 *   * blank or the Exempt group: sold tax-free; rates may not be attached;
 *   * a NEW group must say its rates, so nothing is silently taxed at 0%;
 *   * an existing group's rates are never changed from here — asking for
 *     different ones is an error that says where to change them;
 *   * one file cannot ask one group for two different sets of rates.
 *
 * @param {Array<{name:string, value:string|number}>} [components]
 * @returns {Promise<string>} The group id.
 */
const ensureTaxGroup = async (conn, ctx, name, components) => {
  const n = isExempt(name) ? TAX_GROUP_DEFAULTS.EXEMPT_NAME : clean(name);
  const asked = Array.isArray(components) && components.length ? components : null;

  if (isExempt(n) && asked) {
    throw bad(`“${TAX_GROUP_DEFAULTS.EXEMPT_NAME}” carries no rates. Give these rates a tax group name of their own.`);
  }

  const rows = await listOf(conn, ctx, 'TAX_GROUPS');
  let hit = findIn(rows, n);
  let id = hit?.Id;
  if (!id) {
    if (!isExempt(n) && !asked) {
      throw bad(`Tax group “${n}” is new — give its rates too, e.g. CGST:2.5|SGST:2.5.`);
    }
    const made = await taxGroup.createTx(conn, { Name: n, Active: true }, ctx.tenantId, ctx.userPhone);
    id = made.id;
    hit = { Id: id, Name: n };
    remember(ctx, 'TAX_GROUPS', hit);
    noteCreated(ctx, 'taxGroups', asked ? `${n} (${asked.map((c) => `${c.name} ${c.value}%`).join(' + ')})` : n);
  }
  if (isExempt(n) || !asked) return id;

  const signature = taxComponents.signature(asked);
  const before = ctx.taxAsk.get(id);
  if (before && before !== signature) {
    throw bad(`Tax group “${n}” is given two different sets of rates. Use the same rates everywhere it appears.`);
  }
  ctx.taxAsk.set(id, signature);

  if (!ctx.groupHadRates.has(id)) {
    const [had] = await conn.execute(QUERIES.TAX_GROUP_TAX_TYPE_MAPPER.SELECT_COMPONENTS_OF_GROUP, [id, ctx.tenantId]);
    ctx.groupHadRates.set(id, had.length
      ? taxComponents.signature(had.map((c) => ({ name: c.Name, value: c.Value })))
      : null);
  }
  const already = ctx.groupHadRates.get(id);
  if (already === null) {
    await taxComponents.attachComponentsTx(conn, {
      taxGroupId: id, components: asked, tenantId: ctx.tenantId, userPhone: ctx.userPhone, cache: ctx.cache,
    });
    ctx.groupHadRates.set(id, signature);
  } else if (already !== signature) {
    throw bad(`Tax group “${n}” already has different rates. Change them in Outlet › Tax & GST, or use another group name.`);
  }
  return id;
};

/**
 * "CGST:2.5|SGST:2.5" → [{name, value}]. Empty → undefined (not stated).
 * The importer's notation, so an old template's column still reads.
 */
const parseTaxComponents = (text) => {
  const t = clean(text);
  if (!t) return undefined;
  return t.split(/[|;,]/).map(clean).filter(Boolean).map((part) => {
    const [name, value] = part.split(':').map(clean);
    if (!name || value === undefined || value === '' || !Number.isFinite(Number(value))) {
      throw bad(`Tax rate “${part}” should look like CGST:2.5.`);
    }
    return { name: name.toUpperCase(), value: String(Number(value)) };
  });
};

module.exports = {
  clean, key, newContext, listOf, findIn, makeCode, noteCreated,
  findBranch, findChannel, findPortal,
  ensureCategory, ensureUnit, ensureFoodType, ensureMeatType, ensureTag,
  ensureVariant, ensureAddonGroup, ensureTaxGroup, parseTaxComponents, isExempt,
  DEFAULT_TAX_COMPONENTS: IMPORT.DEFAULT_TAX_COMPONENTS,
};
