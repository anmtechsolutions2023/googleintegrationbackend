// src/modules/export/definitions/insights.js
// Insights › each report's table, as a file.
//
// These READ THE REPORT SERVICES rather than their own SQL wherever the report
// already returns the rows: a figure in the file must be the figure on the
// screen, and two implementations of one number is how they stop agreeing.
// Products and discounts are the exceptions — the reports are leaderboards
// capped at 200 rows, and a file has no reason to stop at the top 200 — so
// those two run the report's own query with the same filters and no LIMIT.
//
// `selfConnected`: the report services take their own connection, so the
// export service must not be holding one when it calls them.

const Joi = require('joi');
const { QUERIES, SCOPES } = require('../../../config/constants');
const reports = require('../../ledger/ledger.report.service');
const f = require('../export.format');

const BOOKS = [SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE];

/** The report query a definition hands on: the export's range and branch. */
const reportQuery = (ctx, extra = {}) => ({
  preset: 'custom', fromDate: ctx.range.from, toDate: ctx.range.to,
  bucket: ctx.bucket || 'day', ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...extra,
});

/** Week buckets come back as YEARWEEK (202640); everything else is a date or month. */
const bucketLabel = (v, bucket) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
  return bucket === 'week' && /^\d{6}$/.test(s) ? `${s.slice(0, 4)}-W${s.slice(4)}` : s;
};

const sales = {
  key: 'sales',
  selfConnected: true,
  workspace: 'Insights',
  label: 'Sales by period',
  where: 'Insights › Reports › Sales',
  grain: 'one day, week or month (as grouped)',
  fileStem: 'sales',
  scopes: BOOKS,
  dated: true,
  bucketed: true,
  inBundle: true,
  load: async (conn, q, ctx) => (await reports.salesReport(reportQuery(ctx), ctx.tenantId)).trend,
  columns: [
    ['Period', (r, ctx) => bucketLabel(r.Bucket, ctx.bucket)],
    ['Bills', (r) => r.Documents],
    ['Discounts', (r) => f.amount(r.DiscountAmount)],
    ['Tax', (r) => f.amount(r.TaxAmount)],
    ['Bill total', (r) => f.amount(r.GrossAmount)],
    ['Returns', (r) => f.amount(r.ReturnedAmount)],
    ['Net of returns', (r) => f.amount(r.NetOfReturns)],
    ['Avg bill', (r) => f.amount(r.Documents ? r.GrossAmount / r.Documents : 0)],
  ],
};

const products = {
  key: 'products',
  workspace: 'Insights',
  label: 'Products',
  where: 'Insights › Reports › Products',
  grain: 'one dish',
  fileStem: 'products',
  scopes: BOOKS,
  dated: true,
  inBundle: true,
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.range.from, ctx.range.to];
    let clause = '';
    if (ctx.branchId) { clause += ' AND l.BranchId = ?'; params.push(ctx.branchId); }
    const [rows] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.PRODUCT_SALES}${clause} GROUP BY ti.ItemId, i.Name, c.Name ORDER BY GrossAmount DESC`,
      params,
    );
    const total = rows.reduce((s, r) => s + (Number(r.GrossAmount) || 0), 0);
    return rows.map((r) => ({ ...r, total }));
  },
  columns: [
    ['Item', (r) => r.ItemName || ''],
    ['Category', (r) => r.CategoryName || ''],
    ['Qty sold', (r) => f.qty(r.QuantitySold)],
    ['Bills', (r) => Number(r.Documents) || 0],
    ['Discount', (r) => f.amount(r.DiscountAmount)],
    ['Taxable', (r) => f.amount(r.NetAmount)],
    ['Tax', (r) => f.amount(r.TaxAmount)],
    ['Gross', (r) => f.amount(r.GrossAmount)],
    ['Options & add-ons', (r) => f.amount((Number(r.OptionsAmount) || 0) + (Number(r.AddonsAmount) || 0))],
    ['Share of gross %', (r) => f.percent(Number(r.GrossAmount) || 0, r.total)],
  ],
};

const channels = {
  key: 'channels',
  selfConnected: true,
  workspace: 'Insights',
  label: 'Channels',
  where: 'Insights › Reports › Channels',
  grain: 'one sales channel',
  fileStem: 'channels',
  scopes: BOOKS,
  dated: true,
  inBundle: true,
  load: async (conn, q, ctx) => (await reports.channelReport(reportQuery(ctx), ctx.tenantId)).channels,
  columns: [
    ['Channel', (r) => r.Channel],
    ['Orders', (r) => r.Orders],
    ['Bills', (r) => r.Bills],
    ['Discount', (r) => f.amount(r.DiscountAmount)],
    ['Taxable', (r) => f.amount(r.NetAmount)],
    ['Tax', (r) => f.amount(r.TaxAmount)],
    ['Gross', (r) => f.amount(r.GrossAmount)],
    ['Avg bill', (r) => f.amount(r.AvgBillValue)],
    ['Share %', (r) => Number(r.ShareOfRevenue || 0).toFixed(1)],
  ],
};

const tenders = {
  key: 'tenders',
  selfConnected: true,
  workspace: 'Insights',
  label: 'Tenders (Z-report)',
  where: 'Insights › Reports › Tenders',
  grain: 'one payment method and account',
  fileStem: 'tenders',
  scopes: BOOKS,
  dated: true,
  // The Z-report has no branch filter on screen, so neither does its file.
  branchless: true,
  inBundle: true,
  load: async (conn, q, ctx) => {
    const rows = (await reports.tenderReport(reportQuery(ctx), ctx.tenantId)).tenders;
    const inflow = rows.reduce((s, r) => s + (Number(r.Inflow) || 0), 0);
    return rows.map((r) => ({ ...r, inflowTotal: inflow }));
  },
  columns: [
    ['Method', (r) => r.PaymentMode || ''],
    ['Account', (r) => r.AccountName || ''],
    ['Payments', (r) => r.Tenders],
    ['Money in', (r) => f.amount(r.Inflow)],
    ['Money out', (r) => f.amount(r.Outflow)],
    ['Net', (r) => f.amount(r.NetAmount)],
    ['Share of money in %', (r) => f.percent(Number(r.Inflow) || 0, r.inflowTotal)],
  ],
};

const venue = {
  key: 'venue',
  selfConnected: true,
  workspace: 'Insights',
  label: 'Floors & tables',
  where: 'Insights › Reports › Floors & tables',
  grain: 'one table (or channel, for sales at no table)',
  fileStem: 'tables',
  scopes: BOOKS,
  dated: true,
  inBundle: true,
  load: async (conn, q, ctx) => (await reports.venueReport(reportQuery(ctx), ctx.tenantId)).tables,
  columns: [
    ['Floor', (r) => r.FloorName || ''],
    ['Table', (r) => r.TableName || ''],
    ['Seats', (r) => (r.Capacity ? r.Capacity : '')],
    ['Orders', (r) => r.Orders],
    ['Bills', (r) => r.Bills],
    ['Gross', (r) => f.amount(r.GrossAmount)],
    ['Avg bill', (r) => f.amount(r.AvgBillValue)],
    ['Per seat', (r) => (r.RevenuePerSeat === null ? '' : f.amount(r.RevenuePerSeat))],
  ],
};

const visits = {
  key: 'visits',
  selfConnected: true,
  workspace: 'Insights',
  label: 'Visit pattern',
  where: 'Insights › Reports › Visit pattern',
  // Long, not the on-screen grid: it pivots in a spreadsheet either way round.
  grain: 'one weekday × hour',
  fileStem: 'visit-pattern',
  scopes: BOOKS,
  dated: true,
  inBundle: true,
  load: async (conn, q, ctx) => (await reports.visitPatternReport(reportQuery(ctx), ctx.tenantId)).cells,
  columns: [
    ['Day', (r) => r.Day],
    ['Hour', (r) => f.hourBand(r.Hour)],
    ['Bills', (r) => r.Visits],
    ['Gross', (r) => f.amount(r.Spend)],
    ['Avg bill', (r) => f.amount(r.Visits ? r.Spend / r.Visits : 0)],
  ],
};

const discounts = {
  key: 'discounts',
  workspace: 'Insights',
  label: 'Discounts',
  where: 'Insights › Reports › Discounts',
  grain: 'one discounted dish',
  fileStem: 'discounts',
  scopes: BOOKS,
  dated: true,
  inBundle: true,
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.range.from, ctx.range.to];
    let clause = '';
    if (ctx.branchId) { clause += ' AND l.BranchId = ?'; params.push(ctx.branchId); }
    const [rows] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.DISCOUNT_BY_PRODUCT}${clause} GROUP BY ti.ItemId, i.Name ORDER BY DiscountAmount DESC`,
      params,
    );
    return rows;
  },
  columns: [
    ['Item', (r) => r.ItemName || ''],
    ['Qty sold', (r) => f.qty(r.QuantitySold)],
    ['Bills', (r) => Number(r.Documents) || 0],
    ['On this dish', (r) => f.amount(r.ItemDiscountAmount)],
    ['Share of bill discounts', (r) => f.amount(r.BillDiscountAmount)],
    ['Total discount', (r) => f.amount(r.DiscountAmount)],
    ['Gross after discount', (r) => f.amount(r.GrossAmount)],
  ],
};

const lapsed = {
  key: 'lapsed',
  workspace: 'Insights',
  label: 'Lapsed customers',
  where: 'Insights › Reports › Lapsed',
  grain: 'one customer who has stopped coming',
  fileStem: 'lapsed',
  scopes: [SCOPES.CUSTOMER_EXPORT],
  pii: true,
  dated: false,
  branchless: true,
  filters: { days: Joi.number().integer().min(1).max(365).default(60) },
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(QUERIES.EXPORT.LAPSED, [ctx.tenantId, q.days || 60]);
    return rows;
  },
  columns: [
    ['Customer', (r) => r.Name],
    ['Mobile', (r, ctx) => f.mobile(r.Phone, ctx)],
    ['Visits', (r) => Number(r.Visits) || 0],
    ['Total spent', (r) => f.amount(r.TotalSpent)],
    ['Last visit', (r) => f.date(r.LastVisitAt)],
    ['Days away', (r) => Number(r.DaysSince) || 0],
    ['Points', (r) => Number(r.LoyaltyPoints) || 0],
  ],
};

module.exports = [sales, products, channels, tenders, venue, visits, discounts, lapsed];
module.exports.bucketLabel = bucketLabel;
