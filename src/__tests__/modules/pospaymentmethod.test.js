// src/__tests__/modules/pospaymentmethod.test.js
//
// The resolve rule and the guards around changing it.
//
// The rule under test everywhere here: NO override row means inherit
// paymentmode.EnabledByDefault. It is what lets a brand-new outlet take Cash and
// UPI having written nothing, and a method added next year reach every existing
// branch with no backfill.

const mockConn = { execute: jest.fn(), release: jest.fn() };

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb, existing) => cb(existing || mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const service = require('../../modules/pospaymentmethod/pospaymentmethod.service');

const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const USER = '+919876543210';

// A provisioned tenant, as posMasters.provision leaves it: Cash and UPI on,
// Card and Wallet off but fully mapped, settlement off.
const CATALOGUE = [
  { Id: 'm-cash', Type: 'Cash', Active: 1, SortOrder: 1, RequiresReference: 0, EnabledByDefault: 1, AccountId: 'a-cash', AccountName: 'Cash', AccountKind: 'ASSET', BranchEnabled: null },
  { Id: 'm-upi', Type: 'UPI', Active: 1, SortOrder: 2, RequiresReference: 1, EnabledByDefault: 1, AccountId: 'a-bank', AccountName: 'Bank', AccountKind: 'ASSET', BranchEnabled: null },
  { Id: 'm-card', Type: 'Card', Active: 1, SortOrder: 3, RequiresReference: 1, EnabledByDefault: 0, AccountId: 'a-bank', AccountName: 'Bank', AccountKind: 'ASSET', BranchEnabled: null },
  { Id: 'm-zom', Type: 'Zomato Settlement', Active: 1, SortOrder: 5, RequiresReference: 0, EnabledByDefault: 0, AccountId: 'a-recv', AccountName: 'Aggregator Receivable', AccountKind: 'ASSET', BranchEnabled: null },
];

/**
 * Routes the three statements the service issues.
 * @param {Object} over - { rows } to replace the resolved catalogue.
 */
const route = (over = {}) => {
  const rows = over.rows || CATALOGUE;
  mockConn.execute.mockImplementation((q, params) => {
    if (/LEFT JOIN pos_branch_payment_method/i.test(q)) return Promise.resolve([rows]);
    if (/SELECT Id, Type, Active, EnabledByDefault FROM paymentmode/i.test(q)) {
      const ids = params.slice(1);
      return Promise.resolve([rows.filter((r) => ids.includes(r.Id))]);
    }
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const sql = (re) => mockConn.execute.mock.calls.filter(([q]) => re.test(q));

afterEach(() => jest.clearAllMocks());

describe('resolving what an outlet accepts', () => {
  it('a branch that has never been configured gets Cash and UPI, and nothing else', async () => {
    route();
    const { methods } = await service.listForBranch(BRANCH, TENANT);

    const on = methods.filter((m) => m.enabled).map((m) => m.type);
    expect(on).toEqual(['Cash', 'UPI']);
    expect(methods.every((m) => m.source === 'default')).toBe(true);
  });

  it('returns the WHOLE catalogue, not just what is on', async () => {
    route();
    const { methods } = await service.listForBranch(BRANCH, TENANT);
    // The config screen needs the off rows in order to offer them.
    expect(methods).toHaveLength(4);
    expect(methods.find((m) => m.type === 'Card').enabled).toBe(false);
  });

  it('a branch override wins over the default, in both directions', async () => {
    route({ rows: [
      { ...CATALOGUE[0], BranchEnabled: 0 },  // Cash off here
      { ...CATALOGUE[2], BranchEnabled: 1 },  // Card on here
    ]});
    const { methods } = await service.listForBranch(BRANCH, TENANT);

    expect(methods.find((m) => m.type === 'Cash')).toMatchObject({ enabled: false, source: 'branch' });
    expect(methods.find((m) => m.type === 'Card')).toMatchObject({ enabled: true, source: 'branch' });
  });

  it('carries the account and the reference rule through to the till', async () => {
    route();
    const { methods } = await service.listForBranch(BRANCH, TENANT);
    const upi = methods.find((m) => m.type === 'UPI');

    // The account is what stops a counter sale settling to a receivable.
    expect(upi.accountName).toBe('Bank');
    // Property of the METHOD, not of its name.
    expect(upi.requiresReference).toBe(true);
    expect(methods.find((m) => m.type === 'Cash').requiresReference).toBe(false);
  });

  it('offers portal settlement to nobody by default', async () => {
    route();
    const { methods } = await service.listForBranch(BRANCH, TENANT);
    // Costs portal settlement nothing: pos_portal.SettlementPaymentModeId names
    // its tender directly and never consults this list.
    expect(methods.find((m) => m.type === 'Zomato Settlement').enabled).toBe(false);
  });
});

describe('saving an outlet\'s decisions', () => {
  it('stores a row only when it differs from the tenant default', async () => {
    route();
    await service.save(BRANCH, TENANT, [{ paymentModeId: 'm-card', enabled: true }], USER);

    expect(sql(/INSERT INTO pos_branch_payment_method/i)).toHaveLength(1);
    expect(sql(/DELETE FROM pos_branch_payment_method/i)).toHaveLength(0);
  });

  it('DELETES the override when a branch is set back to the default', async () => {
    route({ rows: [{ ...CATALOGUE[0] }, { ...CATALOGUE[2], BranchEnabled: 1 }] });
    // Card's default is off; asking for off again means "inherit", not "store off".
    await service.save(BRANCH, TENANT, [{ paymentModeId: 'm-card', enabled: false }], USER);

    expect(sql(/DELETE FROM pos_branch_payment_method/i)).toHaveLength(1);
    expect(sql(/INSERT INTO pos_branch_payment_method/i)).toHaveLength(0);
  });

  it('leaves a method the request did not name exactly as it was', async () => {
    route();
    await service.save(BRANCH, TENANT, [{ paymentModeId: 'm-card', enabled: true }], USER);

    const written = [...sql(/INSERT INTO pos_branch_payment_method/i), ...sql(/DELETE FROM pos_branch_payment_method/i)];
    expect(written).toHaveLength(1);
    expect(written[0][1]).toContain('m-card');
  });

  it('refuses a save that would leave the outlet unable to take money', async () => {
    route({ rows: [CATALOGUE[0], { ...CATALOGUE[1], EnabledByDefault: 0 }] });
    // Cash is the only thing on; switching it off leaves nothing.
    await expect(
      service.save(BRANCH, TENANT, [{ paymentModeId: 'm-cash', enabled: false }], USER),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(sql(/INSERT INTO pos_branch_payment_method/i)).toHaveLength(0);
  });

  it('allows switching one off while another stays on', async () => {
    route();
    await expect(
      service.save(BRANCH, TENANT, [{ paymentModeId: 'm-cash', enabled: false }], USER),
    ).resolves.toBeDefined();
  });

  it('refuses an id that is not this tenant\'s method', async () => {
    route();
    await expect(
      service.save(BRANCH, TENANT, [{ paymentModeId: 'm-someone-else', enabled: true }], USER),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(sql(/INSERT INTO pos_branch_payment_method/i)).toHaveLength(0);
  });

  it('never interpolates ids into the lookup SQL', async () => {
    route();
    await service.save(BRANCH, TENANT, [
      { paymentModeId: 'm-card', enabled: true },
      { paymentModeId: 'm-cash', enabled: false },
    ], USER);

    const [q, params] = sql(/FROM paymentmode WHERE TenantId = \? AND Id IN/i)[0];
    expect(q).toContain('IN (?, ?)');
    expect(q).not.toContain('m-card');
    expect(params).toEqual([TENANT, 'm-card', 'm-cash']);
  });
});

describe('enabledAfter — what the guard actually counts', () => {
  const resolved = [
    { paymentModeId: 'a', enabled: true, active: true },
    { paymentModeId: 'b', enabled: false, active: true },
    { paymentModeId: 'c', enabled: true, active: false },
  ];

  it('an inactive method cannot be what keeps a till alive', () => {
    // 'c' is enabled for the branch but deactivated in the catalogue, so it is
    // not offered and must not count towards the minimum.
    expect(service.enabledAfter(resolved, new Map([['a', false]]))).toHaveLength(0);
  });

  it('counts a pending change over the stored state', () => {
    expect(service.enabledAfter(resolved, new Map([['b', true]])).map((m) => m.paymentModeId))
      .toEqual(['a', 'b']);
  });
});
