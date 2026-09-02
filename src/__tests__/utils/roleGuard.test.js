// src/__tests__/utils/roleGuard.test.js
// The platform owner's role cannot be handed out.
//
// The system has exactly one super admin, established by the seed. Every path
// that accepts roleIds runs this guard, so the refusal cannot be forgotten in
// one of them.

const { assertRolesGrantable, UNGRANTABLE_ROLE_NAMES } = require('../../utils/roleGuard');

const conn = { execute: jest.fn() };
const TENANT = 'tenant-a';

/** conn returns the role NAMES the ids resolve to, which is what the guard reads. */
const resolvesTo = (...names) =>
  conn.execute.mockResolvedValue([names.map((name) => ({ name }))]);

beforeEach(() => jest.clearAllMocks());

describe('assertRolesGrantable', () => {
  it('allows an ordinary set of roles', async () => {
    resolvesTo('TENANT_ADMIN', 'POS_MANAGER');
    await expect(assertRolesGrantable(conn, ['r1', 'r2'], TENANT)).resolves.toBeUndefined();
  });

  it('refuses SUPER_ADMIN with 403', async () => {
    resolvesTo('SUPER_ADMIN');
    await expect(assertRolesGrantable(conn, ['r1'], TENANT))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a set that merely CONTAINS SUPER_ADMIN', async () => {
    // The realistic mistake: ticking it alongside legitimate roles.
    resolvesTo('POS_CASHIER', 'SUPER_ADMIN', 'VIEWER');
    await expect(assertRolesGrantable(conn, ['r1', 'r2', 'r3'], TENANT))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('leaves TENANT_ADMIN grantable — many tenant admins are allowed', async () => {
    resolvesTo('TENANT_ADMIN');
    await expect(assertRolesGrantable(conn, ['r1'], TENANT)).resolves.toBeUndefined();
  });

  it('scopes the lookup to the tenancy, so a foreign role id resolves to nothing', async () => {
    resolvesTo('TENANT_ADMIN');
    await assertRolesGrantable(conn, ['r1'], TENANT);
    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/WHERE tenant_id = \?/);
    expect(params[0]).toBe(TENANT);
  });

  it('parameterises every id rather than interpolating them', async () => {
    resolvesTo('VIEWER', 'EDITOR', 'POS_CASHIER');
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
