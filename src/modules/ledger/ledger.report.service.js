// src/modules/ledger/ledger.report.service.js
// The financial reporting engine.
//
// Every figure here comes from the ledger — transactiondetaillog,
// transactionitemdetail, paymentdetail, paymentbreakup — never from pos_bill.
// That is the whole point: the POS tables are operational state, and a number
// read from them can disagree with the invoice that was actually issued.
//
// Two rules hold throughout:
//   * aggregate in SQL, never in Node. No report pulls a date range into memory
//     to reduce it — that is what turns a month into a timeout.
//   * one date resolver (utils/dateRange) serves every timeframe, so daily,
//     last-5-days, weekend-only and custom cannot drift apart.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, LEDGER } = require('../../config/constants');
const {
  resolveRange,
  bucketExpression,
  weekendPredicate,
  toDateTimeBounds,
} = require('../../utils/dateRange');

/** Numeric coercion — MySQL returns DECIMAL as a string. */
const num = (v) => Number(v || 0);

/** Money rounding for figures derived in Node (roll-ups, per-seat averages). */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const numeric = (row, keys) => {
  const out = { ...row };
  keys.forEach((k) => { if (k in out) out[k] = num(out[k]); });
  return out;
};

/**
 * Restricts a document-level report to a floor or a table.
 *
 * EXISTS rather than a join: the point is to FILTER documents, and joining
 * through pos_bill_order would fan a multi-round bill out into several rows and
 * silently multiply every SUM in the report. EXISTS answers "did any of this
 * bill's rounds happen there?" without changing the row count at all.
 *
 * Reads the venue snapshot on the round, so the filter means "served on that
 * floor at the time", which is the only reading that stays true after the floor
 * plan is rearranged.
 *
 * @param {Object} query - { floorId, tableId }
 * @param {string} [logAlias] - Alias of transactiondetaillog in the outer query.
 * @returns {{clause:string, params:Array}}
 */
const venueFilter = (query, logAlias = 'l') => {
  const conditions = [];
  const params = [];
  if (query.floorId) { conditions.push('o.FloorId = ?'); params.push(query.floorId); }
  if (query.tableId) { conditions.push('o.TableId = ?'); params.push(query.tableId); }
  if (conditions.length === 0) return { clause: '', params: [] };

  return {
    clause:
      ` AND EXISTS (
          SELECT 1
            FROM pos_bill b
            JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
            JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
           WHERE b.TransactionDetailLogId = ${logAlias}.Id
             AND b.TenantId = ${logAlias}.TenantId
             AND ${conditions.join(' AND ')}
        )`,
    params,
  };
};

/**
 * Sales: invoiced vs collected, with a bucketed trend.
 *
 * Invoiced (GrossAmount) and collected (paymentdetail) are reported separately
 * because they are genuinely different numbers whenever a bill is part-paid.
 * Collapsing them into one "revenue" figure is what hides outstanding money.
 *
 * @param {Object} query - { preset, fromDate, toDate, bucket, branchId }
 * @param {string} tenantId
 */
const salesReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const weekend = weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    const branchClause = query.branchId ? ' AND l.BranchId = ?' : '';
    const branchParam = query.branchId ? [query.branchId] : [];
    const venue = venueFilter(query);
    const extra = `${weekend}${branchClause}${venue.clause}`;

    const [[summary]] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.SALES_SUMMARY}${extra}`,
      [tenantId, tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to,
        ...branchParam, ...venue.params],
    );

    // The bucket expression is interpolated, not bound — it is a whitelisted
    // SQL fragment, and MySQL cannot parameterise a GROUP BY expression.
    const trendSql = QUERIES.LEDGER_REPORT.SALES_TREND
      .replace('{{BUCKET}}', bucketExpression(range.bucket, 'l.TransactionDate'))
      .replace('GROUP BY Bucket', `${extra} GROUP BY Bucket`);

    const [trend] = await conn.execute(
      trendSql,
      [tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to,
        ...branchParam, ...venue.params],
    );

    return {
      range,
      summary: numeric(summary || {}, [
        'Documents', 'NetAmount', 'TaxAmount', 'DiscountAmount',
        'RoundOff', 'GrossAmount', 'Collected', 'Outstanding',
      ]),
      trend: trend.map((r) => numeric(r, ['Documents', 'GrossAmount', 'DiscountAmount', 'TaxAmount'])),
    };
  });

/**
 * Product performance: quantity sold, revenue and DISCOUNT per product.
 *
 * Discount is a stored per-line column rather than a derivation, so a line
 * discount and a spread bill discount are both counted, exactly once.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId, categoryId, itemId, limit }
 */
const productReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const params = [tenantId, range.from, range.to];

    let sql = QUERIES.LEDGER_REPORT.PRODUCT_SALES
      + weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    if (query.branchId) { sql += ' AND l.BranchId = ?'; params.push(query.branchId); }
    if (query.categoryId) { sql += ' AND i.CategoryId = ?'; params.push(query.categoryId); }
    if (query.itemId) { sql += ' AND ti.ItemId = ?'; params.push(query.itemId); }
    // Mix and match: "what sold on the rooftop last weekend" is this report with
    // two more bounds, not a report of its own.
    const venue = venueFilter(query);
    sql += venue.clause;
    params.push(...venue.params);

    // Ranked and capped: a product report is a leaderboard, not a data dump.
    const limit = Math.min(Number(query.limit) || 50, 200);
    sql += ` GROUP BY ti.ItemId, i.Name, c.Name ORDER BY GrossAmount DESC LIMIT ${limit}`;

    const [rows] = await conn.execute(sql, params);
    return {
      range,
      products: rows.map((r) => numeric(r, [
        'QuantitySold', 'NetAmount', 'DiscountAmount', 'TaxAmount', 'GrossAmount', 'Documents',
      ])),
    };
  });

/**
 * Pending, in both senses — they are different questions with different owners:
 *   unbilled  — rounds still open on the floor (operational, POS is the source)
 *   unpaid    — invoiced but not fully collected (financial, ledger is the source)
 */
const pendingReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const bounds = toDateTimeBounds(range);

    const [unpaid] = await conn.execute(
      QUERIES.LEDGER_REPORT.PENDING_PAYMENT,
      [tenantId, tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to],
    );
    const [unbilled] = await conn.execute(
      QUERIES.LEDGER_REPORT.PENDING_UNBILLED,
      [tenantId, bounds.from, bounds.to],
    );

    const unpaidRows = unpaid.map((r) => numeric(r, ['GrossAmount', 'Collected', 'Outstanding']));

    return {
      range,
      unpaid: {
        documents: unpaidRows,
        totalOutstanding: unpaidRows.reduce((s, r) => s + r.Outstanding, 0),
      },
      unbilled: {
        orders: unbilled.map((r) => numeric(r, ['Total'])),
        totalValue: unbilled.reduce((s, r) => s + num(r.Total), 0),
      },
    };
  });

/**
 * Tender mix — the Z-report. Refunds and expense payments are negative rows, so
 * SUM() nets them without a special case.
 */
const tenderReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const bounds = toDateTimeBounds(range);
    // The predicate belongs to the WHERE clause, so it is spliced in before
    // GROUP BY rather than appended after ORDER BY.
    const sql = QUERIES.LEDGER_REPORT.TENDER_MIX.replace(
      'GROUP BY',
      `${weekendPredicate(range.weekendOnly, 'b.Timestamp')} GROUP BY`,
    );
    const [rows] = await conn.execute(sql, [tenantId, bounds.from, bounds.to]);
    return {
      range,
      tenders: rows.map((r) => numeric(r, ['Tenders', 'Inflow', 'Outflow', 'NetAmount'])),
    };
  });

/** Cash flow per asset account: money in, money out, net movement. */
const cashFlowReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const bounds = toDateTimeBounds(range);
    const sql = QUERIES.LEDGER_REPORT.CASH_FLOW.replace(
      'GROUP BY',
      `${weekendPredicate(range.weekendOnly, 'b.Timestamp')} GROUP BY`,
    );
    const [rows] = await conn.execute(sql, [tenantId, bounds.from, bounds.to]);
    const accounts = rows.map((r) => numeric(r, ['Inflow', 'Outflow', 'NetMovement']));
    return {
      range,
      accounts,
      totals: {
        Inflow: accounts.reduce((s, a) => s + a.Inflow, 0),
        Outflow: accounts.reduce((s, a) => s + a.Outflow, 0),
        NetMovement: accounts.reduce((s, a) => s + a.NetMovement, 0),
      },
    };
  });

/**
 * Spend by category, from Expense DOCUMENTS.
 * A draft or merely approved claim has no document, so it correctly counts as
 * nothing until the money actually leaves.
 */
const expenseReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const weekend = weekendPredicate(range.weekendOnly, 'l.TransactionDate');

    const [categories] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.EXPENSE_SUMMARY.replace('GROUP BY', `${weekend} GROUP BY`)}`,
      [tenantId, range.from, range.to],
    );

    const trendSql = QUERIES.LEDGER_REPORT.EXPENSE_TREND
      .replace('{{BUCKET}}', bucketExpression(range.bucket, 'l.TransactionDate'))
      .replace('GROUP BY Bucket', `${weekend} GROUP BY Bucket`);
    const [trend] = await conn.execute(trendSql, [tenantId, range.from, range.to]);

    const rows = categories.map((r) => numeric(r, ['Entries', 'Amount']));
    return {
      range,
      categories: rows,
      trend: trend.map((r) => numeric(r, ['Entries', 'Amount'])),
      totalAmount: rows.reduce((s, r) => s + r.Amount, 0),
    };
  });

/**
 * The combined finance view: earned, collected, spent, and what is left.
 *
 * This is the "daily cash flow" question in one call, and it is only answerable
 * because expenses post to the same ledger as sales.
 */
const overviewReport = async (query, tenantId) => {
  const [sales, expenses, cash] = await Promise.all([
    salesReport(query, tenantId),
    expenseReport(query, tenantId),
    cashFlowReport(query, tenantId),
  ]);

  return {
    range: sales.range,
    sales: sales.summary,
    salesTrend: sales.trend,
    expenses: { total: expenses.totalAmount, categories: expenses.categories },
    cash: cash.totals,
    accounts: cash.accounts,
    // Collected rather than invoiced: cash in hand is what was actually taken.
    netPosition: num(sales.summary.Collected) - expenses.totalAmount,
  };
};

/**
 * Revenue by SALES CHANNEL: dine-in, counter, delivery.
 *
 * Counter sales were always in the totals — a counter bill posts the same ledger
 * document as any other — but no report could name them, so "how much came over
 * the counter today?" had no answer and the venue report filed them under
 * "No table" beside delivery.
 *
 * Shares the apportioned bill→round join with the venue report, so the same
 * bill cannot be counted differently by the two, and shares the channel
 * expression with it too — one definition of what a counter sale is.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId, floorId, tableId }
 */
const channelReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const params = [tenantId, tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to];

    let sql = QUERIES.LEDGER_REPORT.CHANNEL_REVENUE
      + weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    if (query.branchId) { sql += ' AND l.BranchId = ?'; params.push(query.branchId); }
    // Filtered on the joined round directly — this report already walks to the
    // round, so the EXISTS indirection venueFilter uses would be redundant.
    if (query.floorId) { sql += ' AND o.FloorId = ?'; params.push(query.floorId); }
    if (query.tableId) { sql += ' AND o.TableId = ?'; params.push(query.tableId); }

    sql += ' GROUP BY Channel ORDER BY GrossAmount DESC';

    const [rows] = await conn.execute(sql, params);

    const channels = rows.map((r) => {
      const c = numeric(r, [
        'Orders', 'Bills', 'NetAmount', 'DiscountAmount', 'TaxAmount', 'GrossAmount',
      ]);
      return {
        ...c,
        // What a customer on this channel is worth. A counter that takes half
        // the bills at a third of the average is a different business from the
        // dining room, and only this number says so.
        AvgBillValue: c.Bills > 0 ? round2(c.GrossAmount / c.Bills) : 0,
      };
    });

    const totalGross = channels.reduce((s, c) => s + c.GrossAmount, 0);

    return {
      range,
      // Share is computed here rather than in SQL: a window function for one
      // percentage is a MySQL-version dependency this codebase does not take
      // elsewhere, and the rows are already in hand.
      channels: channels.map((c) => ({
        ...c,
        ShareOfRevenue: totalGross > 0 ? round2((c.GrossAmount / totalGross) * 100) : 0,
      })),
      totalGross: round2(totalGross),
    };
  });

/**
 * Revenue by floor, and by table within floor.
 *
 * Grouped on the venue SNAPSHOT frozen on each round, not on a live join to
 * pos_table — so renaming a table, moving it to another floor or retiring it
 * leaves last month's numbers exactly where they were earned.
 *
 * A bill covering rounds on two tables is apportioned between them by each
 * round's share of the bill, which is why the totals here tie back to the sales
 * report to the paisa rather than merely looking plausible.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId, floorId, tableId }
 */
const venueReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const params = [tenantId, tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to];

    let sql = QUERIES.LEDGER_REPORT.VENUE_REVENUE
      + weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    if (query.branchId) { sql += ' AND l.BranchId = ?'; params.push(query.branchId); }
    // Filtered on the joined round directly — this report already walks to the
    // table, so the EXISTS indirection would be redundant here.
    if (query.floorId) { sql += ' AND o.FloorId = ?'; params.push(query.floorId); }
    if (query.tableId) { sql += ' AND o.TableId = ?'; params.push(query.tableId); }

    sql += QUERIES.LEDGER_REPORT.VENUE_GROUP_BY;

    const [rows] = await conn.execute(sql, params);

    const tables = rows.map((r) => {
      const t = numeric(r, [
        'Capacity', 'Orders', 'Bills', 'NetAmount', 'DiscountAmount', 'TaxAmount', 'GrossAmount',
      ]);
      return {
        ...t,
        // How hard a table works, not just what it took. Revenue per seat is the
        // figure that makes a 2-top and an 8-top comparable at all.
        AvgBillValue: t.Bills > 0 ? round2(t.GrossAmount / t.Bills) : 0,
        RevenuePerSeat: t.Capacity > 0 ? round2(t.GrossAmount / t.Capacity) : null,
      };
    });

    // Floors are rolled up from the same rows rather than queried again, so a
    // floor total can never disagree with the tables listed under it.
    const byFloor = new Map();
    tables.forEach((t) => {
      const key = t.FloorId || '__unassigned__';
      const f = byFloor.get(key) || {
        FloorId: t.FloorId, FloorName: t.FloorName,
        Tables: 0, Seats: 0, Orders: 0, Bills: 0,
        NetAmount: 0, DiscountAmount: 0, TaxAmount: 0, GrossAmount: 0,
      };
      f.Tables += 1;
      f.Seats += t.Capacity || 0;
      f.Orders += t.Orders;
      f.Bills += t.Bills;
      f.NetAmount += t.NetAmount;
      f.DiscountAmount += t.DiscountAmount;
      f.TaxAmount += t.TaxAmount;
      f.GrossAmount += t.GrossAmount;
      byFloor.set(key, f);
    });

    const floors = [...byFloor.values()]
      .map((f) => ({
        ...f,
        NetAmount: round2(f.NetAmount),
        DiscountAmount: round2(f.DiscountAmount),
        TaxAmount: round2(f.TaxAmount),
        GrossAmount: round2(f.GrossAmount),
        AvgBillValue: f.Bills > 0 ? round2(f.GrossAmount / f.Bills) : 0,
        RevenuePerSeat: f.Seats > 0 ? round2(f.GrossAmount / f.Seats) : null,
      }))
      .sort((a, b) => b.GrossAmount - a.GrossAmount);

    return {
      range,
      floors,
      tables,
      totalGross: round2(tables.reduce((s, t) => s + t.GrossAmount, 0)),
    };
  });

/**
 * What we gave away, and why.
 *
 * Every figure splits into the part decided ON A DISH (ItemDiscountAmount) and
 * the part that is a dish's share of a whole-bill discount. Only the first is a
 * pricing decision anyone made about that product; reporting the merged number
 * would credit a bill-wide 10% to whichever dishes happened to be expensive.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId, floorId, tableId, limit }
 */
const discountReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const weekend = weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    const branchClause = query.branchId ? ' AND l.BranchId = ?' : '';
    const branchParam = query.branchId ? [query.branchId] : [];
    const venue = venueFilter(query);
    const extra = `${weekend}${branchClause}${venue.clause}`;
    const limit = Math.min(Number(query.limit) || 50, 200);

    const [[summary]] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.DISCOUNT_SUMMARY}${extra}`,
      [tenantId, range.from, range.to, ...branchParam, ...venue.params],
    );

    const [products] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.DISCOUNT_BY_PRODUCT}${extra}`
      + ` GROUP BY ti.ItemId, i.Name ORDER BY DiscountAmount DESC LIMIT ${limit}`,
      [tenantId, range.from, range.to, ...branchParam, ...venue.params],
    );

    const [bills] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.DISCOUNT_BY_BILL}${extra}`
      + ` GROUP BY l.Id, l.TransactionNo, l.TransactionDate, l.CustomerName,
                  l.GrossAmount, l.DiscountAmount
          ORDER BY l.DiscountAmount DESC LIMIT ${limit}`,
      [tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to, ...branchParam, ...venue.params],
    );

    return {
      range,
      summary: numeric(summary || {}, [
        'Documents', 'DiscountAmount', 'ItemDiscountAmount', 'BillDiscountAmount', 'GrossAmount',
      ]),
      products: products.map((r) => numeric(r, [
        'QuantitySold', 'DiscountAmount', 'ItemDiscountAmount', 'BillDiscountAmount',
        'GrossAmount', 'Documents',
      ])),
      bills: bills.map((r) => numeric(r, [
        'GrossAmount', 'DiscountAmount', 'ItemDiscountAmount', 'BillDiscountAmount',
      ])),
    };
  });

/**
 * Who buys, how often, and how reliably — the customer credibility report.
 *
 * Reads SETTLED documents rather than pos_order: an order that was placed and
 * never paid for is not a visit, and counting it would flatter every regular.
 *
 * AvgDaysBetween is the useful column and the least obvious one. A raw order
 * count cannot separate somebody who came six times last week from somebody who
 * came six times last year; the interval can.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId, limit, minOrders }
 * @param {string} tenantId
 */
const customerReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const limit = Math.min(Number(query.limit) || 100, 500);

    let sql = QUERIES.LEDGER_REPORT_CUSTOMER.CUSTOMERS
      + weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    const params = [tenantId, range.from, range.to];
    if (query.branchId) { sql += ' AND l.BranchId = ?'; params.push(query.branchId); }
    if (query.customerId) { sql += ' AND c.Id = ?'; params.push(query.customerId); }
    sql += `${QUERIES.LEDGER_REPORT_CUSTOMER.CUSTOMERS_GROUP_BY} LIMIT ${limit}`;

    const [rows] = await conn.execute(sql, params);

    const customers = rows
      .map((r) => numeric(r, ['Orders', 'Spend', 'AverageOrder', 'LoyaltyPoints', 'DaysSinceLast']))
      .map((r) => ({
        ...r,
        AverageOrder: round2(r.AverageOrder),
        Spend: round2(r.Spend),
        // Null for a one-time buyer: an interval needs two points, and 0 would
        // read as "comes every day".
        AvgDaysBetween: r.AvgDaysBetween === null ? null : num(r.AvgDaysBetween),
        IsRepeat: num(r.Orders) > 1,
      }))
      .filter((r) => (query.minOrders ? num(r.Orders) >= Number(query.minOrders) : true));

    // The denominator has to include walk-ins, or "repeat rate" measures only
    // the customers we already know and always looks wonderful.
    const [[repeat]] = await conn.execute(
      QUERIES.LEDGER_REPORT_CUSTOMER.REPEAT_SUMMARY, [tenantId, range.from, range.to],
    );
    const [[totals]] = await conn.execute(
      QUERIES.LEDGER_REPORT_CUSTOMER.TOTAL_DOCUMENTS, [tenantId, range.from, range.to],
    );

    const knownOrders = num(repeat?.KnownOrders);
    const documents = num(totals?.Documents);

    return {
      range,
      summary: {
        Documents: documents,
        KnownCustomers: num(repeat?.KnownCustomers),
        RepeatCustomers: num(repeat?.RepeatCustomers),
        KnownOrders: knownOrders,
        KnownSpend: round2(repeat?.KnownSpend),
        // Share of settled sales attached to somebody we can name. Low is not a
        // failure — it is the size of the opportunity.
        IdentifiedRate: documents ? round2((knownOrders / documents) * 100) : 0,
        // Of the customers we know, how many came back.
        RepeatRate: num(repeat?.KnownCustomers)
          ? round2((num(repeat?.RepeatCustomers) / num(repeat?.KnownCustomers)) * 100)
          : 0,
      },
      customers,
    };
  });

/**
 * When people visit: day of week against hour of day.
 *
 * Returned as a flat grid AND as totals per day and per hour, so the caller can
 * draw a heatmap without recomputing either axis.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId, customerId }
 * @param {string} tenantId
 */
const visitPatternReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);

    let sql = QUERIES.LEDGER_REPORT_CUSTOMER.VISIT_PATTERN
      + weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    const params = [tenantId, range.from, range.to];
    if (query.branchId) { sql += ' AND l.BranchId = ?'; params.push(query.branchId); }
    if (query.customerId) { sql += ' AND o.CustomerId = ?'; params.push(query.customerId); }
    sql += QUERIES.LEDGER_REPORT_CUSTOMER.VISIT_PATTERN_GROUP_BY;

    const [rows] = await conn.execute(sql, params);
    const cells = rows.map((r) => numeric(r, ['Dow', 'Hour', 'Visits', 'Spend']));

    // MySQL DAYOFWEEK is 1=Sunday. Named here rather than in the UI so every
    // consumer agrees on which day column 1 is.
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDay = DAYS.map((name, i) => ({
      Dow: i + 1, Day: name,
      Visits: cells.filter((c) => c.Dow === i + 1).reduce((s, c) => s + c.Visits, 0),
      Spend: round2(cells.filter((c) => c.Dow === i + 1).reduce((s, c) => s + c.Spend, 0)),
    }));
    const byHour = Array.from({ length: 24 }, (_, h) => ({
      Hour: h,
      Visits: cells.filter((c) => c.Hour === h).reduce((s, c) => s + c.Visits, 0),
    }));

    const busiest = [...cells].sort((a, b) => b.Visits - a.Visits)[0] || null;

    return {
      range,
      cells: cells.map((c) => ({ ...c, Day: DAYS[c.Dow - 1], Spend: round2(c.Spend) })),
      byDay,
      byHour,
      // The single sentence a manager wants out of a heatmap.
      Busiest: busiest ? { Day: DAYS[busiest.Dow - 1], Hour: busiest.Hour, Visits: busiest.Visits } : null,
    };
  });

/**
 * Known customers who have stopped coming — a targeting list, not a chart.
 *
 * @param {Object} query - { days, limit }
 * @param {string} tenantId
 */
const lapsedReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const days = Math.min(Math.max(Number(query.days) || 30, 1), 365);
    const limit = Math.min(Number(query.limit) || 100, 500);
    const [rows] = await conn.execute(
      `${QUERIES.LEDGER_REPORT_CUSTOMER.LAPSED} LIMIT ${limit}`, [tenantId, days],
    );
    return {
      thresholdDays: days,
      customers: rows.map((r) => ({
        ...numeric(r, ['Visits', 'TotalSpent', 'LoyaltyPoints', 'DaysSince']),
        TotalSpent: round2(r.TotalSpent),
      })),
    };
  });

module.exports = {
  customerReport,
  visitPatternReport,
  lapsedReport,
  salesReport,
  productReport,
  pendingReport,
  tenderReport,
  cashFlowReport,
  expenseReport,
  overviewReport,
  venueReport,
  channelReport,
  discountReport,
};
