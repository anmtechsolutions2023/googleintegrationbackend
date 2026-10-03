// src/modules/ledger/ledger.settle.js
// The last step of a part-paid sale: PARTIALLY_PAID → SETTLED, and the POS bill
// with it.
//
// Its own module because two services reach it from opposite directions — the
// payments service when the balance is collected or written off, and the
// returns service when a return clears what was owed — and neither should have
// to import the other to get it.

const { QUERIES, LEDGER, POS_BILL_STATUS } = require('../../config/constants');
const { requireMaster, transitionStatus } = require('./ledger.primitives');

/**
 * Moves the sale to SETTLED through the seeded POS_SALE_SETTLE_REMAINDER
 * transition, stamping SettledAt.
 *
 * The bill only moves from 'partially_paid'. A bill a return has already marked
 * partially refunded keeps saying so — "paid" would hide that goods came back.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {Object} sale - Locked row: { Id, TransactionTypeConfigId, TransactionTypeStatusId }.
 */
const settleSaleTx = async (conn, sale, tenantId, userPhone) => {
  const settled = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_SETTLED, tenantId, 'status',
  );
  await transitionStatus(
    conn,
    {
      logId: sale.Id,
      configId: sale.TransactionTypeConfigId,
      fromStatusId: sale.TransactionTypeStatusId,
      toStatusId: settled.Id,
      settledAt: new Date(),
    },
    tenantId, userPhone,
  );
  await conn.execute(QUERIES.LEDGER.UPDATE_BILL_STATUS_BY_LOG_FROM, [
    POS_BILL_STATUS.PAID, userPhone, sale.Id, tenantId, POS_BILL_STATUS.PARTIALLY_PAID,
  ]);
};

module.exports = { settleSaleTx };
