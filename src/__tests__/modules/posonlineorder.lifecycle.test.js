// src/__tests__/modules/posonlineorder.lifecycle.test.js
// Accepting a portal order — the step the module was missing.
//
// Before this, an online order was a status string: no pos_order, so no KOT, so
// no bill, so nothing in the ledger. These tests assert that accepting puts the
// order on the road every other sale already travels, and that the two screens
// over this data can no longer disagree about what stage it is at.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConnection = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConnection)),
  withTransaction: jest.fn(async (cb) => cb(mockConnection)),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

jest.mock('../../modules/posorder/posorder.service', () => ({
  priceItems: jest.fn(),
  createRoundTx: jest.fn(),
}));
jest.mock('../../modules/posorder/posKotWriter', () => ({
  writeKot: jest.fn(),
  findLiveKotTx: jest.fn(),
}));
jest.mock('../../modules/posonlineorder/posonlineorder.settle', () => ({
  settleForOrder: jest.fn(),
}));

const posOrderService = require('../../modules/posorder/posorder.service');
const kotWriter = require('../../modules/posorder/posKotWriter');
const settle = require('../../modules/posonlineorder/posonlineorder.settle');
const lifecycle = require('../../modules/posonlineorder/posonlineorder.lifecycle');

const TENANT = 'tenant-1';
const USER = 'cashier@test.com';

const LINES = [
  { unmapped: false, ItemMetaId: 'im-1', CostInfoId: 'ci-zo', name: 'Paneer Tikka', qty: 2, grossAmount: 460 },
];

const order = (over = {}) => ({
  Id: 'oo-1', PortalId: 'portal-zo', Platform: 'Zomato', Status: 'new',
  OrderLines: JSON.stringify(LINES), BranchDetailId: 'branch-1', ExternalRef: 'ZO-1',
  ...over,
});

const PORTAL = {
  Id: 'portal-zo', Code: 'ZOMATO', Name: 'Zomato', Adapter: 'manual',
  ChannelId: 'chan-online', SettlementPaymentModeId: 'pm-zo',
};

const routeDb = ({ row = order(), portal = PORTAL } = {}) => {
  mockConnection.execute.mockImplementation((sql) => {
    if (/FROM pos_online_order WHERE Id/i.test(sql)) return Promise.resolve([[row]]);
    if (/FROM pos_portal WHERE Id/i.test(sql)) return Promise.resolve([portal ? [portal] : []]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const executed = (fragment) => mockConnection.execute.mock.calls
  .filter(([sql]) => new RegExp(fragment, 'i').test(sql));

beforeEach(() => {
  jest.clearAllMocks();
  posOrderService.priceItems.mockResolvedValue({
    items: LINES,
    totals: { netAmount: 438.1, taxAmount: 21.9, grossAmount: 460 },
  });
  posOrderService.createRoundTx.mockResolvedValue({ id: 'ord-1', OrderNo: 'ORD-0001' });
  kotWriter.findLiveKotTx.mockResolvedValue(null);
  kotWriter.writeKot.mockResolvedValue({ KotId: 'kot-1', KotNo: 'KOT-0001', Status: 'pending' });
  settle.settleForOrder.mockResolvedValue({ BillId: 'bill-1', BillNo: 'BILL-0001' });
});

describe('accept — the order joins the POS', () => {
  it('creates a pos_order, links it back, and fires the kitchen ticket', async () => {
    routeDb();
    const result = await lifecycle.accept('oo-1', {}, TENANT, USER);

    expect(posOrderService.createRoundTx).toHaveBeenCalledTimes(1);
    expect(kotWriter.writeKot).toHaveBeenCalledTimes(1);
    expect(executed('SET Status = .accepted., OrderId')).toHaveLength(1);
    expect(result).toMatchObject({ OrderId: 'ord-1', OrderNo: 'ORD-0001', Status: 'accepted' });
  });

  // All three writes are ONE decision. Splitting them across transactions would
  // allow an accepted order with nothing cooking, or food cooking for an order
  // nothing points at.
  it('does all three writes on one connection', async () => {
    routeDb();
    await lifecycle.accept('oo-1', {}, TENANT, USER);

    const [conn] = posOrderService.createRoundTx.mock.calls[0];
    expect(conn).toBe(mockConnection);
    expect(kotWriter.writeKot.mock.calls[0][0]).toBe(mockConnection);
  });

  // The bill has to be raised at what the customer paid ON THE PORTAL, not at
  // the dine-in price they never saw. Ingest resolved that costinfo; accept
  // must carry it through rather than re-deriving one.
  it('prices the round from the portal costinfo the line carries', async () => {
    routeDb();
    await lifecycle.accept('oo-1', {}, TENANT, USER);

    const [items] = posOrderService.priceItems.mock.calls[0];
    expect(items).toEqual([
      expect.objectContaining({ id: 'im-1', costInfoId: 'ci-zo', qty: 2 }),
    ]);
  });

  // This is what makes pos_channel load-bearing: reports can slice online
  // revenue without matching on OrderType text.
  it('stamps the portal channel and the delivery order type', async () => {
    routeDb();
    await lifecycle.accept('oo-1', {}, TENANT, USER);

    const [, created] = posOrderService.createRoundTx.mock.calls[0];
    expect(created).toMatchObject({
      OrderType: 'delivery',
      ChannelId: 'chan-online',
      TableId: null,
      BranchDetailId: 'branch-1',
    });
  });

  // Aggregators mask the number and rotate it. Resolving a customer per order
  // would fill the CRM with one-visit ghosts and poison the loyalty ledger.
  it('never attaches a CRM customer to a portal order', async () => {
    routeDb();
    await lifecycle.accept('oo-1', {}, TENANT, USER);

    const [, created] = posOrderService.createRoundTx.mock.calls[0];
    expect(created.CustomerId).toBeNull();
  });

  // Same send-once guard the till uses: a double-tap, a retry or a second
  // device must not put the same food on the pass twice.
  it('reuses a live ticket instead of firing a second one', async () => {
    routeDb();
    kotWriter.findLiveKotTx.mockResolvedValue({ Id: 'kot-9', KotNo: 'KOT-0009', Status: 'pending' });

    const result = await lifecycle.accept('oo-1', {}, TENANT, USER);

    expect(kotWriter.writeKot).not.toHaveBeenCalled();
    expect(result.Kot).toMatchObject({ KotNo: 'KOT-0009', AlreadySent: true });
  });

  it('can accept without firing, for a portal that batches its kitchen', async () => {
    routeDb();
    await lifecycle.accept('oo-1', { FireKot: false }, TENANT, USER);
    expect(kotWriter.writeKot).not.toHaveBeenCalled();
  });

  it('refuses an order with nothing on it', async () => {
    routeDb({ row: order({ OrderLines: '[]' }) });
    await expect(lifecycle.accept('oo-1', {}, TENANT, USER)).rejects.toThrow(/no items/i);
  });

  it('refuses to accept an order twice', async () => {
    routeDb({ row: order({ Status: 'accepted' }) });
    await expect(lifecycle.accept('oo-1', {}, TENANT, USER))
      .rejects.toThrow(/Cannot move an order from "accepted" to "accepted"/);
  });
});

describe('transitions — one table, so the screens cannot disagree', () => {
  // The bug this replaces: the queue wrote 'processing' on Accept while the
  // tracking board drew 'accepted' as stage one, so the status a manager read
  // never matched the button a cashier pressed.
  it('allows the real workflow, one stage at a time', () => {
    expect(() => lifecycle.assertTransition('new', 'accepted')).not.toThrow();
    expect(() => lifecycle.assertTransition('accepted', 'processing')).not.toThrow();
    expect(() => lifecycle.assertTransition('processing', 'out for delivery')).not.toThrow();
    expect(() => lifecycle.assertTransition('out for delivery', 'delivered')).not.toThrow();
  });

  it('refuses the skip that used to happen on Accept', () => {
    expect(() => lifecycle.assertTransition('new', 'processing')).toThrow(/Cannot move/);
  });

  it('lets any live order be cancelled, and a finished one be nothing', () => {
    expect(() => lifecycle.assertTransition('new', 'cancelled')).not.toThrow();
    expect(() => lifecycle.assertTransition('processing', 'cancelled')).not.toThrow();
    expect(() => lifecycle.assertTransition('delivered', 'cancelled')).toThrow(/finished/);
  });

  it('rejects a status nothing in the system recognises', () => {
    expect(() => lifecycle.assertTransition('new', 'en route')).toThrow(/Unknown order status/);
  });
});

describe('delivered — where the money is recognised', () => {
  it('settles the bill through the existing posbill path', async () => {
    routeDb({ row: order({ Status: 'out for delivery', OrderId: 'ord-1' }) });
    const result = await lifecycle.setStatus('oo-1', { Status: 'delivered' }, TENANT, USER);

    expect(settle.settleForOrder).toHaveBeenCalledTimes(1);
    expect(result.Settlement).toMatchObject({ BillId: 'bill-1' });
  });

  it('settles nothing on any earlier stage', async () => {
    routeDb({ row: order({ Status: 'accepted' }) });
    await lifecycle.setStatus('oo-1', { Status: 'processing' }, TENANT, USER);
    expect(settle.settleForOrder).not.toHaveBeenCalled();
  });

  // The food arrived. Saying otherwise because a payment mode is unconfigured
  // would be a lie about the physical world — so the delivery stands and the
  // settle failure is reported for someone to fix.
  it('keeps the delivery when the settle fails, and reports it', async () => {
    routeDb({ row: order({ Status: 'out for delivery', OrderId: 'ord-1' }) });
    settle.settleForOrder.mockRejectedValue(new Error('no settlement payment mode configured'));

    const result = await lifecycle.setStatus('oo-1', { Status: 'delivered' }, TENANT, USER);

    expect(result.Status).toBe('delivered');
    expect(executed('SET Status = .delivered.')).toHaveLength(1);
    expect(result.Settlement).toMatchObject({ settled: false });
    expect(result.Settlement.error).toMatch(/payment mode/);
  });
});

describe('reject', () => {
  it('records the coded reason portals require', async () => {
    routeDb();
    const result = await lifecycle.reject('oo-1', { Reason: 'out_of_stock' }, TENANT, USER);

    expect(result).toMatchObject({ Status: 'cancelled', Reason: 'out_of_stock' });
    const [params] = executed('SET Status = .cancelled., CancelReason').map(([, p]) => p);
    expect(params[0]).toBe('out_of_stock');
  });

  it('refuses to reject an order that has already been delivered', async () => {
    routeDb({ row: order({ Status: 'delivered' }) });
    await expect(lifecycle.reject('oo-1', { Reason: 'other' }, TENANT, USER))
      .rejects.toThrow(/finished/);
  });
});
