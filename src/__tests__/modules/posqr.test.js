// The staff side of QR table ordering: settings, codes, the review queue, and
// the permissions and documentation that surround them.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockState;
const mockExecuted = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    const s = String(sql);
    mockExecuted.push({ sql: s, params });
    if (/FOR UPDATE/.test(s)) return [mockState.decisionRow ? [mockState.decisionRow] : []];
    if (/FROM pos_rejection_reason\s+WHERE Id = \?/.test(s)) return [mockState.reasonKnown ? [{ Id: 'r1' }] : []];
    if (/SET Status = 'cancelled'/.test(s)) return [{ affectedRows: 1 }];
    if (/FROM pos_table t/.test(s) && /WHERE t.Id = \?/.test(s)) return [mockState.table ? [mockState.table] : []];
    if (/FROM pos_table t/.test(s)) return [mockState.branchTables];
    if (/UPDATE pos_table_qr/.test(s)) return [{ affectedRows: mockState.hasCode ? 1 : 0 }];
    return [{ affectedRows: 1 }];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
  withTransaction: async (cb) => cb(mockConn),
}));
jest.mock('../../modules/posorder/posorder.service', () => ({
  fireKot: jest.fn(async () => ({ KotId: 'kot-1', AlreadySent: false })),
}));
jest.mock('../../modules/posorder/posorder.transfer', () => ({
  refreshTable: jest.fn(async () => {}),
}));

const { fromStored } = require('../../modules/posqr/posqr.settings.service');
const ordersService = require('../../modules/posqr/posqr.orders.service');
const codesService = require('../../modules/posqr/posqr.codes.service');
const { generateToken, isWellFormed } = require('../../modules/posqr/posqr.token');
const posOrderService = require('../../modules/posorder/posorder.service');
const { refreshTable } = require('../../modules/posorder/posorder.transfer');
const { SCOPES, SCOPE_SETS } = require('../../config/constants');

const pendingQrRow = (over = {}) => ({
  Id: 'order-1', Status: 'open', TableId: 'table-4', ChannelCode: 'QR', LiveKots: 0, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuted.length = 0;
  mockState = {
    decisionRow: pendingQrRow(),
    reasonKnown: true,
    table: { TableId: 'table-4', TableName: 'T4', BranchDetailId: 'branch-1' },
    branchTables: [],
    hasCode: true,
  };
});

describe('posqr.settings — no row means OFF', () => {
  it('defaults to off, order mode', () => {
    expect(fromStored({})).toEqual({ enabled: false, mode: 'order', canOrder: false });
  });
  it('can order only when on AND in order mode', () => {
    expect(fromStored({ 'qr.ordering.enabled': 'true' }).canOrder).toBe(true);
    expect(fromStored({ 'qr.ordering.enabled': 'true', 'qr.ordering.mode': 'menu' }).canOrder).toBe(false);
  });
  it('ignores a mode it does not know', () => {
    expect(fromStored({ 'qr.ordering.mode': 'free-for-all' }).mode).toBe('order');
  });
});

describe('posqr.token', () => {
  it('is 128 bits of hex and never repeats in practice', () => {
    const a = generateToken();
    expect(isWellFormed(a)).toBe(true);
    expect(a).toHaveLength(32);
    expect(generateToken()).not.toBe(a);
  });
});

describe('posqr.codes — issuing lazily', () => {
  it('issues a code for every table without one, in one call', async () => {
    mockState.branchTables = [
      { TableId: 't1', TableName: 'T1', Token: null },
      { TableId: 't2', TableName: 'T2', Token: 'a'.repeat(32) },
    ];
    const res = await codesService.listForBranch('branch-1', 'tenant-1', '+91');
    expect(res.issued).toBe(1);
    const inserts = mockExecuted.filter((e) => /INSERT INTO pos_table_qr/.test(e.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[2]).toBe('t1');
  });

  it('refuses to rotate a table that does not exist', async () => {
    mockState.table = null;
    await expect(codesService.rotate('nope', 'tenant-1', '+91')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('posqr.orders — accept and reject', () => {
  it('accept fires the KOT through the till\'s send-once path', async () => {
    const res = await ordersService.accept('order-1', 'tenant-1', '+91cashier');
    expect(posOrderService.fireKot).toHaveBeenCalledWith('order-1', {}, 'tenant-1', '+91cashier');
    expect(res.kot.KotId).toBe('kot-1');
  });

  it('refuses to accept a round that is not a QR order', async () => {
    mockState.decisionRow = pendingQrRow({ ChannelCode: 'DINEIN' });
    await expect(ordersService.accept('order-1', 'tenant-1', '+91')).rejects.toMatchObject({ statusCode: 409 });
    expect(posOrderService.fireKot).not.toHaveBeenCalled();
  });

  it('refuses to decide a round that already has a ticket', async () => {
    mockState.decisionRow = pendingQrRow({ LiveKots: 1 });
    await expect(ordersService.reject('order-1', { reasonId: 'r1' }, 'tenant-1', '+91'))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('reject cancels with the reason and frees the table', async () => {
    await ordersService.reject('order-1', { reasonId: 'r1', note: 'Out of paneer' }, 'tenant-1', '+91');
    const update = mockExecuted.find((e) => /SET Status = 'cancelled'/.test(e.sql));
    expect(update.params).toEqual(['r1', 'Out of paneer', '+91', 'order-1', 'tenant-1']);
    expect(refreshTable).toHaveBeenCalledWith(mockConn, 'table-4', 'tenant-1', '+91');
  });

  it('reject refuses a reason outside the house list', async () => {
    mockState.reasonKnown = false;
    await expect(ordersService.reject('order-1', { reasonId: 'x' }, 'tenant-1', '+91'))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('permissions — who may do what', () => {
  it('lets floor staff with POS_ORDER:WRITE decide orders without POS_QR', () => {
    expect(SCOPE_SETS.POS_QR_ORDER_DECIDE).toContain(SCOPES.POS_ORDER_WRITE);
    expect(SCOPE_SETS.POS_QR_ORDER_DECIDE).toContain(SCOPES.POS_QR_WRITE);
  });
  it('keeps code management on POS_QR alone — menu setup does not grant it', () => {
    expect(SCOPE_SETS.POS_QR_MANAGE).not.toContain(SCOPES.POS_CONFIG_WRITE);
    expect(SCOPE_SETS.POS_QR_MANAGE).not.toContain(SCOPES.POS_ORDER_WRITE);
    expect(SCOPE_SETS.POS_QR_MANAGE).toContain(SCOPES.POS_QR_WRITE);
  });
});

describe('swagger — the QR surfaces are documented', () => {
  const spec = require('../../config/swagger');
  const qrRoutes = require('../../modules/posqr/posqr.routes');
  const dineRoutes = require('../../modules/posdine/dine.routes');

  const served = (router, prefix) => router.stack
    .filter((l) => l.route)
    .flatMap((l) => Object.keys(l.route.methods).map((m) => [
      `${prefix}${l.route.path}`.replace(/:(\w+)/g, '{$1}'), m,
    ]));

  it('documents every route the staff and guest routers serve', () => {
    const missing = [
      ...served(qrRoutes, '/api/pos/qr'),
      ...served(dineRoutes, '/api/dine'),
    ].filter(([path, method]) => !spec.paths[path] || !spec.paths[path][method]);
    expect(missing).toEqual([]);
  });

  it('resolves every schema the QR docs reference', () => {
    const schemas = spec.components.schemas;
    const text = JSON.stringify(require('../../config/swagger.qrOrdering'));
    const refs = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]);
    expect(refs.filter((r) => !schemas[r])).toEqual([]);
  });
});
