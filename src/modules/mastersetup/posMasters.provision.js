// src/modules/mastersetup/posMasters.provision.js
// Seeds the standard POS + accounting-ledger master data for a tenant so that,
// the moment first-time setup completes, bills can be settled and POSTED to the
// ledger without any manual `02-seed-data.sql` step.
//
// This mirrors database/02-seed-data.sql PART 11, but per-tenant with generated
// ids, and is idempotent (get-or-create by name), so a replayed bootstrap or a
// tenant that was partially seeded by hand converges rather than duplicating.
//
// Runs on the caller's transaction connection, so it commits (or rolls back)
// atomically with the rest of the bootstrap.

const { v4: uuidv4 } = require('uuid');

// Tender → the account the money LANDS IN. Without this mapping every tender
// books to 'Sales' and no account means anything: cash sales and card sales
// become indistinguishable, and cash flow cannot be computed at all.
const MODES = [
  ['Cash', 'Cash'],
  ['Card', 'Bank'],
  ['UPI', 'Bank'],
  ['Wallet', 'Wallet'],
];
// 'Payment' classifies money OUT — paymentbreakup.PaymentReceivedTypeId is NOT
// NULL, and reusing 'Full' would make expenses look like receipts in reports.
const RECEIVED = ['Full', 'Partial', 'Advance', 'Refund', 'Payment'];
// [name, kind] — Kind lets cash flow classify a movement without matching on a
// name the tenant is free to change.
const ACCOUNTS = [
  ['Sales', 'INCOME'],
  ['Cash', 'ASSET'],
  ['Bank', 'ASSET'],
  ['Wallet', 'ASSET'],
  ['Expenses', 'EXPENSE'],
];
const STATUSES = ['DRAFT', 'PARTIALLY_PAID', 'SETTLED', 'CANCELLED', 'REFUNDED'];

const EXPENSE_CATEGORIES = [
  'Raw Material', 'Gas', 'Utilities', 'Rent', 'Salary', 'Maintenance', 'Miscellaneous',
];
const ASSET_CATEGORIES = [
  'Kitchen Equipment', 'Furniture', 'IT Equipment', 'Fixtures', 'Vehicle',
];

// [Name, Code, IsVeg, SortOrder] — pos_item_meta.FoodTypeId is NOT NULL, so a
// tenant with no food types cannot create a single menu item. Keyed by Code to
// match UNIQUE (Code, TenantId); IsVeg drives the veg/non-veg badge on Billing.
const FOOD_TYPES = [
  ['Veg', 'VEG', 1, 1],
  ['Vegan', 'VEGAN', 1, 2],
  ['Non-Veg', 'NONVEG', 0, 3],
];

// One numbering series PER DOCUMENT TYPE. Sales and expenses must not share a
// counter: each series has to be gap-free in its own right.
//
// Orders, KOTs and bills get series too. Their numbers used to be minted on the
// client from Date.now() — ORD-<last 6 digits of epoch ms> wrapped every ~16m40s
// and collided with UNIQUE (OrderNo, TenantId), and KotNo was the raw 13-digit
// epoch the KDS then displayed. These are operational counters rather than
// financial ones, so a gap is harmless, but uniqueness is not optional.
// [tagName, prefix, format]
const SERIES = [
  ['POS_SALE', 'INV', 'INV-{0000}'],
  ['EXPENSE', 'EXP', 'EXP-{0000}'],
  ['POS_ORDER', 'ORD', 'ORD-{0000}'],
  ['POS_KOT', 'KOT', 'KOT-{0000}'],
  ['POS_BILL', 'BILL', 'BILL-{0000}'],
  // Counter tokens, for branches set to 'series' numbering. Branches on the
  // default 'daily' setting count in pos_token_counter and never touch this.
  ['POS_TOKEN', 'TOK', 'TOK-{0000}'],
];

// Permitted status moves per series. SETTLED → CANCELLED is deliberately absent
// — a settled document is reversed by REFUNDED, never voided.
const TRANSITIONS = [
  ['DRAFT', 'SETTLED', 'POS_SALE_SETTLE'],
  ['DRAFT', 'PARTIALLY_PAID', 'POS_SALE_PART_PAY'],
  ['PARTIALLY_PAID', 'SETTLED', 'POS_SALE_SETTLE_REMAINDER'],
  ['DRAFT', 'CANCELLED', 'POS_SALE_VOID'],
  ['SETTLED', 'REFUNDED', 'POS_SALE_REFUND'],
];
// The DRAFT → APPROVED step lives on pos_expense, not here: an unapproved claim
// is not yet a financial event, so no document exists for it. Settling posts.
const EXPENSE_TRANSITIONS = [
  ['DRAFT', 'SETTLED', 'EXPENSE_SETTLE'],
  ['DRAFT', 'CANCELLED', 'EXPENSE_VOID'],
  ['SETTLED', 'REFUNDED', 'EXPENSE_REVERSE'],
];

// Get-or-create a row addressed by a single name column; returns its id. Table
// names come only from the fixed lists above — never from user input.
const ensureByName = async (conn, table, nameCol, name, tenantId, insertSql, insertParams) => {
  const [rows] = await conn.execute(
    `SELECT Id FROM ${table} WHERE ${nameCol} = ? AND TenantId = ? LIMIT 1`,
    [name, tenantId],
  );
  if (rows.length) return rows[0].Id;
  const id = uuidv4();
  await conn.execute(insertSql, insertParams(id));
  return id;
};

/** Records a permitted transition once, keyed by config + from + to. */
const ensureTransition = async (conn, { configId, fromId, toId, tag }, tenantId, by) => {
  const [rows] = await conn.execute(
    'SELECT Id FROM transactiontypebaseconversion WHERE TenantId = ? AND TransactionTypeConfigId = ? ' +
    'AND FromTransactionTypeStatusId = ? AND ToTransactionTypeStatusId = ? LIMIT 1',
    [tenantId, configId, fromId, toId],
  );
  if (rows.length) return;
  await conn.execute(
    'INSERT INTO transactiontypebaseconversion (Id, TenantId, TransactionTypeConfigId, ' +
    'FromTransactionTypeStatusId, ToTransactionTypeStatusId, Tag, Active, CreatedOn, CreatedBy, UpdatedBy) ' +
    'VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)',
    [uuidv4(), tenantId, configId, fromId, toId, tag, by, by],
  );
};

/**
 * Provision a tenant's POS + ledger masters on an open transaction.
 *
 * @param {Object} conn - Active transaction connection.
 * @param {Object} p
 * @param {string} p.tenantId
 * @param {string} [p.configId] - The wizard's numbering config. Accepted for
 *        call-site compatibility but NOT used for documents: sales and expenses
 *        get their own series (see SERIES) so their numbers stay gap-free
 *        independently of onboarding paperwork.
 * @param {string} [userEmail]
 */
const provisionPosMasters = async (conn, { tenantId }, userEmail) => {
  const by = userEmail || 'system-provision';

  // Ledger accounts first — payment modes and expense categories point at them.
  const accountId = {};
  for (const [Name, Kind] of ACCOUNTS) {
    accountId[Name] = await ensureByName(
      conn, 'accounttypebase', 'Name', Name, tenantId,
      'INSERT INTO accounttypebase (Id, Name, Kind, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, ?, NOW(), ?, ?)',
      (id) => [id, Name, Kind, tenantId, by, by],
    );
  }

  // Tender types, each mapped to the account it lands in.
  for (const [Type, account] of MODES) {
    await ensureByName(
      conn, 'paymentmode', 'Type', Type, tenantId,
      'INSERT INTO paymentmode (Id, Type, DefaultAccountTypeBaseId, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?, ?)',
      (id) => [id, Type, accountId[account] ?? null, tenantId, by, by],
    );
  }

  // How a receipt (or payment) is classified
  for (const Type of RECEIVED) {
    await ensureByName(
      conn, 'paymentreceivedtype', 'Type', Type, tenantId,
      'INSERT INTO paymentreceivedtype (Id, Type, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, NOW(), ?, ?)',
      (id) => [id, Type, tenantId, by, by],
    );
  }

  // Expense analysis axis, booked against the Expenses account.
  for (const Name of EXPENSE_CATEGORIES) {
    await ensureByName(
      conn, 'expense_category', 'Name', Name, tenantId,
      'INSERT INTO expense_category (Id, Name, AccountTypeBaseId, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, ?, NOW(), ?, ?)',
      (id) => [id, Name, accountId.Expenses ?? null, tenantId, by, by],
    );
  }

  // Asset register analysis axis.
  for (const Name of ASSET_CATEGORIES) {
    await ensureByName(
      conn, 'asset_category', 'Name', Name, tenantId,
      'INSERT INTO asset_category (Id, Name, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, 1, ?, NOW(), ?, ?)',
      (id) => [id, Name, tenantId, by, by],
    );
  }

  // Menu food types. Without at least one row the Menu Items form cannot be
  // submitted at all, since pos_item_meta.FoodTypeId is NOT NULL.
  for (const [Name, Code, IsVeg, SortOrder] of FOOD_TYPES) {
    await ensureByName(
      conn, 'pos_food_type', 'Code', Code, tenantId,
      'INSERT INTO pos_food_type (Id, Name, Code, Description, SortOrder, IsVeg, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, NULL, ?, ?, ?, 1, NOW(), ?, ?)',
      (id) => [id, Name, Code, SortOrder, IsVeg, tenantId, by, by],
    );
  }

  // Document statuses — keep the ids to wire the transitions.
  const statusId = {};
  for (const Name of STATUSES) {
    statusId[Name] = await ensureByName(
      conn, 'transactiontypestatus', 'Name', Name, tenantId,
      'INSERT INTO transactiontypestatus (Id, Name, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, 1, ?, NOW(), ?, ?)',
      (id) => [id, Name, tenantId, by, by],
    );
  }

  // One numbering series per document type.
  const seriesId = {};
  for (const [tagName, prefix, format] of SERIES) {
    seriesId[tagName] = await ensureByName(
      conn, 'transactiontypeconfig', 'TagName', tagName, tenantId,
      'INSERT INTO transactiontypeconfig (Id, TenantId, StartCounterNo, Prefix, Format, TagName, Active, CreatedOn, CreatedBy, UpdatedBy) ' +
      "VALUES (?, ?, '1', ?, ?, ?, 1, NOW(), ?, ?)",
      (id) => [id, tenantId, prefix, format, tagName, by, by],
    );
  }

  // Document types, each bound to its own series.
  await ensureByName(
    conn, 'transactiontype', 'Name', 'POS Sale', tenantId,
    'INSERT INTO transactiontype (Id, Name, TransactionTypeConfigId, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, ?, NOW(), ?, ?)',
    (id) => [id, 'POS Sale', seriesId.POS_SALE, tenantId, by, by],
  );
  await ensureByName(
    conn, 'transactiontype', 'Name', 'Expense', tenantId,
    'INSERT INTO transactiontype (Id, Name, TransactionTypeConfigId, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, ?, NOW(), ?, ?)',
    (id) => [id, 'Expense', seriesId.EXPENSE, tenantId, by, by],
  );

  // Permitted status transitions, per series.
  for (const [from, to, tag] of TRANSITIONS) {
    await ensureTransition(
      conn,
      { configId: seriesId.POS_SALE, fromId: statusId[from], toId: statusId[to], tag },
      tenantId, by,
    );
  }
  for (const [from, to, tag] of EXPENSE_TRANSITIONS) {
    await ensureTransition(
      conn,
      { configId: seriesId.EXPENSE, fromId: statusId[from], toId: statusId[to], tag },
      tenantId, by,
    );
  }
};

module.exports = {
  provisionPosMasters,
  MODES,
  RECEIVED,
  ACCOUNTS,
  STATUSES,
  SERIES,
  TRANSITIONS,
  EXPENSE_TRANSITIONS,
  EXPENSE_CATEGORIES,
  ASSET_CATEGORIES,
  FOOD_TYPES,
};
