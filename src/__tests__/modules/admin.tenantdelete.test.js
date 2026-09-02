// src/__tests__/modules/admin.tenantdelete.test.js
// admin.service.deleteTenant — the guards, the sweep, and what happens to the
// people in the tenancy.
//
// Deliberately uses the REAL config/constants rather than a mocked QUERIES map:
// the thing most worth testing is the actual 72-statement sweep and its order,
// and a hand-written mock of it would only ever assert what the mock said.

const mockConn = { execute: jest.fn() };

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn((fn) => fn(mockConn)),
  withTransaction: jest.fn((fn) => fn(mockConn)),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const { deleteTenant } = require('../../modules/admin/admin.service');
const { QUERIES } = require('../../config/constants');

const TENANT = 'dead-tenant';
const ACTOR_TENANT = 'my-own-tenant';

/**
 * Answers mockConn.execute by matching the SQL rather than by call index, so a
 * test does not silently pass when the service reorders its reads.
 */
const wire = ({ memberships = 1, superAdmins = 0, members = [], sole = [], admins = [] }) => {
  mockConn.execute.mockImplementation((sql) => {
    if (sql === QUERIES.TENANT_DELETE.COUNT_MEMBERSHIPS) return [[{ total: memberships }]];
    if (sql === QUERIES.TENANT_DELETE.COUNT_SUPER_ADMINS) return [[{ total: superAdmins }]];
    if (sql === QUERIES.TENANT_DELETE.SELECT_MEMBERS) return [members.map((e) => ({ user_email: e }))];
    if (sql === QUERIES.TENANT_DELETE.SELECT_SOLE_MEMBERS) return [sole.map((e) => ({ user_email: e }))];
    if (sql === QUERIES.TENANT_DELETE.SELECT_ADMINS) return [admins.map((e) => ({ user_email: e }))];
    return [{ affectedRows: 0 }];
  });
};

const sqlCalls = () => mockConn.execute.mock.calls.map(([sql]) => sql);

beforeEach(() => jest.clearAllMocks());

describe('deleteTenant — guards', () => {
  it('refuses the tenancy the caller is signed in to, before touching the database', async () => {
    await expect(deleteTenant(ACTOR_TENANT, ACTOR_TENANT)).rejects.toMatchObject({ statusCode: 403 });
    // The point of refusing early: no transaction, no partial sweep.
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('404s a tenancy with no memberships rather than sweeping an unknown id', async () => {
    wire({ memberships: 0 });
    await expect(deleteTenant(TENANT, ACTOR_TENANT)).rejects.toMatchObject({ statusCode: 404 });
    expect(sqlCalls()).not.toContain(QUERIES.TENANT_DELETE.SWEEP[0]);
  });

  it('refuses a tenancy holding a super admin — the rank lives on the membership', async () => {
    wire({ memberships: 3, superAdmins: 1 });
    await expect(deleteTenant(TENANT, ACTOR_TENANT)).rejects.toMatchObject({ statusCode: 403 });
    expect(sqlCalls()).not.toContain(QUERIES.TENANT_DELETE.SWEEP[0]);
  });
});

describe('deleteTenant — the sweep', () => {
  it('runs every sweep statement, in order, scoped to the tenancy', async () => {
    wire({ members: ['a@x.com'], sole: [] });
    await deleteTenant(TENANT, ACTOR_TENANT);

    const swept = mockConn.execute.mock.calls
      .filter(([sql]) => QUERIES.TENANT_DELETE.SWEEP.includes(sql))
      .map(([sql, params]) => ({ sql, params }));

    expect(swept).toHaveLength(QUERIES.TENANT_DELETE.SWEEP.length);
    expect(swept.map((s) => s.sql)).toEqual(QUERIES.TENANT_DELETE.SWEEP);
    swept.forEach((s) => expect(s.params).toEqual([TENANT]));
  });

  it('never deletes from the global tables or from onboarding_requests by tenant', async () => {
    wire({ members: ['a@x.com'], sole: ['a@x.com'] });
    await deleteTenant(TENANT, ACTOR_TENANT);

    const sweptTables = QUERIES.TENANT_DELETE.SWEEP.map((q) => q.match(/DELETE FROM (\w+)/)[1]);
    // features and app_settings are platform-wide; deleting either would damage
    // every other tenancy. onboarding_requests is keyed by email, never tenant.
    expect(sweptTables).not.toContain('features');
    expect(sweptTables).not.toContain('app_settings');
    expect(sweptTables).not.toContain('onboarding_requests');
  });

  it('reads the membership picture BEFORE user_tenants is swept away', async () => {
    wire({ members: ['a@x.com'], sole: ['a@x.com'] });
    await deleteTenant(TENANT, ACTOR_TENANT);

    const calls = sqlCalls();
    const userTenantsDelete = QUERIES.TENANT_DELETE.SWEEP.find((q) =>
      /DELETE FROM user_tenants /.test(q));

    // Both reads must land before the row they read from is gone — otherwise the
    // onboarding cleanup below has nothing to work from.
    expect(calls.indexOf(QUERIES.TENANT_DELETE.SELECT_MEMBERS))
      .toBeLessThan(calls.indexOf(userTenantsDelete));
    expect(calls.indexOf(QUERIES.TENANT_DELETE.SELECT_SOLE_MEMBERS))
      .toBeLessThan(calls.indexOf(userTenantsDelete));
  });
});

describe('deleteTenant — what happens to the people', () => {
  it('clears the onboarding record of a member who belonged nowhere else', async () => {
    wire({ members: ['solo@x.com'], sole: ['solo@x.com'] });
    await deleteTenant(TENANT, ACTOR_TENANT);

    expect(mockConn.execute).toHaveBeenCalledWith(
      QUERIES.TENANT_DELETE.DELETE_ONBOARDING_BY_EMAIL, ['solo@x.com']
    );
  });

  it('leaves a multi-tenant member\'s onboarding record alone', async () => {
    // Belongs here AND somewhere else, so SELECT_SOLE_MEMBERS excludes them.
    wire({ members: ['multi@x.com'], sole: [] });
    await deleteTenant(TENANT, ACTOR_TENANT);

    expect(sqlCalls()).not.toContain(QUERIES.TENANT_DELETE.DELETE_ONBOARDING_BY_EMAIL);
  });

  it('clears only the sole members when the tenancy holds both kinds', async () => {
    wire({ members: ['solo@x.com', 'multi@x.com'], sole: ['solo@x.com'] });
    const result = await deleteTenant(TENANT, ACTOR_TENANT);

    const cleared = mockConn.execute.mock.calls
      .filter(([sql]) => sql === QUERIES.TENANT_DELETE.DELETE_ONBOARDING_BY_EMAIL)
      .map(([, params]) => params[0]);

    expect(cleared).toEqual(['solo@x.com']);
    expect(result).toEqual({
      tenantId: TENANT,
      membersRemoved: 2,
      accountsReset: 1,
      disassociated: 1,
      // Named for the audit trail — see the owner describe block below.
      adminEmails: [],
    });
  });

  it('reports an empty-handed tenancy without claiming it reset anybody', async () => {
    wire({ memberships: 1, members: [], sole: [] });
    const result = await deleteTenant(TENANT, ACTOR_TENANT);
    expect(result).toMatchObject({ membersRemoved: 0, accountsReset: 0, disassociated: 0 });
  });
});

// ── Schema drift ────────────────────────────────────────────────────────────
// The sweep is a hand-maintained list against a schema that keeps growing. This
// is the test that fails when somebody adds a tenant-scoped table and does not
// add it here — without it, the first sign of the omission is a tenancy that
// was "deleted" still owning rows.
describe('deleteTenant — the sweep against the live schema', () => {
  const fs = require('fs');
  const path = require('path');

  const schema = fs.readFileSync(
    path.join(__dirname, '../../../database/01-schema-definition.sql'), 'utf8'
  );
  const tables = [...schema.matchAll(/CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/g)]
    .map(([, name, body]) => ({ name, body }));

  const swept = QUERIES.TENANT_DELETE.SWEEP.map((q) => q.match(/DELETE FROM (\w+)/)[1]);

  // Deleted with their parent by ON DELETE CASCADE, so they must NOT be swept.
  const CASCADES = ['tenant_features', 'role_permissions', 'tenant_invitation_roles'];
  // Platform-wide, shared by every tenancy.
  const GLOBALS = ['features', 'app_settings'];
  // Keyed UNIQUE(email), cleared per person instead — see DELETE_ONBOARDING_BY_EMAIL.
  const BY_EMAIL = ['onboarding_requests'];

  it('sweeps every table that carries a tenant column', () => {
    const tenantScoped = tables
      .filter(({ body }) => /^\s*(TenantId|tenant_id)\s/mi.test(body))
      .map(({ name }) => name)
      .filter((n) => !BY_EMAIL.includes(n));

    const missing = tenantScoped.filter((n) => !swept.includes(n));
    expect(missing).toEqual([]);
  });

  it('sweeps nothing that is global, cascaded, or handled by email', () => {
    [...GLOBALS, ...CASCADES, ...BY_EMAIL].forEach((n) => expect(swept).not.toContain(n));
  });

  it('names each table exactly once', () => {
    expect(new Set(swept).size).toBe(swept.length);
  });

  it('deletes no parent before a RESTRICT child that outlives it', () => {
    // The order is the whole contract: 97 of the schema's foreign keys are
    // RESTRICT, so a parent swept too early aborts the transaction.
    const restrictParents = {};
    tables.forEach(({ name, body }) => {
      restrictParents[name] = new Set();
      const fk = /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)([^,\n]*(?:\n\s+ON DELETE [A-Z ]+)?)/gi;
      for (const m of body.matchAll(fk)) {
        const [, , parent, , tail] = m;
        if (parent !== name && !/ON DELETE\s+CASCADE/i.test(tail || '')) {
          restrictParents[name].add(parent);
        }
      }
    });

    const at = {};
    swept.forEach((t, i) => { at[t] = i; });
    // A cascade child disappears exactly when its parent is swept.
    const diesWith = { tenant_features: 'user_tenants', role_permissions: 'roles', tenant_invitation_roles: 'tenant_invitations' };

    const violations = [];
    Object.entries(restrictParents).forEach(([child, parents]) => {
      parents.forEach((parent) => {
        if (!(parent in at)) return;                       // parent never swept
        const childGone = child in at ? at[child]
          : child in diesWith ? at[diesWith[child]] : null;
        if (childGone === null) return;                    // child never swept
        if (childGone > at[parent]) {
          violations.push(`${child} (${childGone}) still references ${parent} (${at[parent]})`);
        }
      });
    });

    expect(violations).toEqual([]);
  });
});

// ── Who the tenancy belonged to ─────────────────────────────────────────────
// The audit row has to name the tenancy's admin, and that is only knowable
// BEFORE the sweep: afterwards user_tenants holds nothing to join to, and the
// trail could never say whose tenancy was erased.
describe('deleteTenant — naming the owner for the audit trail', () => {
  it('returns the admin emails it read', async () => {
    wire({ memberships: 3, members: ['a@x.com', 'b@x.com'], admins: ['a@x.com'] });
    const result = await deleteTenant(TENANT, ACTOR_TENANT);
    expect(result.adminEmails).toEqual(['a@x.com']);
  });

  it('reads them BEFORE the sweep runs', async () => {
    wire({ memberships: 2, members: ['a@x.com'], admins: ['a@x.com'] });
    await deleteTenant(TENANT, ACTOR_TENANT);

    const calls = sqlCalls();
    expect(calls.indexOf(QUERIES.TENANT_DELETE.SELECT_ADMINS))
      .toBeLessThan(calls.indexOf(QUERIES.TENANT_DELETE.SWEEP[0]));
  });

  it('carries every admin when a tenancy has more than one', async () => {
    wire({ memberships: 4, members: ['a@x.com', 'b@x.com'], admins: ['a@x.com', 'b@x.com'] });
    const result = await deleteTenant(TENANT, ACTOR_TENANT);
    expect(result.adminEmails).toEqual(['a@x.com', 'b@x.com']);
  });

  // A tenancy whose admin was already removed still gets deleted — the trail
  // says so rather than the request failing.
  it('reports an empty list rather than throwing when no admin remains', async () => {
    wire({ memberships: 1, members: ['a@x.com'], admins: [] });
    const result = await deleteTenant(TENANT, ACTOR_TENANT);
    expect(result.adminEmails).toEqual([]);
  });
});
