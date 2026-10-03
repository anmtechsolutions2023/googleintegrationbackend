// src/__tests__/modules/ledger.returns.test.js
// Partial returns. The invariants ARE the deliverable.
//
// Every rule here exists because breaking it costs money in a direction nobody
// notices: a sale refunded past its own value, a tender handed back cash it
// never took, points clawed back twice, a visit erased because one naan came
// back. None of these throw on their own — they just quietly produce wrong
// numbers — so they are asserted rather than assumed.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockUuidCounter = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuidCounter}`) }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  findOneOrFail: jest.fn(), findAll: jest.fn(), executeQuery: jest.fn(),
}));

const returns = require('../../modules/ledger/ledger.returns.service');
const { LEDGER } = require('../../config/constants');

const TENANT = 'tenant-1';
const USER = 'cashier@test.com';
const CASH = 'mode-cash';
const CARD = 'mode-card';
const CASH_ACCT = 'acct-cash';
const BANK_ACCT = 'acct-bank';

const MASTERS = {
  'POS Return': [{ Id: 'type-return', TransactionTypeConfigId: 'cfg-return' }],
  DRAFT:        [{ Id: 'st-draft' }],
  SETTLED:      [{ Id: 'st-settled' }],
  CANCELLED:    [{ Id: 'st-cancel' }],
  Sales:        [{ Id: 'acct-sales' }],
  'Store Credit': [{ Id: 'acct-credit' }],
  Refund:       [{ Id: 'rt-refund' }],
};

// A ₹1,180 invoice: 2 × Dosa @ 236 and 3 × Naan @ 236. Deliberately chosen so a
// proportional share of one unit is a clean number and a rounding remainder is
// still visible on the naan.
const SALE = (over = {}) => [{
  Id: 'log-1', TransactionNo: 'INV-0001', StatusName: 'SETTLED',
  TransactionTypeConfigId: 'cfg-1',
  GrossAmount: 1180, NetAmount: 1000, TaxAmount: 180, DiscountAmount: 0,
  BranchId: 'branch-1', ContactDetailId: 'c-1',
  CustomerName: 'Aarti', CustomerMobile: '98765',
  ...over,
}];

const LINES = () => ([
  {
    Id: 'line-dosa', ItemId: 'item-dosa', Quantity: 2, CostInfoId: 'ci-1',
    UnitPrice: 236, BasePrice: 200, VariantAmount: 0,
    NetAmount: 400, DiscountAmount: 0, ItemDiscountAmount: 0,
    TaxAmount: 72, GrossAmount: 472,
    TaxComponents: [{ name: 'CGST', rate: 9, amount: 36 }, { name: 'SGST', rate: 9, amount: 36 }],
    Variants: [], ItemName: 'Dosa',
  },
  {
    Id: 'line-naan', ItemId: 'item-naan', Quantity: 3, CostInfoId: 'ci-2',
    UnitPrice: 236, BasePrice: 200, VariantAmount: 0,
    NetAmount: 600, DiscountAmount: 0, ItemDiscountAmount: 0,
    TaxAmount: 108, GrossAmount: 708,
    TaxComponents: [{ name: 'CGST', rate: 9, amount: 54 }, { name: 'SGST', rate: 9, amount: 54 }],
    Variants: [], ItemName: 'Naan',
  },
]);

const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql, params = []) => {
    const q = String(sql);
    if (over.handler) {
      const r = over.handler(q, params);
      if (r !== undefined) return Promise.resolve(r);
    }
    if (/FROM transactiondetaillog l[\s\S]*FOR UPDATE/i.test(q)) {
      return Promise.resolve([over.sale || SALE()]);
    }
    if (/ReversesLogId = \? AND Remarks = \?/i.test(q)) return Promise.resolve([over.duplicate || []]);
    if (/SUM\(GrossAmount\)[\s\S]*ReversesLogId/i.test(q)) {
      return Promise.resolve([[over.returnedTotal || { returned: 0, noteCount: 0 }]]);
    }
    if (/n\.ReversesLogId = \?/i.test(q)) return Promise.resolve([over.returnedByLine || []]);
    if (/FROM transactionitemdetail t/i.test(q)) return Promise.resolve([over.lines || LINES()]);
    if (/FROM transactiontype WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM transactiontypestatus WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM accounttypebase WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM paymentreceivedtype WHERE Type/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM transactiontypeconfig WHERE Id/i.test(q)) {
      return Promise.resolve([[{ Id: 'cfg-return', StartCounterNo: '1', CurrentCounterNo: 0, Prefix: 'CN-', Format: 'CN-{0000}' }]]);
    }
    if (/FROM transactiontypebaseconversion/i.test(q)) return Promise.resolve([[{ Id: 'conv-1' }]]);
    // What the customer has paid and not had back. By default the sale was
    // paid in full and every earlier return refunded, which is what makes a
    // return on a paid-up sale refund exactly its own value.
    if (/AS netPaid/i.test(q)) {
      const sale = (over.sale || SALE())[0];
      const back = Number(over.returnedTotal?.returned || 0);
      return Promise.resolve([[{ netPaid: over.netPaid ?? Number(sale.GrossAmount) - back }]]);
    }
    // Every payment taken against the sale.
    if (/AS collected/i.test(q)) {
      const sale = (over.sale || SALE())[0];
      return Promise.resolve([[{ collected: over.collected ?? Number(sale.GrossAmount) }]]);
    }
    if (/FROM paymentdetail/i.test(q)) return Promise.resolve([over.paymentDetail || [{ Id: 'pd-1' }]]);
    if (/FROM paymentbreakup b/i.test(q) && /GROUP BY/i.test(q)) {
      return Promise.resolve([over.tenders || [
        { PaymentModeId: CASH, AccountTypeBaseId: CASH_ACCT, ModeType: 'Cash', NetAmount: 1180 },
      ]]);
    }
    if (/AS BillId/i.test(q)) return Promise.resolve([over.billCustomer || []]);
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([[]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const calls = (re) => mockConn.execute.mock.calls.filter(([sql]) => re.test(String(sql)));
const firstCall = (re) => calls(re)[0];
const noteInsert = () => firstCall(/INSERT INTO transactiondetaillog[\s\S]*ReversesLogId/i)[1];
const lineInserts = () => calls(/INSERT INTO transactionitemdetail[\s\S]*SourceLineId/i).map(([, p]) => p);
const breakups = () => calls(/INSERT INTO paymentbreakup/i).map(([, p]) => p);

beforeEach(() => { jest.clearAllMocks(); mockUuidCounter = 0; });

describe('the credit note', () => {
  it('prices a partial return from the ORIGINAL line, not from today', async () => {
    route();
    // One of two dosas: exactly half of what that line carried.
    const r = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    expect(r.grossAmount).toBe(236);
    expect(r.netAmount).toBe(200);
    expect(r.taxAmount).toBe(36);
  });

  // An invoice raised at 18% must give back 18%, whatever the rate is when the
  // customer walks in. Mirrors the rule loyalty already applies.
  it('scales each tax component rather than recomputing at the current rate', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    const components = JSON.parse(lineInserts()[0][16]);
    expect(components).toEqual([
      { name: 'CGST', rate: 9, amount: 18 },
      { name: 'SGST', rate: 9, amount: 18 },
    ]);
  });

  it('carries positive amounts — the sign is the document type', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);
    expect(Number(noteInsert()[12])).toBe(236); // GrossAmount
    // The money OUT is what is negative.
    expect(Number(breakups()[0][6])).toBe(-236);
  });

  it('points back at the sale and records which line came back', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-naan', quantity: 2 }],
    }, TENANT, USER);

    expect(noteInsert()[21]).toBe('log-1');          // ReversesLogId (after SellerGstin)
    expect(lineInserts()[0][22]).toBe('line-naan');  // SourceLineId (after Note)
    expect(Number(lineInserts()[0][5])).toBe(2);     // Quantity
  });

  it('returns everything outstanding when no lines are named', async () => {
    route();
    const r = await returns.createReturnTx(mockConn, { saleLogId: 'log-1', lines: [] }, TENANT, USER);
    // The whole invoice: 472 + 708.
    expect(r.grossAmount).toBe(1180);
    expect(r.refundState).toBe(LEDGER.REFUND_STATE.FULL);
  });

  // There is no stock ledger. Recording the intent means nothing is lost when
  // one lands; inventing a decrement would be worse than admitting there is none.
  it('records restock as intent only', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1, restock: true }],
    }, TENANT, USER);
    expect(lineInserts()[0][23]).toBe(1);
    expect(calls(/UPDATE batchdetail/i)).toHaveLength(0);
    expect(calls(/stock_movement/i)).toHaveLength(0);
  });
});

describe('the invariants — what must never happen', () => {
  // The one that costs real money. Without the FOR UPDATE lock two cashiers
  // both read "nothing returned yet" and both refund the whole invoice.
  it('locks the sale before reading how much has come back', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    const order = mockConn.execute.mock.calls.map(([sql]) => String(sql));
    const lockAt = order.findIndex((q) => /FOR UPDATE/i.test(q));
    const readAt = order.findIndex((q) => /SUM\(GrossAmount\)[\s\S]*ReversesLogId/i.test(q));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeLessThan(readAt);
  });

  it('refuses a return that would take more than the sale was settled for', async () => {
    route({ returnedTotal: { returned: 1000, noteCount: 2 } });
    await expect(returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-naan', quantity: 3 }],
    }, TENANT, USER)).rejects.toThrow(/exceed what it was settled for/i);
  });

  it('refuses more units of a line than were sold', async () => {
    route();
    await expect(returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 5 }],
    }, TENANT, USER)).rejects.toThrow(/Cannot return more than was sold/i);
  });

  // The guard that makes a SECOND return safe, not just the first.
  it('counts what previous returns already took from that line', async () => {
    route({ returnedByLine: [{ SourceLineId: 'line-dosa', returnedQty: 1 }] });
    await expect(returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 2 }],
    }, TENANT, USER)).rejects.toThrow(/already returned 1/i);
  });

  it('refuses a line that is not on the invoice', async () => {
    route();
    await expect(returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-ghost', quantity: 1 }],
    }, TENANT, USER)).rejects.toThrow(/not on this invoice/i);
  });

  it('refuses to return against a document that was never settled', async () => {
    route({ sale: SALE({ StatusName: 'DRAFT' }) });
    await expect(returns.createReturnTx(mockConn, { saleLogId: 'log-1', lines: [] }, TENANT, USER))
      .rejects.toThrow(/Only a settled sale/i);
  });

  it('refuses once every line has already come back', async () => {
    route({
      returnedByLine: [
        { SourceLineId: 'line-dosa', returnedQty: 2 },
        { SourceLineId: 'line-naan', returnedQty: 3 },
      ],
    });
    await expect(returns.createReturnTx(mockConn, { saleLogId: 'log-1', lines: [] }, TENANT, USER))
      .rejects.toThrow(/already been returned in full/i);
  });
});

describe('idempotency — a double-clicked Refund button', () => {
  // The old model's guard was the status transition failing the second time.
  // Removing that terminal state removes the guard, so this replaces it.
  it('returns the existing note instead of issuing a second one', async () => {
    route({ duplicate: [{ Id: 'note-existing', TransactionNo: 'CN-0001', GrossAmount: 236 }] });
    const r = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }], idempotencyKey: 'k1',
    }, TENANT, USER);

    expect(r).toMatchObject({ transactionDetailLogId: 'note-existing', duplicate: true });
    expect(calls(/INSERT INTO transactiondetaillog/i)).toHaveLength(0);
    expect(calls(/INSERT INTO paymentbreakup/i)).toHaveLength(0);
  });
});

describe('tender apportionment — cash first, never beyond capacity', () => {
  const split = (tenders, amount) => returns.apportionRefund(tenders, amount);

  it('takes cash before anything else', () => {
    // ₹1,240 paid ₹240 cash + ₹1,000 card, refunding ₹500.
    const out = split([
      { paymentModeId: CARD, accountTypeBaseId: BANK_ACCT, isCash: false, remainingMinor: 100000 },
      { paymentModeId: CASH, accountTypeBaseId: CASH_ACCT, isCash: true, remainingMinor: 24000 },
    ], 50000);

    expect(out[0]).toMatchObject({ paymentModeId: CASH, amountMinor: 24000 });
    expect(out[1]).toMatchObject({ paymentModeId: CARD, amountMinor: 26000 });
  });

  // The invariant that matters more than the ordering rule: without it a
  // sequence of partial returns hands back cash the customer never paid in cash.
  it('never refunds a mode more than it received', () => {
    const out = split([
      { paymentModeId: CASH, accountTypeBaseId: CASH_ACCT, isCash: true, remainingMinor: 10000 },
      { paymentModeId: CARD, accountTypeBaseId: BANK_ACCT, isCash: false, remainingMinor: 90000 },
    ], 50000);

    const cash = out.find((o) => o.paymentModeId === CASH);
    expect(cash.amountMinor).toBe(10000);
    expect(out.reduce((s, o) => s + o.amountMinor, 0)).toBe(50000);
  });

  it('refuses when every tender is exhausted and money is still owed', () => {
    expect(() => split([
      { paymentModeId: CASH, accountTypeBaseId: CASH_ACCT, isCash: true, remainingMinor: 1000 },
    ], 50000)).toThrow(/No payment mode may be refunded more than it received/i);
  });

  it('skips a tender that has nothing left', () => {
    const out = split([
      { paymentModeId: CASH, accountTypeBaseId: CASH_ACCT, isCash: true, remainingMinor: 0 },
      { paymentModeId: CARD, accountTypeBaseId: BANK_ACCT, isCash: false, remainingMinor: 50000 },
    ], 50000);
    expect(out).toHaveLength(1);
    expect(out[0].paymentModeId).toBe(CARD);
  });
});

describe('the note owns its own money movement', () => {
  // A credit note is a DOCUMENT, so the money leaving belongs to it — not to
  // the sale's payment record. Without this "refunded to Cash, Card" is
  // underivable per note: every reversal would sit under the sale and no query
  // could say which note took which tender.
  it('writes the reversal against the NOTE, not the sale', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    const notePaymentDetail = firstCall(/INSERT INTO paymentdetail/i)[1][0];
    expect(breakups()[0][3]).toBe(notePaymentDetail);
    expect(breakups()[0][3]).not.toBe('pd-1'); // the sale's
  });

  // Capacity has to span the sale AND every note already raised against it, or
  // it is only correct on the first return.
  it('reads remaining capacity across the sale and all its notes', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    const [sql, params] = calls(/FROM paymentbreakup b/i)[0];
    expect(String(sql)).toMatch(/Id = \? OR ReversesLogId = \?/);
    expect(params).toContain('log-1');
  });
});

describe('store credit — a liability, not money out of the drawer', () => {
  it('books to Store Credit rather than the original tender', async () => {
    route();
    await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1',
      lines: [{ lineId: 'line-dosa', quantity: 1 }],
      destination: LEDGER.REFUND_DESTINATION.STORE_CREDIT,
    }, TENANT, USER);

    expect(breakups()[0][2]).toBe('acct-credit');
    // Nothing was taken out of cash — issuing credit moves nothing, and
    // booking it as a cash refund would make the till short by an amount that
    // never left it.
    expect(breakups().some((b) => b[2] === CASH_ACCT)).toBe(false);
  });
});

describe('refundState — derived, never stored', () => {
  it.each([
    [1180, 0, LEDGER.REFUND_STATE.NONE],
    [1180, 236, LEDGER.REFUND_STATE.PARTIAL],
    [1180, 1180, LEDGER.REFUND_STATE.FULL],
  ])('%i gross with %i returned reads as %s', (gross, returned, expected) => {
    expect(returns.refundState(gross, returned)).toBe(expected);
  });

  // A sequence of proportional partial returns will not land on the exact
  // total. Calling a fully-returned sale "partially refunded" over a rounding
  // remainder would be wrong on the screen and wrong in the report.
  it('treats a sub-paisa remainder as fully refunded', () => {
    expect(returns.refundState(1180, 1179.995)).toBe(LEDGER.REFUND_STATE.FULL);
  });
});

// A sale paid short. Returns clear what is still OWED before any money goes
// back — otherwise the outlet hands back cash it never received.
describe('a return on a part-paid sale', () => {
  // ₹1,180 invoice, ₹1,000 paid at the till, ₹180 still owed.
  const PART_PAID = (collected) => ({
    sale: SALE({ StatusName: 'PARTIALLY_PAID', TransactionTypeStatusId: 'st-part' }),
    collected,
    netPaid: collected,
    tenders: [{ PaymentModeId: CASH, AccountTypeBaseId: CASH_ACCT, ModeType: 'Cash', NetAmount: collected }],
  });

  it('clears the due first and refunds only the rest', async () => {
    route(PART_PAID(1000));
    const r = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    // The note is worth the whole dosa…
    expect(r.grossAmount).toBe(236);
    // …₹180 of it clears the due, ₹56 goes back in cash.
    expect(r.appliedToDue).toBe(180);
    expect(r.refundedAmount).toBe(56);
    expect(breakups()).toHaveLength(1);
    expect(breakups()[0][6]).toBe(-56);
    // What actually left is what the note's payment row says.
    expect(firstCall(/INSERT INTO paymentdetail/i)[1][6]).toBe(56);
  });

  it('settles the sale when the return clears the due', async () => {
    route(PART_PAID(1000));
    const r = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    expect(r.saleSettled).toBe(true);
    expect(r.dueAfter).toBe(0);
    const saleMoves = calls(/UPDATE transactiondetaillog SET TransactionTypeStatusId/i)
      .filter(([, p]) => p[3] === 'log-1');
    expect(saleMoves).toHaveLength(1);
    expect(saleMoves[0][1][0]).toBe('st-settled');
  });

  it('moves no money when the return is smaller than the due', async () => {
    route(PART_PAID(680));
    const r = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);

    expect(r.refundedAmount).toBe(0);
    expect(r.dueAfter).toBe(264);
    expect(r.saleSettled).toBe(false);
    // No ₹0 row in the tender mix.
    expect(breakups()).toHaveLength(0);
  });

  it('keeps the POS bill part-paid while money is still owed', async () => {
    route({ ...PART_PAID(680), billCustomer: [{ BillId: 'bill-1', CustomerId: null }] });
    const note = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);
    await returns.applyDownstreamTx(mockConn, note, TENANT, USER);

    // The unconditional update the returns path makes, not the settle step's.
    const [, p] = calls(/UPDATE pos_bill SET Status/i).find(([sql]) => !/AND Status = \?/i.test(sql));
    expect(p[0]).toBe('partially_paid');
  });

  it('can be returned even when nothing was paid at the till', async () => {
    route({ ...PART_PAID(0), paymentDetail: [] });
    const r = await returns.createReturnTx(mockConn, {
      saleLogId: 'log-1', lines: [{ lineId: 'line-dosa', quantity: 1 }],
    }, TENANT, USER);
    expect(r.refundedAmount).toBe(0);
    expect(r.dueAfter).toBe(944);
  });

  it('returning everything gives back exactly what was paid', async () => {
    route(PART_PAID(1000));
    const r = await returns.createReturnTx(mockConn, { saleLogId: 'log-1', lines: [] }, TENANT, USER);
    expect(r.grossAmount).toBe(1180);
    expect(r.refundedAmount).toBe(1000);
    expect(breakups().reduce((s, b) => s + b[6], 0)).toBe(-1000);
  });
});
