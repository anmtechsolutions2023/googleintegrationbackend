// The guest side of QR table ordering.
//
// What these hold the diner module to:
//   - A diner session token is useless against staff routes (different key).
//   - The menu is this branch's QR-channel menu, falling back to dine-in.
//   - An order line is REBUILT on the server: the phone's price, name, table or
//     customer never reach the round, and a dish from another branch is refused.
//   - Nothing is placed while the branch is menu-only.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-secret-for-tests';

let mockRows = [];
const mockConn = {
  execute: jest.fn(async (sql) => {
    if (/FROM pos_item_meta im\s+JOIN itemdetail/.test(String(sql))) return [mockRows];
    return [[]];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
  withTransaction: async (cb) => cb(mockConn),
}));
jest.mock('../../modules/posorder/posorder.service', () => ({
  create: jest.fn(async (data) => ({ id: 'order-1', OrderNo: 'ORD-0001', Total: 630, ...data })),
  priceItems: jest.fn(),
}));
jest.mock('../../modules/posorder/posorder.transfer', () => ({
  refreshTable: jest.fn(async () => {}),
}));
jest.mock('../../modules/posqr/posqr.channel', () => ({
  ensureQrChannel: jest.fn(async () => 'channel-qr'),
  ensureQrChannelTx: jest.fn(async () => 'channel-qr'),
  findFallbackChannelIdTx: jest.fn(async () => 'channel-dinein'),
}));

const jwt = require('jsonwebtoken');
const session = require('../../modules/posdine/dine.session');
const { filterForQrChannel } = require('../../modules/posdine/dine.menu.service');
const orderService = require('../../modules/posdine/dine.order.service');
const posOrderService = require('../../modules/posorder/posorder.service');
const { refreshTable } = require('../../modules/posorder/posorder.transfer');
const schemas = require('../../modules/posdine/dine.schemas');
const MESSAGES = require('../../config/messages');

const DISH = '11111111-1111-1111-1111-111111111111';
const OTHER_BRANCH_DISH = '22222222-2222-2222-2222-222222222222';

const diner = (over = {}) => ({
  phone: '+919876543210',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  tableId: 'table-4',
  qrId: 'qr-4',
  customerId: 'cust-1',
  sessionStartedAt: new Date(),
  settings: { enabled: true, mode: 'order', canOrder: true },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [{ Id: DISH, Name: 'Paneer Tikka' }];
});

describe('dine.session — a separate key from staff tokens', () => {
  it('issues a token the STAFF secret cannot verify', () => {
    const { token } = session.issue({
      phone: '+919876543210', tenantId: 't', branchId: 'b', tableId: 'tb', qrId: 'q', customerId: 'c',
    });
    expect(() => jwt.verify(token, process.env.JWT_SECRET)).toThrow();
    expect(session.verify(token)).toMatchObject({ tid: 't', tableId: 'tb', customerId: 'c' });
  });

  it('refuses a staff token presented as a diner session', () => {
    const staff = jwt.sign({ phone: '+91', tid: 't', scopes: [] }, process.env.JWT_SECRET);
    expect(() => session.verify(staff)).toThrow();
  });
});

describe('dine.menu — which dishes a guest at a table sees', () => {
  const row = (id, channels) => ({ Id: id, ChannelIds: JSON.stringify(channels) });

  it('falls back to the dine-in menu while no dish is on the QR channel', () => {
    const kept = filterForQrChannel(
      [row('a', ['channel-dinein']), row('b', ['channel-online']), row('c', [])],
      'channel-qr', 'channel-dinein',
    ).map((r) => r.Id);
    expect(kept).toEqual(['a', 'c']);
  });

  it('uses ONLY the QR channel once any dish is linked to it', () => {
    const kept = filterForQrChannel(
      [row('a', ['channel-dinein']), row('b', ['channel-qr']), row('c', [])],
      'channel-qr', 'channel-dinein',
    ).map((r) => r.Id);
    expect(kept).toEqual(['b', 'c']);
  });
});

describe('dine.order — lines are rebuilt on the server', () => {
  it('takes the name from the catalogue, never from the phone', async () => {
    const lines = await orderService.buildLines(
      [{ id: DISH, quantity: 2, name: 'FREE BEER', price: 0 }], diner(),
    );
    expect(lines).toEqual([{ id: DISH, name: 'Paneer Tikka', quantity: 2, variantIds: [], addonIds: [] }]);
  });

  it('refuses a dish that is not on this branch\'s menu', async () => {
    await expect(orderService.buildLines([{ id: OTHER_BRANCH_DISH, quantity: 1 }], diner()))
      .rejects.toMatchObject({ statusCode: 400, message: MESSAGES.ERROR.QR_ITEM_NOT_AT_BRANCH });
  });

  it('places the round at the SESSION\'s table and customer, on the QR channel, with no KOT', async () => {
    await orderService.place({ items: [{ id: DISH, quantity: 1 }] }, diner());
    const [data, tenantId, createdBy] = posOrderService.create.mock.calls[0];
    expect(data).toMatchObject({
      TableId: 'table-4', CustomerId: 'cust-1', BranchDetailId: 'branch-1',
      ChannelId: 'channel-qr', Status: 'open', OrderType: 'dinein',
    });
    expect(tenantId).toBe('tenant-1');
    expect(createdBy).toBe('diner:+919876543210');
    expect(refreshTable).toHaveBeenCalledWith(mockConn, 'table-4', 'tenant-1', 'diner:+919876543210');
  });

  it('refuses to place anything while the branch is menu-only', async () => {
    await expect(orderService.place(
      { items: [{ id: DISH, quantity: 1 }] },
      diner({ settings: { enabled: true, mode: 'menu', canOrder: false } }),
    )).rejects.toMatchObject({ statusCode: 409 });
    expect(posOrderService.create).not.toHaveBeenCalled();
  });

  it('maps a round\'s state to the words a guest understands', () => {
    expect(orderService.statusOf({ Status: 'open', KotStatus: null })).toBe('waiting');
    expect(orderService.statusOf({ Status: 'fired', KotStatus: 'pending' })).toBe('kitchen');
    expect(orderService.statusOf({ Status: 'fired', KotStatus: 'ready' })).toBe('ready');
    expect(orderService.statusOf({ Status: 'cancelled', KotStatus: null })).toBe('rejected');
  });

  // A settled round KEEPS its kitchen status, so without a terminal state it
  // fell through to 'ready' and the guest's phone went on saying "Ready, on its
  // way" after they had paid and left.
  it('a settled round is finished, whatever its ticket still says', () => {
    expect(orderService.statusOf({ Status: 'closed', KotStatus: 'ready' })).toBe('served');
    expect(orderService.statusOf({ Status: 'closed', KotStatus: 'served' })).toBe('served');
    expect(orderService.statusOf({ Status: 'settled', KotStatus: 'completed' })).toBe('served');
    // Closed before anything was cooked is still finished, not 'in the kitchen'.
    expect(orderService.statusOf({ Status: 'closed', KotStatus: null })).toBe('served');
  });

  it('a rejected round still reads as rejected, not as finished', () => {
    // 'cancelled' is in the till's CLOSED_STATUSES too, so order matters here.
    expect(orderService.statusOf({ Status: 'cancelled', KotStatus: 'ready' })).toBe('rejected');
  });
});

describe('dine.schemas — what a phone may send', () => {
  it('refuses a price, a table or a customer on an order', () => {
    const base = { items: [{ id: DISH, quantity: 1 }] };
    expect(schemas.placeOrderSchema.validate(base).error).toBeUndefined();
    expect(schemas.placeOrderSchema.validate({ ...base, TableId: 'x' }).error).toBeDefined();
    expect(schemas.placeOrderSchema.validate({
      items: [{ id: DISH, quantity: 1, price: 1 }],
    }).error).toBeDefined();
  });

  it('refuses an empty order and an absurd quantity', () => {
    expect(schemas.placeOrderSchema.validate({ items: [] }).error).toBeDefined();
    expect(schemas.placeOrderSchema.validate({ items: [{ id: DISH, quantity: 500 }] }).error).toBeDefined();
  });

  it('normalises the phone and refuses a malformed QR token', () => {
    expect(schemas.requestCodeSchema.validate({ phone: '98765 43210' }).value.phone).toBe('+919876543210');
    expect(schemas.requestCodeSchema.validate({ phone: '12345' }).error).toBeDefined();
    expect(schemas.tokenParamSchema.validate({ token: 'not-a-token' }).error).toBeDefined();
    expect(schemas.tokenParamSchema.validate({ token: 'a'.repeat(32) }).error).toBeUndefined();
  });
});

// ── Paying ends the meal ─────────────────────────────────────────────────────
// A diner token lives three hours with no server-side record, so before this a
// guest who had paid and walked out could still place rounds on a table staff
// considered finished.
describe('dine.sessionend — settling the bill ends the session', () => {
  const sessionEnd = require('../../modules/posdine/dine.sessionend.service');

  const conn = () => ({ execute: jest.fn() });

  it('stamps every table the bill\'s rounds sat at', async () => {
    const c = conn();
    c.execute
      .mockResolvedValueOnce([[{ TableId: 't1' }, { TableId: 't2' }]])
      .mockResolvedValueOnce([{ affectedRows: 2 }]);

    expect(await sessionEnd.endForOrders(c, ['o1', 'o2'], 'ten', '+91')).toBe(2);
    const [sql, params] = c.execute.mock.calls[1];
    expect(sql).toMatch(/UPDATE pos_table SET DinerSessionsEndedOn = NOW\(\)/i);
    expect(sql).toContain('IN (?, ?)');
    expect(params).toEqual(['+91', 'ten', 't1', 't2']);
  });

  it('a counter sale has no table and nothing to end', async () => {
    const c = conn();
    c.execute.mockResolvedValueOnce([[]]);
    expect(await sessionEnd.endForOrders(c, ['o1'], 'ten', '+91')).toBe(0);
    expect(c.execute).toHaveBeenCalledTimes(1);
  });

  it('never fails the settle — a paid bill is paid', async () => {
    const c = conn();
    c.execute.mockRejectedValue(new Error('deadlock'));
    await expect(sessionEnd.endForOrders(c, ['o1'], 'ten', '+91')).resolves.toBe(0);
  });

  it('a session opened BEFORE the settle is over', async () => {
    const c = conn();
    c.execute.mockResolvedValue([[{ DinerSessionsEndedOn: '2026-09-30T18:00:00Z' }]]);
    expect(await sessionEnd.isEnded(c, 't1', 'ten', new Date('2026-09-30T17:30:00Z'))).toBe(true);
  });

  // The next party sits down at the same table and scans the same printed card.
  it('a session opened AFTER it is live — the next party must not be locked out', async () => {
    const c = conn();
    c.execute.mockResolvedValue([[{ DinerSessionsEndedOn: '2026-09-30T18:00:00Z' }]]);
    expect(await sessionEnd.isEnded(c, 't1', 'ten', new Date('2026-09-30T18:20:00Z'))).toBe(false);
  });

  it('a table that has never been settled ends nobody', async () => {
    const c = conn();
    c.execute.mockResolvedValue([[{ DinerSessionsEndedOn: null }]]);
    expect(await sessionEnd.isEnded(c, 't1', 'ten', new Date())).toBe(false);
  });
});
