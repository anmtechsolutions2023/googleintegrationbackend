// src/__tests__/modules/posexpense.flow.test.js
// draft → approved → settled.
//
// The property under test throughout: nothing reaches the ledger until the
// money actually leaves. A draft is a claim, an approved expense is a
// commitment, and only settling is a cost.

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
}));

const service = require('../../modules/posexpense/posexpense.service');
const { createSchema } = require('../../modules/posexpense/posexpense.schemas');

const TENANT = 'tenant-1';
const USER = 'manager@test.com';
const ID = 'exp-1';
const CASH_MODE = 'mode-cash';

const EXPENSE = (over = {}) => ({
  Id: ID,
  ExpenseCategoryId: 'cat-1',
  Description: 'LPG cylinder',
  Amount: '500.00',
  ExpenseDate: '2026-08-01',
  PaymentModeId: CASH_MODE,
  Status: 'draft',
  TransactionDetailLogId: null,
  BranchDetailId: 'branch-1',
  ...over,
});

const route = (expense = {}) => {
  mockConn.execute.mockImplementation((sql, params = []) => {
    const q = String(sql);
    if (/FROM pos_expense e/i.test(q)) return Promise.resolve([[EXPENSE(expense)]]);
    if (/FROM pos_expense\b/i.test(q)) {
      return Promise.resolve([[{ TransactionDetailLogId: EXPENSE(expense).TransactionDetailLogId }]]);
    }
    if (/FROM expense_category/i.test(q)) return Promise.resolve([[{ Id: 'cat-1', AccountTypeBaseId: 'acct-expenses' }]]);
    if (/FROM transactiontype WHERE Name/i.test(q)) return Promise.resolve([[{ Id: 'type-exp', TransactionTypeConfigId: 'cfg-exp' }]]);
    if (/FROM transactiontypestatus WHERE Name/i.test(q)) return Promise.resolve([[{ Id: `st-${params[0]}`, Name: params[0] }]]);
    if (/FROM accounttypebase WHERE Name/i.test(q)) return Promise.resolve([[{ Id: 'acct-expenses', Kind: 'EXPENSE' }]]);
    if (/FROM paymentreceivedtype WHERE Type/i.test(q)) return Promise.resolve([[{ Id: 'rt-payment' }]]);
    if (/FROM paymentmode WHERE Id/i.test(q)) {
      return Promise.resolve([[{ Id: params[0], Type: 'Cash', DefaultAccountTypeBaseId: 'acct-cash' }]]);
    }
    if (/FROM transactiontypeconfig WHERE Id/i.test(q)) {
      return Promise.resolve([[{ Id: 'cfg-exp', StartCounterNo: '1', CurrentCounterNo: 0, Prefix: 'EXP', Format: 'EXP-{0000}' }]]);
    }
    if (/FROM transactiontypebaseconversion/i.test(q)) return Promise.resolve([[{ Id: 'conv-1' }]]);
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([[]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const callsTo = (re) => mockConn.execute.mock.calls.filter(([s]) => re.test(String(s)));

beforeEach(() => { jest.clearAllMocks(); mockUuidCounter = 0; });

describe('an expense is born a draft', () => {
  it('does not accept a Status from the client', () => {
    // Otherwise the approval gate is bypassable by posting Status: 'approved'.
    const { error } = createSchema.validate({
      ExpenseCategoryId: '11111111-1111-1111-1111-111111111111',
      Amount: 500,
      Status: 'approved',
    });
    expect(error).toBeDefined();
  });

  it('requires a category from the master, not free text', () => {
    expect(createSchema.validate({ Category: 'Gas', Amount: 500 }).error).toBeDefined();
    expect(createSchema.validate({
      ExpenseCategoryId: '11111111-1111-1111-1111-111111111111', Amount: 500,
    }).error).toBeUndefined();
  });

  it('rejects a negative amount — that would be a reversal, not an expense', () => {
    expect(createSchema.validate({
      ExpenseCategoryId: '11111111-1111-1111-1111-111111111111', Amount: -50,
    }).error).toBeDefined();
  });
});

describe('approval', () => {
  it('records who approved it and when', async () => {
    route();
    await service.approve(ID, TENANT, USER);
    const [sql, params] = callsTo(/SET Status = 'approved'/i)[0];
    expect(sql).toMatch(/ApprovedAt = NOW\(\)/);
    expect(params[0]).toBe(USER);
  });

  it('posts NOTHING to the ledger — approval is not payment', async () => {
    route();
    await service.approve(ID, TENANT, USER);
    expect(callsTo(/INSERT INTO transactiondetaillog/i)).toHaveLength(0);
    expect(callsTo(/INSERT INTO paymentbreakup/i)).toHaveLength(0);
  });

  it('refuses to approve anything that is not a draft', async () => {
    route({ Status: 'approved' });
    await expect(service.approve(ID, TENANT, USER)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a draft without touching the ledger', async () => {
    route();
    await service.reject(ID, TENANT, USER);
    expect(callsTo(/SET Status = 'cancelled'/i)).toHaveLength(1);
    expect(callsTo(/INSERT INTO transactiondetaillog/i)).toHaveLength(0);
  });
});

describe('settlement — the only step that posts', () => {
  it('refuses to settle a draft that was never approved', async () => {
    route({ Status: 'draft' });
    await expect(service.settle(ID, {}, TENANT, USER)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('writes no document for an unapproved expense', async () => {
    route({ Status: 'draft' });
    await service.settle(ID, {}, TENANT, USER).catch(() => {});
    expect(callsTo(/INSERT INTO transactiondetaillog/i)).toHaveLength(0);
  });

  it('posts a numbered document from the EXPENSE series', async () => {
    route({ Status: 'approved' });
    const result = await service.settle(ID, {}, TENANT, USER);
    expect(result.transactionNo).toBe('EXP-0001');
  });

  it('writes a negative tender so cash flow is one query over one table', async () => {
    route({ Status: 'approved' });
    await service.settle(ID, {}, TENANT, USER);
    expect(callsTo(/INSERT INTO paymentbreakup/i)[0][1][6]).toBe(-500);
  });

  it('refuses to settle without a payment mode', async () => {
    // The mode decides which account the money left; "paid, somehow" is not
    // recordable.
    route({ Status: 'approved', PaymentModeId: null });
    await expect(service.settle(ID, {}, TENANT, USER)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lets the settle call name the mode the money actually left by', async () => {
    route({ Status: 'approved', PaymentModeId: null });
    await service.settle(ID, { PaymentModeId: CASH_MODE }, TENANT, USER);
    expect(callsTo(/INSERT INTO paymentbreakup/i)).toHaveLength(1);
  });

  it('marks the expense settled and links it to its document', async () => {
    route({ Status: 'approved' });
    await service.settle(ID, {}, TENANT, USER);
    expect(callsTo(/SET TransactionDetailLogId = \?, Status = 'settled'/i)).toHaveLength(1);
  });
});

describe('immutability', () => {
  it('refuses to edit an expense that has been posted', async () => {
    route({ Status: 'settled', TransactionDetailLogId: 'log-1' });
    await expect(service.update(ID, { Amount: 999 }, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses to delete an expense that has been posted', async () => {
    route({ Status: 'settled', TransactionDetailLogId: 'log-1' });
    await expect(service.remove(ID, TENANT)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows editing while it is still a draft', async () => {
    route({ Status: 'draft' });
    await expect(service.update(ID, { Amount: 600 }, TENANT, USER)).resolves.toBeDefined();
  });
});
