// src/__tests__/modules/pos.pricing.test.js
// Phase 3: POS orders and bills are priced by the server.
//
// The two rules under test are the ones a hand-rolled till gets wrong:
//   * a bill spans every round of a session, not just the first;
//   * a discount reduces the taxable base rather than an already-taxed total.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const mockConnection = {
  execute: jest.fn(),
  query: jest.fn(),
  release: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConnection)),
  withTransaction: jest.fn(async (cb) => cb(mockConnection)),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

const TENANT = 'tenant-1';
const USER = 'cashier@test.com';
const META_A = 'meta-a';
const CI_A = 'ci-a';

const GST18_ROWS = (costInfoId, amount = '100', included = 0) => [
  { CostInfoId: costInfoId, Amount: amount, IsTaxIncluded: included, TaxGroupId: 'tg1', TaxGroupName: 'GST18', TaxTypeId: 'c1', TaxTypeName: 'CGST', TaxTypeValue: '9' },
  { CostInfoId: costInfoId, Amount: amount, IsTaxIncluded: included, TaxGroupId: 'tg1', TaxGroupName: 'GST18', TaxTypeId: 's1', TaxTypeName: 'SGST', TaxTypeValue: '9' },
];

const orderService = require('../../modules/posorder/posorder.service');
const billService = require('../../modules/posbill/posbill.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockConnection.query.mockResolvedValue([[]]);
});

describe('POS order — server-authoritative totals', () => {
  const routeOrder = ({ amount = '100', included = 0 } = {}) => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_item_meta WHERE TenantId/i.test(sql)) {
        return Promise.resolve([[{ Id: META_A, CostInfoId: CI_A }]]);
      }
      if (/FROM costinfo ci/i.test(sql)) {
        return Promise.resolve([GST18_ROWS(CI_A, amount, included)]);
      }
      if (/^SELECT/i.test(sql.trim())) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };

  // Bind positions of POS_ORDER.INSERT, by name. Named rather than indexed
  // because every column added to pos_order shifts the ones after it, and a
  // test that asserts on params[7] fails for a reason that has nothing to do
  // with what it is testing.
  const ORDER_COL = {
    Items: 8, SubTotal: 9, TaxAmount: 10, Total: 11,
  };
  const insertedParams = () =>
    mockConnection.execute.mock.calls.find(([sql]) => /INSERT INTO pos_order/i.test(sql))[1];
  const inserted = (name) => insertedParams()[ORDER_COL[name]];

  it('ignores client totals and recomputes from the tax chain', async () => {
    routeOrder();
    await orderService.create(
      {
        OrderNo: 'ORD-1',
        Items: [{ id: META_A, qty: 2 }],
        // Deliberately wrong — a client must not be able to under-declare tax.
        SubTotal: 999, TaxAmount: 0, Total: 999,
      },
      TENANT,
      USER,
    );

    expect(inserted('SubTotal')).toBe(200);  // net
    expect(inserted('TaxAmount')).toBe(36);   // 18% of 200
    expect(inserted('Total')).toBe(236);
  });

  it('stamps each line with a priced snapshot', async () => {
    routeOrder();
    await orderService.create(
      { OrderNo: 'ORD-1', Items: [{ id: META_A, qty: 2 }] },
      TENANT,
      USER,
    );

    const items = JSON.parse(inserted('Items'));
    expect(items[0]).toMatchObject({
      costInfoId: CI_A, netAmount: 200, taxAmount: 36, grossAmount: 236, taxPct: 18,
    });
    // The component split is what an invoice footer is built from.
    expect(items[0].taxComponents.map((c) => c.name)).toEqual(['CGST', 'SGST']);
  });

  it('resolves costInfoId from the menu row when the client omits it', async () => {
    routeOrder();
    await orderService.create(
      { OrderNo: 'ORD-1', Items: [{ id: META_A, qty: 1 }] },
      TENANT,
      USER,
    );
    expect(
      mockConnection.execute.mock.calls.some(([sql]) =>
        /FROM pos_item_meta WHERE TenantId/i.test(sql)),
    ).toBe(true);
    expect(inserted('TaxAmount')).toBe(18);
  });

  it('handles tax-inclusive menu prices', async () => {
    routeOrder({ included: 1 });
    await orderService.create(
      { OrderNo: 'ORD-1', Items: [{ id: META_A, qty: 1 }] },
      TENANT,
      USER,
    );
    expect(inserted('SubTotal')).toBe(84.75); // net peeled out
    expect(inserted('TaxAmount')).toBe(15.25);
    expect(inserted('Total')).toBe(100);      // gross is the menu price
  });

  it('leaves an order with no priceable lines alone', async () => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_item_meta WHERE TenantId/i.test(sql)) return Promise.resolve([[]]);
      if (/^SELECT/i.test(sql.trim())) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    await orderService.create(
      { OrderNo: 'ORD-1', Items: [{ id: 'unknown', qty: 1 }], SubTotal: 50, TaxAmount: 0, Total: 50 },
      TENANT,
      USER,
    );
    expect(inserted('SubTotal')).toBe(50); // client value preserved
  });
});

describe('POS order — variants surcharge the line', () => {
  const VAR_LG = 'var-lg';

  const routeWithVariants = () => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_item_meta WHERE TenantId/i.test(sql)) {
        return Promise.resolve([[{ Id: META_A, CostInfoId: CI_A }]]);
      }
      if (/FROM pos_variant WHERE TenantId/i.test(sql)) {
        return Promise.resolve([[{ Id: VAR_LG, Name: 'Large', Code: 'LG', Price: '30' }]]);
      }
      if (/FROM costinfo ci/i.test(sql)) {
        return Promise.resolve([GST18_ROWS(CI_A)]);
      }
      if (/^SELECT/i.test(sql.trim())) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };

  // Bind positions of POS_ORDER.INSERT, by name. Named rather than indexed
  // because every column added to pos_order shifts the ones after it, and a
  // test that asserts on params[7] fails for a reason that has nothing to do
  // with what it is testing.
  const ORDER_COL = {
    Items: 8, SubTotal: 9, TaxAmount: 10, Total: 11,
  };
  const insertedParams = () =>
    mockConnection.execute.mock.calls.find(([sql]) => /INSERT INTO pos_order/i.test(sql))[1];
  const inserted = (name) => insertedParams()[ORDER_COL[name]];

  it('taxes base + variant as one price', async () => {
    routeWithVariants();
    await orderService.create(
      { OrderNo: 'ORD-1', Items: [{ id: META_A, qty: 1, variantIds: [VAR_LG] }] },
      TENANT, USER,
    );
    expect(inserted('SubTotal')).toBe(130);   // net = 100 + 30
    expect(inserted('TaxAmount')).toBe(23.4);  // 18% of 130, not 18 + separate variant tax
    expect(inserted('Total')).toBe(153.4);
  });

  it('stores the chosen variants on the line for reprints and repeat orders', async () => {
    routeWithVariants();
    await orderService.create(
      { OrderNo: 'ORD-1', Items: [{ id: META_A, qty: 1, variantIds: [VAR_LG] }] },
      TENANT, USER,
    );
    const line = JSON.parse(inserted('Items'))[0];
    expect(line.variants).toEqual([{ id: VAR_LG, name: 'Large', code: 'LG', price: 30 }]);
    expect(line.basePrice).toBe(100);
    expect(line.variantAmount).toBe(30);
    expect(line.price).toBe(130);
  });

  it('accepts a repeat order that carries resolved variant objects', async () => {
    routeWithVariants();
    // Re-ordering a previous round hands back `variants`, not `variantIds`.
    await orderService.create(
      {
        OrderNo: 'ORD-2',
        Items: [{ id: META_A, qty: 1, variants: [{ id: VAR_LG, name: 'Large', price: 30 }] }],
      },
      TENANT, USER,
    );
    expect(inserted('SubTotal')).toBe(130);
  });

  it('keeps the same item with different variants as separate lines', async () => {
    routeWithVariants();
    await orderService.create(
      {
        OrderNo: 'ORD-1',
        Items: [
          { id: META_A, qty: 1, variantIds: [VAR_LG] },
          { id: META_A, qty: 1 },
        ],
      },
      TENANT, USER,
    );
    const items = JSON.parse(inserted('Items'));
    expect(items).toHaveLength(2);
    expect(items[0].price).toBe(130);
    expect(items[1].price).toBe(100); // same menu id, no variant, own price
    expect(inserted('SubTotal')).toBe(230);
  });
});

describe('POS bill — spans every round, discount before tax', () => {
  // Two rounds of the same session, each already priced by the order service.
  const ROUND_1 = [{ id: 'l1', costInfoId: CI_A, price: 100, qty: 1, isTaxIncluded: false,
    taxComponents: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] }];
  const ROUND_2 = [{ id: 'l2', costInfoId: CI_A, price: 50, qty: 1, isTaxIncluded: false,
    taxComponents: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] }];

  const routeBill = () => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_order WHERE TenantId/i.test(sql)) {
        return Promise.resolve([[
          { Id: 'o1', Items: JSON.stringify(ROUND_1) },
          { Id: 'o2', Items: JSON.stringify(ROUND_2) },
        ]]);
      }
      if (/FROM pos_bill_order/i.test(sql)) {
        return Promise.resolve([[{ OrderId: 'o1' }, { OrderId: 'o2' }]]);
      }
      if (/^SELECT/i.test(sql.trim())) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };

  const billParams = () =>
    mockConnection.execute.mock.calls.find(([sql]) => /INSERT INTO pos_bill /i.test(sql))[1];

  it('totals every round, not just the first', async () => {
    routeBill();
    const result = await billService.create(
      { BillNo: 'B-1', OrderIds: ['o1', 'o2'] }, TENANT, USER,
    );
    // 100 + 50 = 150 net, not 100.
    expect(result.SubTotal).toBe(150);
    expect(result.TaxAmount).toBe(27);
    expect(result.Total).toBe(177);
  });

  it('links the bill to all of its orders', async () => {
    routeBill();
    await billService.create({ BillNo: 'B-1', OrderIds: ['o1', 'o2'] }, TENANT, USER);
    const links = mockConnection.execute.mock.calls.filter(
      ([sql]) => /INSERT INTO pos_bill_order/i.test(sql),
    );
    expect(links).toHaveLength(2);
  });

  it('keeps OrderId as the first round for backward compatibility', async () => {
    routeBill();
    await billService.create({ BillNo: 'B-1', OrderIds: ['o1', 'o2'] }, TENANT, USER);
    expect(billParams()[3]).toBe('o1');
  });

  it('applies the discount BEFORE tax', async () => {
    routeBill();
    const result = await billService.create(
      { BillNo: 'B-1', OrderIds: ['o1', 'o2'], Discount: 30 }, TENANT, USER,
    );
    // Tax is charged on 120, not on 150 — the old flow taxed 150 then
    // subtracted 30, leaving 147 payable instead of 141.60.
    expect(result.SubTotal).toBe(120);
    expect(result.TaxAmount).toBe(21.6);
    expect(result.Total).toBe(141.6);
  });

  it('returns a per-component footer for the printed bill', async () => {
    routeBill();
    const result = await billService.create(
      { BillNo: 'B-1', OrderIds: ['o1', 'o2'] }, TENANT, USER,
    );
    const sum = result.TaxByComponent.reduce((s, c) => s + c.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(result.TaxAmount);
    expect(result.TaxByComponent.map((c) => c.name).sort()).toEqual(['CGST', 'SGST']);
  });

  it('accepts a single OrderId (older callers)', async () => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_order WHERE TenantId/i.test(sql)) {
        return Promise.resolve([[{ Id: 'o1', Items: JSON.stringify(ROUND_1) }]]);
      }
      if (/^SELECT/i.test(sql.trim())) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const result = await billService.create({ BillNo: 'B-1', OrderId: 'o1' }, TENANT, USER);
    expect(result.SubTotal).toBe(100);
  });

  it('prices from the order snapshot, not from live rates', async () => {
    // The chain query must never be consulted when assembling a bill: a tax
    // group edited mid-session must not restate a bill being settled.
    routeBill();
    await billService.create({ BillNo: 'B-1', OrderIds: ['o1', 'o2'] }, TENANT, USER);
    expect(
      mockConnection.execute.mock.calls.some(([sql]) => /FROM costinfo ci/i.test(sql)),
    ).toBe(false);
  });

  it('leaves a bill with no linked orders to the caller values', async () => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_order WHERE TenantId/i.test(sql)) return Promise.resolve([[]]);
      if (/^SELECT/i.test(sql.trim())) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const result = await billService.create(
      { BillNo: 'B-1', OrderIds: ['o1'], SubTotal: 42, TaxAmount: 0, Total: 42 },
      TENANT, USER,
    );
    expect(result.SubTotal).toBe(42);
  });
});
