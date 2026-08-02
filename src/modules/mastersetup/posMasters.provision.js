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

const MODES = ['Cash', 'Card', 'UPI', 'Wallet'];               // paymentmode.Type
const RECEIVED = ['Full', 'Partial', 'Advance', 'Refund'];      // paymentreceivedtype.Type
const ACCOUNTS = ['Sales', 'Cash', 'Bank', 'Wallet'];           // accounttypebase.Name
const STATUSES = ['DRAFT', 'PARTIALLY_PAID', 'SETTLED', 'CANCELLED', 'REFUNDED'];

// Permitted POS-sale status moves. SETTLED → CANCELLED is deliberately absent —
// a settled sale is reversed by REFUNDED, never voided.
const TRANSITIONS = [
  ['DRAFT', 'SETTLED', 'POS_SALE_SETTLE'],
  ['DRAFT', 'PARTIALLY_PAID', 'POS_SALE_PART_PAY'],
  ['PARTIALLY_PAID', 'SETTLED', 'POS_SALE_SETTLE_REMAINDER'],
  ['DRAFT', 'CANCELLED', 'POS_SALE_VOID'],
  ['SETTLED', 'REFUNDED', 'POS_SALE_REFUND'],
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

/**
 * Provision a tenant's POS + ledger masters on an open transaction.
 * @param {Object} conn - Active transaction connection.
 * @param {Object} p
 * @param {string} p.tenantId
 * @param {string} p.configId - The tenant's transactiontypeconfig id (numbering).
 * @param {string} [userEmail]
 */
const provisionPosMasters = async (conn, { tenantId, configId }, userEmail) => {
  const by = userEmail || 'system-provision';

  // Tender types
  for (const Type of MODES) {
    await ensureByName(
      conn, 'paymentmode', 'Type', Type, tenantId,
      'INSERT INTO paymentmode (Id, Type, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, NOW(), ?, ?)',
      (id) => [id, Type, tenantId, by, by],
    );
  }

  // How a receipt is classified
  for (const Type of RECEIVED) {
    await ensureByName(
      conn, 'paymentreceivedtype', 'Type', Type, tenantId,
      'INSERT INTO paymentreceivedtype (Id, Type, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, NOW(), ?, ?)',
      (id) => [id, Type, tenantId, by, by],
    );
  }

  // Ledger accounts (NOT NULL on the payment tables)
  for (const Name of ACCOUNTS) {
    await ensureByName(
      conn, 'accounttypebase', 'Name', Name, tenantId,
      'INSERT INTO accounttypebase (Id, Name, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, 1, ?, NOW(), ?, ?)',
      (id) => [id, Name, tenantId, by, by],
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

  // Document type — POS sales number off the tenant's config.
  await ensureByName(
    conn, 'transactiontype', 'Name', 'POS Sale', tenantId,
    'INSERT INTO transactiontype (Id, Name, TransactionTypeConfigId, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, 1, ?, NOW(), ?, ?)',
    (id) => [id, 'POS Sale', configId, tenantId, by, by],
  );

  // Permitted status transitions (keyed by config + from + to).
  for (const [from, to, tag] of TRANSITIONS) {
    const [rows] = await conn.execute(
      'SELECT Id FROM transactiontypebaseconversion WHERE TenantId = ? AND TransactionTypeConfigId = ? ' +
      'AND FromTransactionTypeStatusId = ? AND ToTransactionTypeStatusId = ? LIMIT 1',
      [tenantId, configId, statusId[from], statusId[to]],
    );
    if (rows.length) continue;
    await conn.execute(
      'INSERT INTO transactiontypebaseconversion (Id, TenantId, TransactionTypeConfigId, ' +
      'FromTransactionTypeStatusId, ToTransactionTypeStatusId, Tag, Active, CreatedOn, CreatedBy, UpdatedBy) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)',
      [uuidv4(), tenantId, configId, statusId[from], statusId[to], tag, by, by],
    );
  }
};

module.exports = { provisionPosMasters, MODES, RECEIVED, ACCOUNTS, STATUSES, TRANSITIONS };
