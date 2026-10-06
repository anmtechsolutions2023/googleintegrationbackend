// src/config/swagger.exports.js
// OpenAPI documentation for CSV exports (/api/exports), merged into swagger.js.
//
// The per-export table below is GENERATED from export.catalogue.js, so the
// docs list exactly the files the server serves, with their real columns and
// filters — adding an export updates /api-docs without touching this file.

const { DEFINITIONS } = require('../modules/export/export.catalogue');
const { MAX_ROWS, MAX_RANGE_DAYS } = require('../modules/export/export.service');

const security = [{ bearerAuth: [] }];
const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } };
const err = (code, description) => ({ [code]: { description, content: errorContent } });

const ADMIN = 'TENANT:ADMIN';

/** One markdown row per export: key, what a row is, who may take it, filters. */
const table = () => [
  '| key | Workspace | One row per | Who may export | Filters | Column groups |',
  '|---|---|---|---|---|---|',
  ...DEFINITIONS.map((d) => [
    `\`${d.key}\``,
    d.workspace,
    d.grain,
    [ADMIN, ...d.scopes].join(', ') + (d.pii ? ' · **personal data**' : ''),
    Object.keys(d.filters || {}).map((k) => `\`${k}\``).join(', ') || '—',
    Object.keys(d.groups || {}).map((k) => `\`${k}\``).join(', ') || '—',
  ].join(' | ')).map((r) => `| ${r} |`),
].join('\n');

const keyParam = {
  name: 'key', in: 'path', required: true,
  schema: { type: 'string', enum: DEFINITIONS.map((d) => d.key) },
  description: 'Which export. See GET /api/exports for the ones the caller may take.',
};

const commonQuery = [
  { name: 'preset', in: 'query', schema: { type: 'string', enum: ['today', 'yesterday', 'last3', 'last5', 'week', 'month', 'weekend', 'custom'], default: 'month' }, description: 'Period, for dated exports. `month` is a rolling 30 days. Ignored by undated exports (dues, assets, customers, menu, lapsed).' },
  { name: 'fromDate', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Required when preset=custom.' },
  { name: 'toDate', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Required when preset=custom.' },
  { name: 'branchId', in: 'query', schema: { type: 'string' }, description: 'One branch. Omitted = every branch. Ignored by tenant-wide exports (menu items, options, category hours, tenders, lapsed).' },
  { name: 'bucket', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' }, description: '`sales` only: how rows are grouped.' },
  { name: 'groups', in: 'query', schema: { type: 'string' }, example: 'tax,buyer', description: 'Comma-separated optional column groups to include. Omitted = the export\'s defaults; empty = core columns only.' },
  { name: 'unmask', in: 'query', schema: { type: 'boolean', default: false }, description: 'Write mobile numbers in full. Honoured only for TENANT:ADMIN and CUSTOMER:EXPORT holders; everyone else always gets `98450 •••45`.' },
  { name: 'type', in: 'query', schema: { type: 'string', enum: ['sale', 'return', 'expense'] }, description: '`ledger-documents` filter.' },
  { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Status filter. `ledger-documents`: DRAFT, PARTIALLY_PAID, SETTLED, CANCELLED, REFUNDED. `expenses`: draft, approved, settled, cancelled. `cash-sessions`: open, closed. `assets`: in_use, under_repair, retired.' },
  { name: 'categoryId', in: 'query', schema: { type: 'string' }, description: '`expenses` / `assets` filter.' },
  { name: 'reasonId', in: 'query', schema: { type: 'string' }, description: '`returns` filter.' },
  { name: 'isFault', in: 'query', schema: { type: 'boolean' }, description: '`returns` filter: only returns whose reason is (not) our fault.' },
  { name: 'age', in: 'query', schema: { type: 'string', enum: ['today', 'week', 'month', 'older'] }, description: '`dues` filter.' },
  { name: 'search', in: 'query', schema: { type: 'string' }, description: '`dues` filter: invoice, customer or mobile.' },
  { name: 'segment', in: 'query', schema: { type: 'string', enum: ['regular', 'lapsed', 'business', 'new'] }, description: '`customers` filter. Regular = 3+ visits; lapsed = 2+ visits and 60+ days away; business = has a GSTIN.' },
  { name: 'rating', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5 }, description: '`feedback` filter.' },
  { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 60 }, description: '`lapsed`: how long away counts as gone.' },
];

const schemas = {
  ExportColumn: {
    type: 'object',
    properties: {
      header: { type: 'string', example: 'Document No' },
      group: { type: 'string', nullable: true, example: 'tax', description: 'Null = always written.' },
    },
  },
  ExportDefinition: {
    type: 'object',
    properties: {
      key: { type: 'string', example: 'ledger-documents' },
      workspace: { type: 'string', enum: ['Money', 'Guests', 'Menu', 'Insights'] },
      label: { type: 'string', example: 'Ledger — documents' },
      where: { type: 'string', example: 'Money › Ledger' },
      grain: { type: 'string', example: 'one document (sale, credit note or expense)' },
      pii: { type: 'boolean', description: 'Holds personal data; the download is audited at WARN.' },
      dated: { type: 'boolean', description: 'Takes a period.' },
      branchable: { type: 'boolean', description: 'Takes branchId.' },
      bucketed: { type: 'boolean', description: 'Takes bucket.' },
      inBundle: { type: 'boolean', description: 'Included in GET /api/exports/bundle.' },
      filters: { type: 'array', items: { type: 'string' }, example: ['type', 'status'] },
      groups: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, default: { type: 'boolean' } } } },
      columns: { type: 'array', items: { $ref: '#/components/schemas/ExportColumn' } },
      canUnmask: { type: 'boolean' },
    },
  },
  ExportPreview: {
    allOf: [
      { $ref: '#/components/schemas/ExportDefinition' },
      {
        type: 'object',
        properties: {
          fileName: { type: 'string', example: 'ledger_indiranagar_2026-10-01_to_2026-10-06.csv' },
          rowCount: { type: 'integer', example: 142 },
          range: { type: 'object', nullable: true, properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } },
          branchName: { type: 'string', nullable: true },
          masked: { type: 'boolean', description: 'Mobiles will be written masked.' },
          writtenColumns: { type: 'array', items: { type: 'string' }, description: 'The header row the file will have.' },
        },
      },
    ],
  },
};

const FILE_RULES = 'Every file: UTF-8 with a byte-order mark, comma-separated, CRLF, one header row and nothing else. '
  + 'Dates `YYYY-MM-DD`, timestamps local `YYYY-MM-DD HH:MM`, money as two decimals with no symbol or grouping '
  + '(credit notes and refunds negative), mobiles `98450 12345` (or `98450 •••45` masked). Typed-in text beginning '
  + 'with `= + - @` is prefixed with an apostrophe so a spreadsheet does not run it. Staff appear by name, never by mobile. '
  + '`menu-items` uses the import template\'s lower-case headers so the file re-imports unchanged.';

const paths = {
  '/api/exports': {
    get: {
      tags: ['Exports'],
      summary: 'The exports the caller may take',
      description: `Filtered to the caller's scopes. The frontend shows an Export button only for keys listed here.\n\n${table()}\n\nTENANT:SUPER_ADMIN may take every export.`,
      security,
      responses: {
        200: {
          description: 'Success',
          content: { 'application/json': { schema: { type: 'object', properties: {
            success: { type: 'boolean' }, message: { type: 'string' },
            data: { type: 'object', properties: {
              exports: { type: 'array', items: { $ref: '#/components/schemas/ExportDefinition' } },
              canUnmask: { type: 'boolean' },
            } },
          } } } },
        },
        ...err(401, 'Unauthorized'),
      },
    },
  },
  '/api/exports/bundle': {
    get: {
      tags: ['Exports'],
      summary: 'Every Insights report for a period, as one .zip',
      description: 'One CSV per report the caller may open (sales, products, channels, tenders, tables, visit pattern, discounts) plus README.txt naming the period, branch and who exported it. Audit-logged.',
      security,
      parameters: commonQuery.filter((p) => ['preset', 'fromDate', 'toDate', 'branchId', 'bucket'].includes(p.name)),
      responses: {
        200: { description: 'The archive', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } },
        ...err(400, 'Validation error, or a range longer than the limit'),
        ...err(403, 'The caller may open none of the bundled reports'),
      },
    },
  },
  '/api/exports/{key}/preview': {
    get: {
      tags: ['Exports'],
      summary: 'What a download would hold, without downloading it',
      description: 'Same query as the download. Returns the row count, the file name and the header row — what the Export dialog shows before Download. Not audit-logged: no data leaves.',
      security,
      parameters: [keyParam, ...commonQuery],
      responses: {
        200: { description: 'Success', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { $ref: '#/components/schemas/ExportPreview' } } } } } },
        ...err(400, 'Validation error'),
        ...err(403, 'The caller may not take this export'),
        ...err(404, 'No such export, or branch not found'),
      },
    },
  },
  '/api/exports/{key}': {
    get: {
      tags: ['Exports'],
      summary: 'Download one export as CSV',
      description: `${FILE_RULES}\n\nThe file name arrives in Content-Disposition (exposed to the browser), e.g. \`ledger_indiranagar_2026-10-01_to_2026-10-06.csv\`. `
        + `A dated export may cover at most ${MAX_RANGE_DAYS} days and ${MAX_ROWS.toLocaleString('en-IN')} rows.\n\n`
        + 'Every download writes an audit row (category REPORTS) with the file name, row count, range, branch and whether mobiles were masked — at WARN for exports holding personal data. A refused attempt is logged too.',
      security,
      parameters: [keyParam, ...commonQuery],
      responses: {
        200: {
          description: 'The CSV',
          headers: { 'Content-Disposition': { schema: { type: 'string' }, example: 'attachment; filename="ledger_all-branches_2026-10-01_to_2026-10-06.csv"' } },
          content: { 'text/csv': { schema: { type: 'string' }, example: 'Date,Document No,Type,Status,Branch,Customer,Mobile,Taxable,Tax,Discount,Round off,Gross,Paid,Returned,Written off,Due,Reverses,Settled at\r\n2026-10-01,INV/IND/2610/0412,Sale,Settled,Indiranagar,Riya Sharma,98450 •••45,800.00,40.00,0.00,0.00,840.00,840.00,0.00,0.00,0.00,,2026-10-01 13:41\r\n' } },
        },
        ...err(400, 'Validation error, a range longer than the limit, or too many rows'),
        ...err(403, 'The caller may not take this export (e.g. customers without CUSTOMER:EXPORT)'),
        ...err(404, 'No such export, or branch not found'),
      },
    },
  },
};

const tags = [{ name: 'Exports', description: 'CSV downloads for Money, Guests, Menu and Insights. Each export is gated on the scope its own screen opens on; customer data needs CUSTOMER:EXPORT.' }];

module.exports = { schemas, paths, tags };
