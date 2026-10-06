// src/modules/ledger/ledger.writeoff.report.js
// Balances given up on: how much, why, by whom, and on which bills.
//
// One read behind Money › Dues › Written off (the register) and Finance (the
// Overview card and the Written off tab), so the two can never disagree.
//
// Counted by the day each balance was WRITTEN OFF, not the bill's date — see
// WRITE_OFF_GROUPS. What was written off on bills from before the window is
// reported apart (OnEarlierBills), so the rest (OnThisPeriodBills) is exactly
// Invoiced − Collected − Outstanding for the window's own bills.
//
// Totals follow the window and its bounds (branch, venue, weekends) only. The
// register's reason, who and search filters narrow the LIST in the browser and
// never the totals, as on Dues: "₹1,305 written off this month" must not change
// because the list was narrowed to one reason.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, LEDGER } = require('../../config/constants');
const {
  resolveRange,
  bucketExpression,
  weekendPredicate,
  toDateTimeBounds,
  localOffsetMinutes,
} = require('../../utils/dateRange');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');
const { venueFilter } = require('./ledger.venue');
const { describeSourceRow } = require('./ledger.source');

/** The register is small by nature; this only stops a runaway year. */
const ROW_LIMIT = 1000;
/** Gap-filling a daily trend is for charts; a year of empty days is not. */
const MAX_FILLED_DAYS = 92;

const num = (v) => Number(v || 0);
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

const reasonLabel = (code) =>
  (LEDGER.WRITE_OFF_REASONS.find(([c]) => c === code) || [])[1] || code || 'Unknown';

/**
 * The mobile behind a removed member, reduced to its last four digits. The
 * register is read by accountants as well as admins, so a mobile number never
 * leaves the server.
 */
const maskPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : 'Former member';
};

/**
 * A membership "name" that is really a mobile number. Sign-in fills full_name
 * with the number when nobody typed a name, and passing that on would send the
 * very mobile this report keeps back.
 */
const isPhoneLike = (name) => {
  const text = String(name || '').trim();
  return /^[+\d\s().-]+$/.test(text) && text.replace(/\D/g, '').length >= 7;
};

/**
 * Who wrote each balance off, by name. WrittenOffBy holds the member's mobile;
 * the key handed out is the membership id, so the list can be filtered by person
 * without the mobile itself being sent.
 *
 * @returns {Promise<Map<string, {key:string, name:string}>>} Keyed by mobile.
 */
const memberNames = async (conn, phones, tenantId) => {
  const unique = [...new Set(phones.filter(Boolean))];
  const out = new Map();
  if (unique.length === 0) return out;

  const [rows] = await conn.execute(
    QUERIES.LEDGER.SELECT_MEMBER_NAMES.replace(':phones', unique.map(() => '?').join(', ')),
    [tenantId, ...unique],
  );
  (rows || []).forEach((r) => {
    const named = r.full_name && !isPhoneLike(r.full_name);
    out.set(r.user_phone, { key: r.id, name: named ? r.full_name : maskPhone(r.user_phone) });
  });
  // Not a member any more: still named, as far as the record allows.
  unique.forEach((p, i) => {
    if (!out.has(p)) out.set(p, { key: `former-${i + 1}`, name: maskPhone(p) });
  });
  return out;
};

/** A DATE comes back as a UTC-midnight Date; weeks and months as text. */
const bucketKey = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));

/** Every local day of the window, so a quiet day shows as ₹0 rather than vanishing. */
const daysOf = ({ from, to }) => {
  const out = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end && out.length <= MAX_FILLED_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out.length > MAX_FILLED_DAYS ? null : out;
};

/** Adds one grouped row's amount (paise) and bills to a roll-up map. */
const add = (map, key, minor, bills) => {
  const cur = map.get(key) || { minor: 0, bills: 0 };
  cur.minor += minor;
  cur.bills += bills;
  map.set(key, cur);
};

/**
 * The write-off register for a window.
 *
 * Four reads on one connection: the grouped totals, the rows, the names written
 * off more than once, and what was invoiced (the denominator of "share of
 * sales"). Takes the shared report query contract.
 *
 * @param {Object} query - { preset, fromDate, toDate, bucket, branchId, floorId, tableId }
 * @param {string} tenantId
 */
const writeOffReport = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    const bounds = toDateTimeBounds(range);

    // Bounds on the write-off. The weekend test reads WrittenOffAt as local
    // time, because it is stored as a UTC instant.
    const venue = venueFilter(query);
    let clause = weekendPredicate(range.weekendOnly, 'l.WrittenOffAt', { utc: true });
    const params = [];
    if (query.branchId) { clause += ' AND l.BranchId = ?'; params.push(query.branchId); }
    clause += venue.clause;
    params.push(...venue.params);
    const base = [tenantId, LEDGER.TYPE_POS_SALE, bounds.from, bounds.to];

    // The trend buckets the LOCAL day: shifted back from UTC before DATE().
    // The offset is a number this process computes, never request text.
    const localWrittenOff = `(l.WrittenOffAt + INTERVAL ${localOffsetMinutes()} MINUTE)`;
    const [groups] = await conn.execute(
      QUERIES.LEDGER_REPORT.WRITE_OFF_GROUPS
        .replace('{{BUCKET}}', bucketExpression(range.bucket, localWrittenOff))
        .replace('GROUP BY', `${clause} GROUP BY`),
      [range.from, ...base, ...params],
    );

    const [rows] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.WRITE_OFF_ROWS}${clause}`
        + ` ORDER BY l.WrittenOffAt DESC, l.TransactionNo DESC LIMIT ${ROW_LIMIT}`,
      [range.from, ...base, ...params],
    );

    const [repeats] = await conn.execute(
      QUERIES.LEDGER_REPORT.WRITE_OFF_REPEATS.replace('GROUP BY', `${clause} GROUP BY`),
      [...base, ...params],
    );

    // Invoiced is a SALES figure, so it is bounded by bill date like every
    // other one — the same window, read the way the Sales tab reads it.
    let salesClause = weekendPredicate(range.weekendOnly, 'l.TransactionDate');
    const salesParams = [];
    if (query.branchId) { salesClause += ' AND l.BranchId = ?'; salesParams.push(query.branchId); }
    salesClause += venue.clause;
    salesParams.push(...venue.params);
    const [[invoicedRow]] = await conn.execute(
      `${QUERIES.LEDGER_REPORT.WRITE_OFF_INVOICED}${salesClause}`,
      [tenantId, LEDGER.TYPE_POS_SALE, range.from, range.to, ...salesParams],
    );

    const names = await memberNames(
      conn,
      [...(groups || []).map((g) => g.WrittenOffBy), ...(rows || []).map((r) => r.WrittenOffBy)],
      tenantId,
    );
    const nameOf = (phone) => names.get(phone) || { key: 'unknown', name: 'Unknown' };

    // ── Roll the grouped rows up ────────────────────────────────────────────
    // In paise, so five sums of two-decimal figures cannot drift a paisa.
    let totalMinor = 0;
    let bills = 0;
    let largestMinor = 0;
    let earlierMinor = 0;
    let earlierBills = 0;
    const reasons = new Map();
    const people = new Map();
    const days = new Map();
    (groups || []).forEach((g) => {
      const minor = toMinor(num(g.Amount));
      const count = num(g.Bills);
      totalMinor += minor;
      bills += count;
      largestMinor = Math.max(largestMinor, toMinor(num(g.Largest)));
      if (num(g.OnEarlierBill)) { earlierMinor += minor; earlierBills += count; }
      add(reasons, g.Reason || 'OTHER', minor, count);
      add(people, g.WrittenOffBy || '', minor, count);
      add(days, bucketKey(g.WrittenOffDay), minor, count);
    });

    const total = fromMinor(totalMinor);
    const invoiced = num(invoicedRow?.Invoiced);

    const documents = (rows || []).map((r) => {
      const by = nameOf(r.WrittenOffBy);
      return {
        Id: r.Id,
        TransactionNo: r.TransactionNo,
        TransactionDate: r.TransactionDate,
        BranchId: r.BranchId,
        BranchName: r.BranchName,
        CustomerName: r.CustomerName,
        CustomerMobile: r.CustomerMobile,
        GrossAmount: num(r.GrossAmount),
        Collected: num(r.Collected),
        Returned: num(r.Returned),
        WrittenOff: num(r.WriteOffAmount),
        Reason: r.WriteOffReason,
        ReasonLabel: reasonLabel(r.WriteOffReason),
        Note: r.WriteOffNote || null,
        WrittenOffAt: r.WrittenOffAt,
        WrittenOffByKey: by.key,
        WrittenOffByName: by.name,
        // A bill dated before the window, written off within it.
        OnEarlierBill: !!num(r.OnEarlierBill),
        Source: describeSourceRow(r),
      };
    });
    const largestDoc = documents.find((d) => toMinor(d.WrittenOff) === largestMinor) || null;

    let byDay = [...days.entries()].map(([Bucket, v]) => ({ Bucket, Bills: v.bills, Amount: fromMinor(v.minor) }));
    const filled = range.bucket === 'day' ? daysOf(range) : null;
    if (filled) {
      const known = new Map(byDay.map((d) => [d.Bucket, d]));
      byDay = filled.map((Bucket) => known.get(Bucket) || { Bucket, Bills: 0, Amount: 0 });
    } else {
      byDay.sort((a, b) => String(a.Bucket).localeCompare(String(b.Bucket)));
    }

    return {
      range,
      summary: {
        WrittenOff: total,
        Bills: bills,
        Average: bills > 0 ? fromMinor(Math.round(totalMinor / bills)) : 0,
        Largest: fromMinor(largestMinor),
        LargestNo: largestDoc ? largestDoc.TransactionNo : null,
        LargestReason: largestDoc ? largestDoc.ReasonLabel : null,
        OnEarlierBills: fromMinor(earlierMinor),
        EarlierBills: earlierBills,
        OnThisPeriodBills: fromMinor(totalMinor - earlierMinor),
        Invoiced: invoiced,
        ShareOfInvoiced: share(total, invoiced),
      },
      byReason: [...reasons.entries()]
        .map(([Code, v]) => ({
          Code, Label: reasonLabel(Code), Bills: v.bills, Amount: fromMinor(v.minor),
          Share: share(v.minor, totalMinor),
        }))
        .sort((a, b) => b.Amount - a.Amount),
      byUser: [...people.entries()]
        .map(([phone, v]) => ({
          Key: nameOf(phone).key, Name: nameOf(phone).name, Bills: v.bills, Amount: fromMinor(v.minor),
          Share: share(v.minor, totalMinor),
        }))
        .sort((a, b) => b.Amount - a.Amount),
      byDay,
      repeats: (repeats || []).map((r) => ({
        CustomerName: r.CustomerName || null,
        CustomerMobile: r.CustomerMobile || null,
        Times: num(r.Times),
        Amount: num(r.Amount),
        LastAt: r.LastAt,
      })),
      documents,
      // True when the window held more write-offs than the list carries. The
      // totals above are complete either way — they are aggregated in SQL.
      truncated: (rows || []).length >= ROW_LIMIT,
    };
  });

module.exports = { writeOffReport, memberNames, maskPhone };
