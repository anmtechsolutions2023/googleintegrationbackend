// A counter sale gets a token; nothing else does.
//
// The token is minted INSIDE the settle transaction on purpose: payment and
// token are one act, so a dropped follow-up request cannot leave a paying
// customer with no number.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const mockConn = { execute: jest.fn(async () => [[{ affectedRows: 1 }]]) };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

jest.mock('../../modules/posbill/posbill.repository', () => ({
  getBillOrderIdsTx: jest.fn(async () => ['o1']),
  getOrdersMetaTx: jest.fn(async () => []),
  getOrderLinesTx: jest.fn(async () => [{
    orderId: 'o1', unitAmount: 100, quantity: 1, isTaxIncluded: false, components: [],
  }]),
  toLedgerLinesTx: jest.fn(async (conn, lines) => lines),
  getSessionCustomerIdTx: jest.fn(async () => null),
  setBillOrdersTx: jest.fn(),
}));

jest.mock('../../modules/ledger/ledger.service', () => ({
  postSaleFromBill: jest.fn(async () => ({
    transactionNo: 'INV-0001', payable: 100, balanceDue: 0, roundOff: 0,
  })),
}));

jest.mock('../../modules/postoken/postoken.service', () => ({
  issueTokenTx: jest.fn(async () => ({
    id: 'tok-1', TokenNumber: 7, TokenLabel: '7', TokenDate: '2026-08-16',
  })),
}));

const repository = require('../../modules/posbill/posbill.repository');
const tokenService = require('../../modules/postoken/postoken.service');
const billService = require('../../modules/posbill/posbill.service');

const TENANT = 'tn';
const USER = 'till@x.com';
const BILL = { Id: 'b1', TenantId: TENANT, BranchDetailId: 'branch-a', Discount: 0, TransactionDetailLogId: null };

// Every SELECT on the bill returns the same unposted bill; everything else is a
// write. The ledger and the token minting are mocked, so what is under test is
// only the decision of WHETHER to issue.
const routeBill = (bill = BILL) => {
  mockConn.execute.mockImplementation(async (sql) => {
    if (/^\s*SELECT/i.test(sql)) return [[bill]];
    return [{ affectedRows: 1 }];
  });
};

const settle = () => billService.settle('b1', {
  Tenders: [{ paymentModeId: 'pm1', amount: 100 }],
}, TENANT, USER);

beforeEach(() => {
  jest.clearAllMocks();
  routeBill();
});

describe('counter sale — takeaway with no table', () => {
  beforeEach(() => {
    repository.getOrdersMetaTx.mockResolvedValue([
      { Id: 'o1', OrderType: 'takeaway', TableId: null, BranchDetailId: 'branch-a' },
    ]);
  });

  it('issues a token against the bill\'s branch and its order', async () => {
    const result = await settle();
    expect(tokenService.issueTokenTx).toHaveBeenCalledWith(
      mockConn, { branchId: 'branch-a', orderId: 'o1' }, TENANT, USER,
    );
    expect(result).toMatchObject({ TokenNumber: 7, TokenLabel: '7' });
  });

  it('mints on the settle transaction\'s own connection', async () => {
    await settle();
    expect(tokenService.issueTokenTx.mock.calls[0][0]).toBe(mockConn);
  });

  it('falls back to the round\'s branch when the bill has none', async () => {
    routeBill({ ...BILL, BranchDetailId: null });
    await settle();
    expect(tokenService.issueTokenTx.mock.calls[0][1].branchId).toBe('branch-a');
  });

  it('settles without a token rather than failing a paid sale with no branch', async () => {
    routeBill({ ...BILL, BranchDetailId: null });
    repository.getOrdersMetaTx.mockResolvedValue([
      { Id: 'o1', OrderType: 'takeaway', TableId: null, BranchDetailId: null },
    ]);
    const result = await settle();
    expect(tokenService.issueTokenTx).not.toHaveBeenCalled();
    expect(result).toMatchObject({ transactionNo: 'INV-0001' });
    expect(result.TokenLabel).toBeUndefined();
  });
});

describe('everything else gets no token', () => {
  it('dine-in: the table IS the handle on the order', async () => {
    repository.getOrdersMetaTx.mockResolvedValue([
      { Id: 'o1', OrderType: 'dinein', TableId: 't1', BranchDetailId: 'branch-a' },
    ]);
    await settle();
    expect(tokenService.issueTokenTx).not.toHaveBeenCalled();
  });

  it('delivery: the address is the handle', async () => {
    repository.getOrdersMetaTx.mockResolvedValue([
      { Id: 'o1', OrderType: 'delivery', TableId: null, BranchDetailId: 'branch-a' },
    ]);
    await settle();
    expect(tokenService.issueTokenTx).not.toHaveBeenCalled();
  });

  it('a mixed bill: one token could not stand for a seated round too', async () => {
    repository.getOrdersMetaTx.mockResolvedValue([
      { Id: 'o1', OrderType: 'takeaway', TableId: null, BranchDetailId: 'branch-a' },
      { Id: 'o2', OrderType: 'dinein', TableId: 't1', BranchDetailId: 'branch-a' },
    ]);
    await settle();
    expect(tokenService.issueTokenTx).not.toHaveBeenCalled();
  });

  it('a takeaway round that somehow sat at a table', async () => {
    repository.getOrdersMetaTx.mockResolvedValue([
      { Id: 'o1', OrderType: 'takeaway', TableId: 't1', BranchDetailId: 'branch-a' },
    ]);
    await settle();
    expect(tokenService.issueTokenTx).not.toHaveBeenCalled();
  });
});
