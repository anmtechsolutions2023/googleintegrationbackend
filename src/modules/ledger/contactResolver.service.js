// src/modules/ledger/contactResolver.service.js
// Resolves a POS customer to the master contact the ledger records.
//
// Two "customer" concepts exist and this reconciles them:
//   contactdetail  — the person (business domain). What the ledger links to.
//   pos_customer   — the POS-facing CRM projection (visits, loyalty, spend).
//
// Direction matters: POS depends on master data, never the reverse. Pointing the
// ledger at pos_customer would be the schema's first business→POS foreign key
// and would be nonsense on a purchase document.
//
// ── The phone rule ──────────────────────────────────────────────────────────
// A contact is created ONLY when a phone number exists. `uk_contact_name_mobile`
// is (FirstName, LastName, MobileNo, TenantId) and MobileNo is nullable — MySQL
// treats NULLs as distinct in a unique index, so promoting phoneless walk-ins
// would silently create a new "Rahul" every single time and the constraint would
// never fire. Phone is identity; the name is descriptive.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');

/**
 * Splits a single-field POS name into the first/last pair contactdetail needs.
 * LastName is NOT NULL, so a mononym gets an empty string rather than failing —
 * empty is not null, and the phone carries identity anyway.
 * @param {string} full
 * @returns {{firstName:string, lastName:string}}
 */
const splitName = (full) => {
  const trimmed = String(full || '').trim();
  if (!trimmed) return { firstName: 'Guest', lastName: '' };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
  };
};

/**
 * Resolves the contact a sale should be attributed to.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {string|null} posCustomerId
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<{contactDetailId:string|null, name:string|null, mobile:string|null}>}
 *          All-null for a walk-in — an anonymous sale is normal, not an error.
 */
const resolveContactForPosCustomer = async (conn, posCustomerId, tenantId, userEmail) => {
  const none = { contactDetailId: null, name: null, mobile: null };
  if (!posCustomerId) return none;

  const [customers] = await conn.execute(
    'SELECT Id, Name, Phone, ContactDetailId FROM pos_customer WHERE Id = ? AND TenantId = ?',
    [posCustomerId, tenantId],
  );
  if (!customers || customers.length === 0) return none;
  const customer = customers[0];

  // Already merged — reuse.
  if (customer.ContactDetailId) {
    return {
      contactDetailId: customer.ContactDetailId,
      name: customer.Name || null,
      mobile: customer.Phone || null,
    };
  }

  const phone = String(customer.Phone || '').trim();
  // No phone: record the name on the document snapshot but create no contact.
  if (!phone) return { contactDetailId: null, name: customer.Name || null, mobile: null };

  // Phone is identity: match an existing contact before creating one.
  const [existing] = await conn.execute(
    'SELECT Id FROM contactdetail WHERE MobileNo = ? AND TenantId = ? AND Active = 1 LIMIT 1',
    [phone, tenantId],
  );

  let contactDetailId;
  if (existing && existing.length > 0) {
    contactDetailId = existing[0].Id;
  } else {
    const { firstName, lastName } = splitName(customer.Name);
    contactDetailId = uuidv4();
    await conn.execute(
      `INSERT INTO contactdetail
         (Id, TenantId, FirstName, LastName, MobileNo, Active, CreatedOn, CreatedBy, UpdatedBy)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      [contactDetailId, tenantId, firstName, lastName, phone, userEmail, userEmail],
    );
  }

  // Complete the merge so the next sale skips all of this.
  await conn.execute(
    'UPDATE pos_customer SET ContactDetailId = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
    [contactDetailId, userEmail, posCustomerId, tenantId],
  );

  return { contactDetailId, name: customer.Name || null, mobile: phone };
};

module.exports = { resolveContactForPosCustomer, splitName };
