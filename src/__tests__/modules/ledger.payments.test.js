// src/__tests__/modules/ledger.payments.test.js
// Collecting a balance after the sale, writing one off, and naming who owes it.
//
// The worked example throughout is the one the feature was designed around:
// INV-0002, ₹288.00, ₹200.00 paid in cash at the till, ₹88.00 still owed.

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

const payments = require('../../modules/ledger/ledger.payments.service');
const { dueOf, refundableMinor } = require('../../modules/ledger/ledger.due');
const { POS_BILL_STATUS } = require('../../config/constants');

const TENANT = 'tenant-1';
const USER = 'cashier@test.com';
const CASH = 'mode-cash';
const UPI = 'mode-upi';
const CASH_ACCT = 'acct-cash';
const BANK_ACCT = 'acct-bank';

const MASTERS = {
  SETTLED: [{ Id: 'st-settled', Name: 'SETTLED' }],
  Sales:   [{ Id: 'acct-sales' }],
  Full:    [{ Id: 'rt-full' }],
  Partial: [{ Id: 'rt-part' }],
};

const SALE = (over = {}) => ({
  Id: 'log-2', TransactionNo: 'INV-0002', GrossAmount: 288, BranchId: 'branch-1',
  TransactionTypeConfigId: 'cfg-1', TransactionTypeStatusId: 'st-part',
  ContactDetailId: null, CustomerName: 'Rahul M.', CustomerMobile: '98765 43210',
  WriteOffAmount: 0, StatusName: 'PARTIALLY_PAID', TypeName: 'POS Sale',
  ...over,
});

const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql, params = []) => {
    const q = String(sql);
    // The Dues read — first, because it selects a Collected column too.
    if (/AS AgeDays/i.test(q)) return Promise.resolve([over.dues || []]);
    if (/FROM transactiondetaillog l[\s\S]*FOR UPDATE/i.test(q)) {
      return Promise.resolve([over.sale === null ? [] : [SALE(over.sale)]]);
    }
    if (/AS collected/i.test(q)) return Promise.resolve([[{ collected: over.collected ?? 200 }]]);
    if (/SUM\(GrossAmount\)[\s\S]*ReversesLogId/i.test(q)) {
      return Promise.resolve([[{ returned: over.returned ?? 0, noteCount: 0 }]]);
    }
    if (/FROM paymentmode WHERE Id/i.test(q)) {
      const isUpi = params[0] === UPI;
      return Promise.resolve([[{
        Id: params[0], Type: isUpi ? 'UPI' : 'Cash', RequiresReference: isUpi ? 1 : 0,
        DefaultAccountTypeBaseId: isUpi ? BANK_ACCT : CASH_ACCT,
      }]]);
    }
    if (/FROM transactiontypestatus WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM accounttypebase WHERE Name/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM paymentreceivedtype WHERE Type/i.test(q)) return Promise.resolve([MASTERS[params[0]] || []]);
    if (/FROM transactiontypebaseconversion/i.test(q)) return Promise.resolve([[{ Id: 'conv-remainder' }]]);
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([[]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const calls = (re) => mockConn.execute.mock.calls.filter(([sql]) => re.test(String(sql)));
const collect = (tenders) => payments.collectPaymentTx(
  mockConn, { saleLogId: 'log-2', tenders }, TENANT, USER,
);

beforeEach(() => { jest.clearAllMocks(); mockUuidCounter = 0; });

describe('what is still owed', () => {
  it('is gross less returns, payments and write-offs', () => {
    expect(dueOf({ gross: 288, collected: 200 })).toBe(88);
    expect(dueOf({ gross: 288, collected: 200, returned: 50 })).toBe(38);
    expect(dueOf({ gross: 288, collected: 250, writtenOff: 38 })).toBe(0);
  });

  it('never goes below zero, and a paisa left over counts as paid', () => {
    expect(dueOf({ gross: 288, collected: 200, returned: 149 })).toBe(0);
    expect(dueOf({ gross: 288, collected: 287.99 })).toBe(0);
  });

  it('reads MySQL DECIMAL strings', () => {
    expect(dueOf({ gross: '288.0000', collected: '200.0000', returned: '0' })).toBe(88);
  });
});

describe('a return on a part-paid sale clears the due first', () => {
  it('refunds only what was paid beyond the goods kept', () => {
    // ₹149 back on ₹288 with ₹200 paid: ₹88 clears the due, ₹61 goes back.
    expect(refundableMinor({ gross: 288, returnedAfter: 149, netPaid: 200, noteGross: 149 })).toBe(6100);
  });

  it('refunds nothing when the return is smaller than the due', () => {
    expect(refundableMinor({ gross: 288, returnedAfter: 50, netPaid: 200, noteGross: 50 })).toBe(0);
  });

  it('refunds the whole note on a sale paid in full', () => {
    expect(refundableMinor({ gross: 118, returnedAfter: 50, netPaid: 118, noteGross: 50 })).toBe(5000);
  });

  it('returning everything gives back exactly what was paid', () => {
    expect(refundableMinor({ gross: 288, returnedAfter: 288, netPaid: 200, noteGross: 288 })).toBe(20000);
  });
});

describe('collecting the balance', () => {
  it('settles the invoice when the whole due is paid', async () => {
    route();
    const r = await collect([{ paymentModeId: UPI, amount: 88, refNo: '427199301185' }]);

    expect(r).toMatchObject({ collected: 88, due: 0, change: 0, status: 'SETTLED', transactionNo: 'INV-0002' });
    // PARTIALLY_PAID → SETTLED through the seeded transition, stamped with a time.
    const [, statusParams] = calls(/UPDATE transactiondetaillog SET TransactionTypeStatusId/i)[0];
    expect(statusParams[0]).toBe('st-settled');
    expect(statusParams[1]).toBeInstanceOf(Date);
    // The POS bill follows, but only from partially_paid.
    const [, billParams] = calls(/UPDATE pos_bill SET Status = \?[\s\S]*AND Status = \?/i)[0];
    expect(billParams[0]).toBe(POS_BILL_STATUS.PAID);
    expect(billParams[4]).toBe(POS_BILL_STATUS.PARTIALLY_PAID);
  });

  it('writes a NEW payment row against the sale, never edits the first', async () => {
    route();
    await collect([{ paymentModeId: UPI, amount: 88, refNo: '427199301185' }]);

    const [, pd] = calls(/INSERT INTO paymentdetail/i)[0];
    expect(pd[3]).toBe('log-2');
    expect(pd[6]).toBe(88);
    expect(calls(/UPDATE paymentdetail/i)).toHaveLength(0);
    // Booked to the account the money landed in, with the reference attached.
    const [, breakup] = calls(/INSERT INTO paymentbreakup/i)[0];
    expect(breakup[2]).toBe(BANK_ACCT);
    expect(breakup[5]).toBe('rt-full');
    expect(breakup[6]).toBe(88);
    expect(calls(/INSERT INTO paymentmodetransactiondetail/i)[0][1][3]).toBe('427199301185');
  });

  it('a smaller payment leaves the invoice part-paid with a smaller due', async () => {
    route();
    const r = await collect([{ paymentModeId: UPI, amount: 50, refNo: '427199301185' }]);

    expect(r).toMatchObject({ collected: 50, due: 38, status: 'PARTIALLY_PAID' });
    expect(calls(/INSERT INTO paymentbreakup/i)[0][1][5]).toBe('rt-part');
    expect(calls(/UPDATE transactiondetaillog SET TransactionTypeStatusId/i)).toHaveLength(0);
  });

  it('cash above the due is change, and only the due is recorded', async () => {
    route();
    const r = await collect([{ paymentModeId: CASH, amount: 100 }]);

    expect(r).toMatchObject({ collected: 88, change: 12, due: 0, status: 'SETTLED' });
    expect(calls(/INSERT INTO paymentbreakup/i)[0][1][6]).toBe(88);
  });

  it('a split trims the CASH row, so the change is cash in hand', async () => {
    route();
    const r = await collect([
      { paymentModeId: CASH, amount: 50 },
      { paymentModeId: UPI, amount: 60, refNo: '427199301185' },
    ]);

    expect(r.change).toBe(22);
    const amounts = calls(/INSERT INTO paymentbreakup/i).map(([, p]) => [p[2], p[6]]);
    expect(amounts).toEqual([[BANK_ACCT, 60], [CASH_ACCT, 28]]);
  });

  it('refuses UPI above the due — there is no change on a bank transfer', async () => {
    route();
    await expect(collect([{ paymentModeId: UPI, amount: 100, refNo: '427199301185' }]))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(calls(/INSERT INTO paymentdetail/i)).toHaveLength(0);
  });

  it('a method that needs a reference cannot be recorded without one', async () => {
    route();
    await expect(collect([{ paymentModeId: UPI, amount: 88 }]))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(calls(/INSERT INTO paymentdetail/i)).toHaveLength(0);
  });

  it('refuses a ₹0 payment', async () => {
    route();
    await expect(collect([{ paymentModeId: CASH, amount: 0 }])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses an invoice already paid in full', async () => {
    route({ sale: { StatusName: 'SETTLED' }, collected: 288 });
    await expect(collect([{ paymentModeId: CASH, amount: 10 }])).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses when a return has already cleared the due', async () => {
    route({ returned: 149 });
    await expect(collect([{ paymentModeId: CASH, amount: 10 }])).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses anything that is not a sale', async () => {
    route({ sale: { TypeName: 'Expense' } });
    await expect(collect([{ paymentModeId: CASH, amount: 10 }])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('404s an unknown document', async () => {
    route({ sale: null });
    await expect(collect([{ paymentModeId: CASH, amount: 10 }])).rejects.toMatchObject({ statusCode: 404 });
  });

  it('locks the invoice before reading what it owes', async () => {
    route();
    await collect([{ paymentModeId: CASH, amount: 88 }]);
    const first = String(mockConn.execute.mock.calls[0][0]);
    expect(first).toMatch(/FOR UPDATE/i);
  });
});

describe('writing a balance off', () => {
  const writeOff = (reason, note) => payments.writeOffTx(
    mockConn, { saleLogId: 'log-2', reason, note }, TENANT, USER,
  );

  it('writes off exactly what is due and settles the invoice', async () => {
    route({ collected: 250 });
    const r = await writeOff('CUSTOMER_LEFT');

    expect(r).toMatchObject({ writtenOff: 38, status: 'SETTLED', reasonLabel: 'Customer left without paying' });
    const [, p] = calls(/SET WriteOffAmount/i)[0];
    expect(p.slice(0, 3)).toEqual([38, 'CUSTOMER_LEFT', null]);
    // Not a payment: nothing is added to what was collected.
    expect(calls(/INSERT INTO paymentdetail/i)).toHaveLength(0);
    expect(calls(/UPDATE transactiondetaillog SET TransactionTypeStatusId/i)).toHaveLength(1);
  });

  it('needs a note when the reason is Other', async () => {
    route();
    await expect(writeOff('OTHER')).rejects.toMatchObject({ statusCode: 400 });
    await expect(writeOff('OTHER', 'Promised to pay, never came back')).resolves.toMatchObject({ writtenOff: 88 });
  });

  it('refuses an unknown reason', async () => {
    route();
    await expect(writeOff('BAD_LUCK')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses an invoice with nothing due', async () => {
    route({ sale: { StatusName: 'SETTLED' }, collected: 288 });
    await expect(writeOff('DISPUTED')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('naming who owes it', () => {
  const setDebtor = () => payments.setDebtorTx(
    mockConn, { saleLogId: 'log-2', name: '  Rahul M. ', mobile: '98765 43210' }, TENANT, USER,
  );

  it('sets the name on an unnamed part-paid sale', async () => {
    route({ sale: { CustomerName: null, CustomerMobile: null } });
    const r = await setDebtor();
    expect(r.CustomerName).toBe('Rahul M.');
    expect(calls(/SET CustomerName = \?/i)[0][1].slice(0, 2)).toEqual(['Rahul M.', '98765 43210']);
  });

  it('leaves a sale linked to a guest alone', async () => {
    route({ sale: { ContactDetailId: 'c-1' } });
    await expect(setDebtor()).rejects.toMatchObject({ statusCode: 409 });
  });

  it('only while something is still owed', async () => {
    route({ sale: { StatusName: 'SETTLED' }, collected: 288 });
    await expect(setDebtor()).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('the Dues worklist', () => {
  const ROW = (over) => ({
    Id: over.Id, TransactionNo: over.no, TransactionDate: '2026-10-01', GrossAmount: over.gross,
    Collected: over.paid, Returned: over.back || 0, WriteOffAmount: 0, AgeDays: over.age,
    CustomerName: over.name || null, CustomerMobile: null, TableNames: over.table || null,
  });

  it('summarises everything owed, whatever the filter', async () => {
    route({
      dues: [
        ROW({ Id: 'a', no: 'INV-0412', gross: 1520, paid: 1200, age: 23, name: 'P. Nair' }),
        ROW({ Id: 'b', no: 'INV-0590', gross: 742, paid: 500, age: 4 }),
        ROW({ Id: 'c', no: 'INV-0640', gross: 288, paid: 200, age: 0, table: 'Marble Table 2' }),
      ],
    });
    const r = await payments.listDues({ age: 'today' }, TENANT);

    expect(r.summary).toMatchObject({
      outstanding: 650, count: 3, oldestDays: 23, oldestNo: 'INV-0412',
      buckets: { all: 3, today: 1, week: 1, month: 1, older: 0 },
    });
    expect(r.documents.map((d) => d.TransactionNo)).toEqual(['INV-0640']);
    expect(r.documents[0]).toMatchObject({ Due: 88, Source: { kind: 'table', label: 'Marble Table 2' } });
  });

  it('searches the invoice, the name and the table', async () => {
    route({
      dues: [
        ROW({ Id: 'a', no: 'INV-0412', gross: 1520, paid: 1200, age: 23, name: 'P. Nair' }),
        ROW({ Id: 'c', no: 'INV-0640', gross: 288, paid: 200, age: 0, table: 'Marble Table 2' }),
      ],
    });
    expect((await payments.listDues({ search: 'nair' }, TENANT)).documents).toHaveLength(1);
    expect((await payments.listDues({ search: 'marble' }, TENANT)).documents).toHaveLength(1);
  });

  it('drops a row a return has already cleared', async () => {
    route({ dues: [ROW({ Id: 'c', no: 'INV-0640', gross: 288, paid: 200, back: 149, age: 0 })] });
    const r = await payments.listDues({}, TENANT);
    expect(r.summary.count).toBe(0);
  });
});
