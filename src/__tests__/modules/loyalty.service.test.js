// Loyalty points, as a ledger rather than a counter.
//
// The bug this module exists to close: settling credited points and refunding
// gave none of them back. Nothing spent points yet, which is the only reason it
// had gone unnoticed — the moment redemption exists, that is a way to withdraw
// cash. So the reversal tests below are the point of the file, and the rest is
// what makes a reversal possible: every movement carries the reason it happened
// and the source that caused it.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: () => 'generated-id' }));

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    const s = String(sql);
    executed.push({ sql: s, params });
    if (/FROM pos_setting/.test(s)) {
      if (state.settingThrows) throw new Error('no such table');
      return [state.rateSetting ? [{ SettingValue: state.rateSetting }] : []];
    }
    if (/INSERT INTO pos_loyalty_ledger/.test(s)) {
      if (state.duplicate) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      return [{ affectedRows: 1 }];
    }
    if (/SELECT Id, CustomerId, Points FROM pos_loyalty_ledger/.test(s)) {
      return [state.originalEntry ? [state.originalEntry] : []];
    }
    if (/SUM\(Points\)/.test(s)) return [[{ balance: state.balance }]];
    if (/SELECT Id, EntryType/.test(s)) return [state.statement];
    return [{ affectedRows: 1 }];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
  withTransaction: async (cb) => cb(mockConn),
}));

const loyalty = require('../../modules/loyalty/loyalty.service');
const { LOYALTY } = require('../../config/constants');

const TENANT = 'tenant-a';
const USER = 'cashier@crackd.in';

const ledgerWrite = () => executed.find((e) => /INSERT INTO pos_loyalty_ledger/.test(e.sql));
const pointsMove = () => executed.find((e) => /SET LoyaltyPoints/.test(e.sql));
// INSERT column order: Id, TenantId, CustomerId, EntryType, Points, SourceType,
// SourceId, ReversesId, Reason, BranchDetailId, CreatedBy
const wrote = () => {
  const p = ledgerWrite()?.params || [];
  return { customerId: p[2], type: p[3], points: p[4], sourceType: p[5],
    sourceId: p[6], reverses: p[7], reason: p[8] };
};

beforeEach(() => {
  jest.clearAllMocks();
  executed.length = 0;
  state = { rateSetting: null, settingThrows: false, duplicate: false,
    originalEntry: null, balance: 0, statement: [] };
});

describe('earning on a settled sale', () => {
  // The rule the old counter enforced, preserved here now that points moved.
  it('awards whole points at the configured rate', async () => {
    const points = await loyalty.earnForSaleTx(
      mockConn, { customerId: 'c1', billId: 'b1', amount: 396 }, TENANT, USER,
    );
    // 396 / 100 = 3, floored. Points are whole or they are not points.
    expect(points).toBe(Math.floor(396 / LOYALTY.RUPEES_PER_POINT));
    expect(points).toBe(3);
    expect(wrote()).toMatchObject({ type: 'EARN', points: 3, sourceType: 'BILL', sourceId: 'b1' });
  });

  it('moves the cache on pos_customer by the same amount', async () => {
    await loyalty.earnForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', amount: 396 }, TENANT, USER);
    expect(pointsMove().params[0]).toBe(3);
  });

  it('records why the balance moved', async () => {
    await loyalty.earnForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', amount: 396 }, TENANT, USER);
    expect(wrote().reason).toMatch(/Earned on a sale of 396/);
  });

  it('records nothing for a walk-in', async () => {
    await expect(loyalty.earnForSaleTx(mockConn, { billId: 'b1', amount: 500 }, TENANT, USER))
      .resolves.toBe(0);
    expect(ledgerWrite()).toBeUndefined();
  });

  // A refund must never mint loyalty, and a ₹1 sale must not round up to one.
  it('awards nothing for a negative or too-small amount', async () => {
    await expect(loyalty.earnForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', amount: -500 }, TENANT, USER))
      .resolves.toBe(0);
    await expect(loyalty.earnForSaleTx(mockConn, { customerId: 'c1', billId: 'b2', amount: 1 }, TENANT, USER))
      .resolves.toBe(0);
    expect(ledgerWrite()).toBeUndefined();
  });

  it('uses the tenancy’s own rate when one is configured', async () => {
    state.rateSetting = '50';                       // ₹50 per point
    const points = await loyalty.earnForSaleTx(
      mockConn, { customerId: 'c1', billId: 'b1', amount: 400 }, TENANT, USER,
    );
    expect(points).toBe(8);
  });

  it('falls back to the default rather than failing a sale', async () => {
    state.settingThrows = true;
    await expect(loyalty.earnForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', amount: 400 }, TENANT, USER))
      .resolves.toBe(4);
  });

  // A retried settle after a dropped response must not mint twice.
  it('cannot credit the same bill twice', async () => {
    state.duplicate = true;
    await expect(loyalty.earnForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', amount: 396 }, TENANT, USER))
      .resolves.toBe(0);
    expect(pointsMove()).toBeUndefined();          // and the cache does not move
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reason this module exists.
// ─────────────────────────────────────────────────────────────────────────────
describe('taking points back when a sale is refunded', () => {
  beforeEach(() => { state.originalEntry = { Id: 'earn-1', CustomerId: 'c1', Points: 100 }; });

  it('reverses exactly what the sale gave', async () => {
    const back = await loyalty.reverseForSaleTx(mockConn, { billId: 'b1' }, TENANT, USER);
    expect(back).toBe(100);
    expect(wrote()).toMatchObject({ type: 'REVERSAL', points: -100, customerId: 'c1' });
  });

  // If the tenancy changed its earn rate between the sale and the refund,
  // recomputing would claw back a different number than was given — and the
  // customer would be right to complain.
  it('reverses by the original entry, not by recomputing from the rate', async () => {
    state.rateSetting = '10';                       // rate changed since the sale
    const back = await loyalty.reverseForSaleTx(mockConn, { billId: 'b1' }, TENANT, USER);
    expect(back).toBe(100);                          // what was given, not 10× more
    expect(wrote().reverses).toBe('earn-1');
  });

  it('moves the cache back down', async () => {
    await loyalty.reverseForSaleTx(mockConn, { billId: 'b1' }, TENANT, USER);
    expect(pointsMove().params[0]).toBe(-100);
  });

  it('carries the refund reason so the customer can be told', async () => {
    await loyalty.reverseForSaleTx(mockConn, { billId: 'b1', reason: 'Wrong order' }, TENANT, USER);
    expect(wrote().reason).toMatch(/Refunded — Wrong order/);
  });

  it('does nothing when the sale never earned any', async () => {
    state.originalEntry = null;                      // a walk-in sale
    await expect(loyalty.reverseForSaleTx(mockConn, { billId: 'b1' }, TENANT, USER)).resolves.toBe(0);
    expect(ledgerWrite()).toBeUndefined();
  });

  // Double-clicking Refund must not claw back twice.
  it('cannot reverse the same bill twice', async () => {
    state.duplicate = true;
    await expect(loyalty.reverseForSaleTx(mockConn, { billId: 'b1' }, TENANT, USER)).resolves.toBe(0);
    expect(pointsMove()).toBeUndefined();
  });
});

describe('spending points', () => {
  beforeEach(() => { state.balance = 200; });

  it('takes the balance under a row lock', async () => {
    await loyalty.redeemForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', points: 50, maxValue: 500 }, TENANT, USER);
    // Two tills settling for one customer would otherwise both spend the same
    // points. Same discipline the numbering series uses.
    expect(executed.some((e) => /FOR UPDATE/.test(e.sql))).toBe(true);
  });

  it('writes a negative entry for what was spent', async () => {
    const spent = await loyalty.redeemForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', points: 50, maxValue: 500 }, TENANT, USER);
    expect(spent).toBe(50);
    expect(wrote()).toMatchObject({ type: 'REDEEM', points: -50 });
  });

  it('cannot spend more than the customer has', async () => {
    const spent = await loyalty.redeemForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', points: 900, maxValue: 5000 }, TENANT, USER);
    expect(spent).toBe(200);
  });

  // A discount larger than the bill would turn a customer into a creditor.
  it('cannot discount more than the sale is worth', async () => {
    const spent = await loyalty.redeemForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', points: 200, maxValue: 75 }, TENANT, USER);
    expect(spent).toBe(75);
  });

  it('spends nothing when the balance is empty', async () => {
    state.balance = 0;
    await expect(loyalty.redeemForSaleTx(mockConn, { customerId: 'c1', billId: 'b1', points: 50, maxValue: 500 }, TENANT, USER))
      .resolves.toBe(0);
    expect(ledgerWrite()).toBeUndefined();
  });
});

describe('the statement', () => {
  it('reports the balance from the ledger, not from the cache', async () => {
    state.balance = 240;
    state.statement = [{ Id: 'e1', EntryType: 'EARN', Points: 100 }];
    const result = await loyalty.getStatement('c1', TENANT);
    expect(result).toMatchObject({ balance: 240 });
    expect(result.entries).toHaveLength(1);
    expect(executed.some((e) => /SUM\(Points\)/.test(e.sql))).toBe(true);
  });
});

describe('a manual adjustment', () => {
  it('records the reason, because an unexplained movement is worse than none', async () => {
    await loyalty.adjust({ customerId: 'c1', points: 50, reason: 'Goodwill — cold coffee' }, TENANT, USER);
    expect(wrote()).toMatchObject({ type: 'ADJUSTMENT', points: 50, sourceType: 'MANUAL' });
    expect(wrote().reason).toBe('Goodwill — cold coffee');
  });

  it('can take points away as well as give them', async () => {
    await loyalty.adjust({ customerId: 'c1', points: -25, reason: 'Applied in error' }, TENANT, USER);
    expect(wrote().points).toBe(-25);
  });
});

// ── Partial returns ─────────────────────────────────────────────────────────
// The old claw-back reversed the ENTIRE original EARN whatever came back, and
// was keyed on the BILL — so the second partial return against one bill
// violated UNIQUE (TenantId, SourceType, SourceId, EntryType) and rolled the
// whole refund transaction back.
describe('reverseForReturnTx — proportional, and repeatable', () => {
  const EARN = { Id: 'earn-1', CustomerId: 'cust-1', Points: 100 };

  const routeReturn = ({ earn = EARN, alreadyReversed = 0 } = {}) => {
    mockConn.execute.mockImplementation((sql) => {
      const q = String(sql);
      if (/SELECT Id, CustomerId, Points FROM pos_loyalty_ledger/i.test(q)) {
        return Promise.resolve([earn ? [earn] : []]);
      }
      if (/SUM\(-Points\)/i.test(q)) {
        return Promise.resolve([[{ reversed: alreadyReversed }]]);
      }
      if (/^\s*SELECT/i.test(q)) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };

  const inserted = () => mockConn.execute.mock.calls
    .filter(([sql]) => /INSERT INTO pos_loyalty_ledger/i.test(String(sql)))
    .map(([, p]) => p);

  it('claws back only the share that actually came back', async () => {
    routeReturn();
    // A quarter of a ₹1,000 sale returned, against 100 points earned.
    const points = await returnLoyalty(250, 1000, false);
    expect(points).toBe(25);
    expect(Number(inserted()[0][4])).toBe(-25);
  });

  // Keyed on the CREDIT NOTE, which is what makes the second return legal —
  // the unique key still stops a replayed request double-clawing.
  it('keys the reversal on the credit note, not the bill', async () => {
    routeReturn();
    await returnLoyalty(250, 1000, false);
    expect(inserted()[0][5]).toBe('RETURN');
    expect(inserted()[0][6]).toBe('note-1');
    // And still names the EARN it undoes, so a claw-back is traceable.
    expect(inserted()[0][7]).toBe('earn-1');
  });

  // Three returns of a third each at 100 points give 33+33+33 = 99, leaving a
  // point that was granted and never taken back.
  it('trues up the remainder on the final return', async () => {
    routeReturn({ alreadyReversed: 66 });
    const points = await returnLoyalty(334, 1000, true);
    expect(points).toBe(34);
  });

  it('never reverses more than was earned, however many returns', async () => {
    routeReturn({ alreadyReversed: 100 });
    const points = await returnLoyalty(500, 1000, false);
    expect(points).toBe(0);
    expect(inserted()).toHaveLength(0);
  });

  it('moves nothing when the sale never earned any', async () => {
    routeReturn({ earn: null });
    expect(await returnLoyalty(500, 1000, false)).toBe(0);
    expect(inserted()).toHaveLength(0);
  });

  // Helper: the call under test, with the noise factored out.
  async function returnLoyalty(returnedAmount, originalAmount, isFinal) {
    return loyalty.reverseForReturnTx(mockConn, {
      billId: 'bill-1',
      returnLogId: 'note-1',
      returnedAmount,
      originalAmount,
      isFinal,
      reason: 'Return CN-0001',
      branchDetailId: 'branch-1',
    }, TENANT, USER);
  }
});
