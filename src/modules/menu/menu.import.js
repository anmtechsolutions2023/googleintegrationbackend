// src/modules/menu/menu.import.js
// The menu file: rows in, dishes out.
//
// THE FILE
//   menu.csv   — one row per dish (see MENU_FILE.md / the export's header).
//   addons.csv — optional; one row per add-on inside a group.
//   hours.csv  — optional; one row per trading window of a category.
// The browser parses the CSV (utils/csv.js) and posts the rows as JSON, the
// same as the item importer: the person sees the parse before anything moves.
//
// RULES
//   * a row is a dish: matched by `code`, then by `name`; no match = new;
//   * a blank cell keeps the current value; a single `-` clears it;
//   * category, unit, tag, variant, add-on group, diet, meat type and tax group
//     are created when named and missing; branch, channel and portal never are;
//   * each row applies on its own — a bad row is reported and skipped.
//
// PREVIEW = APPLY, ROLLED BACK
// The review is not a guess. It runs exactly the code Apply runs, inside one
// transaction, then rolls it back — so "will create category Desserts" and
// "Paneer Tikka: Zomato ₹345 → ₹350" are what applying would really do. Each
// row runs under its own SAVEPOINT, so a failing row is undone alone and the
// rows around it carry on.

const { withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const { splitOvernight } = require('../poscategoryschedule/poscategoryschedule.service');
const m = require('./menu.masters');
const { loadDishes, saveDish, NUTRITION_FIELDS, money } = require('./menu.dish');
const { v4: uuidv4 } = require('uuid');

const CLEAR = '-';

/** A header the way the browser's parser keys it: lower case, no spaces / _ / -. */
const hkey = (h) => String(h || '').toLowerCase().replace(/[\s_-]/g, '');

/** Row object with every key normalised, values trimmed. */
const normaliseRow = (row) => Object.fromEntries(
  Object.entries(row || {}).filter(([k]) => k !== '__line').map(([k, v]) => [hkey(k), v === null || v === undefined ? '' : String(v).trim()]),
);

/** The first of several aliases a row carries. `undefined` when none. */
const pick = (row, ...names) => {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n)) return row[n];
  }
  return undefined;
};

/** blank → undefined (keep), "-" → null (clear), else the text. */
const cell = (v) => {
  if (v === undefined || v === '') return undefined;
  if (v === CLEAR) return null;
  return v;
};

const list = (v) => String(v).split(';').map(m.clean).filter(Boolean);

const YES = new Set(['yes', 'y', 'true', '1', 'on', 'listed', 'active']);
const NO = new Set(['no', 'n', 'false', '0', 'off', 'not listed', 'hidden']);
const bool = (v, what) => {
  const t = String(v).toLowerCase().trim();
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  throw new HttpError(`${what} should be Yes or No, not “${v}”.`, 400);
};

const number = (v, what, { min = 0 } = {}) => {
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n) || n < min) throw new HttpError(`${what} should be a number${min === 0 ? ' of 0 or more' : ''}, not “${v}”.`, 400);
  return n;
};

/** "Regular=0; Large=+60" → [{name, surcharge}]. A bare name adds nothing. */
const parseVariants = (v) => list(v).map((part) => {
  const [name, price] = part.split('=').map(m.clean);
  return { name, surcharge: price === undefined || price === '' ? 0 : number(price.replace(/^\+/, ''), `Variant “${name}” price`) };
});

const NUTRITION_COLUMNS = {
  servingg: 'ServingSizeG', kcal: 'Calories', calories: 'Calories', proteing: 'ProteinG',
  carbsg: 'CarbohydrateG', carbohydrateg: 'CarbohydrateG', sugarg: 'SugarG', fatg: 'FatG',
  satfatg: 'SaturatedFatG', saturatedfatg: 'SaturatedFatG', fibreg: 'FibreG', fiberg: 'FibreG',
  sodiummg: 'SodiumMg', allergens: 'Allergens',
};

/**
 * What a row says, laid over the dish as it stands (or a blank new dish).
 *
 * @param {Object|null} before - The current dish, or null for a new one.
 * @param {Object} row - Normalised row.
 * @param {Object} refs - { branches, channels, portals } lists, for names and defaults.
 * @returns {Object} The dish to save.
 */
const mergeRow = async (conn, ctx, before, row, refs) => {
  const fresh = !before;
  const d = before ? JSON.parse(JSON.stringify(before)) : {
    itemId: null, code: null, name: null, category: null, description: null, diet: null, meatType: null,
    unit: null, sku: null, barcode: null, hsn: null, sac: null, price: null, taxGroup: null,
    taxComponents: undefined, taxIncluded: false, branches: null, variants: [], addonGroups: [], tags: [],
    serves: null, portion: null, prepMin: null, maxPerOrder: null, stockTracked: false, nutrition: null,
    portals: [], status: 'Active',
  };
  // The current tax rates are not restated on save unless the row states them.
  if (before) d.taxComponents = undefined;

  const text = (field, ...names) => {
    const v = cell(pick(row, ...names));
    if (v !== undefined) d[field] = v === null ? null : m.clean(v);
  };
  text('code', 'code');
  text('name', 'name', 'item', 'dish');
  text('category', 'category');
  text('description', 'description');
  text('diet', 'diet', 'foodtype');
  text('meatType', 'meattype');
  text('unit', 'unit', 'uom');
  text('sku', 'sku');
  text('barcode', 'barcode');
  text('hsn', 'hsn', 'hsncode');
  text('sac', 'sac', 'saccode');
  text('portion', 'portion', 'portionsize');

  const price = cell(pick(row, 'price', 'baseprice'));
  if (price !== undefined) d.price = price === null ? null : number(price, 'Price');
  const tg = cell(pick(row, 'taxgroup'));
  if (tg !== undefined) d.taxGroup = tg;
  const tc = cell(pick(row, 'taxcomponents', 'taxrates'));
  if (tc !== undefined && tc !== null) d.taxComponents = m.parseTaxComponents(tc);
  const ti = cell(pick(row, 'taxincluded', 'gstincluded'));
  if (ti !== undefined) d.taxIncluded = ti === null ? false : bool(ti, 'tax_included');

  [['serves', 'serves'], ['prepMin', 'prepmin', 'preptime', 'preptimeminutes'], ['maxPerOrder', 'maxperorder']]
    .forEach(([field, ...names]) => {
      const v = cell(pick(row, ...names));
      if (v !== undefined) d[field] = v === null ? null : number(v, names[0]);
    });
  const st = cell(pick(row, 'stocktracked', 'countdaily'));
  if (st !== undefined) d.stockTracked = st === null ? false : bool(st, 'stock_tracked');

  const status = cell(pick(row, 'status'));
  if (status !== undefined) {
    if (status === null) d.status = 'Active';
    else if (/^hid/i.test(status) || /^inactive$/i.test(status)) d.status = 'Hidden';
    else if (/^active$/i.test(status)) d.status = 'Active';
    else throw new HttpError(`status should be Active or Hidden, not “${status}”.`, 400);
  }

  const variants = cell(pick(row, 'variants'));
  if (variants !== undefined) d.variants = variants === null ? [] : parseVariants(variants);
  const groups = cell(pick(row, 'addongroups', 'addons'));
  if (groups !== undefined) d.addonGroups = groups === null ? [] : list(groups);
  const tags = cell(pick(row, 'tags'));
  if (tags !== undefined) d.tags = tags === null ? [] : list(tags);

  // Nutrition — any one column touches it; the rest stay as they were.
  let nut = d.nutrition ? { ...d.nutrition } : null;
  Object.entries(NUTRITION_COLUMNS).forEach(([col, field]) => {
    const v = cell(row[col]);
    if (v === undefined) return;
    nut = nut || Object.fromEntries(NUTRITION_FIELDS.map((f) => [f, null]));
    nut[field] = v === null ? null : (field === 'Allergens' ? m.clean(v) : number(v, col));
  });
  if (nut && NUTRITION_FIELDS.every((f) => nut[f] === null || nut[f] === undefined || nut[f] === '')) nut = null;
  d.nutrition = nut;

  // ── Where it is sold ─────────────────────────────────────────────────────
  const allChannelIds = refs.channels.map((c) => c.Id);
  const branchCell = cell(pick(row, 'branches', 'branch'));
  const channelCell = cell(pick(row, 'channels', 'channel'));
  let channelIds;
  if (channelCell !== undefined) {
    if (channelCell === null) channelIds = [];
    else if (/^all$/i.test(m.clean(channelCell))) channelIds = allChannelIds;
    else {
      channelIds = [];
      for (const name of list(channelCell)) {
        channelIds.push((await m.findChannel(conn, ctx, name)).Id);
      }
    }
  }

  let branchIds;
  if (branchCell !== undefined) {
    if (branchCell === null) branchIds = [];
    else if (/^all$/i.test(m.clean(branchCell))) branchIds = refs.branches.map((b) => b.Id);
    else {
      branchIds = [];
      for (const name of list(branchCell)) {
        branchIds.push((await m.findBranch(conn, ctx, name)).Id);
      }
    }
  } else if (fresh) {
    // A new dish goes everywhere unless the row says otherwise.
    branchIds = refs.branches.map((b) => b.Id);
  }

  const had = new Map((d.branches || []).map((b) => [b.branchId, b]));
  if (branchIds) {
    d.branches = branchIds.map((id) => ({
      branchId: id,
      channelIds: channelIds || had.get(id)?.channelIds || allChannelIds,
      price: had.get(id)?.price ?? null,
    }));
  } else if (channelIds) {
    d.branches = (d.branches || []).map((b) => ({ ...b, channelIds }));
  }
  d.branches = d.branches || [];

  // Branch prices: price@<branch>.
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith('price@')) continue;
    const val = cell(v);
    if (val === undefined) continue;
    const label = k.slice('price@'.length);
    const branch = refs.branches.find((b) => m.key(b.Name).toLowerCase() === label.replace(/[^a-z0-9]/g, ''));
    if (!branch) throw new HttpError(`Column price@${label} names a branch that doesn't exist.`, 400);
    const entry = d.branches.find((b) => b.branchId === branch.Id);
    if (!entry) {
      if (val !== null) throw new HttpError(`price@${branch.Name} is set but the dish isn't sold at ${branch.Name}.`, 400);
      continue;
    }
    entry.price = val === null ? null : number(val, `price@${branch.Name}`);
  }

  // Portals: <portal>_listed, <portal>_price, <portal>_name.
  const portals = new Map((d.portals || []).map((p) => [p.portalId, { ...p }]));
  refs.portals.forEach((portal) => {
    const prefixes = [...new Set([m.key(portal.Name).toLowerCase(), m.key(portal.Code || '').toLowerCase()].filter(Boolean))];
    const get = (suffix) => {
      for (const pre of prefixes) {
        if (Object.prototype.hasOwnProperty.call(row, `${pre}${suffix}`)) return cell(row[`${pre}${suffix}`]);
      }
      return undefined;
    };
    const listed = get('listed');
    const pprice = get('price');
    const pname = get('name');
    if (listed === undefined && pprice === undefined && pname === undefined) return;
    const cur = portals.get(portal.Id) || { portalId: portal.Id, listed: false, price: null, name: null };
    if (listed !== undefined) cur.listed = listed === null ? false : bool(listed, `${portal.Name.toLowerCase()}_listed`);
    else if (pprice !== undefined && pprice !== null) cur.listed = true;
    if (pprice !== undefined) cur.price = pprice === null ? null : number(pprice, `${portal.Name.toLowerCase()}_price`);
    if (pname !== undefined) cur.name = pname === null ? null : m.clean(pname);
    portals.set(portal.Id, cur);
  });
  d.portals = [...portals.values()];

  // A blank tax_group on a new dish is the Exempt (0%) group — the masters
  // resolve null to it, exactly as the item importer does.
  return d;
};

// ── Review wording ───────────────────────────────────────────────────────────

const show = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

/** "Paneer Tikka: Zomato price ₹345 → ₹350" — what changes, in words. */
const describeChanges = (before, after, refs) => {
  const out = [];
  const add = (field, a, b) => { if (show(a) !== show(b)) out.push({ field, from: show(a), to: show(b) }); };
  const branchName = (id) => refs.branches.find((b) => b.Id === id)?.Name || 'a branch';
  const channelName = (id) => refs.channels.find((c) => c.Id === id)?.Name || 'a channel';
  const portalName = (id) => refs.portals.find((p) => p.Id === id)?.Name || 'a portal';

  [['name', 'Name'], ['code', 'Code'], ['category', 'Category'], ['description', 'Description'],
    ['diet', 'Diet'], ['meatType', 'Meat type'], ['unit', 'Unit'], ['sku', 'SKU'], ['barcode', 'Barcode'],
    ['hsn', 'HSN'], ['sac', 'SAC'], ['taxGroup', 'Tax group'], ['taxIncluded', 'GST inside price'],
    ['serves', 'Serves'], ['portion', 'Portion'], ['prepMin', 'Prep (min)'], ['maxPerOrder', 'Max per order'],
    ['stockTracked', 'Counted daily'], ['status', 'Status']]
    .forEach(([k, label]) => add(label, before[k], after[k]));
  add('Price', before.price === null ? null : `₹${before.price}`, after.price === null ? null : `₹${money(after.price)}`);
  add('Variants', before.variants.map((v) => `${v.name} +${v.surcharge}`).join('; '), after.variants.map((v) => `${v.name} +${money(v.surcharge)}`).join('; '));
  add('Add-on groups', before.addonGroups.join('; '), after.addonGroups.join('; '));
  // Tags are a set — the order they are written in means nothing.
  add('Tags', [...before.tags].sort().join('; '), [...after.tags].sort().join('; '));
  add('Sold at', before.branches.map((b) => branchName(b.branchId)).join('; '), after.branches.map((b) => branchName(b.branchId)).join('; '));
  after.branches.forEach((b) => {
    const was = before.branches.find((x) => x.branchId === b.branchId);
    if (!was) return;
    add(`${branchName(b.branchId)} channels`, was.channelIds.map(channelName).sort().join('; '), b.channelIds.map(channelName).sort().join('; '));
    add(`${branchName(b.branchId)} price`, was.price === null ? 'base' : `₹${was.price}`, b.price === null || b.price === undefined ? 'base' : `₹${money(b.price)}`);
  });
  const portalIds = new Set([...before.portals, ...after.portals].map((p) => p.portalId));
  portalIds.forEach((id) => {
    const a = before.portals.find((p) => p.portalId === id) || { listed: false, price: null, name: null };
    const b = after.portals.find((p) => p.portalId === id) || { listed: false, price: null, name: null };
    const word = (p) => (p.listed ? `listed${p.price !== null && p.price !== undefined ? `, ₹${money(p.price)}` : ', base price'}` : 'not listed');
    add(portalName(id), word(a), word(b));
    if (b.listed) add(`${portalName(id)} name`, a.name, b.name);
  });
  const nut = (n) => (n ? NUTRITION_FIELDS.filter((f) => n[f] !== null && n[f] !== undefined && n[f] !== '').map((f) => `${f} ${n[f]}`).join(', ') : '');
  add('Nutrition', nut(before.nutrition), nut(after.nutrition));
  return out;
};

const describeNew = (after, refs) => {
  const bits = [after.category, after.price !== null ? `₹${money(after.price)}` : null, after.taxGroup || 'Exempt (0%)',
    `${after.branches.length} branch${after.branches.length === 1 ? '' : 'es'}`];
  after.portals.filter((p) => p.listed).forEach((p) => {
    const name = refs.portals.find((x) => x.Id === p.portalId)?.Name;
    bits.push(`${name}${p.price !== null && p.price !== undefined ? ` ₹${money(p.price)}` : ''}`);
  });
  if (after.variants.length) bits.push(`variants ${after.variants.map((v) => v.name).join(', ')}`);
  if (after.addonGroups.length) bits.push(`add-ons ${after.addonGroups.join(', ')}`);
  if (after.tags.length) bits.push(`tags ${after.tags.join(', ')}`);
  return bits.filter(Boolean).join(' · ');
};

// ── Add-ons and hours ────────────────────────────────────────────────────────

const applyAddonRow = async (conn, ctx, raw) => {
  const row = normaliseRow(raw);
  const group = m.clean(row.group || row.addongroup);
  const addon = m.clean(row.addon || row.name);
  if (!group || !addon) throw new HttpError('Each add-on row needs a group and an add-on name.', 400);
  const min = row.min === undefined || row.min === '' ? undefined : number(row.min, 'min');
  const max = row.max === undefined || row.max === '' ? undefined : number(row.max, 'max', { min: 1 });
  if (min !== undefined && max !== undefined && min > max) throw new HttpError(`${group}: min is more than max.`, 400);

  const groupRows = await m.listOf(conn, ctx, 'ADDON_GROUPS');
  const existingGroup = m.findIn(groupRows, group, { byCode: true });
  const groupId = await m.ensureAddonGroup(conn, ctx, group, { min, max });
  if (existingGroup && (min !== undefined || max !== undefined)) {
    await conn.execute(QUERIES.MENU.UPDATE_ADDON_GROUP_RULE, [
      min ?? existingGroup.MinSelection ?? 0, max ?? existingGroup.MaxSelection ?? 1, ctx.userPhone, groupId, ctx.tenantId,
    ]);
  }
  const price = row.price === undefined || row.price === '' ? 0 : number(row.price, `${addon} price`);
  const dietId = row.diet ? await m.ensureFoodType(conn, ctx, row.diet) : null;
  const sort = row.sort === undefined || row.sort === '' ? 0 : number(row.sort, 'sort');
  const [found] = await conn.execute(QUERIES.MENU.ADDON_IN_GROUP, [ctx.tenantId, groupId, addon]);
  if (found[0]) {
    await conn.execute(QUERIES.MENU.UPDATE_ADDON, [price, dietId, sort, ctx.userPhone, found[0].Id, ctx.tenantId]);
    return 'updated';
  }
  const code = m.clean(row.code) || await m.makeCode(conn, ctx, 'pos_addon', `${group} ${addon}`);
  await conn.execute(QUERIES.POS_ADDON.INSERT, [
    uuidv4(), ctx.tenantId, groupId, addon, code, price, dietId, sort, 1, ctx.userPhone, ctx.userPhone,
  ]);
  m.noteCreated(ctx, 'addons', `${group}: ${addon}`);
  return 'created';
};

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** "Mon-Fri", "Sat; Sun", "Every day" → [1..5] etc. (0 = Sunday). */
const parseDays = (text) => {
  const t = m.clean(text).toLowerCase();
  if (!t || /^(every ?day|daily|all|mon-sun|mon ?- ?sun)$/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set();
  t.split(/[;,]/).map((x) => x.trim()).filter(Boolean).forEach((part) => {
    const range = part.split(/\s*-\s*/).map((x) => x.slice(0, 3));
    const a = DAY_INDEX[range[0]];
    const b = range.length > 1 ? DAY_INDEX[range[1]] : a;
    if (a === undefined || b === undefined) throw new HttpError(`Days “${text}” should look like Mon-Fri or Sat; Sun.`, 400);
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
  });
  return [...out];
};

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Every category named in hours.csv gets exactly the windows the file gives it. */
const applyHours = async (conn, ctx, rawRows) => {
  const byCategory = new Map();
  rawRows.map(normaliseRow).forEach((row, i) => {
    const cat = m.clean(row.category);
    if (!cat) throw new HttpError(`hours.csv row ${i + 2}: category is empty.`, 400);
    const list2 = byCategory.get(cat) || [];
    list2.push({ row, line: i + 2 });
    byCategory.set(cat, list2);
  });
  let windows = 0;
  for (const [cat, rows] of byCategory) {
    const categoryId = await m.ensureCategory(conn, ctx, cat);
    await conn.execute(QUERIES.POS_CATEGORY_SCHEDULE.DELETE_BY_CATEGORY, [categoryId, ctx.tenantId]);
    for (const { row, line } of rows) {
      if (!row.from && !row.to) continue; // a category listed with no times is open all day
      if (!TIME.test(row.from || '') || !TIME.test(row.to || '')) {
        throw new HttpError(`hours.csv row ${line}: from/to should be 24-hour times like 07:00 and 23:30.`, 400);
      }
      for (const day of parseDays(row.days)) {
        for (const r of splitOvernight({ DayOfWeek: day, StartTime: row.from, EndTime: row.to })) {
          await conn.execute(QUERIES.POS_CATEGORY_SCHEDULE.INSERT, [
            uuidv4(), categoryId, r.DayOfWeek, r.StartTime, r.EndTime, ctx.tenantId, ctx.userPhone, ctx.userPhone,
          ]);
          windows += 1;
        }
      }
    }
  }
  return { categories: byCategory.size, windows };
};

// ── Running a file ───────────────────────────────────────────────────────────

/** Copies the parts of a context a failed row may have dirtied. */
const snapshot = (ctx) => ({
  created: JSON.parse(JSON.stringify(ctx.created)),
  cache: new Map(ctx.cache),
  lists: new Map([...ctx.lists].map(([k, v]) => [k, [...v]])),
  taxAsk: new Map(ctx.taxAsk),
  groupHadRates: new Map(ctx.groupHadRates),
});
const restore = (ctx, snap) => Object.assign(ctx, snap);

class DryRun extends Error {
  constructor(result) {
    super('dry run');
    this.result = result;
  }
}

/** Run `fn` under a savepoint; undo just this part if it throws. */
const isolated = async (conn, ctx, fn) => {
  const snap = snapshot(ctx);
  await conn.query('SAVEPOINT menu_row');
  try {
    const out = await fn();
    await conn.query('RELEASE SAVEPOINT menu_row');
    return { ok: true, out };
  } catch (err) {
    await conn.query('ROLLBACK TO SAVEPOINT menu_row');
    restore(ctx, snap);
    return { ok: false, error: err instanceof HttpError ? err.message : (err.sqlMessage || err.message || 'Could not be applied') };
  }
};

/**
 * Preview or apply a menu file.
 *
 * @param {{menu?: Object[], addons?: Object[], hours?: Object[]}} files - Parsed rows.
 * @param {{dryRun: boolean}} options
 * @param {string} tenantId
 * @param {string} userPhone
 */
const run = async (files, { dryRun }, tenantId, userPhone) => {
  const menuRows = Array.isArray(files.menu) ? files.menu : [];
  const addonRows = Array.isArray(files.addons) ? files.addons : [];
  const hourRows = Array.isArray(files.hours) ? files.hours : [];
  if (!menuRows.length && !addonRows.length && !hourRows.length) {
    throw new HttpError('The file has no rows.', 400);
  }

  const work = async (conn) => {
    const ctx = m.newContext(tenantId, userPhone);
    const refs = {
      branches: await m.listOf(conn, ctx, 'BRANCHES'),
      channels: await m.listOf(conn, ctx, 'CHANNELS'),
      portals: await m.listOf(conn, ctx, 'PORTALS'),
    };
    if (!refs.branches.length) throw new HttpError('Set up a branch before importing a menu.', 400);

    // Add-ons first: the menu rows name their groups.
    const addons = { created: 0, updated: 0, errors: [] };
    for (let i = 0; i < addonRows.length; i += 1) {
      const r = await isolated(conn, ctx, () => applyAddonRow(conn, ctx, addonRows[i]));
      if (r.ok) addons[r.out] += 1;
      else addons.errors.push({ line: addonRows[i].__line || i + 2, error: r.error });
    }

    const rows = [];
    for (let i = 0; i < menuRows.length; i += 1) {
      const raw = menuRows[i];
      const line = raw.__line || i + 2;
      const row = normaliseRow(raw);
      const label = m.clean(row.name) || m.clean(row.code) || `Row ${line}`;
      const r = await isolated(conn, ctx, async () => {
        let itemId = null;
        if (m.clean(row.code)) {
          const [hit] = await conn.execute(QUERIES.MENU.ITEM_BY_CODE, [tenantId, m.clean(row.code)]);
          itemId = hit[0]?.Id || null;
        }
        if (!itemId && m.clean(row.name)) {
          const [hit] = await conn.execute(QUERIES.MENU.ITEM_BY_NAME, [tenantId, m.clean(row.name)]);
          itemId = hit[0]?.Id || null;
        }
        const before = itemId ? (await loadDishes(conn, tenantId, [itemId]))[0] : null;
        const after = await mergeRow(conn, ctx, before, row, refs);
        const changes = before ? describeChanges(before, after, refs) : [];
        if (before && changes.length === 0) {
          return { action: 'unchanged', name: after.name, code: after.code, changes: [] };
        }
        await saveDish(conn, after, ctx);
        return {
          action: before ? 'changed' : 'new',
          name: after.name,
          code: after.code,
          changes: before ? changes : [{ field: 'New dish', from: '', to: describeNew(after, refs) }],
        };
      });
      rows.push(r.ok
        ? { line, ...r.out }
        : { line, action: 'error', name: label, code: m.clean(row.code) || null, error: r.error, changes: [] });
    }

    let hours = null;
    if (hourRows.length) {
      const r = await isolated(conn, ctx, () => applyHours(conn, ctx, hourRows));
      hours = r.ok ? r.out : { error: r.error };
    }

    const count = (a) => rows.filter((x) => x.action === a).length;
    const result = {
      dryRun,
      summary: { total: rows.length, new: count('new'), changed: count('changed'), unchanged: count('unchanged'), errors: count('error') },
      created: ctx.created,
      rows,
      addons,
      hours,
    };
    if (dryRun) throw new DryRun(result);
    return result;
  };

  try {
    const result = await withTransaction(work);
    logger.info('Menu import applied', { tenantId, ...result.summary });
    return result;
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    throw err;
  }
};

module.exports = { run, mergeRow, normaliseRow, parseVariants, parseDays, describeChanges, hkey };
