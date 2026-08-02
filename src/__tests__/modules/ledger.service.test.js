// src/__tests__/modules/ledger.service.test.js
// The four properties that make this a ledger rather than a table dump:
// numbered, immutable, auditable, balanced.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

// Jest requires factory-referenced variables to be `mock`-prefixed.
let mockUuidCounter = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuidCounter}`) }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  findOneOrFail: jest.fn(), findAll: jest.fn(), executeQuery: jest.fn(),
}));

const ledger = require('../../modules/ledger/ledger.service');
const { formatNumber, issueNumber } = require('../../modules/ledger/transactionNumber.service');
const { splitName, resolveContactForPosCustomer } = require('../../modules/ledger/contactResolver.service');

const TENANT = 'tenant-1';
const USER = 'cashier@test.com';
const CASH_MODE = 'mode-cash';
const CARD_MODE = 'mode-card';

const MASTERS = {
  'POS Sale':       [{ Id: 'type-sale', TransactionTypeConfigId: 'cfg-1' }],
  DRAFT:            [{ Id: 'st-draft', Name: 'DRAFT' }],
  SETTLED:          [{ Id: 'st-settled', Name: 'SETTLED' }],
  PARTIALLY_PAID:   [{ Id: 'st-part', Name: 'PARTIALLY_PAID' }],
  REFUNDED:         [{ Id: 'st-refund', Name: 'REFUNDED' }],
  Sales:            [{ Id: 'acct-sales' }],
  Full:             [{ Id: 'rt-full' }],
  Partial:          [{ Id: 'rt-part' }],
  Refund:           [{ Id: 'rt-refund' }],
};

/** Routes every query the ledger issues; overrides let a test bend one answer. */
const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql, params = []) => {
    const q = String(sql);
    if (over.handler) {
      const r = over.handler(q, params);
      if (r !== undefined) return Promise.resolve(r);
    }
    if (/FROM pos_bill/i.test(q)) return Promise.resolve([[{ TransactionDetailLogId: over.alreadyPosted || null }]]);
    if (/FROM transactiontype WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM transactiontypestatus WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM accounttypebase WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM paymentreceivedtype WHERE Type/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM paymentmode WHERE Id/i.test(q)) {
      return Promise.resolve([[{ Id: params[0], Type: params[0] === CARD_MODE ? 'Card' : 'Cash' }]]);
    }
    if (/FROM transactiontypeconfig WHERE Id/i.test(q)) {
      return Promise.resolve([[{ Id: 'cfg-1', StartCounterNo: '1', CurrentCounterNo: over.counter ?? 0, Prefix: 'INV-', Format: 'INV-{0000}' }]]);
    }
    if (/FROM transactiontypebaseconversion/i.test(q)) {
      return Promise.resolve([over.noTransition ? [] : [{ Id: 'conv-1' }]]);
    }
    if (/FROM pos_customer/i.test(q)) return Promise.resolve([over.posCustomer || []]);
    if (/FROM contactdetail/i.test(q)) return Promise.resolve([over.contact || []]);
    if (/FROM transactiondetaillog l/i.test(q)) return Promise.resolve([over.log || []]);
    if (/FROM paymentdetail/i.test(q)) return Promise.resolve([over.paymentDetail || []]);
    if (/FROM paymentbreakup/i.test(q)) return Promise.resolve([over.breakups || []]);
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([[]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const calls = (re) => mockConn.execute.mock.calls.filter(([sql]) => re.test(String(sql)));
const firstCall = (re) => calls(re)[0];

const BILL = (over = {}) => ({
  billId: 'bill-1',
  totals: { SubTotal: 100, TaxAmount: 18, Discount: 0, Total: 118, TaxByComponent: [{ name: 'CGST', amount: 9 }] },
  lines: [{ itemDetailId: 'item-1', costInfoId: 'ci-1', quantity: 1, unitAmount: 100, basePrice: 100, variantAmount: 0, netAmount: 100, taxAmount: 18, grossAmount: 118, name: 'Dosa', variants: [], taxComponents: [] }],
  tenders: [{ paymentModeId: CASH_MODE, amount: 118 }],
  posCustomerId: null,
  branchId: 'branch-1',
  ...over,
});

beforeEach(() => { jest.clearAllMocks(); mockUuidCounter = 0; });

describe('numbering — gap-free and formatted', () => {
  it.each([
    ['INV-{0000}', 42, 'INV-0042'],
    ['INV-{000000}', 7, 'INV-000007'],
    ['INV-{0000}', 12345, 'INV-12345'],
  ])('formats %s at %i as %s', (format, counter, expected) => {
    expect(formatNumber({ Prefix: 'INV-', Format: format }, counter)).toBe(expected);
  });

  it('falls back when the format has no placeholder', () => {
    expect(formatNumber({ Prefix: 'X-', Format: '' }, 5)).toBe('X-5');
  });

  it('starts at StartCounterNo on first issue', async () => {
    route({ counter: 0 });
    mockConn.execute.mockImplementationOnce(() => Promise.resolve([[
      { Id: 'cfg-1', StartCounterNo: '100', CurrentCounterNo: 0, Prefix: 'INV-', Format: 'INV-{0000}' },
    ]]));
    const { transactionNo } = await issueNumber(mockConn, 'cfg-1', TENANT, USER);
    expect(transactionNo).toBe('INV-0100');
  });

  it('takes a row lock so two tills cannot share a number', async () => {
    route();
    await issueNumber(mockConn, 'cfg-1', TENANT, USER);
    expect(firstCall(/FROM transactiontypeconfig WHERE Id/i)[0]).toMatch(/FOR UPDATE/i);
  });

  it('advances the counter', async () => {
    route({ counter: 41 });
    const { transactionNo } = await issueNumber(mockConn, 'cfg-1', TENANT, USER);
    expect(transactionNo).toBe('INV-0042');
    expect(firstCall(/UPDATE transactiontypeconfig/i)[1][0]).toBe(42);
  });
});

describe('round-off — automatic to the nearest rupee', () => {
  it.each([
    [1039.96, 1040, 0.04],
    [1039.4, 1039, -0.4],
    [100, 100, 0],
    [0.5, 1, 0.5],
  ])('%s → %s (adjust %s)', (gross, rounded, adjust) => {
    const r = ledger.applyRoundOff(gross);
    expect(r.roundedGross).toBe(rounded);
    expect(r.roundOff).toBeCloseTo(adjust, 2);
  });
});

describe('posting a sale', () => {
  it('writes header, lines, payment and tender', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER);
    expect(calls(/INSERT INTO transactiondetaillog/i)).toHaveLength(1);
    expect(calls(/INSERT INTO transactionitemdetail/i)).toHaveLength(1);
    expect(calls(/INSERT INTO paymentdetail/i)).toHaveLength(1);
    expect(calls(/INSERT INTO paymentbreakup/i)).toHaveLength(1);
  });

  it('issues an invoice number', async () => {
    route({ counter: 0 });
    const r = await ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER);
    expect(r.transactionNo).toBe('INV-0001');
  });

  it('numbers lines so one item can appear twice with different options', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      lines: [
        { itemDetailId: 'item-1', quantity: 1, unitAmount: 130, variants: [{ id: 'v1', name: 'Large' }], name: 'Dosa' },
        { itemDetailId: 'item-1', quantity: 1, unitAmount: 100, variants: [], name: 'Dosa' },
      ],
    }), TENANT, USER);

    const lineNos = calls(/INSERT INTO transactionitemdetail/i).map(([, p]) => p[3]);
    expect(lineNos).toEqual([1, 2]);
  });

  it('stores the variants on the line', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      lines: [{ itemDetailId: 'item-1', quantity: 1, unitAmount: 130, basePrice: 100, variantAmount: 30, variants: [{ id: 'v1', name: 'Large', price: 30 }], name: 'Dosa' }],
    }), TENANT, USER);

    const params = firstCall(/INSERT INTO transactionitemdetail/i)[1];
    expect(JSON.parse(params[14])).toEqual([{ id: 'v1', name: 'Large', price: 30 }]);
    expect(params[8]).toBe(100);  // BasePrice
    expect(params[9]).toBe(30);   // VariantAmount
  });

  it('writes one tender row per payment, each with its own instrument', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      totals: { SubTotal: 100, TaxAmount: 18, Discount: 0, Total: 118 },
      tenders: [
        { paymentModeId: CASH_MODE, amount: 100 },
        { paymentModeId: CARD_MODE, amount: 18, refNo: 'AUTH-1' },
      ],
    }), TENANT, USER);

    expect(calls(/INSERT INTO paymentbreakup/i)).toHaveLength(2);
    expect(calls(/INSERT INTO paymentmodetransactiondetail/i)).toHaveLength(2);
  });

  it('rejects a card tender with no reference', async () => {
    route();
    await expect(ledger.postSaleFromBill(mockConn, BILL({
      tenders: [{ paymentModeId: CARD_MODE, amount: 118 }],
    }), TENANT, USER)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('records the status transition as an audit row', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER);
    expect(calls(/INSERT INTO transactiontypeconversionmapper/i)).toHaveLength(1);
  });

  it('refuses a transition the whitelist does not permit', async () => {
    route({ noTransition: true });
    await expect(ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses to post the same bill twice', async () => {
    route({ alreadyPosted: 'log-existing' });
    await expect(ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('fails loudly when master data is unseeded', async () => {
    route({ handler: (q) => (/FROM accounttypebase WHERE Name/i.test(q) ? [[]] : undefined) });
    await expect(ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('links the bill to the document it was posted as', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER);
    expect(calls(/UPDATE pos_bill SET TransactionDetailLogId/i)).toHaveLength(1);
  });
});

describe('partial settlement', () => {
  it('reports PARTIALLY_PAID and the balance still due', async () => {
    route();
    const r = await ledger.postSaleFromBill(mockConn, BILL({
      tenders: [{ paymentModeId: CASH_MODE, amount: 50 }],
    }), TENANT, USER);

    expect(r.status).toBe('PARTIALLY_PAID');
    expect(r.balanceDue).toBe(68);
  });

  it('records only the payable share when over-tendered — change is not revenue', async () => {
    route();
    const r = await ledger.postSaleFromBill(mockConn, BILL({
      tenders: [{ paymentModeId: CASH_MODE, amount: 500 }],
    }), TENANT, USER);

    expect(r.balanceDue).toBe(0);
    // paymentdetail.TotalAmount is the 7th bind: capped at the payable.
    expect(firstCall(/INSERT INTO paymentdetail/i)[1][6]).toBe(118);
    expect(firstCall(/INSERT INTO paymentbreakup/i)[1][6]).toBe(118);
  });

  it('tender rows sum to what was settled, not what was handed over', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      tenders: [
        { paymentModeId: CASH_MODE, amount: 100 },
        { paymentModeId: CASH_MODE, amount: 100 },
      ],
    }), TENANT, USER);

    const sum = calls(/INSERT INTO paymentbreakup/i).reduce((s, [, p]) => s + p[6], 0);
    expect(sum).toBe(118);
  });
});

describe('customer merge', () => {
  it.each([
    ['Rahul Verma', { firstName: 'Rahul', lastName: 'Verma' }],
    ['Rahul', { firstName: 'Rahul', lastName: '' }],
    ['  ', { firstName: 'Guest', lastName: '' }],
  ])('splits %p', (input, expected) => {
    expect(splitName(input)).toEqual(expected);
  });

  it('records no customer for a walk-in', async () => {
    route();
    const r = await resolveContactForPosCustomer(mockConn, null, TENANT, USER);
    expect(r.contactDetailId).toBeNull();
  });

  it('does NOT create a contact without a phone', async () => {
    // uk_contact_name_mobile includes a nullable MobileNo, so phoneless
    // promotion would duplicate silently on every sale.
    route({ posCustomer: [{ Id: 'pc-1', Name: 'Rahul', Phone: null, ContactDetailId: null }] });
    const r = await resolveContactForPosCustomer(mockConn, 'pc-1', TENANT, USER);
    expect(r.contactDetailId).toBeNull();
    expect(r.name).toBe('Rahul');
    expect(calls(/INSERT INTO contactdetail/i)).toHaveLength(0);
  });

  it('matches an existing contact by phone before creating one', async () => {
    route({
      posCustomer: [{ Id: 'pc-1', Name: 'Rahul', Phone: '9876543210', ContactDetailId: null }],
      contact: [{ Id: 'contact-existing' }],
    });
    const r = await resolveContactForPosCustomer(mockConn, 'pc-1', TENANT, USER);
    expect(r.contactDetailId).toBe('contact-existing');
    expect(calls(/INSERT INTO contactdetail/i)).toHaveLength(0);
  });

  it('creates and back-links a contact when the phone is new', async () => {
    route({ posCustomer: [{ Id: 'pc-1', Name: 'Rahul Verma', Phone: '9876543210', ContactDetailId: null }] });
    const r = await resolveContactForPosCustomer(mockConn, 'pc-1', TENANT, USER);
    expect(calls(/INSERT INTO contactdetail/i)).toHaveLength(1);
    expect(calls(/UPDATE pos_customer SET ContactDetailId/i)).toHaveLength(1);
    expect(r.contactDetailId).toBeTruthy();
  });

  it('reuses an already merged customer', async () => {
    route({ posCustomer: [{ Id: 'pc-1', Name: 'Rahul', Phone: '98765', ContactDetailId: 'contact-1' }] });
    const r = await resolveContactForPosCustomer(mockConn, 'pc-1', TENANT, USER);
    expect(r.contactDetailId).toBe('contact-1');
    expect(calls(/INSERT INTO contactdetail/i)).toHaveLength(0);
  });

  it('stamps the customer snapshot on the document', async () => {
    route({ posCustomer: [{ Id: 'pc-1', Name: 'Rahul Verma', Phone: '9876543210', ContactDetailId: 'contact-1' }] });
    await ledger.postSaleFromBill(mockConn, BILL({ posCustomerId: 'pc-1' }), TENANT, USER);
    const params = firstCall(/INSERT INTO transactiondetaillog/i)[1];
    expect(params[14]).toBe('contact-1');      // ContactDetailId
    expect(params[15]).toBe('Rahul Verma');    // CustomerName snapshot
    expect(params[16]).toBe('9876543210');     // CustomerMobile snapshot
  });
});

describe('refund — reversal, never deletion', () => {
  const settledLog = [{ Id: 'log-1', TransactionTypeConfigId: 'cfg-1', SettledAt: new Date() }];

  it('transitions to REFUNDED and records it', async () => {
    route({ log: settledLog, paymentDetail: [{ Id: 'pd-1', TotalAmount: 118 }], breakups: [{ Amount: 118, PaymentModeId: CASH_MODE }] });
    const r = await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);
    expect(r.status).toBe('REFUNDED');
    expect(calls(/INSERT INTO transactiontypeconversionmapper/i)).toHaveLength(1);
  });

  it('writes a negative tender back to the original mode', async () => {
    route({ log: settledLog, paymentDetail: [{ Id: 'pd-1', TotalAmount: 118 }], breakups: [{ Amount: 118, PaymentModeId: CARD_MODE }] });
    await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);

    const breakup = firstCall(/INSERT INTO paymentbreakup/i)[1];
    expect(breakup[6]).toBe(-118);
    // Money goes back the way it came in.
    expect(firstCall(/INSERT INTO paymentmodetransactiondetail/i)[1][2]).toBe(CARD_MODE);
  });

  it('deletes nothing', async () => {
    route({ log: settledLog, paymentDetail: [{ Id: 'pd-1', TotalAmount: 118 }], breakups: [{ Amount: 118, PaymentModeId: CASH_MODE }] });
    await ledger.refundSale(mockConn, 'log-1', null, TENANT, USER);
    expect(calls(/DELETE FROM/i)).toHaveLength(0);
  });

  it('404s for an unknown document', async () => {
    route({ log: [] });
    await expect(ledger.refundSale(mockConn, 'nope', null, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
