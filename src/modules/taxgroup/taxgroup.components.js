// src/modules/taxgroup/taxgroup.components.js
//
// A tax group's RATES — resolved, created and attached.
//
// WHY THIS IS ITS OWN MODULE
// Two callers need it and they must not disagree: the bulk import (a CSV naming
// `CGST:9|SGST:9`) and the first-time setup wizard (rate rows typed into a
// form). When only the import knew how, the wizard created tax groups with no
// rates in them at all — a group whose name said "GST 18%" and whose items
// billed ₹0 tax, forever, with nothing anywhere to say so.
//
// THE RULE BOTH MUST AGREE ON
// A tax type is its NAME AND ITS RATE together. `CGST 2.5` and `CGST 9` are two
// different tax types, and `UNIQUE (Name, Value, TenantId)` in the schema says
// so. Resolving on the name alone is what silently handed a GST 18% group the
// CGST row already standing at 2.5%.
//
// Every write goes through the owning module's `createTx`, exactly as the
// ordinary forms do — no shadow inserts, no second code path.

const { QUERIES, IMPORT } = require('../../config/constants');
const taxType = require('../taxtype/taxtype.service');
const taxMapper = require('../taxgrouptaxtypemapper/taxgrouptaxtypemapper.service');

/**
 * A component's rate as the database stores it: a string, trimmed of the noise
 * two spellings of the same number pick up (`9`, `9.0`, `' 9 '`).
 *
 * Without this, `9` and `9.0` resolve to two different tax types that mean the
 * same thing, and the unique key cheerfully allows both.
 *
 * @param {number|string} value
 * @returns {string}
 */
const normaliseRate = (value) => {
  const num = Number(String(value).trim());
  if (Number.isNaN(num)) return String(value).trim();
  // Drops a trailing '.0' without touching a genuine 2.5.
  return String(num);
};

/** A component's name as stored: trimmed, case kept as the caller typed it. */
const normaliseName = (name) => String(name).trim();

/**
 * A stable identity for one component, used as a cache key and to compare two
 * sets of rates for equality.
 *
 * @param {{name: string, value: number|string}} component
 * @returns {string}
 */
const componentKey = (component) =>
  `${normaliseName(component.name).toLowerCase()}:${normaliseRate(component.value)}`;

/**
 * A stable identity for a WHOLE set of rates, order-independent.
 *
 * Order-independent on purpose: `CGST:2.5|SGST:2.5` and `SGST:2.5|CGST:2.5` are
 * the same tax treatment, and a file that spells them in a different order in
 * two rows is not a conflict to refuse.
 *
 * @param {Array<{name: string, value: number|string}>} components
 * @returns {string}
 */
const signature = (components) =>
  (components || []).map(componentKey).sort().join('|');

/**
 * The rates currently attached to a group.
 *
 * @param {Object} conn - Open connection/transaction.
 * @param {string} taxGroupId
 * @param {string} tenantId
 * @returns {Promise<Array<{name: string, value: string}>>}
 */
const readComponentsTx = async (conn, taxGroupId, tenantId) => {
  const [rows] = await conn.execute(
    QUERIES.TAX_GROUP_TAX_TYPE_MAPPER.SELECT_COMPONENTS_OF_GROUP,
    [taxGroupId, tenantId],
  );
  return (rows || []).map((r) => ({ name: r.Name, value: r.Value }));
};

/**
 * Resolve one tax type by (name, rate), creating it only if that exact pair
 * does not exist yet.
 *
 * @param {Object} conn - Open connection/transaction.
 * @param {{name: string, value: number|string}} component
 * @param {string} tenantId
 * @param {string} userPhone
 * @param {Map} [cache] - Optional per-run cache, so a 56-row file resolves CGST
 *   once rather than 56 times. Keyed on (name, rate) like the lookup itself.
 * @returns {Promise<{id: string, created: boolean}>}
 */
const resolveTaxTypeTx = async (conn, component, tenantId, userPhone, cache) => {
  const name = normaliseName(component.name);
  const value = normaliseRate(component.value);
  const key = `taxType:${componentKey(component)}`;

  if (cache && cache.has(key)) return { id: cache.get(key), created: false };

  const [rows] = await conn.execute(
    QUERIES.TAX_TYPES.SELECT_BY_NAME_AND_VALUE, [name, value, tenantId],
  );
  if (rows.length > 0) {
    if (cache) cache.set(key, rows[0].Id);
    return { id: rows[0].Id, created: false };
  }

  const record = await taxType.createTx(
    conn, { Name: name, Value: value, Active: true }, tenantId, userPhone,
  );
  if (cache) cache.set(key, record.id);
  return { id: record.id, created: true };
};

/**
 * Attach a set of rates to a tax group.
 *
 * Idempotent: a mapping that already exists is left alone rather than added
 * again. `taxgrouptaxtypemapper` does carry `UNIQUE (TaxGroupId, TaxTypeId,
 * TenantId)`, so a duplicate would be refused by the database — but refused
 * mid-import is a failed row, and skipping is what makes re-running the same
 * file a no-op instead of an error.
 *
 * @param {Object} conn - Open connection/transaction.
 * @param {Object} args
 * @param {string} args.taxGroupId
 * @param {Array<{name: string, value: number|string}>} args.components
 * @param {string} args.tenantId
 * @param {string} args.userPhone
 * @param {Map} [args.cache]
 * @returns {Promise<{taxTypes: number, mappings: number}>} How many were newly created.
 */
const attachComponentsTx = async (conn, {
  taxGroupId, components, tenantId, userPhone, cache,
}) => {
  const counts = { taxTypes: 0, mappings: 0 };

  for (const component of components || []) {
    // eslint-disable-next-line no-await-in-loop
    const { id: taxTypeId, created } = await resolveTaxTypeTx(
      conn, component, tenantId, userPhone, cache,
    );
    if (created) counts.taxTypes += 1;

    // eslint-disable-next-line no-await-in-loop
    const [mapped] = await conn.execute(
      QUERIES.TAX_GROUP_TAX_TYPE_MAPPER.SELECT_BY_GROUP_AND_TYPE,
      [taxGroupId, taxTypeId, tenantId],
    );
    if (mapped.length > 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await taxMapper.createTx(
      conn, { TaxGroupId: taxGroupId, TaxTypeId: taxTypeId, Active: true },
      tenantId, userPhone,
    );
    counts.mappings += 1;
  }

  return counts;
};

/**
 * What a group's rates should be when the caller states none.
 *
 * A deliberate product decision, and the same one the bulk import has always
 * made: an Indian restaurant menu is 5% GST split CGST/SGST intra-state, and a
 * menu that silently prices at 0% is the worse failure. Every caller announces
 * this before applying it — it is never a surprise found afterwards.
 *
 * @returns {Array<{name: string, value: string}>}
 */
const defaultComponents = () =>
  IMPORT.DEFAULT_TAX_COMPONENTS.map((c) => ({ name: c.name, value: c.value }));

module.exports = {
  attachComponentsTx,
  resolveTaxTypeTx,
  readComponentsTx,
  defaultComponents,
  signature,
  normaliseRate,
  normaliseName,
};
