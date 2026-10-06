// src/modules/export/definitions/guests.js
// Guests › customers, loyalty, feedback and campaign results, as files.
//
// Three of these four carry personal data. Customers and the loyalty statement
// need CUSTOMER:EXPORT — reading one guest on screen (POS_CRM:READ) is not the
// same trust as taking every guest's number home. Feedback opens on
// POS_CRM:READ because its value is the comments, and its mobiles are masked
// for anyone who cannot un-mask them. `pii` makes the audit row a WARN.

const Joi = require('joi');
const { QUERIES, SCOPES } = require('../../../config/constants');
const f = require('../export.format');

const Q = () => QUERIES.EXPORT;

// A regular is three visits or more; gone is sixty days without one. The same
// thresholds the dialog's segment picker names.
const REGULAR_VISITS = 3;
const LAPSED_DAYS = 60;

/** Which list a customer falls in, most specific first. */
const segmentOf = (r) => {
  if (r.GSTIN) return 'Business';
  const visits = Number(r.Visits) || 0;
  const away = r.DaysAway === null || r.DaysAway === undefined ? null : Number(r.DaysAway);
  if (visits >= 2 && away !== null && away > LAPSED_DAYS) return 'Lapsed';
  if (visits >= REGULAR_VISITS) return 'Regular';
  return 'New';
};

const SEGMENTS = { regular: 'Regular', lapsed: 'Lapsed', business: 'Business', new: 'New' };

const customers = {
  key: 'customers',
  workspace: 'Guests',
  label: 'Customers',
  where: 'Guests › Customers',
  grain: 'one customer',
  fileStem: 'customers',
  scopes: [SCOPES.CUSTOMER_EXPORT],
  pii: true,
  dated: false,
  filters: { segment: Joi.string().valid(...Object.keys(SEGMENTS)) },
  groups: { contact: 'Contact (mobile, email)', business: 'Business (GSTIN, legal name)' },
  defaultGroups: ['contact'],
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(
      `${Q().CUSTOMERS} ORDER BY c.TotalSpent DESC, c.Name ASC`,
      [ctx.tenantId, ctx.branchId, ctx.branchId],
    );
    const all = rows.map((r) => ({ ...r, Segment: segmentOf(r) }));
    return q.segment ? all.filter((r) => r.Segment === SEGMENTS[q.segment]) : all;
  },
  columns: [
    ['Customer', (r) => r.Name],
    ['Mobile', (r, ctx) => f.mobile(r.Phone, ctx), 'contact'],
    ['Email', (r) => r.Email || '', 'contact'],
    ['GSTIN', (r) => r.GSTIN || '', 'business'],
    ['Legal name', (r) => r.LegalName || '', 'business'],
    ['Home branch', (r) => r.BranchName || ''],
    ['First seen', (r) => f.date(r.CreatedOn)],
    ['Last visit', (r) => f.date(r.LastVisitAt)],
    ['Visits', (r) => Number(r.Visits) || 0],
    ['Total spent', (r) => f.amount(r.TotalSpent)],
    ['Avg bill', (r) => f.amount(Number(r.Visits) ? Number(r.TotalSpent) / Number(r.Visits) : 0)],
    ['Points', (r) => Number(r.LoyaltyPoints) || 0],
    ['Days away', (r) => (r.DaysAway === null ? '' : r.DaysAway)],
    ['Segment', (r) => r.Segment],
  ],
};

const ENTRY_LABEL = { REVERSAL: 'REVERSE', ADJUSTMENT: 'ADJUST' };

const loyalty = {
  key: 'loyalty',
  workspace: 'Guests',
  label: 'Loyalty statement',
  where: 'Guests › Customers › Loyalty',
  grain: 'one points movement',
  fileStem: 'loyalty',
  scopes: [SCOPES.CUSTOMER_EXPORT],
  pii: true,
  dated: true,
  /**
   * The running balance is the customer's whole balance, so it is built over
   * every branch and only then narrowed to the one asked for: an earn at
   * Koramangala still moves what a guest at Indiranagar can spend.
   */
  load: async (conn, q, ctx) => {
    const [rows] = await conn.execute(Q().LOYALTY, [ctx.tenantId, ctx.bounds.from, ctx.bounds.to]);
    const ids = [...new Set(rows.map((r) => r.CustomerId))];
    const opening = new Map();
    if (ids.length) {
      const [open] = await conn.execute(
        Q().LOYALTY_OPENING.replace(':ids', ids.map(() => '?').join(', ')),
        [ctx.tenantId, ctx.bounds.from, ...ids],
      );
      open.forEach((o) => opening.set(o.CustomerId, Number(o.Opening) || 0));
    }
    const balance = new Map(ids.map((id) => [id, opening.get(id) || 0]));
    const out = rows.map((r) => {
      const after = balance.get(r.CustomerId) + (Number(r.Points) || 0);
      balance.set(r.CustomerId, after);
      return { ...r, BalanceAfter: after };
    });
    await ctx.loadStaff(conn, out.map((r) => r.CreatedBy));
    return ctx.branchId ? out.filter((r) => r.BranchDetailId === ctx.branchId) : out;
  },
  columns: [
    ['When', (r) => f.dateTime(r.CreatedOn)],
    ['Customer', (r) => r.Name],
    ['Mobile', (r, ctx) => f.mobile(r.Phone, ctx)],
    ['Entry', (r) => ENTRY_LABEL[r.EntryType] || r.EntryType],
    ['Points', (r) => Number(r.Points) || 0],
    ['Balance after', (r) => r.BalanceAfter],
    ['Source', (r) => r.SourceNo || (r.SourceType === 'MANUAL' ? 'Manual' : '')],
    ['Reason', (r) => r.Reason || ''],
    ['Branch', (r) => r.BranchName || ''],
    ['By', (r, ctx) => ctx.staff(r.CreatedBy)],
  ],
};

/** "Dine-in · T4", "Takeaway", "Zomato". */
const whereServed = (r) => {
  if (r.TableName) return `Dine-in · ${r.TableName}`;
  if (r.ChannelName) return r.ChannelName;
  const type = String(r.OrderType || '').toLowerCase();
  return { takeaway: 'Takeaway', delivery: 'Delivery', dinein: 'Dine-in' }[type] || '';
};

const feedback = {
  key: 'feedback',
  workspace: 'Guests',
  label: 'Feedback',
  where: 'Guests › Feedback',
  grain: 'one feedback card',
  fileStem: 'feedback',
  scopes: [SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE],
  pii: true,
  dated: true,
  filters: { rating: Joi.number().integer().min(1).max(5) },
  load: async (conn, q, ctx) => {
    const params = [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.bounds.from, ctx.bounds.to];
    let sql = Q().FEEDBACK;
    if (q.rating) { sql += ' AND f.Rating = ?'; params.push(q.rating); }
    const [rows] = await conn.execute(`${sql} ORDER BY f.CreatedOn ASC`, params);
    return rows;
  },
  columns: [
    ['When', (r) => f.dateTime(r.CreatedOn)],
    ['Customer', (r) => r.CustomerName || 'Walk-in'],
    ['Mobile', (r, ctx) => f.mobile(r.Phone, ctx)],
    ['Rating', (r) => (r.Rating === null ? '' : Number(r.Rating))],
    ['Comments', (r) => r.Comments || ''],
    ['Bill', (r) => r.BillNo || ''],
    ['Where', (r) => whereServed(r)],
    ['Branch', (r) => r.BranchName || ''],
  ],
};

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon–Fri 16:00–18:00", "Every day", "Sat, Sun". ISO weekdays, 1 = Monday. */
const whenRuns = (c) => {
  const days = String(c.DaysOfWeek || '').split(',').map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7);
  const contiguous = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  let dayText = 'Every day';
  if (days.length && days.length < 7) {
    dayText = contiguous ? `${WEEKDAYS[days[0]]}–${WEEKDAYS[days[days.length - 1]]}` : days.map((d) => WEEKDAYS[d]).join(', ');
  }
  const hours = c.StartTime && c.EndTime ? ` ${f.time(c.StartTime)}–${f.time(c.EndTime)}` : '';
  return `${dayText}${hours}`;
};

const campaigns = {
  key: 'campaigns',
  workspace: 'Guests',
  label: 'Campaign performance',
  where: 'Guests › Campaigns',
  grain: 'one campaign',
  fileStem: 'campaigns',
  scopes: [SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE],
  dated: true,
  // Redemptions are rolled up per bill so a bill with three free chais counts
  // its revenue once.
  load: async (conn, q, ctx) => {
    const [list] = await conn.execute(Q().CAMPAIGNS, [ctx.tenantId]);
    const [used] = await conn.execute(
      Q().CAMPAIGN_REDEMPTIONS,
      [ctx.tenantId, ctx.branchId, ctx.branchId, ctx.bounds.from, ctx.bounds.to],
    );
    const roll = new Map();
    used.forEach((u) => {
      const t = roll.get(u.CampaignId) || { redemptions: 0, bills: 0, given: 0, revenue: 0 };
      t.redemptions += Number(u.Redemptions) || 0;
      t.given += Number(u.Given) || 0;
      if (u.BillId) { t.bills += 1; t.revenue += Number(u.BillGross) || 0; }
      roll.set(u.CampaignId, t);
    });
    return list.map((c) => ({ ...c, ...(roll.get(c.Id) || { redemptions: 0, bills: 0, given: 0, revenue: 0 }) }));
  },
  columns: [
    ['Campaign', (r) => r.Name],
    ['Code', (r) => r.Code],
    ['Status', (r) => String(r.Status || '').charAt(0) + String(r.Status || '').slice(1).toLowerCase()],
    ['Starts', (r) => f.date(r.StartsOn)],
    ['Ends', (r) => f.date(r.EndsOn)],
    ['When', (r) => whenRuns(r)],
    ['Budget', (r) => (r.BudgetAmount === null ? '' : f.amount(r.BudgetAmount))],
    ['Spent to date', (r) => f.amount(r.SpentAmount)],
    ['Given in period', (r) => f.amount(r.given)],
    ['Redemptions', (r) => r.redemptions],
    ['Bills', (r) => r.bills],
    ['Revenue on bills', (r) => f.amount(r.revenue)],
    ['Cost per redemption', (r) => f.amount(r.redemptions ? r.given / r.redemptions : 0)],
    ['Avg bill', (r) => f.amount(r.bills ? r.revenue / r.bills : 0)],
  ],
};

module.exports = [customers, loyalty, feedback, campaigns];
module.exports.segmentOf = segmentOf;
module.exports.whenRuns = whenRuns;
