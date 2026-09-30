// src/modules/posdine/dine.customer.service.js
// A verified diner becomes — or is recognised as — a customer of the restaurant.
//
// Keyed on (normalised phone, tenant), which pos_customer already holds UNIQUE:
// the same person at two branches of one chain is ONE customer, and at two
// different restaurants is two. Visits and spend are NOT touched here; they are
// credited on the existing settle path (poscustomer.stats.recordSaleTx), exactly
// as for a customer the till attached.

const { v4: uuidv4 } = require('uuid');
const { withTransaction } = require('../../utils/dbHelper');
const { QUERIES, QR_ORDERING } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { maskForLog } = require('../../utils/phone');

const Q = QUERIES.POS_CUSTOMER;

const isDuplicate = (err) => err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062);

/** Whether a stored name is only the placeholder a nameless diner got. */
const isPlaceholderName = (name) => !name || name === QR_ORDERING.GUEST_NAME;

const toPublic = (row, isNew) => ({
  id: row.Id,
  name: isPlaceholderName(row.Name) ? null : row.Name,
  isNew,
});

const findByPhoneTx = async (conn, phone, tenantId) => {
  const [rows] = await conn.execute(Q.SELECT_BY_PHONE, [phone, tenantId]);
  return rows[0] || null;
};

/**
 * Finds the customer behind a verified number, creating them on first visit.
 *
 * A returning customer is renamed only if they are still the "Guest"
 * placeholder and now gave a name — a name the till typed in is never
 * overwritten by what someone types on a phone.
 *
 * @param {Object} p
 * @param {string} p.phone - E.164, already verified.
 * @param {string} [p.name]
 * @param {string} p.tenantId
 * @param {string} p.branchId - Recorded as their first branch on creation.
 * @returns {Promise<{id: string, name: string|null, isNew: boolean}>}
 */
const findOrCreate = async ({ phone, name, tenantId, branchId }) => {
  const createdBy = `${QR_ORDERING.CREATED_BY_PREFIX}${phone}`;
  const cleanName = name ? String(name).trim().slice(0, 100) : '';

  try {
    return await withTransaction(async (conn) => {
      const existing = await findByPhoneTx(conn, phone, tenantId);
      if (existing) {
        if (cleanName && isPlaceholderName(existing.Name)) {
          await conn.execute(Q.SET_NAME, [cleanName, createdBy, existing.Id, tenantId]);
          return toPublic({ ...existing, Name: cleanName }, false);
        }
        return toPublic(existing, false);
      }

      const id = uuidv4();
      await conn.execute(Q.INSERT, [
        id, tenantId, cleanName || QR_ORDERING.GUEST_NAME, phone, null,
        0, 0, 0, branchId, null, null, true, createdBy, createdBy,
      ]);
      logger.info('Diner saved as a new customer', { tenantId, phone: maskForLog(phone) });
      return toPublic({ Id: id, Name: cleanName || QR_ORDERING.GUEST_NAME }, true);
    });
  } catch (err) {
    // Two first verifies of one number racing: the loser's insert hits the
    // UNIQUE key. The winner's row is the customer — read it and carry on.
    if (!isDuplicate(err)) throw err;
    return withTransaction(async (conn) => toPublic(await findByPhoneTx(conn, phone, tenantId), false));
  }
};

/**
 * A guest naming themselves after verifying (the first-visit screen).
 *
 * Applied only while the stored name is still the placeholder: a name the till
 * or an earlier visit recorded is never overwritten from a phone.
 *
 * @param {string} customerId - From the diner session.
 * @param {string} name
 * @param {string} tenantId
 * @param {string} phone - For UpdatedBy.
 * @returns {Promise<{name: string|null}>} The name now on record.
 */
const nameIfGuest = async (customerId, name, tenantId, phone) => {
  const cleanName = String(name || '').trim().slice(0, 100);
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(Q.SELECT_BY_ID, [customerId, tenantId]);
    const row = rows[0];
    if (!row) return { name: null };
    if (!cleanName || !isPlaceholderName(row.Name)) {
      return { name: isPlaceholderName(row.Name) ? null : row.Name };
    }
    await conn.execute(Q.SET_NAME, [
      cleanName, `${QR_ORDERING.CREATED_BY_PREFIX}${phone}`, customerId, tenantId,
    ]);
    return { name: cleanName };
  });
};

module.exports = { findOrCreate, nameIfGuest, isPlaceholderName };
