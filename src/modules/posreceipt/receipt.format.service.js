// src/modules/posreceipt/receipt.format.service.js
//
// What prints on paper, per branch.
//
// STORAGE
// pos_setting, the table branch preferences already live in — key/value, keyed
// `UNIQUE (TenantId, BranchDetailId, SettingKey)`. No new table, and each outlet
// keeps its own format for free.
//
// ONLY OVERRIDES ARE STORED. A branch that accepts every default stores zero
// rows. Writing the defaults out would look identical right up until a default
// changes, at which point every branch that never chose anything is silently
// pinned to the old one — which is the bug this avoids, not a micro-optimisation.
//
// WHAT THIS MODULE OWNS, AND WHAT IT DOES NOT
// It owns the CONFIG: defaults, overrides, and the legal locks. It does not
// render anything. Rendering is the caller's — the browser today, an ESC/POS
// writer later — and both read the same resolved config from here. That seam is
// what stops the printer and the screen from disagreeing about what a bill says.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const catalogue = require('./receipt.catalogue');

const {
  DOCUMENTS, TAX_MODE, TAX_MODE_KEY,
  fieldsOf, fieldDef, defaultsOf, allowedValues, lockOf, settingKey,
} = catalogue;

const KEY_PREFIX = 'receipt.';
// The licence number itself, as opposed to whether it prints. Not a
// branchdetail column, so it lives here beside the format that displays it.
const FSSAI_KEY = 'receipt.shop.fssai';

/**
 * The branch row every read here needs: its name, its address and its GSTIN.
 *
 * @param {Object} conn - Open connection.
 * @param {string} branchId
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
const readBranch = async (conn, branchId, tenantId) => {
  const [rows] = await conn.execute(
    `SELECT b.BranchName, b.GSTIN,
            CONCAT_WS(', ', NULLIF(a.AddressLine1, ''), NULLIF(a.City, ''),
                            NULLIF(a.State, ''), NULLIF(a.Pincode, '')) AS Address
       FROM branchdetail b
       LEFT JOIN addressdetail a ON a.Id = b.AddressDetailId AND a.TenantId = b.TenantId
      WHERE b.Id = ? AND b.TenantId = ? LIMIT 1`,
    [branchId, tenantId],
  );
  return rows[0] || {};
};

/**
 * How this branch charges tax.
 *
 * Derived from the branch's own GSTIN unless somebody has said otherwise. The
 * override exists for the composition scheme, which a GSTIN alone cannot reveal.
 *
 * @param {Object} branch
 * @param {Object<string,string>} stored - Already-read receipt.* overrides.
 * @returns {'gst'|'composition'|'unregistered'}
 */
const resolveTaxMode = (branch, stored) => {
  const chosen = stored[TAX_MODE_KEY];
  if (chosen && Object.values(TAX_MODE).includes(chosen)) return chosen;
  // A branch holding a GSTIN is registered; one that does not cannot be. The
  // override exists for the composition scheme, which a GSTIN cannot reveal.
  return String(branch.GSTIN || '').trim() ? TAX_MODE.GST : TAX_MODE.UNREGISTERED;
};

/**
 * The masthead — name, address, GSTIN, FSSAI.
 *
 * Returned WITH the format rather than fetched separately by every screen that
 * prints: the branch row is already open here for the tax mode, and a renderer
 * that has to make a second call is a renderer that can print a bill with no
 * shop name on it when that call fails.
 *
 * FSSAI is a branch setting because it is not a branchdetail column — every
 * other field here is.
 */
const shopOf = (branch, stored) => ({
  name: branch.BranchName || '',
  address: branch.Address || '',
  gstin: String(branch.GSTIN || '').trim(),
  fssai: stored[FSSAI_KEY] || '',
});

/** Every `receipt.*` override a branch holds, as a flat map. */
const readOverrides = async (conn, branchId, tenantId) => {
  const [rows] = await conn.execute(
    QUERIES.POS_SETTING.SELECT_BY_PREFIX, [tenantId, branchId, KEY_PREFIX],
  );
  return Object.fromEntries((rows || []).map((r) => [r.SettingKey, r.SettingValue]));
};

/**
 * One document's settings, with defaults filled in and locks applied.
 *
 * A locked field takes the lock's value, NOT the stored one. An override
 * written while a branch was GST registered must not keep printing a GSTIN
 * after it stops being registered — the lock is the authority, every read.
 *
 * @param {string} doc
 * @param {Object<string,string>} stored
 * @param {Object} ctx - { taxMode }
 * @returns {Object<string,string>}
 */
const applyDoc = (doc, stored, ctx) => {
  const out = defaultsOf(doc);
  fieldsOf(doc).forEach((field) => {
    const override = stored[settingKey(doc, field.key)];
    if (override !== undefined && override !== null) out[field.key] = override;

    const lock = lockOf(field, ctx);
    if (lock) out[field.key] = lock.value;
  });
  return out;
};

/**
 * The resolved format for EVERY document type — what a renderer needs.
 *
 * @param {string} branchId
 * @param {string} tenantId
 * @returns {Promise<Object>} { branchId, taxMode, documents: { bill: {...}, … } }
 */
const resolveAll = (branchId, tenantId) =>
  withConnection(async (conn) => {
    const stored = await readOverrides(conn, branchId, tenantId);
    const branch = await readBranch(conn, branchId, tenantId);
    const taxMode = resolveTaxMode(branch, stored);
    const ctx = { taxMode };

    return {
      branchId,
      taxMode,
      shop: shopOf(branch, stored),
      documents: Object.fromEntries(
        Object.keys(DOCUMENTS).map((doc) => [doc, applyDoc(doc, stored, ctx)]),
      ),
    };
  });

/**
 * One document's editable shape: the catalogue, its current values, and which
 * fields this branch may not change.
 *
 * The editor reads this and nothing else — it never carries its own copy of the
 * field list, so a field added to the catalogue appears in the UI with no
 * frontend change at all.
 *
 * @param {string} doc
 * @param {string} branchId
 * @param {string} tenantId
 */
const describe = (doc, branchId, tenantId) =>
  withConnection(async (conn) => {
    const definition = DOCUMENTS[doc];
    if (!definition) {
      throw new HttpError(`Unknown document type “${doc}”.`, MESSAGES.HTTP_STATUS.NOT_FOUND);
    }

    const stored = await readOverrides(conn, branchId, tenantId);
    const branch = await readBranch(conn, branchId, tenantId);
    const taxMode = resolveTaxMode(branch, stored);
    const ctx = { taxMode };
    const values = applyDoc(doc, stored, ctx);

    return {
      doc,
      label: definition.label,
      description: definition.description,
      branchId,
      taxMode,
      shop: shopOf(branch, stored),
      // Every document type, so the editor can render its tabs from one call.
      documents: Object.entries(DOCUMENTS).map(([key, d]) => ({ key, label: d.label })),
      sections: definition.sections.map((section) => ({
        key: section.key,
        label: section.label,
        fields: section.fields.map((field) => {
          const lock = lockOf(field, ctx);
          return {
            key: field.key,
            label: field.label,
            hint: field.hint || null,
            type: field.type,
            states: field.states || null,
            options: field.options || null,
            maxLength: field.maxLength || null,
            default: String(field.default),
            value: values[field.key],
            // Null when the branch is free to choose. Otherwise WHY, and where
            // the setting that would change it lives.
            locked: lock ? { reason: lock.reason, changeAt: lock.changeAt } : null,
            // Whether this differs from what it would be untouched — drives the
            // "reset" affordance without the editor recomputing it.
            overridden: stored[settingKey(doc, field.key)] !== undefined && !lock,
          };
        }),
      })),
    };
  });

/**
 * Validate one field's incoming value against the catalogue.
 *
 * @param {string} doc
 * @param {string} key
 * @param {*} raw
 * @returns {string} The value as it will be stored.
 * @throws {HttpError} 400
 */
const coerce = (doc, key, raw) => {
  const field = fieldDef(doc, key);
  if (!field) {
    throw new HttpError(
      `“${key}” is not a field on the ${DOCUMENTS[doc].label.toLowerCase()}.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  const value = raw === null || raw === undefined ? '' : String(raw);
  const allowed = allowedValues(field);

  if (allowed) {
    if (!allowed.includes(value)) {
      throw new HttpError(
        `“${key}” must be one of: ${allowed.join(', ')}.`,
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      );
    }
    return value;
  }

  // Free text. VARCHAR(255) is the hard ceiling; the catalogue may set a lower
  // one because a footer line longer than the paper is not a footer line.
  const max = Math.min(field.maxLength || 120, 255);
  if (value.length > max) {
    throw new HttpError(
      `“${key}” must be ${max} characters or fewer.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  return value;
};

/**
 * Save a document's settings for a branch.
 *
 * Three rules, all of them load-bearing:
 *   1. A value equal to the default DELETES its override — see the note at the
 *      top of this file.
 *   2. A LOCKED field is refused rather than silently ignored. Silently
 *      dropping it means the editor shows one thing and the printer does
 *      another, which is the worst of the three outcomes.
 *   3. Everything lands in ONE transaction, so a rejected field cannot leave a
 *      half-applied format behind.
 *
 * @param {string} doc
 * @param {Object} values - { fieldKey: value }
 * @param {string} branchId
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<Object>} The resolved document after saving.
 */
const save = async (doc, values, branchId, tenantId, userEmail) => {
  if (!DOCUMENTS[doc]) {
    throw new HttpError(`Unknown document type “${doc}”.`, MESSAGES.HTTP_STATUS.NOT_FOUND);
  }

  await withTransaction(async (conn) => {
    const stored = await readOverrides(conn, branchId, tenantId);
    const branch = await readBranch(conn, branchId, tenantId);
    const taxMode = resolveTaxMode(branch, stored);
    const ctx = { taxMode };
    const defaults = defaultsOf(doc);

    for (const [key, raw] of Object.entries(values)) {
      const field = fieldDef(doc, key);
      const lock = field ? lockOf(field, ctx) : null;
      if (lock) {
        throw new HttpError(
          `“${field.label}” cannot be changed: ${lock.reason}.`,
          MESSAGES.HTTP_STATUS.CONFLICT,
        );
      }

      const value = coerce(doc, key, raw);
      const storageKey = settingKey(doc, key);

      if (value === defaults[key]) {
        // eslint-disable-next-line no-await-in-loop
        await conn.execute(QUERIES.POS_SETTING.DELETE_KEY, [tenantId, branchId, storageKey]);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await conn.execute(QUERIES.POS_SETTING.UPSERT, [
          uuidv4(), tenantId, branchId, storageKey, value, userEmail, userEmail,
        ]);
      }
    }
  });

  logger.info('Receipt format updated', {
    tenantId, branchId, doc, fields: Object.keys(values).length, userEmail,
  });

  return describe(doc, branchId, tenantId);
};

/**
 * Set the branch's tax mode.
 *
 * Its own call rather than a field on a document, because it is the one setting
 * that changes what the OTHER settings are allowed to be. Saving it through the
 * document path would let a caller flip it and a locked field in the same
 * request, with the outcome depending on key order.
 *
 * @param {string} taxMode
 * @param {string} branchId
 * @param {string} tenantId
 * @param {string} userEmail
 */
const setTaxMode = async (taxMode, branchId, tenantId, userEmail) => {
  if (!Object.values(TAX_MODE).includes(taxMode)) {
    throw new HttpError(
      `Tax mode must be one of: ${Object.values(TAX_MODE).join(', ')}.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  await withConnection((conn) => conn.execute(QUERIES.POS_SETTING.UPSERT, [
    uuidv4(), tenantId, branchId, TAX_MODE_KEY, taxMode, userEmail, userEmail,
  ]));

  logger.info('Receipt tax mode changed', { tenantId, branchId, taxMode, userEmail });
  return resolveAll(branchId, tenantId);
};

module.exports = { resolveAll, describe, save, setTaxMode };
