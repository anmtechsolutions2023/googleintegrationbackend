// src/modules/export/definitions/menu.js
// Menu › the menu as it stands, as files.
//
// Menu Items is the one export whose headers are NOT plain English: they are
// the import template's twelve columns, in its order, lower case — so a file
// downloaded here can be edited in a spreadsheet and imported straight back
// (Admin › Data tables › Import, or the setup wizard). Change the template in
// the frontend's utils/itemImport.js and this list together.

const { QUERIES, SCOPES, TAX_GROUP_DEFAULTS } = require('../../../config/constants');
const f = require('../export.format');

const Q = () => QUERIES.EXPORT;
const MENU = [SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE];

/** The import template's columns. */
const IMPORT_COLUMNS = ['name', 'category', 'unit', 'price', 'tax_group', 'tax_components',
  'food_type', 'code', 'description', 'tax_included', 'hsn', 'sac'];

/** "CGST:2.5|SGST:2.5", the importer's own notation. */
const componentsText = (list = []) => list.map((c) => `${c.Name}:${f.qty(c.Value)}`).join('|');

const isExempt = (name) => String(name || '').trim().toLowerCase()
  === String(TAX_GROUP_DEFAULTS.EXEMPT_NAME || '').toLowerCase();

const menuItems = {
  key: 'menu-items',
  workspace: 'Menu',
  label: 'Menu items (re-importable)',
  where: 'Menu › Menu Master',
  grain: 'one dish',
  fileStem: 'menu-items',
  scopes: MENU,
  dated: false,
  branchless: true,
  load: async (conn, q, ctx) => {
    const [[items], [components]] = await Promise.all([
      conn.execute(Q().MENU_ITEMS, [ctx.tenantId]),
      conn.execute(Q().TAX_GROUP_COMPONENTS, [ctx.tenantId]),
    ]);
    const byGroup = new Map();
    components.forEach((c) => {
      const list = byGroup.get(c.TaxGroupId) || [];
      list.push(c);
      byGroup.set(c.TaxGroupId, list);
    });
    return items.map((i) => ({ ...i, components: byGroup.get(i.TaxGroupId) || [] }));
  },
  columns: [
    [IMPORT_COLUMNS[0], (r) => r.Name],
    [IMPORT_COLUMNS[1], (r) => r.CategoryName || ''],
    [IMPORT_COLUMNS[2], (r) => r.UnitName || ''],
    [IMPORT_COLUMNS[3], (r) => f.qty(r.Price)],
    [IMPORT_COLUMNS[4], (r) => r.TaxGroupName || ''],
    // The Exempt group is empty on purpose and the importer refuses rates on it.
    [IMPORT_COLUMNS[5], (r) => (isExempt(r.TaxGroupName) ? '' : componentsText(r.components))],
    [IMPORT_COLUMNS[6], (r) => r.FoodTypeName || ''],
    [IMPORT_COLUMNS[7], (r) => r.Code || ''],
    [IMPORT_COLUMNS[8], (r) => r.Description || ''],
    [IMPORT_COLUMNS[9], (r) => (r.IsTaxIncluded === null || r.IsTaxIncluded === undefined ? '' : String(!!Number(r.IsTaxIncluded)))],
    [IMPORT_COLUMNS[10], (r) => r.HSNCode || ''],
    [IMPORT_COLUMNS[11], (r) => r.SACCode || ''],
  ],
};

const menuBranch = {
  key: 'menu-branch',
  workspace: 'Menu',
  label: 'Menu by branch',
  where: 'Menu › Menu Master',
  grain: 'one dish at one branch',
  fileStem: 'menu-branch',
  scopes: MENU,
  dated: false,
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(Q().MENU_BRANCH, [ctx.tenantId, ctx.branchId, ctx.branchId]);
    return rows;
  },
  columns: [
    ['Code', (r) => r.Code || ''],
    ['Item', (r) => r.Name],
    ['Category', (r) => r.CategoryName || ''],
    ['Branch', (r) => r.BranchName || ''],
    ['Price', (r) => f.amount(r.Price)],
    ['Tax group', (r) => r.TaxGroupName || ''],
    ['Channels', (r) => r.Channels || ''],
    ['Variants', (r) => r.Variants || ''],
    ['Add-on groups', (r) => r.AddonGroups || ''],
    ['Food type', (r) => r.FoodTypeName || ''],
    ['Meat type', (r) => r.MeatTypeName || ''],
    ['Serves', (r) => (r.ServesCount === null ? '' : r.ServesCount)],
    ['Portion', (r) => r.PortionSize || ''],
    ['Prep (min)', (r) => (r.PrepTimeMinutes === null ? '' : r.PrepTimeMinutes)],
    ['Stock tracked', (r) => f.yesNo(r.StockTracked)],
    ['Max per order', (r) => (r.MaxPerOrder === null ? '' : r.MaxPerOrder)],
  ],
};

const menuOptions = {
  key: 'menu-options',
  workspace: 'Menu',
  label: 'Variants & add-ons',
  where: 'Menu › Options',
  grain: 'one variant or add-on',
  fileStem: 'menu-options',
  scopes: MENU,
  dated: false,
  branchless: true,
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(Q().MENU_OPTIONS, [ctx.tenantId, ctx.tenantId]);
    return rows;
  },
  columns: [
    ['Type', (r) => r.Kind],
    ['Group', (r) => r.GroupName || ''],
    ['Group rule', (r) => (r.Kind === 'Add-on' ? `Pick ${Number(r.MinSelection) || 0}–${Number(r.MaxSelection) || 0}` : '')],
    ['Name', (r) => r.Name],
    ['Code', (r) => r.Code || ''],
    ['Price', (r) => f.amount(r.Price)],
    ['Food type', (r) => r.FoodTypeName || ''],
    ['Sort', (r) => Number(r.SortOrder) || 0],
    ['Used by (dishes)', (r) => Number(r.UsedBy) || 0],
  ],
};

const categoryHours = {
  key: 'category-hours',
  workspace: 'Menu',
  label: 'Category hours',
  where: 'Menu › Categories & hours',
  grain: 'one trading window on one day',
  fileStem: 'category-hours',
  scopes: MENU,
  dated: false,
  branchless: true,
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(Q().CATEGORY_HOURS, [ctx.tenantId]);
    return rows;
  },
  columns: [
    ['Category', (r) => r.CategoryName],
    ['Day', (r) => f.DAYS[Number(r.DayOfWeek)] || ''],
    ['From', (r) => f.time(r.StartTime)],
    ['To', (r) => f.time(r.EndTime)],
  ],
};

const dailyStock = {
  key: 'daily-stock',
  workspace: 'Menu',
  label: "Today's counts",
  where: 'Menu › Stock & units',
  grain: 'one stock-tracked dish on one day',
  fileStem: 'daily-counts',
  // The Today's Counts tab is open to the till too — the cashier is asked
  // whether a dish is still on before the guest is.
  scopes: [...MENU, SCOPES.POS_OPS_READ, SCOPES.POS_BILLING_READ],
  dated: true,
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(
      Q().DAILY_STOCK,
      [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.range.from, ctx.range.to],
    );
    return rows;
  },
  columns: [
    ['Date', (r) => f.date(r.BusinessDate)],
    ['Branch', (r) => r.BranchName || ''],
    ['Item', (r) => r.Name],
    ['Code', (r) => r.Code || ''],
    ['Counted at open', (r) => Number(r.PreparedQty) || 0],
    ['Sold', (r) => Number(r.SoldQty) || 0],
    ['Remaining', (r) => Math.max(0, (Number(r.PreparedQty) || 0) - (Number(r.SoldQty) || 0))],
    ['Status', (r) => ((Number(r.PreparedQty) || 0) - (Number(r.SoldQty) || 0) > 0 ? 'On' : 'Sold out')],
  ],
};

module.exports = [menuItems, menuBranch, menuOptions, categoryHours, dailyStock];
module.exports.IMPORT_COLUMNS = IMPORT_COLUMNS;
