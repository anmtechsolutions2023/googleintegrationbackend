// The CRM projection, and the link that was never made.
//
// pos_order.CustomerId, the settle path and the ledger contact have always been
// a complete chain — but nothing ever set CustomerId, and nothing ever wrote
// Visits / TotalSpent / LoyaltyPoints. Three columns read 0 for every customer
// no matter how often they came in.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql: String(sql), params });
    const q = String(sql);
    if (/UPDATE pos_customer/.test(q)) return [{ affectedRows: state.customerExists ? 1 : 0 }];
    if (/FROM pos_customer\s*\n?\s*WHERE Id/.test(q) || /SELECT \* FROM pos_customer WHERE Id/.test(q)) {
      return [state.customer ? [state.customer] : []];
    }
    if (/ORDER_HISTORY|FROM pos_order o/.test(q)) return [state.orders || []];
    if (/FROM pos_feedback f/.test(q)) return [state.feedback || []];
    if (/FROM pos_customer/.test(q)) return [state.search || []];
    return [[]];
  }),
};
jest.mock('../../utils/dbHelper', () => ({ withConnection: async (cb) => cb(mockConn) }));

const stats = require('../../modules/poscustomer/poscustomer.stats.service');
const profile = require('../../modules/poscustomer/poscustomer.profile.service');
const { LOYALTY } = require('../../config/constants');

const TENANT = 'tn';
const USER = 'till@x.com';

beforeEach(() => {
  executed.length = 0;
  mockConn.execute.mockClear();
  state = {
    customerExists: true,
    customer: { Id: 'c1', Name: 'Ravi', Visits: '3', TotalSpent: '900.00', LoyaltyPoints: '9' },
    orders: [], feedback: [], search: [],
  };
});

describe('recording a settled sale against a customer', () => {
  it('counts the visit and adds the spend', async () => {
    await stats.recordSaleTx(mockConn, 'c1', 396, TENANT, USER);
    const call = executed.find((e) => /UPDATE pos_customer/.test(e.sql));
    expect(call.sql).toMatch(/Visits\s+= Visits \+ 1/);
    expect(call.params[0]).toBe(396);
  });

  // Points moved OUT of here and into the loyalty ledger, which records why a
  // balance changed. The rate and the whole-points rule are asserted there —
  // see loyalty.service.test.js. What matters here is that this path no longer
  // touches them, so the two cannot both move the same number.
  it('no longer moves points — the loyalty ledger owns those', async () => {
    await stats.recordSaleTx(mockConn, 'c1', 396, TENANT, USER);
    const call = executed.find((e) => /UPDATE pos_customer/.test(e.sql));
    expect(call.sql).not.toMatch(/LoyaltyPoints/);
  });

  // The commonest sale in the building.
  it('records nothing for a walk-in', async () => {
    const recorded = await stats.recordSaleTx(mockConn, null, 500, TENANT, USER);
    expect(recorded).toBe(false);
    expect(executed).toHaveLength(0);
  });

  // The sale is already paid and posted by this point. Refusing it now over a
  // stale customer reference would undo a completed payment.
  it('reports rather than throws when the customer no longer exists', async () => {
    state.customerExists = false;
    await expect(stats.recordSaleTx(mockConn, 'gone', 500, TENANT, USER)).resolves.toBe(false);
  });

  it('is scoped to the tenant', async () => {
    await stats.recordSaleTx(mockConn, 'c1', 100, TENANT, USER);
    const call = executed.find((e) => /UPDATE pos_customer/.test(e.sql));
    expect(call.sql).toMatch(/WHERE Id = \? AND TenantId = \?/);
    expect(call.params.slice(-2)).toEqual(['c1', TENANT]);
  });
});

describe('the customer profile', () => {
  it('coerces the counters MySQL returns as strings', async () => {
    const p = await profile.getProfile('c1', TENANT);
    expect(p.Customer.Visits).toBe(3);
    expect(p.Customer.TotalSpent).toBe(900);
  });

  it('returns their order history and what they said', async () => {
    state.orders = [{ OrderId: 'o1', OrderNo: 'ORD-1', Total: '396.00', TokenLabel: '7' }];
    state.feedback = [{ Id: 'f1', Rating: 5, OrderId: 'o1', OrderNo: 'ORD-1' }];
    const p = await profile.getProfile('c1', TENANT);
    expect(p.Orders[0].OrderNo).toBe('ORD-1');
    expect(p.Feedback[0].Rating).toBe(5);
  });

  it('averages the order value and the rating from the rows in hand', async () => {
    state.orders = [{ Total: '100.00' }, { Total: '300.00' }];
    state.feedback = [{ Rating: 4 }, { Rating: 5 }];
    const p = await profile.getProfile('c1', TENANT);
    expect(p.Summary.AverageOrderValue).toBe(200);
    expect(p.Summary.AverageRating).toBe(4.5);
  });

  // Null, not zero: "never rated us" and "rated us zero" are different facts.
  it('reports no average rating rather than zero when nobody rated', async () => {
    state.feedback = [];
    const p = await profile.getProfile('c1', TENANT);
    expect(p.Summary.AverageRating).toBeNull();
  });

  it('404s for a customer in another tenant', async () => {
    state.customer = null;
    await expect(profile.getProfile('c1', TENANT)).rejects.toThrow(/not found/i);
  });
});

describe('the counter lookup', () => {
  it('searches phone and name, and puts an exact phone match first', async () => {
    await profile.search('98765', TENANT);
    const call = executed.find((e) => /Phone LIKE \?/.test(e.sql));
    expect(call.sql).toMatch(/Name LIKE \?/);
    expect(call.sql).toMatch(/ORDER BY \(Phone = \?\) DESC/);
    // tenant, %term%, %term%, exact
    expect(call.params).toEqual([TENANT, '%98765%', '%98765%', '98765']);
  });

  it('caps results — this backs a type-ahead beside a queue', async () => {
    await profile.search('a', TENANT);
    expect(executed[0].sql).toMatch(/LIMIT 10/);
  });
});

// The other half, which did not exist: settling credited a visit and the spend,
// and refunding reversed the money while leaving both standing.
describe('taking a refunded sale back off the record', () => {
  it('removes the visit and the spend', async () => {
    await stats.reverseSaleTx(mockConn, 'c1', 396, TENANT, USER);
    const call = executed.find((e) => /UPDATE pos_customer/.test(e.sql));
    expect(call.sql).toMatch(/Visits\s+= GREATEST\(Visits - 1, 0\)/);
    expect(call.params[0]).toBe(396);
  });

  // A projection that has drifted must not be driven below zero by a
  // correction — a customer with -1 visits is a worse answer than one with 0.
  it('floors at zero rather than going negative', async () => {
    await stats.reverseSaleTx(mockConn, 'c1', 999999, TENANT, USER);
    const call = executed.find((e) => /UPDATE pos_customer/.test(e.sql));
    expect(call.sql).toMatch(/GREATEST\(TotalSpent - \?, 0\)/);
  });

  it('does nothing for a walk-in', async () => {
    await expect(stats.reverseSaleTx(mockConn, null, 100, TENANT, USER)).resolves.toBe(false);
    expect(executed.filter((e) => /UPDATE pos_customer/.test(e.sql))).toHaveLength(0);
  });

  it('reports a customer who is not in this tenancy rather than failing', async () => {
    state.customerExists = false;
    await expect(stats.reverseSaleTx(mockConn, 'ghost', 100, TENANT, USER)).resolves.toBe(false);
  });
});

// ── Partial returns must not erase a visit ──────────────────────────────────
// REVERSE_SALE decremented Visits unconditionally, so a customer who sent back
// a single naan from a four-item dinner lost a whole visit from their history —
// and three partial returns could take three visits for one meal.
describe('reverseSaleTx — visit vs value', () => {
  const customerWrites = () => executed.filter((e) => /UPDATE pos_customer/.test(e.sql));
  const visitWrites = () => customerWrites().filter((e) => /Visits/.test(e.sql));

  it('takes the visit off on a FULL return', async () => {
    await stats.reverseSaleTx(mockConn, 'c1', 1180, TENANT, USER, { removeVisit: true });
    expect(visitWrites()).toHaveLength(1);
  });

  it('leaves the visit standing on a PARTIAL return', async () => {
    await stats.reverseSaleTx(mockConn, 'c1', 236, TENANT, USER, { removeVisit: false });
    expect(visitWrites()).toHaveLength(0);

    // The spend still comes off — by the value actually returned, not the
    // whole sale.
    const write = customerWrites()[0];
    expect(write.sql).toMatch(/TotalSpent = GREATEST\(TotalSpent - \?, 0\)/);
    expect(write.params[0]).toBe(236);
  });

  // The pre-existing full-refund caller passes no options at all, so the
  // default has to be the behaviour it already relied on.
  it('defaults to removing the visit, so the old caller is unchanged', async () => {
    await stats.reverseSaleTx(mockConn, 'c1', 1180, TENANT, USER);
    expect(visitWrites()).toHaveLength(1);
  });
});
