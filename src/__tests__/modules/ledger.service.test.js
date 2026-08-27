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

const CASH_ACCOUNT = 'acct-cash';
const BANK_ACCOUNT = 'acct-bank';

const MASTERS = {
  'POS Sale':       [{ Id: 'type-sale', TransactionTypeConfigId: 'cfg-1' }],
  Expense:          [{ Id: 'type-exp', TransactionTypeConfigId: 'cfg-exp' }],
  // A return is its own document type with its own series — see
  // ledger.returns.service.js for why it is not a status on the sale.
  'POS Return':     [{ Id: 'type-return', TransactionTypeConfigId: 'cfg-return' }],
  DRAFT:            [{ Id: 'st-draft', Name: 'DRAFT' }],
  SETTLED:          [{ Id: 'st-settled', Name: 'SETTLED' }],
  PARTIALLY_PAID:   [{ Id: 'st-part', Name: 'PARTIALLY_PAID' }],
  REFUNDED:         [{ Id: 'st-refund', Name: 'REFUNDED' }],
  Sales:            [{ Id: 'acct-sales', Kind: 'INCOME' }],
  Expenses:         [{ Id: 'acct-expenses', Kind: 'EXPENSE' }],
  Full:             [{ Id: 'rt-full' }],
  Partial:          [{ Id: 'rt-part' }],
  Refund:           [{ Id: 'rt-refund' }],
  Payment:          [{ Id: 'rt-payment' }],
  CANCELLED:        [{ Id: 'st-cancel', Name: 'CANCELLED' }],
  'Store Credit':   [{ Id: 'acct-credit', Kind: 'LIABILITY' }],
};

// A settled sale, as the returns path reads it back under its row lock. Richer
// than the old fixture because a credit note has to be priced FROM the sale:
// it needs the status, the gross and the lines, not just an id.
const SETTLED_SALE = (over = {}) => [{
  Id: 'log-1',
  TransactionTypeConfigId: 'cfg-1',
  TransactionNo: 'INV-0001',
  StatusName: 'SETTLED',
  GrossAmount: 118,
  NetAmount: 100,
  TaxAmount: 18,
  DiscountAmount: 0,
  BranchId: 'branch-1',
  SettledAt: new Date(),
  ...over,
}];

// The sale's lines are what a return sends back — so a return of "everything"
// is priced from these rather than from the header.
const SALE_LINES = (over = []) => (over.length ? over : [{
  Id: 'line-1', ItemId: 'item-1', Quantity: 1, CostInfoId: 'ci-1',
  UnitPrice: 100, BasePrice: 100, VariantAmount: 0,
  NetAmount: 100, DiscountAmount: 0, ItemDiscountAmount: 0,
  TaxAmount: 18, GrossAmount: 118,
  TaxComponents: [], Variants: [], ItemName: 'Dosa',
}]);

/** Routes every query the ledger issues; overrides let a test bend one answer. */
const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql, params = []) => {
    const q = String(sql);
    if (over.handler) {
      const r = over.handler(q, params);
      if (r !== undefined) return Promise.resolve(r);
    }
    // Two different reads hit pos_bill: the idempotency probe (by bill id) and
    // the refund's customer lookup (by log id). They answer different shapes.
    if (/AS BillId/i.test(q)) return Promise.resolve([over.billCustomer || []]);
    if (/FROM pos_bill/i.test(q)) return Promise.resolve([[{ TransactionDetailLogId: over.alreadyPosted || null }]]);
    if (/FROM transactiontype WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM transactiontypestatus WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM accounttypebase WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM paymentreceivedtype WHERE Type/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM paymentmode WHERE Id/i.test(q)) {
      const isCard = params[0] === CARD_MODE;
      return Promise.resolve([[{
        Id: params[0],
        Type: isCard ? 'Card' : 'Cash',
        // Where the money lands. `unmappedMode` drops it to prove a mode with
        // no account cannot silently take payments.
        DefaultAccountTypeBaseId: over.unmappedMode
          ? null
          : (isCard ? BANK_ACCOUNT : CASH_ACCOUNT),
      }]]);
    }
    if (/FROM expense_category/i.test(q)) {
      return Promise.resolve([over.expenseCategory || [{ Id: 'cat-1', Name: 'Gas', AccountTypeBaseId: 'acct-expenses' }]]);
    }
    if (/FROM pos_expense/i.test(q)) {
      return Promise.resolve([[{ TransactionDetailLogId: over.expenseAlreadyPosted || null }]]);
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
    // How much has already come back, in total and per original line. Empty on
    // a first return; a test bends these to exercise a SECOND one.
    if (/ReversesLogId = \? AND TenantId/i.test(q) && /SUM\(GrossAmount\)/i.test(q)) {
      return Promise.resolve([[over.returnedTotal || { returned: 0, noteCount: 0 }]]);
    }
    if (/n\.ReversesLogId = \?/i.test(q)) return Promise.resolve([over.returnedByLine || []]);
    // The idempotency probe.
    if (/ReversesLogId = \? AND Remarks = \?/i.test(q)) {
      return Promise.resolve([over.duplicateNote || []]);
    }
    if (/FROM transactionitemdetail t/i.test(q)) return Promise.resolve([SALE_LINES(over.saleLines || [])]);
    if (/FROM paymentdetail/i.test(q)) return Promise.resolve([over.paymentDetail || [{ Id: 'pd-1' }]]);
    // tenderCapacity: what each mode still has left to give back.
    if (/FROM paymentbreakup b/i.test(q) && /GROUP BY/i.test(q)) {
      return Promise.resolve([(over.breakups || [{ Amount: 118, AccountTypeBaseId: CASH_ACCOUNT, PaymentModeId: CASH_MODE }])
        .map((b) => ({
          PaymentModeId: b.PaymentModeId,
          AccountTypeBaseId: b.AccountTypeBaseId ?? (b.PaymentModeId === CARD_MODE ? BANK_ACCOUNT : CASH_ACCOUNT),
          ModeType: b.PaymentModeId === CARD_MODE ? 'Card' : 'Cash',
          NetAmount: b.Amount,
        }))]);
    }
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
      totals: { SubTotal: 230, TaxAmount: 0, Discount: 0, Total: 230, TaxByComponent: [] },
      lines: [
        { itemDetailId: 'item-1', quantity: 1, unitAmount: 130, grossAmount: 130, variants: [{ id: 'v1', name: 'Large' }], name: 'Dosa' },
        { itemDetailId: 'item-1', quantity: 1, unitAmount: 100, grossAmount: 100, variants: [], name: 'Dosa' },
      ],
    }), TENANT, USER);

    const lineNos = calls(/INSERT INTO transactionitemdetail/i).map(([, p]) => p[3]);
    expect(lineNos).toEqual([1, 2]);
  });

  it('stores the variants on the line', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      totals: { SubTotal: 130, TaxAmount: 0, Discount: 0, Total: 130, TaxByComponent: [] },
      lines: [{ itemDetailId: 'item-1', quantity: 1, unitAmount: 130, basePrice: 100, variantAmount: 30, grossAmount: 130, variants: [{ id: 'v1', name: 'Large', price: 30 }], name: 'Dosa' }],
    }), TENANT, USER);

    // Bound by column name rather than position — the line INSERT gains columns
    // over time, and a bare index silently starts asserting the wrong one.
    const [sql, params] = firstCall(/INSERT INTO transactionitemdetail/i);
    const at = (col) => params[
      sql.slice(sql.indexOf('('), sql.indexOf(')'))
        .replace(/[()\s]/g, '')
        .split(',')
        .indexOf(col)
    ];

    expect(JSON.parse(at('Variants'))).toEqual([{ id: 'v1', name: 'Large', price: 30 }]);
    expect(at('BasePrice')).toBe(100);
    expect(at('VariantAmount')).toBe(30);
  });

  it('records the item discount separately from the bill’s share', async () => {
    // "We discounted this dish" and "this dish absorbed part of a bill discount"
    // are different facts. Merged, "which products do we discount?" cannot be
    // answered at all.
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      totals: { SubTotal: 80, TaxAmount: 0, Discount: 20, Total: 80, TaxByComponent: [] },
      lines: [{
        itemDetailId: 'item-1', quantity: 1, unitAmount: 100, grossAmount: 80,
        discountAmount: 20, itemDiscountAmount: 15, name: 'Dosa',
      }],
    }), TENANT, USER);

    const [sql, params] = firstCall(/INSERT INTO transactionitemdetail/i);
    const cols = sql.slice(sql.indexOf('('), sql.indexOf(')')).replace(/[()\s]/g, '').split(',');

    expect(params[cols.indexOf('DiscountAmount')]).toBe(20);
    expect(params[cols.indexOf('ItemDiscountAmount')]).toBe(15);
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

// A full refund is now the credit-note path with no line selection — see
// ledger.returns.service.js. These assert the guarantees that did NOT change:
// money goes back the way it came, nothing is deleted, and the reversal is
// recorded as a status move rather than a silent edit.
describe('refund — reversal, never deletion', () => {
  const settledLog = SETTLED_SALE();

  it('records the reversal as a status move, not a silent edit', async () => {
    route({ log: settledLog, paymentDetail: [{ Id: 'pd-1', TotalAmount: 118 }], breakups: [{ Amount: 118, PaymentModeId: CASH_MODE }] });
    const r = await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);
    expect(r.status).toBe('REFUNDED');
    // The move recorded is the CREDIT NOTE's DRAFT → SETTLED. The sale itself
    // is never mutated — that is what lets a second, smaller return happen.
    expect(calls(/INSERT INTO transactiontypeconversionmapper/i)).toHaveLength(1);
  });

  it('leaves the sale document untouched', async () => {
    route({ log: settledLog, paymentDetail: [{ Id: 'pd-1' }], breakups: [{ Amount: 118, PaymentModeId: CASH_MODE }] });
    await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);

    // The only UPDATE_LOG_STATUS is the credit note's own, addressed by the
    // note's id — never the sale's.
    const statusWrites = calls(/UPDATE transactiondetaillog SET TransactionTypeStatusId/i);
    statusWrites.forEach(([, params]) => expect(params[3]).not.toBe('log-1'));
  });

  it('raises a numbered credit note that points back at the sale', async () => {
    route({ log: settledLog, paymentDetail: [{ Id: 'pd-1' }], breakups: [{ Amount: 118, PaymentModeId: CASH_MODE }] });
    const r = await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);

    expect(r.creditNoteId).toBeTruthy();
    const note = firstCall(/INSERT INTO transactiondetaillog[\s\S]*ReversesLogId/i)[1];
    expect(note[17]).toBe('log-1');   // ReversesLogId
    expect(Number(note[12])).toBe(118); // GrossAmount, positive on the note
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

describe('line integrity — a document must itemise everything it charges for', () => {
  it('refuses a line whose menu item is no longer linked to the catalogue', async () => {
    route();
    await expect(ledger.postSaleFromBill(mockConn, BILL({
      lines: [{ itemDetailId: null, quantity: 1, grossAmount: 118, name: 'Ghost Dosa' }],
    }), TENANT, USER)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('names the offending item so the cashier can fix it', async () => {
    route();
    await expect(ledger.postSaleFromBill(mockConn, BILL({
      lines: [{ itemDetailId: null, quantity: 1, grossAmount: 118, name: 'Ghost Dosa' }],
    }), TENANT, USER)).rejects.toThrow(/Ghost Dosa/);
  });

  it('writes NOTHING when a line cannot be posted', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      lines: [{ itemDetailId: null, quantity: 1, grossAmount: 118, name: 'Ghost' }],
    }), TENANT, USER).catch(() => {});
    expect(calls(/INSERT INTO paymentdetail/i)).toHaveLength(0);
    expect(calls(/INSERT INTO paymentbreakup/i)).toHaveLength(0);
  });

  it('refuses a document whose lines do not add up to its header', async () => {
    route();
    await expect(ledger.postSaleFromBill(mockConn, BILL({
      totals: { SubTotal: 100, TaxAmount: 18, Discount: 0, Total: 118, TaxByComponent: [] },
      lines: [{ itemDetailId: 'item-1', quantity: 1, grossAmount: 50, name: 'Dosa' }],
    }), TENANT, USER)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('stores the per-line discount that product analytics reports on', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      totals: { SubTotal: 90, TaxAmount: 0, Discount: 10, Total: 90, TaxByComponent: [] },
      lines: [{ itemDetailId: 'item-1', quantity: 1, unitAmount: 100, netAmount: 90, discountAmount: 10, grossAmount: 90, name: 'Dosa' }],
    }), TENANT, USER);
    expect(firstCall(/INSERT INTO transactionitemdetail/i)[1][11]).toBe(10);
  });
});

describe('account attribution — where the money actually landed', () => {
  it('books a cash tender to the Cash account, not to Sales', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER);
    expect(firstCall(/INSERT INTO paymentbreakup/i)[1][2]).toBe(CASH_ACCOUNT);
  });

  it('books a card tender to the Bank account', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      tenders: [{ paymentModeId: CARD_MODE, amount: 118, refNo: 'AUTH-9' }],
    }), TENANT, USER);
    expect(firstCall(/INSERT INTO paymentbreakup/i)[1][2]).toBe(BANK_ACCOUNT);
  });

  it('still books the income side to Sales', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER);
    expect(firstCall(/INSERT INTO paymentdetail/i)[1][2]).toBe('acct-sales');
  });

  it('refuses a payment mode with no account mapped', async () => {
    route({ unmappedMode: true });
    await expect(ledger.postSaleFromBill(mockConn, BILL(), TENANT, USER))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('splits a mixed settlement across the accounts it landed in', async () => {
    route();
    await ledger.postSaleFromBill(mockConn, BILL({
      tenders: [
        { paymentModeId: CASH_MODE, amount: 100 },
        { paymentModeId: CARD_MODE, amount: 18, refNo: 'AUTH-1' },
      ],
    }), TENANT, USER);
    const accounts = calls(/INSERT INTO paymentbreakup/i).map(([, p]) => p[2]);
    expect(accounts).toEqual([CASH_ACCOUNT, BANK_ACCOUNT]);
  });
});

describe('refund — the POS side must not disagree', () => {
  const SETTLED_LOG = { log: SETTLED_SALE() };

  it('marks the linked bill refunded in the same transaction', async () => {
    route(SETTLED_LOG);
    await ledger.refundSale(mockConn, 'log-1', 'spoiled', TENANT, USER);
    const call = firstCall(/UPDATE pos_bill SET Status/i);
    expect(call).toBeDefined();
    expect(call[1][0]).toBe('refunded');
  });

  it('reverses money out of the account it went into', async () => {
    route({
      ...SETTLED_LOG,
      paymentDetail: [{ Id: 'pd-1' }],
      breakups: [{ Amount: 118, AccountTypeBaseId: CASH_ACCOUNT, PaymentModeId: CASH_MODE }],
    });
    await ledger.refundSale(mockConn, 'log-1', null, TENANT, USER);
    const breakup = firstCall(/INSERT INTO paymentbreakup/i)[1];
    expect(breakup[2]).toBe(CASH_ACCOUNT);
    expect(breakup[6]).toBe(-118);
  });
});

describe('expenses — money out, in the same ledger', () => {
  const EXPENSE = (over = {}) => ({
    expenseId: 'exp-1',
    amount: 500,
    categoryId: 'cat-1',
    paymentModeId: CASH_MODE,
    description: 'LPG cylinder',
    branchId: 'branch-1',
    expenseDate: '2026-08-01',
    ...over,
  });

  it('posts a numbered document', async () => {
    route();
    const result = await ledger.postExpense(mockConn, EXPENSE(), TENANT, USER);
    expect(calls(/INSERT INTO transactiondetaillog/i)).toHaveLength(1);
    expect(result.transactionNo).toBeTruthy();
  });

  it('writes a NEGATIVE tender — this is what makes cash flow one query', async () => {
    route();
    await ledger.postExpense(mockConn, EXPENSE(), TENANT, USER);
    expect(firstCall(/INSERT INTO paymentbreakup/i)[1][6]).toBe(-500);
  });

  it('takes the money out of the account it was paid from', async () => {
    route();
    await ledger.postExpense(mockConn, EXPENSE(), TENANT, USER);
    expect(firstCall(/INSERT INTO paymentbreakup/i)[1][2]).toBe(CASH_ACCOUNT);
  });

  it('books the cost against the category account', async () => {
    route();
    await ledger.postExpense(mockConn, EXPENSE(), TENANT, USER);
    expect(firstCall(/INSERT INTO paymentdetail/i)[1][2]).toBe('acct-expenses');
  });

  it('writes no item lines — the category is the analysis axis', async () => {
    route();
    await ledger.postExpense(mockConn, EXPENSE(), TENANT, USER);
    expect(calls(/INSERT INTO transactionitemdetail/i)).toHaveLength(0);
  });

  it('refuses to post the same expense twice', async () => {
    route({ expenseAlreadyPosted: 'log-existing' });
    await expect(ledger.postExpense(mockConn, EXPENSE(), TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('numbers expenses off their OWN series, not the sales series', async () => {
    route();
    await ledger.postExpense(mockConn, EXPENSE(), TENANT, USER);
    expect(firstCall(/FROM transactiontypeconfig WHERE Id/i)[1][0]).toBe('cfg-exp');
  });
});


// ── The claw-back ──────────────────────────────────────────────────────────
// A refund that returns the money but leaves the visit, the spend and the
// points standing is the failure this whole path exists to prevent: settle,
// refund, and the customer ends up a visit richer with points they did not
// keep. All three must move back inside the SAME transaction as the reversal.
describe('refund — the customer record must move back too', () => {
  const SETTLED = { log: SETTLED_SALE() };
  const WITH_CUSTOMER = {
    ...SETTLED,
    billCustomer: [{ BillId: 'bill-1', Total: 1000, BranchDetailId: 'branch-1', CustomerId: 'cust-1' }],
  };

  it('reverses the visit and the spend', async () => {
    route(WITH_CUSTOMER);
    await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);
    const call = firstCall(/UPDATE pos_customer[\s\S]*Visits/i);
    expect(call).toBeDefined();
  });

  it('writes a REVERSAL against the original EARN', async () => {
    route({
      ...WITH_CUSTOMER,
      handler: (q) => (/FROM pos_loyalty_ledger/i.test(q)
        ? [[{ Id: 'earn-1', Points: 10 }]] : undefined),
    });
    await ledger.refundSale(mockConn, 'log-1', 'Wrong order', TENANT, USER);
    const ins = firstCall(/INSERT INTO pos_loyalty_ledger/i);
    expect(ins).toBeDefined();
    // Signed, and negative: the ledger stores the movement, not its magnitude.
    expect(Number(ins[1][4])).toBeLessThan(0);
  });

  it('reverses the points actually EARNED, not points recomputed from the total', async () => {
    // The rate could have changed since the sale, or the earn could have been
    // capped. Recomputing would claw back a number that was never granted.
    route({
      ...WITH_CUSTOMER,
      handler: (q) => (/FROM pos_loyalty_ledger/i.test(q)
        ? [[{ Id: 'earn-1', Points: 3 }]] : undefined),
    });
    await ledger.refundSale(mockConn, 'log-1', null, TENANT, USER);
    expect(Number(firstCall(/INSERT INTO pos_loyalty_ledger/i)[1][4])).toBe(-3);
  });

  it('moves no points when the sale never earned any', async () => {
    route(WITH_CUSTOMER); // no EARN row on file
    await ledger.refundSale(mockConn, 'log-1', null, TENANT, USER);
    expect(calls(/INSERT INTO pos_loyalty_ledger/i)).toHaveLength(0);
  });

  it('touches no customer record for a walk-in sale', async () => {
    route({ ...SETTLED, billCustomer: [{ BillId: 'bill-1', Total: 1000, CustomerId: null }] });
    await ledger.refundSale(mockConn, 'log-1', null, TENANT, USER);
    expect(calls(/UPDATE pos_customer/i)).toHaveLength(0);
    expect(calls(/INSERT INTO pos_loyalty_ledger/i)).toHaveLength(0);
  });

  it('still reverses the money when the bill has no customer', async () => {
    route({ ...SETTLED, billCustomer: [] });
    const r = await ledger.refundSale(mockConn, 'log-1', null, TENANT, USER);
    expect(r.status).toBe('REFUNDED');
  });
});
