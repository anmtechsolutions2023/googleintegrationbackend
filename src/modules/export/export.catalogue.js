// src/modules/export/export.catalogue.js
// Every export in the application, and who may take each one.
//
// The scopes are the DATA's own, exactly as the Reports catalogue does it:
// an export opens on the scope its screen opens on, so a manager can download
// exactly what they can already see. There is no "export" permission for
// ordinary data — only CUSTOMER:EXPORT, for taking personal data in bulk.
//
// The frontend asks GET /api/exports for this list (filtered to the caller)
// and shows an Export button only where one is offered, so the button and the
// server can never disagree about who may press it.

const { SCOPES } = require('../../config/constants');

const DEFINITIONS = [
  ...require('./definitions/money'),
  ...require('./definitions/guests'),
  ...require('./definitions/menu'),
  ...require('./definitions/insights'),
];

const BY_KEY = new Map(DEFINITIONS.map((d) => [d.key, d]));
if (BY_KEY.size !== DEFINITIONS.length) {
  throw new Error('export.catalogue: two exports share a key');
}

// Administrators of the tenancy may take every export. A platform super
// admin passes every scope check in the app, and here too.
const ADMIN = [SCOPES.TENANT_ADMIN];

const holds = (scopes = [], wanted = []) => wanted.some((s) => scopes.includes(s));

/** May these scopes take this export? */
const canExport = (def, scopes = []) =>
  scopes.includes(SCOPES.TENANT_SUPER_ADMIN) || holds(scopes, [...ADMIN, ...def.scopes]);

/** May these scopes write mobile numbers in full? */
const canUnmask = (scopes = []) =>
  scopes.includes(SCOPES.TENANT_SUPER_ADMIN) || holds(scopes, [SCOPES.TENANT_ADMIN, SCOPES.CUSTOMER_EXPORT]);

/** A definition's column groups as the dialog lists them. */
const groupsOf = (def) => Object.entries(def.groups || {}).map(([key, label]) => ({
  key,
  label,
  // Groups are on unless a definition names its defaults — customers leave
  // the business columns off, because most rows would be empty.
  default: def.defaultGroups ? def.defaultGroups.includes(key) : true,
}));

/** What the client needs to draw an Export button and its dialog. */
const describe = (def, scopes) => ({
  key: def.key,
  workspace: def.workspace,
  label: def.label,
  where: def.where,
  grain: def.grain,
  pii: !!def.pii,
  dated: !!def.dated,
  branchable: !def.branchless,
  bucketed: !!def.bucketed,
  inBundle: !!def.inBundle,
  filters: Object.keys(def.filters || {}),
  groups: groupsOf(def),
  columns: def.columns.map(([header, , group]) => ({ header, group: group || null })),
  canUnmask: canUnmask(scopes),
});

/** Every export these scopes may take, in catalogue order. */
const visibleTo = (scopes = []) => DEFINITIONS.filter((d) => canExport(d, scopes)).map((d) => describe(d, scopes));

const find = (key) => BY_KEY.get(key) || null;

module.exports = { DEFINITIONS, find, canExport, canUnmask, describe, visibleTo, groupsOf };
