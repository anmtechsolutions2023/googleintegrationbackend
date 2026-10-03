// src/__tests__/modules/posdailystock.test.js
//
// The four states and the one statement that guards them.

const mockConn = { execute: jest.fn(), release: jest.fn() };

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb, existing) => cb(existing || mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { resolve, refusalFor, STOCK_STATE } = require('../../modules/posdailystock/posdailystock.resolver');
const service = require('../../modules/posdailystock/posdailystock.service');

const TENANT = 'ten-1';
const USER = '+919876543210';
const DAY = '2026-10-02';

/** A menu row joined to its day's count, as SELECT_FOR_ITEMS returns one. */
const row = (over = {}) => ({
  ItemMetaId: 'm1', ItemName: 'Paneer Biryani',
  StockTracked: 1, MaxPerOrder: null,
  PreparedQty: 10, SoldQty: 0,
  ...over,
});

afterEach(() => jest.clearAllMocks());

describe('the four states', () => {
  it('an untracked dish is unlimited — every dish that exists today', () => {
    const r = resolve(row({ StockTracked: 0, PreparedQty: null, SoldQty: null }));
    expect(r.stockState).toBe(STOCK_STATE.UNLIMITED);
    expect(r.remaining).toBeNull();
  });

  // The operator's own rule, and the reason StockTracked has to exist: without
  // the flag this would apply to the whole menu.
  it('tracked with no count for today is UNAVAILABLE, not unlimited', () => {
    const r = resolve(row({ PreparedQty: null, SoldQty: null }));
    expect(r.stockState).toBe(STOCK_STATE.UNAVAILABLE);
    expect(r.prepared).toBeNull();
  });

  it('tracked with portions left is available, and says how many', () => {
    expect(resolve(row({ PreparedQty: 10, SoldQty: 7 })))
      .toMatchObject({ stockState: STOCK_STATE.AVAILABLE, remaining: 3 });
  });

  it('a count of zero left is SOLD OUT, which is not the same as unavailable', () => {
    const soldOut = resolve(row({ PreparedQty: 10, SoldQty: 10 }));
    const neverSet = resolve(row({ PreparedQty: null, SoldQty: null }));
    expect(soldOut.stockState).toBe(STOCK_STATE.SOLD_OUT);
    expect(neverSet.stockState).toBe(STOCK_STATE.UNAVAILABLE);
    expect(soldOut.stockState).not.toBe(neverSet.stockState);
  });

  // A portal order may push SoldQty past PreparedQty; "-2 left" helps nobody.
  it('never reports a negative remaining', () => {
    expect(resolve(row({ PreparedQty: 5, SoldQty: 8 })).remaining).toBe(0);
  });

  it('prepared zero is a decision, and reads as sold out', () => {
    expect(resolve(row({ PreparedQty: 0, SoldQty: 0 })).stockState).toBe(STOCK_STATE.SOLD_OUT);
  });
});

describe('refusing a line', () => {
  it('lets an untracked dish through at any quantity', () => {
    expect(refusalFor(row({ StockTracked: 0, PreparedQty: null }), 99)).toBeNull();
  });
  it('refuses more than the per-order cap, before stock is even consulted', () => {
    expect(refusalFor(row({ MaxPerOrder: 2 }), 3)).toMatch(/at most 2 per order/i);
  });
  it('allows exactly the cap', () => {
    expect(refusalFor(row({ MaxPerOrder: 2 }), 2)).toBeNull();
  });
  it('names the shortfall rather than saying no', () => {
    expect(refusalFor(row({ PreparedQty: 10, SoldQty: 8 }), 5)).toMatch(/only 2 left/i);
  });
  it('says sold out, and says not available today, differently', () => {
    expect(refusalFor(row({ PreparedQty: 4, SoldQty: 4 }), 1)).toMatch(/sold out/i);
    expect(refusalFor(row({ PreparedQty: null }), 1)).toMatch(/not available today/i);
  });
});

describe('the per-order cap, through the whole pre-check', () => {
  const route = (rows) => mockConn.execute.mockImplementation((q) => {
    if (/FROM pos_item_meta im/i.test(q)) return Promise.resolve([rows]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });

  it('refuses four teas against a cap of two, whichever key carries the quantity', async () => {
    route([row({ MaxPerOrder: 2, PreparedQty: 10, SoldQty: 0 })]);
    await expect(
      service.assertStockAvailable([{ id: 'm1', qty: 4 }], TENANT, { date: DAY }),
    ).rejects.toMatchObject({ statusCode: 400 });

    route([row({ MaxPerOrder: 2, PreparedQty: 10, SoldQty: 0 })]);
    await expect(
      service.assertStockAvailable([{ id: 'm1', quantity: 4 }], TENANT, { date: DAY }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('splitting a capped dish across two lines does not beat the cap', async () => {
    route([row({ MaxPerOrder: 2, PreparedQty: 10, SoldQty: 0 })]);
    await expect(
      service.assertStockAvailable(
        [{ id: 'm1', qty: 2 }, { id: 'm1', qty: 2 }], TENANT, { date: DAY },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('consuming inside the order transaction', () => {
  /** Routes the service's two statements: the read, then the conditional UPDATE. */
  const route = ({ rows = [row()], took = true } = {}) => {
    mockConn.execute.mockImplementation((q) => {
      if (/FROM pos_item_meta im/i.test(q)) return Promise.resolve([rows]);
      if (/UPDATE pos_item_daily_stock/i.test(q)) {
        return Promise.resolve([{ affectedRows: took ? 1 : 0 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };
  const sql = (re) => mockConn.execute.mock.calls.filter(([q]) => re.test(q));

  it('takes the portions with the guard in the WHERE clause', async () => {
    route();
    await service.consumeForOrder(mockConn, [{ id: 'm1', quantity: 2 }], TENANT, USER, { date: DAY });

    const [q, params] = sql(/UPDATE pos_item_daily_stock/i)[0];
    expect(q).toMatch(/PreparedQty - SoldQty >= \?/);
    expect(params).toEqual([2, USER, TENANT, 'm1', DAY, 2]);
  });

  // The race. The UPDATE matching nothing IS the report that somebody won.
  it('throws 409 when another order took the last portion first', async () => {
    route({ took: false });
    await expect(
      service.consumeForOrder(mockConn, [{ id: 'm1', quantity: 1 }], TENANT, USER, { date: DAY }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('touches nothing for an untracked dish', async () => {
    route({ rows: [row({ StockTracked: 0, PreparedQty: null })] });
    await service.consumeForOrder(mockConn, [{ id: 'm1', quantity: 3 }], TENANT, USER, { date: DAY });
    expect(sql(/UPDATE pos_item_daily_stock/i)).toHaveLength(0);
  });

  // Two lines of the same dish are two ticket lines but one draw on the count.
  it('sums repeated lines of the same dish into one deduction', async () => {
    route();
    await service.consumeForOrder(
      mockConn, [{ id: 'm1', quantity: 2 }, { id: 'm1', quantity: 3 }], TENANT, USER, { date: DAY },
    );
    const calls = sql(/UPDATE pos_item_daily_stock/i);
    expect(calls).toHaveLength(1);
    expect(calls[0][1][0]).toBe(5);
  });

  // THE BUG THIS EXISTS FOR. The till sends its quantity under `qty`; the diner
  // app sends `quantity`. Reading only one of them made every till order record
  // a single portion however many were ordered — four teas showed as one sold —
  // and made a per-order cap of two pass a four-tea order, because the number it
  // compared was 1.
  it('reads the quantity the TILL sends (qty), not only the diner app\'s', async () => {
    route();
    await service.consumeForOrder(mockConn, [{ id: 'm1', qty: 4 }], TENANT, USER, { date: DAY });

    const [, params] = sql(/UPDATE pos_item_daily_stock/i)[0];
    expect(params[0]).toBe(4);
  });

  it('a portal round records without the guard and is never refused', async () => {
    route({ took: false });
    await expect(service.consumeForOrder(
      mockConn, [{ id: 'm1', quantity: 4 }], TENANT, USER, { date: DAY, guard: false },
    )).resolves.toBeUndefined();

    const [q] = sql(/UPDATE pos_item_daily_stock/i)[0];
    expect(q).not.toMatch(/PreparedQty - SoldQty >= \?/);
  });
});

describe('giving portions back', () => {
  const route = () => mockConn.execute.mockImplementation((q) => {
    if (/FROM pos_item_meta im/i.test(q)) return Promise.resolve([[row({ SoldQty: 4 })]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
  const sql = (re) => mockConn.execute.mock.calls.filter(([q]) => re.test(q));

  it('returns what the round took, floored at zero by the query', async () => {
    route();
    await service.releaseForOrder(mockConn, [{ id: 'm1', quantity: 2 }], TENANT, USER, { date: DAY });
    const [q, params] = sql(/GREATEST\(SoldQty - \?, 0\)/i)[0];
    expect(q).toMatch(/UPDATE pos_item_daily_stock/i);
    expect(params[0]).toBe(2);
  });

  // Staff must always be able to reject a round; a count is fixable, a stuck
  // table is not.
  it('never throws, so a failed release cannot block a rejection', async () => {
    mockConn.execute.mockRejectedValue(new Error('deadlock'));
    await expect(
      service.releaseForOrder(mockConn, [{ id: 'm1', quantity: 1 }], TENANT, USER, { date: DAY }),
    ).resolves.toBeUndefined();
  });
});

describe('setting the day', () => {
  it('upserts without resetting what has already sold', async () => {
    mockConn.execute.mockImplementation((q) => {
      if (/FROM pos_item_meta im/i.test(q)) return Promise.resolve([[row({ PreparedQty: 12, SoldQty: 4 })]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const out = await service.setPrepared(
      { branchId: 'b1', itemMetaId: 'm1', date: DAY, preparedQty: 12 }, TENANT, USER,
    );
    const [q] = mockConn.execute.mock.calls.find(([s]) => /INSERT INTO pos_item_daily_stock/i.test(s));
    expect(q).toMatch(/ON DUPLICATE KEY UPDATE PreparedQty = VALUES\(PreparedQty\)/i);
    expect(q).not.toMatch(/SoldQty = 0/);
    expect(out).toMatchObject({ remaining: 8, stockState: STOCK_STATE.AVAILABLE });
  });

  it('clearing the day returns the dish to unavailable', async () => {
    mockConn.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const out = await service.clearDay({ itemMetaId: 'm1', date: DAY }, TENANT, USER);
    expect(out.stockState).toBe(STOCK_STATE.UNAVAILABLE);
  });
});
