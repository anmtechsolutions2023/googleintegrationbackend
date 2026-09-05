// src/modules/posorder/posNumbering.js
// Numbers for the operational POS documents: orders, KOTs and bills.
//
// These used to be minted in the browser from Date.now():
//   ORD-${Date.now().toString().slice(-6)}   → the last 6 digits of the epoch in
//     milliseconds, which wraps every ~16m40s and then violates
//     UNIQUE (OrderNo, TenantId). Two orders placed 16m40s apart in the same
//     tenant failed the sale outright.
//   KOT-${Date.now()}                        → the raw 13-digit epoch, which is
//     what the kitchen display showed as the ticket number.
//
// They now come from the same gap-free, row-locked generator the ledger uses
// (transactionNumber.service), addressed by series tag.

const { v4: uuidv4 } = require('uuid');
const { issueByTag } = require('../ledger/transactionNumber.service');
const { logger } = require('../../utils/logger');

/**
 * Issues the next number for a POS series, falling back to a unique-by-construction
 * value if the tenant has no such series configured.
 *
 * The fallback exists because a missing master row is a provisioning gap, and
 * refusing the sale over it would be worse than the gap. It is deliberately NOT
 * time-derived — the whole defect being fixed here was a time-derived number that
 * collided. A uuid fragment cannot collide with itself or with a series number.
 *
 * MUST be called on an open transaction connection: the series row is taken
 * FOR UPDATE, so two tills serialise on it, and a rolled-back sale returns its
 * number.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {string} tagName - Series tag, e.g. 'POS_ORDER'.
 * @param {string} prefix - Prefix for the fallback value, e.g. 'ORD'.
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<string>}
 */
const issuePosNumber = async (conn, tagName, prefix, tenantId, userPhone) => {
  const issued = await issueByTag(conn, tagName, tenantId, userPhone);
  if (issued) return issued;

  logger.warn(`No ${tagName} numbering series for tenant — falling back`, {
    tenantId,
    tagName,
  });
  return `${prefix}-${uuidv4().slice(0, 8).toUpperCase()}`;
};

module.exports = { issuePosNumber };
