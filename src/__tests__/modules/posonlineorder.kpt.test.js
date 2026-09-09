// src/__tests__/modules/posonlineorder.kpt.test.js
// Kitchen Preparation Time — the number we promise a portal on accept.
//
// This is the one field on an accept that a merchant RATING is scored against,
// and every way it can go wrong is quiet:
//
//   * resolving to 0 tells the portal the food is already made;
//   * resolving to nothing at all leaves a NULL where a promise belongs;
//   * AVG or SUM across the lines answers the wrong question — the kitchen is
//     not finished until its SLOWEST dish is;
//   * a typo (200 for 20) shows the customer an absurd wait either way.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const { KPT, QUERIES, POS_SETTING_KEYS } = require('../../config/constants');
const kpt = require('../../modules/posonlineorder/posonlineorder.kpt');
const { resolveKpt, clamp, getSlowestLineTx, getBranchDefaultTx, decideKptTx } = kpt;

const TENANT = 'tenant-1';
const BRANCH = 'branch-1';

beforeEach(() => jest.clearAllMocks());

describe('choosing the number — priority order', () => {
  it('prefers what the person at the pass typed', () => {
    expect(resolveKpt({ explicit: 12, slowestLine: 30, branchDefault: 25 }))
      .toEqual({ minutes: 12, source: 'explicit' });
  });

  it('falls back to the slowest dish on the order', () => {
    expect(resolveKpt({ slowestLine: 30, branchDefault: 25 }))
      .toEqual({ minutes: 30, source: 'slowest-line' });
  });

  it('then to the branch default', () => {
    expect(resolveKpt({ branchDefault: 25 }))
      .toEqual({ minutes: 25, source: 'branch-default' });
  });

  // Never NULL. A missing KPT is a promise nobody made.
  it('always lands on a real number, never nothing', () => {
    expect(resolveKpt({})).toEqual({ minutes: KPT.DEFAULT_MINUTES, source: 'platform-default' });
    expect(resolveKpt()).toEqual({ minutes: KPT.DEFAULT_MINUTES, source: 'platform-default' });
  });
});

describe('values that must not be treated as an answer', () => {
  // Zero would tell the portal the food is already made.
  it.each([
    ['zero', 0],
    ['null', null],
    ['undefined', undefined],
    ['a negative', -5],
    ['a non-number', 'twenty'],
    ['NaN', NaN],
  ])('%s falls through rather than becoming the KPT', (_label, value) => {
    const r = resolveKpt({ explicit: value, slowestLine: 30 });
    expect(r).toEqual({ minutes: 30, source: 'slowest-line' });
  });

  it('falls all the way to the platform default when every input is unusable', () => {
    expect(resolveKpt({ explicit: 0, slowestLine: null, branchDefault: 'abc' }))
      .toEqual({ minutes: KPT.DEFAULT_MINUTES, source: 'platform-default' });
  });
});

describe('clamping a mistyped promise', () => {
  it('holds a sane value unchanged', () => {
    expect(clamp(20)).toBe(20);
  });

  // 200 is a typo for 20. Clamped, not rejected — an accept must not fail over
  // a number the till can obviously correct.
  it('caps an absurd wait instead of failing the accept', () => {
    expect(clamp(200)).toBe(KPT.MAX_MINUTES);
    expect(resolveKpt({ explicit: 500 }).minutes).toBe(KPT.MAX_MINUTES);
  });

  it('never returns below the floor', () => {
    expect(clamp(0.4)).toBe(KPT.MIN_MINUTES);
  });

  it('rounds rather than storing a fractional minute', () => {
    expect(clamp(12.6)).toBe(13);
  });
});

describe('reading the slowest line', () => {
  const conn = { execute: jest.fn() };

  it('asks for MAX, not AVG or SUM — the kitchen finishes with its last dish', () => {
    expect(QUERIES.POS_ONLINE_ORDER.SELECT_MAX_PREP_TIME).toMatch(/MAX\(PrepTimeMinutes\)/);
    expect(QUERIES.POS_ONLINE_ORDER.SELECT_MAX_PREP_TIME).not.toMatch(/AVG\(|SUM\(/);
  });

  it('ignores lines with no prep time rather than counting them as zero', () => {
    expect(QUERIES.POS_ONLINE_ORDER.SELECT_MAX_PREP_TIME).toMatch(/PrepTimeMinutes IS NOT NULL/);
  });

  it('scopes the read to the tenant', async () => {
    conn.execute.mockResolvedValue([[{ MaxPrep: 18 }]]);
    await getSlowestLineTx(conn, ['im1', 'im2'], TENANT);
    const [, params] = conn.execute.mock.calls[0];
    expect(params[0]).toBe(TENANT);
  });

  it('does not query at all for an order with no resolvable lines', async () => {
    conn.execute.mockClear();
    await expect(getSlowestLineTx(conn, [], TENANT)).resolves.toBeNull();
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it('de-duplicates ids so one placeholder is bound per distinct dish', async () => {
    conn.execute.mockResolvedValue([[{ MaxPrep: 10 }]]);
    await getSlowestLineTx(conn, ['im1', 'im1', 'im2'], TENANT);
    const [sql, params] = conn.execute.mock.calls[0];
    expect((sql.match(/\?/g) || []).length).toBe(params.length);
    expect(params).toEqual([TENANT, 'im1', 'im2']);
  });

  it('reports null when no line carries a time', async () => {
    conn.execute.mockResolvedValue([[{ MaxPrep: null }]]);
    await expect(getSlowestLineTx(conn, ['im1'], TENANT)).resolves.toBeNull();
  });
});

describe('reading the branch default', () => {
  const conn = { execute: jest.fn() };

  it('asks for the documented setting key', async () => {
    conn.execute.mockResolvedValue([[{ SettingValue: '25' }]]);
    await getBranchDefaultTx(conn, BRANCH, TENANT);
    expect(conn.execute).toHaveBeenCalledWith(
      QUERIES.POS_SETTING.SELECT_VALUE,
      [TENANT, BRANCH, POS_SETTING_KEYS.KPT_DEFAULT_MINUTES],
    );
  });

  it('reads the stored string as a number', async () => {
    conn.execute.mockResolvedValue([[{ SettingValue: '25' }]]);
    await expect(getBranchDefaultTx(conn, BRANCH, TENANT)).resolves.toBe(25);
  });

  // "twenty" must not become NaN minutes on a live order.
  it('ignores a value somebody typed as words', async () => {
    conn.execute.mockResolvedValue([[{ SettingValue: 'twenty' }]]);
    await expect(getBranchDefaultTx(conn, BRANCH, TENANT)).resolves.toBeNull();
  });

  it.each([['no row', []], ['an empty value', [{ SettingValue: '' }]]])(
    'reports null for %s',
    async (_label, rows) => {
      conn.execute.mockResolvedValue([rows]);
      await expect(getBranchDefaultTx(conn, BRANCH, TENANT)).resolves.toBeNull();
    },
  );

  it('does not query when the order has no branch', async () => {
    conn.execute.mockClear();
    await expect(getBranchDefaultTx(conn, null, TENANT)).resolves.toBeNull();
    expect(conn.execute).not.toHaveBeenCalled();
  });
});

describe('deciding on the caller connection', () => {
  const conn = { execute: jest.fn() };

  // The lookups exist to SUGGEST a number. Once one is given there is nothing
  // to suggest, and two queries on the accept hot path would be wasted.
  it('skips both reads when the user supplied a value', async () => {
    conn.execute.mockClear();
    const r = await decideKptTx(conn, {
      explicit: 15, itemMetaIds: ['im1'], branchDetailId: BRANCH, tenantId: TENANT,
    });
    expect(r).toEqual({ minutes: 15, source: 'explicit' });
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it('uses the slowest dish when nothing was supplied', async () => {
    conn.execute.mockImplementation(async (sql) => {
      if (String(sql).includes('MAX(PrepTimeMinutes)')) return [[{ MaxPrep: 35 }]];
      return [[{ SettingValue: '20' }]];
    });
    const r = await decideKptTx(conn, {
      itemMetaIds: ['im1'], branchDetailId: BRANCH, tenantId: TENANT,
    });
    expect(r).toEqual({ minutes: 35, source: 'slowest-line' });
  });

  it('uses the branch default when no dish carries a time', async () => {
    conn.execute.mockImplementation(async (sql) => {
      if (String(sql).includes('MAX(PrepTimeMinutes)')) return [[{ MaxPrep: null }]];
      return [[{ SettingValue: '22' }]];
    });
    const r = await decideKptTx(conn, {
      itemMetaIds: ['im1'], branchDetailId: BRANCH, tenantId: TENANT,
    });
    expect(r).toEqual({ minutes: 22, source: 'branch-default' });
  });

  it('still produces a promise when the branch is unconfigured too', async () => {
    conn.execute.mockImplementation(async (sql) => {
      if (String(sql).includes('MAX(PrepTimeMinutes)')) return [[{ MaxPrep: null }]];
      return [[]];
    });
    const r = await decideKptTx(conn, {
      itemMetaIds: ['im1'], branchDetailId: BRANCH, tenantId: TENANT,
    });
    expect(r).toEqual({ minutes: KPT.DEFAULT_MINUTES, source: 'platform-default' });
  });
});

describe('the accept statement', () => {
  // The number and the moment it was given are two halves of one promise. A
  // second statement could commit one without the other.
  it('writes KptMinutes and KptSetOn in the same UPDATE that accepts', () => {
    const sql = QUERIES.POS_ONLINE_ORDER.SET_ACCEPTED;
    expect(sql).toMatch(/KptMinutes = \?/);
    expect(sql).toMatch(/KptSetOn = NOW\(\)/);
    expect(sql).toMatch(/Status = 'accepted'/);
  });

  it('is scoped by id AND tenant', () => {
    expect(QUERIES.POS_ONLINE_ORDER.SET_ACCEPTED).toMatch(/WHERE Id = \? AND TenantId = \?$/);
  });

  it('binds its parameters in the order the statement declares them', () => {
    // OrderId, KptMinutes, UpdatedBy, Id, TenantId
    const sql = QUERIES.POS_ONLINE_ORDER.SET_ACCEPTED;
    expect((sql.match(/\?/g) || []).length).toBe(5);
  });
});
