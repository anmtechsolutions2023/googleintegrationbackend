// One request, ONE connection — asserted against the real pool helper.
//
// A settle runs inside withTransaction, which holds a connection for the whole
// call. Anything it awaits that takes a SECOND connection makes the request
// cost two, and at CONNECTION_LIMIT 4 four overlapping settles then hold their
// transactions and wait for a second connection nobody is left to release.
// mysql2 has no acquire timeout, so that wait never ends: the settle hangs and
// then fails. That is exactly what assertBillMutable did by calling this
// class's getById override, which opened a transaction of its own.
//
// The other settle tests stub withConnection/withTransaction to hand back one
// shared connection, so they cannot see a second acquisition at all — which is
// why this one stubs the POOL instead and counts.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const BILL = {
  Id: 'b1', TenantId: 'tn', BranchDetailId: 'branch-a',
  Discount: 0, LineDiscounts: null, TransactionDetailLogId: null, OrderId: 'o1',
};

const stats = { acquired: 0, held: 0, peak: 0 };

// A pool that counts. Every getConnection is a real acquisition; release()
// gives it back. `peak` is what has to stay at 1.
jest.mock('../../config/db', () => ({
  getConnection: jest.fn(async () => {
    stats.acquired += 1;
    stats.held += 1;
    stats.peak = Math.max(stats.peak, stats.held);
    return {
      execute: jest.fn(async (sql) => (/^\s*SELECT/i.test(sql)
        ? [[BILL]]
        : [{ affectedRows: 1 }])),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(() => { stats.held -= 1; }),
    };
  }),
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
    transactionNo: 'INV-0001', transactionDetailLogId: 'log-1',
    payable: 100, balanceDue: 0, roundOff: 0,
  })),
}));
jest.mock('../../modules/poscustomer/poscustomer.stats.service', () => ({
  recordSaleTx: jest.fn(async () => true),
}));
jest.mock('../../modules/loyalty/loyalty.service', () => ({
  earnForSaleTx: jest.fn(async () => null),
}));
jest.mock('../../modules/posoffer/offer.engine.service', () => ({
  evaluateTx: jest.fn(async () => ({ applied: [], lineDiscounts: {} })),
  mergeLineDiscounts: jest.fn((manual) => manual || {}),
  recordRedemptionsTx: jest.fn(async () => null),
}));
jest.mock('../../modules/postoken/postoken.service', () => ({
  issueTokenTx: jest.fn(async () => null),
}));

const billService = require('../../modules/posbill/posbill.service');

beforeEach(() => {
  stats.acquired = 0;
  stats.held = 0;
  stats.peak = 0;
});

describe('a settle costs exactly one connection', () => {
  it('never holds two at once', async () => {
    await billService.settle('b1', {
      Payments: [{ paymentModeId: 'pm1', amount: 100 }],
    }, 'tn', 'till@x.com');

    expect(stats.peak).toBe(1);
  });

  it('gives the connection back', async () => {
    await billService.settle('b1', {
      Payments: [{ paymentModeId: 'pm1', amount: 100 }],
    }, 'tn', 'till@x.com');

    expect(stats.held).toBe(0);
  });

  it('reads the bill on the transaction, so the check sees uncommitted state', async () => {
    await billService.settle('b1', {
      Payments: [{ paymentModeId: 'pm1', amount: 100 }],
    }, 'tn', 'till@x.com');

    // One acquisition for the whole settle — not one for the transaction and
    // another for the mutability check.
    expect(stats.acquired).toBe(1);
  });
});

describe('reading a bill costs one connection too', () => {
  it('does not read the row on one and its rounds on another', async () => {
    await billService.getById('b1', 'tn');

    expect(stats.peak).toBe(1);
    expect(stats.acquired).toBe(1);
    expect(stats.held).toBe(0);
  });
});
