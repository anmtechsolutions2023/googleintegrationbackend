// src/modules/export/export.service.js
// Turns a definition into a file.
//
// Everything every export shares lives here, once: the scope check, the range,
// the branch, which column groups are written, whether mobiles are masked, the
// row cap, the CSV itself and the file name. A definition only says what to
// read and how each column reads it.
//
// Built in memory rather than streamed. The app runs as a serverless function,
// where a response is sent whole anyway, and the row cap below keeps the
// largest file to a few megabytes.

const { withConnection } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { QUERIES } = require('../../config/constants');
const { toCsv } = require('../../utils/csv');
const zip = require('../../utils/zip');
const { resolveRange, toDateTimeBounds, businessDate } = require('../../utils/dateRange');
const { memberNames } = require('../ledger/ledger.writeoff.report');
const catalogue = require('./export.catalogue');
const { queryFor } = require('./export.schemas');
const f = require('./export.format');

/** More than this and the person is asked to narrow the range. */
const MAX_ROWS = 100000;
/** The longest dated range one file may cover. */
const MAX_RANGE_DAYS = 366;

const STATUS = MESSAGES.HTTP_STATUS;

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/** The definition, or a 404 / 403 that says which. */
const authorise = (key, scopes) => {
  const def = catalogue.find(key);
  if (!def) throw new HttpError(MESSAGES.ERROR.EXPORT_NOT_FOUND, STATUS.NOT_FOUND);
  if (!catalogue.canExport(def, scopes)) throw new HttpError(MESSAGES.ERROR.EXPORT_FORBIDDEN, STATUS.FORBIDDEN);
  return def;
};

/** The query for one export, validated against its own filters. */
const validate = (def, raw) => {
  const { error, value } = queryFor(def).validate(raw || {}, { stripUnknown: true });
  if (error) throw new HttpError(`${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`, STATUS.BAD_REQUEST);
  return value;
};

const branchNameOf = (tenantId, branchId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.GST_EXPORT.SELECT_BRANCH, [branchId, tenantId]);
  if (!rows[0]) throw new HttpError(MESSAGES.ERROR.EXPORT_BRANCH_NOT_FOUND, STATUS.NOT_FOUND);
  return rows[0].BranchName || 'branch';
});

/**
 * Everything a definition's load and columns read.
 *
 * Staff appear by NAME: rows store the member's mobile, and a staff mobile
 * never leaves the server in a file. `loadStaff` resolves a batch once per
 * export; `staff` reads the result.
 */
const contextFor = async (def, q, user) => {
  const range = def.dated ? resolveRange(q) : null;
  if (range && daysBetween(range.from, range.to) > MAX_RANGE_DAYS) {
    throw new HttpError(MESSAGES.ERROR.EXPORT_RANGE_TOO_LONG, STATUS.BAD_REQUEST);
  }
  const branchId = def.branchless ? null : (q.branchId || null);
  const branchName = branchId ? await branchNameOf(user.tid, branchId) : null;
  const names = new Map();
  const unmasked = !!q.unmask && catalogue.canUnmask(user.scopes);

  return {
    tenantId: user.tid,
    range,
    bounds: range ? toDateTimeBounds(range) : null,
    bucket: q.bucket || 'day',
    branchId,
    branchName,
    // Read by format.mobile as its options — masked unless asked otherwise by
    // someone allowed to.
    mask: !unmasked,
    loadStaff: async (conn, phones) => {
      const wanted = [...new Set(phones.filter((p) => p && f.isPhoneLike(p) && !names.has(p)))];
      if (!wanted.length) return;
      (await memberNames(conn, wanted, user.tid)).forEach((v, k) => names.set(k, v));
    },
    staff: (phone) => f.staffName(names, phone),
  };
};

/** Which column groups are written: the ones asked for, else the defaults. */
const chosenGroups = (def, q) => {
  const known = catalogue.groupsOf(def);
  if (q.groups === undefined) return new Set(known.filter((g) => g.default).map((g) => g.key));
  const asked = String(q.groups).split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(asked.filter((k) => known.some((g) => g.key === k)));
};

/**
 * The columns written. A definition whose columns depend on the tenancy (one
 * per branch, three per portal) supplies columnsFor(ctx), read after its load
 * has filled ctx in; `columns` is then the fixed part the catalogue lists.
 */
const columnsFor = (def, q, ctx = null) => {
  const groups = chosenGroups(def, q);
  const all = def.columnsFor && ctx ? def.columnsFor(ctx) : def.columns;
  return all.filter(([, , group]) => !group || groups.has(group));
};

/** export_branch_from_to.csv, export_branch_today.csv, or export_today.csv. */
const fileNameFor = (def, ctx) => {
  const parts = [def.fileStem];
  if (!def.branchless) parts.push(ctx.branchName ? f.slug(ctx.branchName) : 'all-branches');
  parts.push(ctx.range ? `${ctx.range.from}_to_${ctx.range.to}` : businessDate());
  return `${parts.join('_')}.csv`;
};

/** Reads the rows and writes the file. Shared by download and preview. */
const build = async (def, q, user) => {
  const ctx = await contextFor(def, q, user);
  // A definition that reads through another service (the Dues screen's read,
  // a report) lets that service take its own connection. Holding one here
  // while it takes a second is the two-connections-per-request shape that
  // deadlocks the pool (config.js, DATABASE.CONNECTION_LIMIT).
  const rows = def.selfConnected
    ? await def.load(null, q, ctx)
    : await withConnection((conn) => def.load(conn, q, ctx));
  if (rows.length > MAX_ROWS) {
    throw new HttpError(MESSAGES.ERROR.EXPORT_TOO_MANY_ROWS, STATUS.BAD_REQUEST);
  }
  const columns = columnsFor(def, q, ctx);
  return { ctx, rows, columns };
};

const toFile = (columns, rows, ctx) => toCsv(
  columns.map(([header]) => header),
  rows.map((r) => columns.map(([, value]) => value(r, ctx))),
  { bom: true },
);

/** One line for the audit trail: what left, how much of it, and how. */
const auditDetails = (def, ctx, rowCount, fileName) => [
  fileName,
  `${rowCount} rows`,
  ctx.range ? `${ctx.range.from} to ${ctx.range.to}` : null,
  def.branchless ? null : (ctx.branchName || 'all branches'),
  def.pii || def.columns.some(([h]) => h === 'Mobile') ? (ctx.mask ? 'mobiles masked' : 'mobiles in full') : null,
].filter(Boolean).join(' · ').slice(0, 500);

/**
 * The CSV for one export.
 * @returns {Promise<{fileName:string, csv:string, rowCount:number, def:Object, details:string}>}
 */
const run = async (key, rawQuery, user) => {
  const def = authorise(key, user.scopes);
  const q = validate(def, rawQuery);
  const { ctx, rows, columns } = await build(def, q, user);
  const fileName = fileNameFor(def, ctx);
  return {
    def,
    fileName,
    csv: toFile(columns, rows, ctx),
    rowCount: rows.length,
    details: auditDetails(def, ctx, rows.length, fileName),
  };
};

/**
 * What the dialog shows before anyone presses Download: the row count, the
 * file name and the columns, for the same query.
 */
const preview = async (key, rawQuery, user) => {
  const def = authorise(key, user.scopes);
  const q = validate(def, rawQuery);
  const { ctx, rows, columns } = await build(def, q, user);
  return {
    ...catalogue.describe(def, user.scopes),
    fileName: fileNameFor(def, ctx),
    rowCount: rows.length,
    range: ctx.range ? { from: ctx.range.from, to: ctx.range.to } : null,
    branchName: ctx.branchName,
    masked: ctx.mask,
    writtenColumns: columns.map(([header]) => header),
  };
};

/**
 * Every Insights report this person may open, for one range, in one .zip —
 * the month-end download for the accountant. A README records the range, the
 * branch and who took it, because a CSV cannot say any of that about itself.
 */
const bundle = async (rawQuery, user) => {
  const defs = catalogue.DEFINITIONS.filter((d) => d.inBundle && catalogue.canExport(d, user.scopes));
  if (!defs.length) throw new HttpError(MESSAGES.ERROR.EXPORT_FORBIDDEN, STATUS.FORBIDDEN);

  // One validation for the lot: the bundled reports take no filters of their own.
  const q = validate(defs[0], rawQuery);
  const entries = [];
  let ctxForName = null;
  for (const def of defs) {
    const { ctx, rows, columns } = await build(def, q, user);
    ctxForName = ctxForName || ctx;
    entries.push({ name: `${def.fileStem}.csv`, data: toFile(columns, rows, ctx), rows: rows.length, label: def.label });
  }

  const { range, branchName } = ctxForName;
  const branchText = branchName || 'All branches';
  const readme = [
    'Reports export',
    '',
    `Period:      ${range.from} to ${range.to}`,
    `Branch:      ${branchText} (Tenders always covers every branch)`,
    `Exported by: ${user.name || 'staff member'}`,
    `Exported at: ${f.dateTime(new Date())}`,
    '',
    'Files:',
    ...entries.map((e) => `  ${e.name.padEnd(22)} ${String(e.rows).padStart(6)} rows  ${e.label}`),
    '',
    'Amounts are in rupees with two decimals. Dates are YYYY-MM-DD.',
  ].join('\r\n');

  const fileName = `reports_${branchName ? f.slug(branchName) : 'all-branches'}_${range.from}_to_${range.to}.zip`;
  return {
    fileName,
    buffer: zip.build([...entries.map(({ name, data }) => ({ name, data })), { name: 'README.txt', data: readme }]),
    details: [fileName, `${entries.length} reports`, `${range.from} to ${range.to}`, branchText].join(' · '),
  };
};

module.exports = { run, preview, bundle, MAX_ROWS, MAX_RANGE_DAYS, fileNameFor, columnsFor };
