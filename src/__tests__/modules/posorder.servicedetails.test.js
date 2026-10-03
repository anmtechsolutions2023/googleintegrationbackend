// Covers, waiter and the printed-bill state on a table's rounds.
//
// The waiter is named by membership id and resolved on the server, because the
// name is printed on the guest's bill. These tests walk the real service with a
// fake connection that answers each statement the way MySQL would.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const WAITER = { Id: 'a1b2c3d4-1111-1111-1111-111111111111', Name: 'Ravi Kumar' };
const rounds = new Map();
let waiterRows = [WAITER];

const mockConn = {
  execute: jest.fn(async (q, params = []) => {
    const sql = String(q);
    if (/FROM user_tenants/.test(sql)) return [waiterRows];
    if (/^SELECT \* FROM pos_order WHERE Id = \?/.test(sql)) {
      const row = rounds.get(params[0]);
      return [row ? [row] : []];
    }
    if (/^\s*SELECT/i.test(sql)) return [[]];
    return [{ affectedRows: 1 }];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  executeQuery: jest.fn(),
}));
jest.mock('../../modules/positemmeta/positemmeta.repository', () => ({
  getInactiveItemMetaIds: jest.fn(async () => new Set()),
  getCostInfoIdsByItemMetaIds: jest.fn(async () => new Map()),
  getVariantPricesByIds: jest.fn(async () => new Map()),
  getAddonPricesByIds: jest.fn(async () => new Map()),
  getAddonRulesByItemMetaIds: jest.fn(async () => new Map()),
  getCategoryIdsByItemMetaIds: jest.fn(async () => new Map()),
}));
jest.mock('../../modules/poscategoryschedule/poscategoryschedule.service', () => {
  const actual = jest.requireActual('../../modules/poscategoryschedule/poscategoryschedule.service');
  return {
    availabilityOf: actual.availabilityOf,
    indexByCategory: actual.indexByCategory,
    getAllForTenant: jest.fn(async () => []),
    getTimeZone: jest.fn(async () => 'Asia/Kolkata'),
  };
});
jest.mock('../../modules/pricing/pricing.service', () => ({
  priceLines: jest.fn(),
  priceSnapshotLines: jest.fn(),
}));
jest.mock('../../modules/posorder/posNumbering', () => ({
  issuePosNumber: jest.fn(async () => 'ORD-0042'),
}));
jest.mock('../../modules/posorder/posVenue', () => ({
  resolveVenueTx: jest.fn(async () => ({
    TableName: 'G-1', FloorId: null, FloorName: null, TableCapacity: 4,
  })),
}));

const service = require('../../modules/posorder/posorder.service');
const { serviceDetailsSchema, createSchema } = require('../../modules/posorder/posorder.schemas');

const TENANT = 'tn';
const USER = '+919876543210';
const R1 = 'f1f1f1f1-0000-0000-0000-000000000001';
const R2 = 'f1f1f1f1-0000-0000-0000-000000000002';

/** Every SET_SERVICE write, as { id, GuestCount, WaiterId, WaiterName }. */
const serviceWrites = () => mockConn.execute.mock.calls
  .filter(([q]) => /SET GuestCount = \?/.test(String(q)))
  .map(([, p]) => ({ GuestCount: p[0], WaiterId: p[1], WaiterName: p[2], id: p[4] }));

beforeEach(() => {
  jest.clearAllMocks();
  waiterRows = [WAITER];
  rounds.clear();
  rounds.set(R1, {
    Id: R1, OrderNo: 'ORD-1', Status: 'fired', GuestCount: 2, WaiterId: null, WaiterName: null,
  });
  rounds.set(R2, {
    Id: R2, OrderNo: 'ORD-2', Status: 'open', GuestCount: 2, WaiterId: null, WaiterName: null,
  });
});

describe('the request shape', () => {
  it('needs guests or a waiter to change', () => {
    expect(serviceDetailsSchema.validate({ orderIds: [R1] }).error).toBeTruthy();
    expect(serviceDetailsSchema.validate({ orderIds: [R1], GuestCount: 3 }).error).toBeFalsy();
    expect(serviceDetailsSchema.validate({ orderIds: [R1], WaiterId: null }).error).toBeFalsy();
  });

  it('refuses no guests, a fraction of one, and a slipped key', () => {
    ['0', 0, 2.5, 5000].forEach((GuestCount) => {
      expect(serviceDetailsSchema.validate({ orderIds: [R1], GuestCount }).error).toBeTruthy();
    });
  });

  it('a round can be placed with covers and a waiter, and a blank waiter is none', () => {
    const { value, error } = createSchema.validate({ Items: [], GuestCount: 4, WaiterId: '' });
    expect(error).toBeFalsy();
    expect(value.GuestCount).toBe(4);
    expect(value.WaiterId).toBeNull();
  });
});

describe('placing a round with covers and a waiter', () => {
  it('stores the covers and the waiter\'s name as the server knows it', async () => {
    const created = await service.createRoundTx(mockConn, {
      TableId: null, OrderType: 'dinein', Items: [], GuestCount: 4, WaiterId: WAITER.Id,
    }, TENANT, USER);

    expect(serviceWrites()).toEqual([
      { GuestCount: 4, WaiterId: WAITER.Id, WaiterName: 'Ravi Kumar', id: 'mock-uuid' },
    ]);
    expect(created).toMatchObject({ GuestCount: 4, WaiterName: 'Ravi Kumar' });
  });

  it('refuses a waiter who is not an active member before numbering the round', async () => {
    waiterRows = [];
    await expect(service.createRoundTx(mockConn, {
      TableId: null, Items: [], WaiterId: WAITER.Id,
    }, TENANT, USER)).rejects.toThrow(/not an active member/);
    expect(mockConn.execute.mock.calls.some(([q]) => /INSERT INTO pos_order/.test(String(q))))
      .toBe(false);
  });

  it('writes nothing extra for a round that names neither', async () => {
    await service.createRoundTx(mockConn, { TableId: null, Items: [] }, TENANT, USER);
    expect(serviceWrites()).toEqual([]);
  });
});

describe('changing a running table', () => {
  it('assigns the waiter to every round and leaves each round\'s covers alone', async () => {
    await service.setServiceDetails({ orderIds: [R1, R2], WaiterId: WAITER.Id }, TENANT, USER);
    expect(serviceWrites()).toEqual([
      { GuestCount: 2, WaiterId: WAITER.Id, WaiterName: 'Ravi Kumar', id: R1 },
      { GuestCount: 2, WaiterId: WAITER.Id, WaiterName: 'Ravi Kumar', id: R2 },
    ]);
  });

  it('changes the covers without touching the waiter, and null clears them', async () => {
    rounds.set(R1, { ...rounds.get(R1), WaiterId: WAITER.Id, WaiterName: 'Ravi Kumar' });
    await service.setServiceDetails({ orderIds: [R1], GuestCount: null }, TENANT, USER);
    expect(serviceWrites()).toEqual([
      { GuestCount: null, WaiterId: WAITER.Id, WaiterName: 'Ravi Kumar', id: R1 },
    ]);
  });

  it('refuses the whole change when any round is already settled', async () => {
    rounds.set(R2, { ...rounds.get(R2), Status: 'closed' });
    await expect(service.setServiceDetails({ orderIds: [R1, R2], GuestCount: 5 }, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(serviceWrites()).toEqual([]);
  });
});

describe('printing the bill before payment', () => {
  it('stamps every round it was printed for', async () => {
    const res = await service.markBillPrinted([R1, R2], TENANT, USER);
    const stamped = mockConn.execute.mock.calls
      .filter(([q]) => /SET BillPrintedAt = NOW\(\)/.test(String(q)))
      .map(([, p]) => p[1]);
    expect(stamped).toEqual([R1, R2]);
    expect(res.orderIds).toEqual([R1, R2]);
  });

  it('refuses a round that is not there', async () => {
    await expect(service.markBillPrinted(['f1f1f1f1-0000-0000-0000-000000000009'], TENANT, USER))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
