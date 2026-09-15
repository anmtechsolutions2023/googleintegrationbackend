// src/modules/gstexport/gstexport.service.js
// GST returns out of the ledger: readiness, the CA pack, the sales-without-GST
// record, filings, and the with/without-GST split report.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, LEDGER } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { resolveRange, toISODate } = require('../../utils/dateRange');
const { splitComponents } = require('./gstexport.builders');
const builders = require('./gstexport.builders');
const zip = require('../../utils/zip');
const taxSettingRepository = require('../taxsetting/taxsetting.repository');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');

const Q = () => QUERIES.GST_EXPORT;
const TYPES = () => [LEDGER.TYPE_POS_SALE, LEDGER.TYPE_POS_RETURN];
const ISSUED_STATUSES = () => [LEDGER.STATUS_SETTLED, LEDGER.STATUS_PARTIALLY_PAID, LEDGER.STATUS_REFUNDED];

/** '2026-08' → { from: '2026-08-01', to: '2026-08-31' } */
const monthBounds = (period) => {
  const [y, m] = String(period).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
};

const dateOnly = (v) => (v instanceof Date ? toISODate(v) : String(v || '').slice(0, 10));

/**
 * Everything a range of documents needs, read in four queries.
 * @param {string|null} branchId - null for every branch
 */
const loadRange = (tenantId, branchId, from, to) => withConnection(async (conn) => {
  const scope = [tenantId, branchId || null, branchId || null, from, to];
  const [[documents], [lines], [tenderRows]] = await Promise.all([
    conn.execute(Q().SELECT_DOCUMENTS, [...scope, ...TYPES()]),
    conn.execute(Q().SELECT_LINES, [...scope, ...TYPES()]),
    conn.execute(Q().SELECT_TENDERS, scope),
  ]);
  return { documents, lines, tenders: new Map(tenderRows.map((r) => [r.LogId, r.Modes || ''])) };
});

const loadBranch = (tenantId, branchId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(Q().SELECT_BRANCH, [branchId, tenantId]);
  if (!rows[0]) throw new HttpError('Branch not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  return { id: rows[0].Id, name: rows[0].BranchName || '', gstin: String(rows[0].GSTIN || '').trim().toUpperCase() || null };
});

const loadFiling = (tenantId, branchId, period) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.GST_FILING.SELECT_ONE, [tenantId, branchId, period]);
  return rows[0] || null;
});

/** The model, classification and tie-out for one branch-month. */
const analyseMonth = async ({ period, branchId }, tenantId) => {
  const { from, to } = monthBounds(period);
  const [branch, data, filing] = await Promise.all([
    loadBranch(tenantId, branchId),
    loadRange(tenantId, branchId, from, to),
    loadFiling(tenantId, branchId, period),
  ]);
  const model = builders.buildModel(data);
  const acc = builders.classify(model, branch.gstin);
  const tie = builders.tieOut(model, acc);
  const checks = builders.checksFor({ model, acc, tie, branch, filing });
  return { from, to, branch, filing, model, acc, tie, checks };
};

/** What the export screen shows before anything is downloaded. */
const readiness = async (query, tenantId) => {
  const a = await analyseMonth(query, tenantId);
  return {
    period: query.period,
    from: a.from,
    to: a.to,
    branch: a.branch,
    filing: a.filing ? { filedOn: dateOnly(a.filing.FiledOn), recordedBy: a.filing.RecordedBy } : null,
    summary: builders.summaryFor(a.model, a.acc, a.tie),
    checks: a.checks,
    blocked: a.checks.some((c) => c.level === 'block'),
  };
};

/**
 * The CA pack as a zip.
 * @returns {Promise<{fileName:string, buffer:Buffer}>}
 */
const pack = async (query, tenantId) => {
  const a = await analyseMonth(query, tenantId);
  if (!a.branch.gstin) {
    throw new HttpError(
      'This branch has no GSTIN. Add it on the GST tab or under POS Settings → GST before exporting a GST pack.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  const withoutGst = builders.sheetWithoutGst(a.model);
  const includesWithoutGst = withoutGst.bills > 0;
  const generatedAt = new Date().toISOString();

  const files = [
    { name: 'README.txt', data: builders.readme({ period: query.period, branch: a.branch, generatedAt, checks: a.checks, tie: a.tie, includesWithoutGst }) },
    { name: 'gstr3b_summary.csv', data: builders.sheetGstr3b(a.acc, a.tie) },
    { name: 'b2cs.csv', data: builders.sheetB2cs(a.acc) },
    { name: 'b2b.csv', data: builders.sheetB2b(a.acc) },
    { name: 'cdnr.csv', data: builders.sheetCdnr(a.acc) },
    { name: 'exemp.csv', data: builders.sheetExemp(a.acc) },
    { name: 'hsn_b2c.csv', data: builders.sheetHsn(a.acc.hsn.b2c) },
    { name: 'hsn_b2b.csv', data: builders.sheetHsn(a.acc.hsn.b2b) },
    { name: 'docs.csv', data: builders.sheetDocs(a.model) },
    { name: 'eco.csv', data: builders.sheetEco(a.acc) },
    { name: 'invoice_register.csv', data: builders.sheetRegister(a.model, a.acc.pos) },
    ...(includesWithoutGst ? [{ name: 'sales_without_gst.csv', data: withoutGst.csv }] : []),
  ];

  return {
    fileName: `GST_${a.branch.gstin}_${query.period}.zip`,
    buffer: zip.build(files),
  };
};

/**
 * Sales issued without GST, any date range, any or every branch.
 * @returns {Promise<{fileName:string, csv:string}>}
 */
const withoutGstCsv = async (query, tenantId) => {
  const from = dateOnly(query.fromDate);
  const to = dateOnly(query.toDate);
  const data = await loadRange(tenantId, query.branchId || null, from, to);
  const { csv } = builders.sheetWithoutGst(builders.buildModel(data));
  return { fileName: `sales_without_gst_${from}_to_${to}.csv`, csv };
};

/** Records that a month has been filed. */
const recordFiling = async (body, tenantId, userPhone) => {
  await loadBranch(tenantId, body.branchId);
  const filedOn = dateOnly(body.filedOn);
  await withConnection((conn) => conn.execute(QUERIES.GST_FILING.UPSERT, [
    uuidv4(), tenantId, body.branchId, body.period, filedOn, userPhone,
  ]));
  return { period: body.period, branchId: body.branchId, filedOn };
};

/**
 * Which days in a range GST was on, from the switch history.
 * @returns {Array<{from:string, to:string, gstCharging:boolean, offReason:(string|null), changedBy:(string|null)}>}
 */
const periodsFor = async (tenantId, from, to) => {
  const [history, current] = await Promise.all([
    taxSettingRepository.historyUntil(tenantId, `${to} 23:59:59`),
    taxSettingRepository.get(tenantId),
  ]);
  const before = history.filter((h) => dateOnly(h.changedOn) < from);
  const within = history.filter((h) => dateOnly(h.changedOn) >= from);

  let state;
  if (before.length > 0) {
    const last = before[before.length - 1];
    state = { gstCharging: last.toCharging, offReason: last.offReason, changedBy: last.changedBy };
  } else if (within.length > 0) {
    state = { gstCharging: within[0].fromCharging, offReason: null, changedBy: null };
  } else {
    state = { gstCharging: current.gstCharging, offReason: current.offReason, changedBy: current.updatedBy };
  }

  const periods = [];
  let start = from;
  within.forEach((change) => {
    const day = dateOnly(change.changedOn);
    if (day > start) periods.push({ from: start, to: prevDay(day), ...state });
    state = { gstCharging: change.toCharging, offReason: change.offReason, changedBy: change.changedBy };
    start = day > start ? day : start;
  });
  periods.push({ from: start, to, ...state });
  return periods;
};

const prevDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d - 1));
};

/** Sales with and without GST, over any report range. */
const splitReport = async (query, tenantId) => {
  const range = resolveRange(query);
  const branchId = query.branchId || null;
  const statuses = ISSUED_STATUSES();
  const scope = [tenantId, branchId, branchId, range.from, range.to, ...TYPES(), ...statuses];

  const [totals, components, products, periods] = await Promise.all([
    withConnection(async (conn) => {
      const [rows] = await conn.execute(Q().SPLIT_TOTALS, [
        LEDGER.TYPE_POS_SALE, LEDGER.TYPE_POS_RETURN, LEDGER.TYPE_POS_RETURN, LEDGER.TYPE_POS_RETURN, ...scope,
      ]);
      return rows;
    }),
    withConnection(async (conn) => {
      const [rows] = await conn.execute(Q().SPLIT_TAX_COMPONENTS, [LEDGER.TYPE_POS_RETURN, ...scope]);
      return rows;
    }),
    withConnection(async (conn) => {
      const ret = LEDGER.TYPE_POS_RETURN;
      const [rows] = await conn.execute(Q().SPLIT_PRODUCTS, [ret, ret, ret, ret, ret, ...scope]);
      return rows;
    }),
    periodsFor(tenantId, range.from, range.to),
  ]);

  const bucket = (name) => {
    const row = totals.find((r) => r.Bucket === name) || {};
    return {
      bills: Number(row.Bills) || 0,
      netAmount: Number(row.NetAmount) || 0,
      taxAmount: Number(row.TaxAmount) || 0,
      grossAmount: Number(row.GrossAmount) || 0,
    };
  };

  let cgst = 0; let sgst = 0; let igst = 0;
  components.forEach((r) => {
    let parsed = r.TaxComponents;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = []; } }
    const s = splitComponents(parsed);
    const sign = Number(r.Sign) || 1;
    cgst += sign * s.cgst; sgst += sign * s.sgst; igst += sign * s.igst;
  });

  return {
    range,
    periods,
    withGst: { ...bucket('with'), cgst: fromMinor(cgst), sgst: fromMinor(sgst), igst: fromMinor(igst) },
    withoutGst: bucket('without'),
    products: products.map((p) => ({
      itemId: p.ItemId,
      itemName: p.ItemName || 'Item',
      qtyWith: Number(p.QtyWith) || 0,
      grossWith: fromMinor(toMinor(p.GrossWith || 0)),
      taxWith: fromMinor(toMinor(p.TaxWith || 0)),
      qtyWithout: Number(p.QtyWithout) || 0,
      grossWithout: fromMinor(toMinor(p.GrossWithout || 0)),
    })),
  };
};

module.exports = {
  monthBounds, readiness, pack, withoutGstCsv, recordFiling, splitReport, periodsFor,
};
