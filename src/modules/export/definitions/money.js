// src/modules/export/definitions/money.js
// Money › every register behind the workspace, as files.
//
// A definition says WHAT a file holds; export.service.js does the rest — the
// scope check, the range, the masking, the CSV and the audit row. Columns are
// [header, value(row, ctx), group?]. A column with a group is left out unless
// the dialog asked for that group; one without is always written.

const Joi = require('joi');
const {
  QUERIES, SCOPES, LEDGER, EXPENSE_STATUS, CASH_SESSION_STATUS, ASSET_STATUS,
} = require('../../../config/constants');
const { dueOf } = require('../../ledger/ledger.due');
const { listDues } = require('../../ledger/ledger.payments.service');
const f = require('../export.format');

const Q = () => QUERIES.EXPORT;
const BOOKS = [SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE];

/** Appends `AND col = ?` for each filter present. */
const where = (sql, params, pairs) => {
  let out = sql;
  pairs.forEach(([value, clause]) => {
    if (value === undefined || value === null || value === '') return;
    out += ` AND ${clause}`;
    params.push(value);
  });
  return out;
};

const TYPE_LABEL = {
  [LEDGER.TYPE_POS_SALE]: 'Sale',
  [LEDGER.TYPE_POS_RETURN]: 'Credit note',
  [LEDGER.TYPE_EXPENSE]: 'Expense',
};
const typeLabel = (name) => TYPE_LABEL[name] || name || '';
const statusLabel = (s) => String(s || '').toLowerCase().replace(/_/g, ' ')
  .replace(/^\w/, (c) => c.toUpperCase());
// A credit note is money going back: written negative, so a SUM of the file is
// the true net for the period.
const signOf = (typeName) => (typeName === LEDGER.TYPE_POS_RETURN ? -1 : 1);

const ledgerDocuments = {
  key: 'ledger-documents',
  workspace: 'Money',
  label: 'Ledger — documents',
  where: 'Money › Ledger',
  grain: 'one document (sale, credit note or expense)',
  fileStem: 'ledger',
  scopes: BOOKS,
  dated: true,
  filters: {
    type: Joi.string().valid('sale', 'return', 'expense'),
    status: Joi.string().valid(
      LEDGER.STATUS_DRAFT, LEDGER.STATUS_PARTIALLY_PAID, LEDGER.STATUS_SETTLED,
      LEDGER.STATUS_CANCELLED, LEDGER.STATUS_REFUNDED,
    ),
  },
  groups: { tax: 'Tax breakup (CGST, SGST, IGST)', buyer: 'Business buyer (GSTIN)' },
  load: async (conn, q, ctx) => {
    const typeName = { sale: LEDGER.TYPE_POS_SALE, return: LEDGER.TYPE_POS_RETURN, expense: LEDGER.TYPE_EXPENSE }[q.type];
    const params = [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.range.from, ctx.range.to];
    const sql = where(Q().LEDGER_DOCUMENTS, params, [[typeName, 't.Name = ?'], [q.status, 's.Name = ?']]);
    const [rows] = await conn.execute(`${sql} ORDER BY l.TransactionDate ASC, l.TransactionNo ASC`, params);
    return rows.map((r) => ({ ...r, sign: signOf(r.TypeName), tax: f.taxSplit(r.TaxByComponent) }));
  },
  columns: [
    ['Date', (r) => f.date(r.TransactionDate)],
    ['Document No', (r) => r.TransactionNo],
    ['Type', (r) => typeLabel(r.TypeName)],
    ['Status', (r) => statusLabel(r.StatusName)],
    ['Branch', (r) => r.BranchName || ''],
    ['Customer', (r) => r.CustomerName || (r.TypeName === LEDGER.TYPE_EXPENSE ? '' : 'Walk-in')],
    ['Mobile', (r, ctx) => f.mobile(r.CustomerMobile, ctx)],
    ['Buyer GSTIN', (r) => r.BuyerGstin || '', 'buyer'],
    ['Buyer legal name', (r) => r.BuyerLegalName || '', 'buyer'],
    ['Taxable', (r) => f.amount(r.NetAmount, r.sign)],
    ['CGST', (r) => f.amount(r.tax.CGST, r.sign), 'tax'],
    ['SGST', (r) => f.amount(r.tax.SGST, r.sign), 'tax'],
    ['IGST', (r) => f.amount(r.tax.IGST, r.sign), 'tax'],
    ['Other tax', (r) => f.amount(r.tax.Other, r.sign), 'tax'],
    ['Tax', (r) => f.amount(r.TaxAmount, r.sign)],
    ['Discount', (r) => f.amount(r.DiscountAmount, r.sign)],
    ['Round off', (r) => f.amount(r.RoundOff, r.sign)],
    ['Gross', (r) => f.amount(r.GrossAmount, r.sign)],
    ['Paid', (r) => f.amount(Math.abs(Number(r.Paid) || 0), r.sign)],
    ['Returned', (r) => (r.TypeName === LEDGER.TYPE_POS_SALE ? f.amount(r.Returned) : '')],
    ['Written off', (r) => (r.TypeName === LEDGER.TYPE_POS_SALE ? f.amount(r.WriteOffAmount) : '')],
    ['Due', (r) => (r.TypeName === LEDGER.TYPE_POS_SALE
      ? f.amount(dueOf({ gross: r.GrossAmount, collected: r.Paid, returned: r.Returned, writtenOff: r.WriteOffAmount }))
      : '0.00')],
    ['Reverses', (r) => r.ReversesNo || ''],
    ['Settled at', (r) => f.dateTime(r.SettledAt)],
  ],
};

const ledgerLines = {
  key: 'ledger-lines',
  workspace: 'Money',
  label: 'Ledger — line items',
  where: 'Money › Ledger',
  grain: 'one line on a sale or credit note',
  fileStem: 'ledger-lines',
  scopes: BOOKS,
  dated: true,
  groups: { tax: 'Tax breakup (CGST, SGST, IGST)' },
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(
      `${Q().LEDGER_LINES} ORDER BY l.TransactionDate ASC, l.TransactionNo ASC, d.LineNo ASC`,
      [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.range.from, ctx.range.to,
        LEDGER.TYPE_POS_SALE, LEDGER.TYPE_POS_RETURN],
    );
    return rows.map((r) => ({ ...r, sign: signOf(r.TypeName), tax: f.taxSplit(r.TaxComponents) }));
  },
  columns: [
    ['Date', (r) => f.date(r.TransactionDate)],
    ['Document No', (r) => r.TransactionNo],
    ['Type', (r) => typeLabel(r.TypeName)],
    ['Branch', (r) => r.BranchName || ''],
    ['Line', (r) => r.LineNo],
    ['Item', (r) => r.ItemName || ''],
    ['Code', (r) => r.ItemCode || ''],
    ['HSN/SAC', (r) => r.SACCode || r.HSNCode || ''],
    ['Variant', (r) => f.choices(r.Variants)],
    ['Add-ons', (r) => f.choices(r.Addons, { withGroup: true })],
    ['Qty', (r) => f.qty((Number(r.Quantity) || 0) * r.sign)],
    ['Unit price', (r) => f.amount(r.UnitPrice)],
    ['Discount', (r) => f.amount(r.DiscountAmount, r.sign)],
    ['Taxable', (r) => f.amount(r.NetAmount, r.sign)],
    ['CGST', (r) => f.amount(r.tax.CGST, r.sign), 'tax'],
    ['SGST', (r) => f.amount(r.tax.SGST, r.sign), 'tax'],
    ['IGST', (r) => f.amount(r.tax.IGST, r.sign), 'tax'],
    ['Tax', (r) => f.amount(r.TaxAmount, r.sign)],
    ['Line total', (r) => f.amount(r.GrossAmount, r.sign)],
  ],
};

const payments = {
  key: 'payments',
  workspace: 'Money',
  label: 'Payments received',
  where: 'Money › Ledger',
  grain: 'one payment, refund or expense payout',
  fileStem: 'payments',
  scopes: BOOKS,
  dated: true,
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(
      `${Q().PAYMENTS} ORDER BY b.Timestamp ASC`,
      [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.bounds.from, ctx.bounds.to],
    );
    await ctx.loadStaff(conn, rows.map((r) => r.CreatedBy));
    return rows;
  },
  columns: [
    ['Date', (r) => f.dateTime(r.Timestamp).slice(0, 10)],
    ['Time', (r) => f.dateTime(r.Timestamp).slice(11)],
    ['Document No', (r) => r.TransactionNo],
    ['Type', (r) => typeLabel(r.TypeName)],
    ['Branch', (r) => r.BranchName || ''],
    ['Method', (r) => r.Method || ''],
    ['Account', (r) => r.AccountName || ''],
    ['Reference', (r) => r.RefNo || ''],
    ['Amount', (r) => f.amount(r.Amount)],
    ['Customer', (r) => r.CustomerName || ''],
    ['Taken by', (r, ctx) => ctx.staff(r.CreatedBy)],
  ],
};

const dues = {
  key: 'dues',
  workspace: 'Money',
  label: 'Dues',
  where: 'Money › Dues',
  grain: 'one bill with money still owed',
  fileStem: 'dues',
  // Same door as the Dues screen: a cashier who collects a balance may list them.
  scopes: [...BOOKS, SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE],
  dated: false,
  filters: {
    age: Joi.string().valid('today', 'week', 'month', 'older'),
    search: Joi.string().trim().max(100),
  },
  selfConnected: true,
  // The Dues screen's own read, so the file and the screen cannot disagree.
  load: async (conn, q, ctx) => (await listDues({ branchId: ctx.branchId, age: q.age, search: q.search }, ctx.tenantId)).documents,
  columns: [
    ['Invoice', (r) => r.TransactionNo],
    ['Bill date', (r) => f.date(r.TransactionDate)],
    ['Age (days)', (r) => r.AgeDays],
    ['Customer', (r) => r.CustomerName || 'Walk-in'],
    ['Mobile', (r, ctx) => f.mobile(r.CustomerMobile, ctx)],
    ['Branch', (r) => r.BranchName || ''],
    ['Source', (r) => r.Source?.label || ''],
    ['Bill', (r) => f.amount(r.GrossAmount)],
    ['Paid', (r) => f.amount(r.Collected)],
    ['Returned', (r) => f.amount(r.Returned)],
    ['Due', (r) => f.amount(r.Due)],
    ['Last collected', (r) => f.dateTime(r.LastPaymentAt)],
  ],
};

const returns = {
  key: 'returns',
  workspace: 'Money',
  label: 'Returns & refunds',
  where: 'Money › Returns',
  grain: 'one returned line on a credit note',
  fileStem: 'returns',
  scopes: BOOKS,
  dated: true,
  filters: {
    reasonId: Joi.string().trim().max(50),
    isFault: Joi.boolean(),
  },
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.range.from, ctx.range.to, LEDGER.TYPE_POS_RETURN];
    const fault = q.isFault === undefined ? undefined : (q.isFault ? 1 : 0);
    const sql = where(Q().RETURNS, params, [
      [q.reasonId, 'l.ReturnReasonId = ?'], [fault, 'COALESCE(rr.IsFault, 0) = ?'],
    ]);
    const [rows] = await conn.execute(`${sql} ORDER BY l.TransactionDate ASC, l.TransactionNo ASC, d.LineNo ASC`, params);
    await ctx.loadStaff(conn, rows.map((r) => r.CreatedBy));
    return rows;
  },
  columns: [
    ['Credit note', (r) => r.TransactionNo],
    ['Date', (r) => f.date(r.TransactionDate)],
    ['Against invoice', (r) => r.SaleNo || ''],
    ['Branch', (r) => r.BranchName || ''],
    ['Customer', (r) => r.CustomerName || 'Walk-in'],
    ['Mobile', (r, ctx) => f.mobile(r.CustomerMobile, ctx)],
    ['Item', (r) => r.ItemName || ''],
    ['Qty', (r) => f.qty(r.Quantity)],
    ['Reason', (r) => r.ReasonName],
    ['Our fault', (r) => f.yesNo(r.IsFault)],
    ['Refund', (r) => f.amount(r.GrossAmount)],
    ['Refunded by', (r) => r.RefundedTo || ''],
    ['Settlement', (r) => statusLabel(r.SettlementStatus)],
    ['Approved by', (r, ctx) => ctx.staff(r.CreatedBy)],
  ],
};

const cashSessions = {
  key: 'cash-sessions',
  workspace: 'Money',
  label: 'Cash sessions',
  where: 'Money › Cash Sessions',
  grain: 'one cashier shift',
  fileStem: 'cash-sessions',
  scopes: [SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE],
  dated: true,
  filters: { status: Joi.string().valid(...Object.values(CASH_SESSION_STATUS)) },
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.bounds.from, ctx.bounds.to];
    const sql = where(Q().CASH_SESSIONS, params, [[q.status, 'cs.Status = ?']]);
    const [rows] = await conn.execute(`${sql} ORDER BY cs.OpenedAt ASC`, params);
    await ctx.loadStaff(conn, rows.flatMap((r) => [r.CashierPhone, r.OpenedBy, r.ClosedBy]));
    return rows;
  },
  columns: [
    ['Branch', (r) => r.BranchName || ''],
    ['Cashier', (r, ctx) => ctx.staff(r.CashierPhone)],
    ['Shift', (r) => r.ShiftLabel || ''],
    ['Opened', (r) => f.dateTime(r.OpenedAt)],
    ['Closed', (r) => f.dateTime(r.ClosedAt)],
    ['Opening float', (r) => f.amount(r.OpeningFloat)],
    // What the ledger says moved through the drawer in the shift: Expected less
    // the float it started with. Blank until the shift is closed and counted.
    ['Cash movement', (r) => (r.ExpectedCash === null ? '' : f.amount(Number(r.ExpectedCash) - Number(r.OpeningFloat)))],
    ['Expected', (r) => (r.ExpectedCash === null ? '' : f.amount(r.ExpectedCash))],
    ['Counted', (r) => (r.CountedCash === null ? '' : f.amount(r.CountedCash))],
    ['Variance', (r) => (r.Variance === null ? '' : f.amount(r.Variance))],
    ['Status', (r) => statusLabel(r.Status)],
    ['Closed by', (r, ctx) => ctx.staff(r.ClosedBy)],
    ['Notes', (r) => r.Notes || ''],
  ],
};

const expenses = {
  key: 'expenses',
  workspace: 'Money',
  label: 'Expenses',
  where: 'Money › Expenses',
  grain: 'one expense claim',
  fileStem: 'expenses',
  scopes: [SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE, SCOPES.EXPENSE_APPROVE],
  dated: true,
  filters: {
    status: Joi.string().valid(...Object.values(EXPENSE_STATUS)),
    categoryId: Joi.string().trim().max(50),
  },
  groups: { approval: 'Approval (status, approved by, approved at)', ledger: 'Ledger document number' },
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.range.from, ctx.range.to];
    const sql = where(Q().EXPENSES, params, [[q.status, 'e.Status = ?'], [q.categoryId, 'e.ExpenseCategoryId = ?']]);
    const [rows] = await conn.execute(`${sql} ORDER BY COALESCE(e.ExpenseDate, e.CreatedOn) ASC`, params);
    await ctx.loadStaff(conn, rows.flatMap((r) => [r.ApprovedBy, r.CreatedBy]));
    return rows;
  },
  columns: [
    ['Date', (r) => f.date(r.ExpenseDate || r.CreatedOn)],
    ['Branch', (r) => r.BranchName || ''],
    ['Category', (r) => r.CategoryName || ''],
    ['Description', (r) => r.Description || ''],
    ['Paid by', (r) => r.PaidBy || ''],
    ['Amount', (r) => f.amount(r.Amount)],
    ['Raised by', (r, ctx) => ctx.staff(r.CreatedBy)],
    ['Status', (r) => statusLabel(r.Status), 'approval'],
    ['Approved by', (r, ctx) => ctx.staff(r.ApprovedBy), 'approval'],
    ['Approved at', (r) => f.dateTime(r.ApprovedAt), 'approval'],
    ['Ledger document', (r) => r.TransactionNo || '', 'ledger'],
  ],
};

const assets = {
  key: 'assets',
  workspace: 'Money',
  label: 'Asset register',
  where: 'Money › Assets',
  grain: 'one asset',
  fileStem: 'assets',
  scopes: [SCOPES.ASSET_READ, SCOPES.ASSET_WRITE],
  dated: false,
  filters: {
    status: Joi.string().valid(...Object.values(ASSET_STATUS)),
    categoryId: Joi.string().trim().max(50),
  },
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.branchId, ctx.branchId];
    const sql = where(Q().ASSETS, params, [[q.status, 'a.Status = ?'], [q.categoryId, 'a.AssetCategoryId = ?']]);
    const [rows] = await conn.execute(`${sql} ORDER BY br.BranchName ASC, ac.Name ASC, a.Name ASC`, params);
    return rows;
  },
  columns: [
    ['Asset', (r) => r.Name],
    ['Category', (r) => r.CategoryName || ''],
    ['Branch', (r) => r.BranchName || ''],
    ['Serial no', (r) => r.SerialNo || ''],
    ['Purchase date', (r) => f.date(r.PurchaseDate)],
    ['Cost', (r) => f.amount(r.PurchaseCost)],
    ['Supplier', (r) => r.SupplierName || ''],
    ['Status', (r) => statusLabel(r.Status)],
    ['Purchase document', (r) => r.TransactionNo || ''],
    ['Notes', (r) => r.Notes || ''],
  ],
};

module.exports = [ledgerDocuments, ledgerLines, payments, dues, returns, cashSessions, expenses, assets];
