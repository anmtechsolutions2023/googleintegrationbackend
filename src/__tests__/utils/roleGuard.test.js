// src/__tests__/utils/roleGuard.test.js
// The platform owner's role cannot be handed out, and no role may be borrowed
// from another tenancy.
//
// The system has exactly one super admin, established by the seed. Every path
// that accepts roleIds runs this guard, so neither refusal can be forgotten in
// one of them.

const { assertRolesGrantable, UNGRANTABLE_ROLE_NAMES } = require('../../utils/roleGuard');

const conn = { execute: jest.fn() };
const TENANT = 'tenant-a';

/**
 * conn returns the rows the ids resolve to INSIDE the tenancy: one { id, name }
 * per id given, in order. An id left out of `names` resolves to nothing.
 */
const resolves = (ids, ...names) =>
  conn.execute.mockResolvedValue([names.map((name, i) => ({ id: ids[i], name }))]);

beforeEach(() => jest.clearAllMocks());

describe('assertRolesGrantable', () => {
  it('allows an ordinary set of roles', async () => {
    resolves(['r1', 'r2'], 'TENANT_ADMIN', 'POS_MANAGER');
    await expect(assertRolesGrantable(conn, ['r1', 'r2'], TENANT)).resolves.toBeUndefined();
  });

  it('refuses SUPER_ADMIN with 403', async () => {
    resolves(['r1'], 'SUPER_ADMIN');
    await expect(assertRolesGrantable(conn, ['r1'], TENANT))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a set that merely CONTAINS SUPER_ADMIN', async () => {
    // The realistic mistake: ticking it alongside legitimate roles.
    resolves(['r1', 'r2', 'r3'], 'POS_CASHIER', 'SUPER_ADMIN', 'VIEWER');
    await expect(assertRolesGrantable(conn, ['r1', 'r2', 'r3'], TENANT))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('leaves TENANT_ADMIN grantable — many tenant admins are allowed', async () => {
    resolves(['r1'], 'TENANT_ADMIN');
    await expect(assertRolesGrantable(conn, ['r1'], TENANT)).resolves.toBeUndefined();
  });

  it('refuses a role id from another tenancy with 400', async () => {
    // The lookup is confined to the tenancy, so a foreign id resolves to no row.
    // It used to be skipped as "not SUPER_ADMIN" and then stored by the caller.
    resolves(['r1']);
    await expect(assertRolesGrantable(conn, ['foreign-role'], TENANT))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a set where only SOME ids belong to the tenancy', async () => {
    resolves(['own'], 'POS_CASHIER');
    await expect(assertRolesGrantable(conn, ['own', 'foreign-role'], TENANT))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts the same id twice as one role', async () => {
    resolves(['r1'], 'VIEWER');
    await expect(assertRolesGrantable(conn, ['r1', 'r1'], TENANT)).resolves.toBeUndefined();
    const [, params] = conn.execute.mock.calls[0];
    expect(params).toEqual([TENANT, 'r1']);
  });

  it('scopes the lookup to the tenancy', async () => {
    resolves(['r1'], 'TENANT_ADMIN');
    await assertRolesGrantable(conn, ['r1'], TENANT);
    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/WHERE tenant_id = \?/);
    expect(params[0]).toBe(TENANT);
  });

  it('parameterises every id rather than interpolating them', async () => {
    resolves(['a', 'b', 'c'], 'VIEWER', 'EDITOR', 'POS_CASHIER');
    await assertRolesGrantable(conn, ['a', 'b', 'c'], TENANT);
    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toContain('IN (?, ?, ?)');
    expect(params).toEqual([TENANT, 'a', 'b', 'c']);
  });

  it('does nothing, and costs no query, for an empty or missing set', async () => {
    await expect(assertRolesGrantable(conn, [], TENANT)).resolves.toBeUndefined();
    await expect(assertRolesGrantable(conn, undefined, TENANT)).resolves.toBeUndefined();
    await expect(assertRolesGrantable(conn, null, TENANT)).resolves.toBeUndefined();
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it('names SUPER_ADMIN as the role that cannot be granted', () => {
    expect(UNGRANTABLE_ROLE_NAMES).toContain('SUPER_ADMIN');
    // TENANT_ADMIN must NOT be here — the whole point is that tenancies can have
    // as many administrators as they like.
    expect(UNGRANTABLE_ROLE_NAMES).not.toContain('TENANT_ADMIN');
  });
});
