// src/modules/ledger/ledger.due.js
// What a sale still owes — one rule, in one place.
//
//   Due = Gross − Returns − Collected − Written off, never below zero.
//
// Pure arithmetic on purpose. The collect sheet, the write-off, the returns
// path, the ledger list, the order detail and the Dues worklist all need the
// same answer, and each computing its own is how one screen ends up saying ₹88
// while another says ₹0. The SQL twin used for filters and sums is DUE_SQL in
// config/constants.js; the two must stay in step.
//
// Returns come off the due FIRST. A guest who paid ₹200 of ₹288 and sends back a
// ₹149 dish owes nothing and is owed ₹61 — not ₹149, which would hand back money
// the outlet never received.

const { toMinor, fromMinor } = require('../../utils/taxCalculator');

/**
 * Within a paisa counts as settled. Proportional returns do not always land on
 * the exact total, and a sale owing ₹0.01 nobody can see must not sit in Dues.
 */
const PAISA_TOLERANCE_MINOR = 1;

/**
 * @param {Object} figures
 * @param {number|string} figures.gross      - The sale's GrossAmount (rounded payable).
 * @param {number|string} [figures.collected] - SUM of its paymentdetail rows.
 * @param {number|string} [figures.returned]  - SUM of its credit notes' GrossAmount.
 * @param {number|string} [figures.writtenOff]- Its WriteOffAmount.
 * @returns {number} Rupees still owed; 0 when nothing (or under a paisa) is.
 */
const dueOf = ({ gross, collected = 0, returned = 0, writtenOff = 0 }) => {
  const minor = toMinor(gross || 0) - toMinor(returned || 0)
    - toMinor(collected || 0) - toMinor(writtenOff || 0);
  return minor > PAISA_TOLERANCE_MINOR ? fromMinor(minor) : 0;
};

/**
 * How much of a return goes back to the customer as money (or store credit).
 *
 * The customer keeps goods worth Gross − ReturnedAfter. Whatever they have paid
 * beyond that, net of refunds already made, comes back; anything less simply
 * clears the due. Never more than the note itself is worth.
 *
 * Written off balances are deliberately ignored here: forgiving ₹38 does not
 * entitle anyone to have ₹38 handed over when goods come back.
 *
 * @param {Object} figures
 * @param {number} figures.gross          - The sale's GrossAmount.
 * @param {number} figures.returnedAfter  - All credit notes INCLUDING this one.
 * @param {number} figures.netPaid        - Paid in minus refunded out, so far.
 * @param {number} figures.noteGross      - This credit note's value.
 * @returns {number} Minor units to refund.
 */
const refundableMinor = ({ gross, returnedAfter, netPaid, noteGross }) => {
  const keptMinor = Math.max(0, toMinor(gross || 0) - toMinor(returnedAfter || 0));
  const overpaidMinor = Math.max(0, toMinor(netPaid || 0) - keptMinor);
  return Math.min(overpaidMinor, toMinor(noteGross || 0));
};

module.exports = { dueOf, refundableMinor, PAISA_TOLERANCE_MINOR };
