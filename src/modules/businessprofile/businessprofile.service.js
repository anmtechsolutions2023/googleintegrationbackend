// src/modules/businessprofile/businessprofile.service.js
//
// Everything onboarding collected, in one read and one atomic write.
//
// WHY A FACADE OVER FOUR MODULES THAT ALREADY HAVE CRUD
// Two reasons, and the second is the real one.
//
// 1. ATOMICITY. A business profile spans organizationdetail, branchdetail,
//    addressdetail and contactdetail. A screen that saved them with four
//    sequential PUTs can fail on the third, leaving the name changed, the address
//    changed and the GSTIN not — a half-saved identity, with no way for the user
//    to tell which half. One transaction cannot do that.
//
// 2. THERE WAS NOWHERE TO LOOK. The audit found the answer to "where do I change
//    my business details" spread across Master Data → Organizations, Master Data →
//    Branch Details, Master Data → Address Details, Master Data → Contact Details,
//    POS Settings → GST and Receipt Format. Six destinations in two navigation
//    trees, and one of them shows an address as a dropdown of GUIDs. This is the
//    one place, and this module is what it reads.
//
// WHAT IT DOES NOT OWN
// No new storage. Every value here lives on the record that already owns it —
// there is deliberately no tenant_profile table, because a second home for a fact
// branchdetail already holds is how the two drift apart.
//
// It also does not own VISIBILITY. Whether any of this prints is the receipt
// catalogue's business; this module reports what the catalogue resolved to so the
// screen can show "stored but not printed", which is the state that made the
// original audit necessary.

const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const { normaliseGstin } = require('../../utils/gstStates');
const taxSettingRepository = require('../taxsetting/taxsetting.repository');
const taxSettingService = require('../taxsetting/taxsetting.service');
const posMedia = require('../posmedia/posmedia.service');
const receiptFormat = require('../posreceipt/receipt.format.service');

/**
 * The four records behind one branch, plus who last touched each.
 *
 * CreatedOn/CreatedBy and UpdatedOn/UpdatedBy are selected for every record
 * because the screen puts a provenance badge on each group — "Set at setup, 22 Sep"
 * against "Changed 14 Oct by Priya". That answers the question the audit could
 * not: which of this did I type during onboarding? Every table already carries the
 * columns, so no snapshot of the original submission is needed to say it.
 */
const readProfile = (branchId, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(
    `SELECT b.Id              AS branchId,
            b.BranchName, b.GSTIN, b.PAN, b.TINNo, b.FSSAI,
            b.CreatedOn       AS branchCreatedOn,
            b.CreatedBy       AS branchCreatedBy,
            b.UpdatedOn       AS branchUpdatedOn,
            b.UpdatedBy       AS branchUpdatedBy,

            o.Id              AS organizationId,
            o.Name            AS legalName,
            o.CreatedOn       AS orgCreatedOn,
            o.CreatedBy       AS orgCreatedBy,
            o.UpdatedOn       AS orgUpdatedOn,
            o.UpdatedBy       AS orgUpdatedBy,

            a.Id              AS addressId,
            a.AddressLine1, a.AddressLine2, a.City, a.State, a.Pincode, a.Landmark,
            a.CreatedOn       AS addressCreatedOn,
            a.CreatedBy       AS addressCreatedBy,
            a.UpdatedOn       AS addressUpdatedOn,
            a.UpdatedBy       AS addressUpdatedBy,

            c.Id              AS contactId,
            c.FirstName, c.LastName, c.Email, c.MobileNo, c.Landline1,
            c.CreatedOn       AS contactCreatedOn,
            c.CreatedBy       AS contactCreatedBy,
            c.UpdatedOn       AS contactUpdatedOn,
            c.UpdatedBy       AS contactUpdatedBy,

            -- Read-only on this screen: invoice numbering is changed at Master
            -- Data → Transaction Type Configs, and showing the series here without
            -- an edit box is how the user learns that.
            t.Format          AS invoiceFormat,
            t.CurrentCounterNo AS invoiceCounter,
            t.TagName         AS invoiceSeries
       FROM branchdetail b
       LEFT JOIN organizationdetail o    ON o.Id = b.OrganizationDetailId    AND o.TenantId = b.TenantId
       LEFT JOIN addressdetail a         ON a.Id = b.AddressDetailId         AND a.TenantId = b.TenantId
       LEFT JOIN contactdetail c         ON c.Id = b.ContactDetailId         AND c.TenantId = b.TenantId
       LEFT JOIN transactiontypeconfig t ON t.Id = b.TransactionTypeConfigId AND t.TenantId = b.TenantId
      WHERE b.Id = ? AND b.TenantId = ? LIMIT 1`,
    [branchId, tenantId],
  );
  return rows[0] || null;
});

/** When and by whom, for one record's provenance badge. */
const provenanceOf = (row, prefix) => ({
  createdOn: row[`${prefix}CreatedOn`] || null,
  createdBy: row[`${prefix}CreatedBy`] || null,
  updatedOn: row[`${prefix}UpdatedOn`] || null,
  updatedBy: row[`${prefix}UpdatedBy`] || null,
});

/**
 * What the "On the bill" tab renders: every masthead value, whether it prints, and
 * why not when it does not.
 *
 * This is the whole point of the screen. A field can be STORED and NOT PRINTED and
 * nothing in the application used to say which — so a tenant who typed an FSSAI
 * number had no way to discover that the number was never on the paper.
 *
 * @param {Object} format - receiptFormat.resolveAll() output.
 * @returns {Array<Object>}
 */
const printedFields = (format) => {
  // key → the shop{} value it prints. Only fields whose value comes from a record;
  // free-text header/footer lines are edited on the Receipt Format screen itself.
  const VALUE_OF = {
    logo: 'logoUrl',
    shopName: 'name',
    legalName: 'legalName',
    address: 'address',
    phone: 'phone',
    email: 'email',
    contactName: 'contactName',
    gstin: 'gstin',
    fssai: 'fssai',
    pan: 'pan',
    tin: 'tin',
    upiQr: 'paymentQrUrl',
  };

  const LABEL = {
    logo: 'Logo', shopName: 'Outlet name', legalName: 'Legal / group name',
    address: 'Address', phone: 'Phone', email: 'Email',
    contactName: 'Contact person', gstin: 'GSTIN', fssai: 'FSSAI',
    pan: 'PAN', tin: 'TIN', upiQr: 'Payment QR',
  };

  const bill = format.documents?.bill || {};
  const shop = format.shop || {};

  return Object.entries(VALUE_OF).map(([key, shopKey]) => {
    const value = shop[shopKey] || '';
    const state = bill[key] || 'never';
    const hasValue = String(value).trim() !== '';
    // Mirrors utils/receiptFields.shows() + present() on the client. Stated here
    // too so the summary cannot claim something the renderer would not do.
    const prints = state === 'always' ? hasValue : (state === 'if_present' && hasValue);
    return {
      key,
      label: LABEL[key],
      value,
      hasValue,
      state,
      prints,
      // What the user should do about it, in one word the UI turns into a link.
      action: (() => {
        if (!hasValue) return 'setValue';       // nothing stored yet
        if (state === 'never') return 'switchOn'; // stored, switched off
        return null;                              // printing
      })(),
    };
  });
};

/**
 * Everything the Business Profile screen needs, in one read.
 *
 * @param {string} branchId
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
const get = async (branchId, tenantId) => {
  const row = await readProfile(branchId, tenantId);
  if (!row) {
    throw new HttpError('Branch not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }

  const [taxStatus, media, format] = await Promise.all([
    taxSettingService.getStatus(tenantId),
    posMedia.list(branchId, tenantId),
    receiptFormat.resolveAll(branchId, tenantId),
  ]);

  return {
    branchId: row.branchId,
    business: {
      organizationId: row.organizationId,
      legalName: row.legalName || '',
      branchName: row.BranchName || '',
      // Read-only here. Named so the screen can say where to change it.
      invoiceFormat: row.invoiceFormat || '',
      invoiceCounter: Number(row.invoiceCounter) || 0,
      invoiceSeries: row.invoiceSeries || '',
      provenance: {
        organization: provenanceOf(row, 'org'),
        branch: provenanceOf(row, 'branch'),
      },
    },
    address: {
      addressId: row.addressId,
      addressLine1: row.AddressLine1 || '',
      addressLine2: row.AddressLine2 || '',
      city: row.City || '',
      state: row.State || '',
      pincode: row.Pincode || '',
      landmark: row.Landmark || '',
      provenance: provenanceOf(row, 'address'),
    },
    contact: {
      contactId: row.contactId,
      firstName: row.FirstName || '',
      lastName: row.LastName || '',
      email: row.Email || '',
      mobileNo: row.MobileNo || '',
      landline1: row.Landline1 || '',
      provenance: provenanceOf(row, 'contact'),
    },
    tax: {
      gstin: row.GSTIN || '',
      pan: row.PAN || '',
      tin: row.TINNo || '',
      fssai: row.FSSAI || '',
      // The tenant-wide switch, its history and anything blocking a change.
      gstCharging: taxStatus.gstCharging,
      offReason: taxStatus.offReason,
      taxMode: taxStatus.taxMode,
      history: taxStatus.history,
      openOrders: taxStatus.openOrders,
      provenance: provenanceOf(row, 'branch'),
    },
    branding: media,
    onTheBill: printedFields(format),
  };
};

/**
 * Saves the profile. ONE transaction across four tables.
 *
 * Only the sections present in the body are touched, and within a section only the
 * keys present — so the Address tab saving does not rewrite the contact, and a
 * field the form never showed is never overwritten with a blank.
 *
 * The GST SWITCH IS NOT SAVED HERE. It goes through taxsetting.setStatus, which
 * refuses while any round is open and appends to pos_tax_mode_history. Folding it
 * in would mean either duplicating that guard or quietly skipping it, and a switch
 * that re-prices every future bill deserves its own explicit act.
 *
 * @param {Object} body - { business?, address?, contact?, tax? }
 * @param {string} branchId
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<Object>} The profile as it now stands.
 */
const update = async (body, branchId, tenantId, userPhone) => {
  const existing = await readProfile(branchId, tenantId);
  if (!existing) {
    throw new HttpError('Branch not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }

  const { business = {}, address = {}, contact = {}, tax = {} } = body;

  // `undefined` means "not on this form" and keeps what is stored; '' means the
  // user cleared the box and is stored as NULL. Conflating the two is how a tab
  // that shows four fields wipes the six it does not.
  const pick = (next, current) => (next === undefined ? current : (next === '' ? null : next));

  await withTransaction(async (conn) => {
    if (business.legalName !== undefined && existing.organizationId) {
      await conn.execute(QUERIES.ORGANIZATION.UPDATE, [
        business.legalName, 1, userPhone, existing.organizationId, tenantId,
      ]);
    }

    if (Object.keys(address).length > 0 && existing.addressId) {
      await conn.execute(
        `UPDATE addressdetail
            SET AddressLine1 = ?, AddressLine2 = ?, City = ?, State = ?,
                Pincode = ?, Landmark = ?, UpdatedOn = NOW(), UpdatedBy = ?
          WHERE Id = ? AND TenantId = ?`,
        [
          pick(address.addressLine1, existing.AddressLine1),
          pick(address.addressLine2, existing.AddressLine2),
          pick(address.city, existing.City),
          pick(address.state, existing.State),
          pick(address.pincode, existing.Pincode),
          pick(address.landmark, existing.Landmark),
          userPhone, existing.addressId, tenantId,
        ],
      );
    }

    if (Object.keys(contact).length > 0 && existing.contactId) {
      await conn.execute(
        `UPDATE contactdetail
            SET FirstName = ?, LastName = ?, Email = ?, MobileNo = ?, Landline1 = ?,
                UpdatedOn = NOW(), UpdatedBy = ?
          WHERE Id = ? AND TenantId = ?`,
        [
          pick(contact.firstName, existing.FirstName),
          pick(contact.lastName, existing.LastName),
          pick(contact.email, existing.Email),
          pick(contact.mobileNo, existing.MobileNo),
          pick(contact.landline1, existing.Landline1),
          userPhone, existing.contactId, tenantId,
        ],
      );
    }

    // The branch's own columns: its name and its tax identity.
    //
    // The GSTIN is normalised through the same helper the dedicated endpoint uses,
    // so this screen cannot store a spelling that one would have rejected — the
    // audit's "two doors, one column" finding, closed by making this door apply
    // the same rule rather than by removing the other.
    const wantsBranch = business.branchName !== undefined || Object.keys(tax).length > 0;
    if (wantsBranch) {
      const gstin = tax.gstin === undefined
        ? existing.GSTIN
        : (normaliseGstin(tax.gstin) || null);
      await conn.execute(
        `UPDATE branchdetail
            SET BranchName = ?, GSTIN = ?, PAN = ?, TINNo = ?, FSSAI = ?,
                UpdatedOn = NOW(), UpdatedBy = ?
          WHERE Id = ? AND TenantId = ?`,
        [
          business.branchName === undefined
            ? existing.BranchName
            : String(business.branchName).trim(),
          gstin,
          pick(tax.pan, existing.PAN),
          pick(tax.tin, existing.TINNo),
          pick(tax.fssai, existing.FSSAI),
          userPhone, branchId, tenantId,
        ],
      );
    }
  });

  logger.info('Business profile updated', {
    tenantId,
    branchId,
    sections: Object.keys(body).filter((k) => Object.keys(body[k] || {}).length > 0),
    userPhone,
  });

  return get(branchId, tenantId);
};

module.exports = { get, update, printedFields };
