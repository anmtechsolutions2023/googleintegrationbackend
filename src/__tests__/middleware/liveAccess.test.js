// src/__tests__/middleware/liveAccess.test.js
// A token's scopes are no longer trusted for the whole of its life.
//
// Suspending somebody, removing them or changing their roles used to reach them
// only at their next sign-in — up to an hour later. These pin the three things
// the per-request check must do: refuse a membership that no longer admits
// them, replace stale scopes, and hand back a re-signed token without ever
// lengthening the session.

process.env.LIVE_ACCESS_IN_TESTS = '1';

jest.mock('../../config/db', () => ({ execute: jest.fn() }));
jest.mock('../../config/envConfig', () => ({ JWT_SECRET: 'test-secret' }));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const { QUERIES } = require('../../config/constants');
const liveAccess = require('../../middleware/liveAccess');
const { authenticateToken } = require('../../middleware/authMiddleware');

const TID = 'tenant-a';
const PHONE = '+919800000001';

/** The pool answers the three reads liveAccess makes, in order. */
const dbSays = ({ membership, grants = [], roles = [] }) => {
  db.execute.mockImplementation(async (sql) => {
    if (sql === QUERIES.ADMIN_USERS.SELECT_ACCESS_FLAGS) return [membership ? [membership] : []];
    if (sql === QUERIES.PERMISSIONS.SELECT_ALL_GRANTS) {
      return [grants.map((g) => { const [feature_short_name, scope] = g.split(':'); return { feature_short_name, scope }; })];
    }
    if (sql === QUERIES.USER_ROLES.SELECT_BY_USER_TENANT) return [roles.map((role_name) => ({ role_name, role_is_active: 1 }))];
    throw new Error(`unexpected query: ${sql}`);
  });
};

const ACTIVE = { is_admin: 0, is_super_admin: 0, is_active: 1, status: 'ACTIVE' };

const tokenFor = (scopes, extra = {}) =>
  jwt.sign({ phone: PHONE, tid: TID, scopes, roles: [], ...extra }, 'test-secret', { expiresIn: '1h' });

/** Run authenticateToken and resolve with what it passed to next. */
const run = (token) => new Promise((resolve) => {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  authenticateToken(req, res, (err) => resolve({ err, req, headers }));
});

beforeEach(() => {
  jest.clearAllMocks();
  liveAccess._cache.clear();
});

afterAll(() => { delete process.env.LIVE_ACCESS_IN_TESTS; });

describe('liveAccess — through authenticateToken', () => {
  it('lets an unchanged member through with no refreshed token', async () => {
    dbSays({ membership: ACTIVE, grants: ['POS_ORDER:READ'], roles: ['POS_WAITER'] });
    const { err, req, headers } = await run(tokenFor(['POS_ORDER:READ']));
    expect(err).toBeUndefined();
    expect(req.user.scopes).toEqual(['POS_ORDER:READ']);
    expect(headers[liveAccess.REFRESH_HEADER]).toBeUndefined();
  });

  it('refuses a suspended member with 401 on their very next request', async () => {
    dbSays({ membership: { ...ACTIVE, is_active: 0, status: 'SUSPENDED' } });
    const { err } = await run(tokenFor(['POS_ORDER:READ']));
    expect(err).toMatchObject({ statusCode: 401 });
  });

  it('refuses a removed member (no membership row) with 401', async () => {
    dbSays({ membership: null });
    const { err } = await run(tokenFor(['TENANT:ADMIN']));
    expect(err).toMatchObject({ statusCode: 401 });
  });

  it('replaces stale scopes with what the database says now', async () => {
    // The token still carries Admin; the switch was turned off since sign-in.
    dbSays({ membership: ACTIVE, grants: ['POS_ORDER:READ'] });
    const { err, req } = await run(tokenFor(['POS_ORDER:READ', 'TENANT:ADMIN']));
    expect(err).toBeUndefined();
    expect(req.user.scopes).toEqual(['POS_ORDER:READ']);
  });

  it('adds the flag scopes from the membership, never from a role', async () => {
    dbSays({ membership: { ...ACTIVE, is_admin: 1 }, grants: ['POS_ORDER:READ'] });
    const { req } = await run(tokenFor(['POS_ORDER:READ']));
    expect(req.user.scopes).toEqual(['POS_ORDER:READ', 'TENANT:ADMIN']);
  });

  it('hands back a re-signed token with the new scopes and the SAME expiry', async () => {
    dbSays({ membership: ACTIVE, grants: ['POS_ORDER:READ', 'POS_ORDER:WRITE'], roles: ['POS_WAITER'] });
    const old = tokenFor(['POS_ORDER:READ']);
    const { headers } = await run(old);
    const fresh = headers[liveAccess.REFRESH_HEADER];
    expect(fresh).toBeDefined();
    const before = jwt.decode(old);
    const after = jwt.verify(fresh, 'test-secret');
    expect(after.scopes).toEqual(['POS_ORDER:READ', 'POS_ORDER:WRITE']);
    expect(after.roles).toEqual(['POS_WAITER']);
    expect(after.exp).toBe(before.exp);   // a change of access never lengthens a session
    expect(after.phone).toBe(PHONE);
    expect(after.tid).toBe(TID);
  });

  it('caches the answer, so a burst of calls costs one lookup', async () => {
    dbSays({ membership: ACTIVE, grants: ['POS_ORDER:READ'] });
    const token = tokenFor(['POS_ORDER:READ']);
    await run(token);
    await run(token);
    await run(token);
    const membershipReads = db.execute.mock.calls.filter(([sql]) => sql === QUERIES.ADMIN_USERS.SELECT_ACCESS_FLAGS);
    expect(membershipReads).toHaveLength(1);
  });

  it('reads again after invalidate(tenant, phone) — the admin service calls it on every change', async () => {
    dbSays({ membership: ACTIVE, grants: ['POS_ORDER:READ'] });
    const token = tokenFor(['POS_ORDER:READ']);
    await run(token);
    liveAccess.invalidate(TID, PHONE);
    dbSays({ membership: { ...ACTIVE, is_active: 0, status: 'SUSPENDED' } });
    const { err } = await run(token);
    expect(err).toMatchObject({ statusCode: 401 });
  });

  it('invalidate(tenant) drops every member of that tenancy only', () => {
    liveAccess._cache.set(`${TID}|a`, { at: Date.now(), access: {} });
    liveAccess._cache.set(`${TID}|b`, { at: Date.now(), access: {} });
    liveAccess._cache.set('tenant-b|a', { at: Date.now(), access: {} });
    liveAccess.invalidate(TID);
    expect([...liveAccess._cache.keys()]).toEqual(['tenant-b|a']);
  });

  it('leaves guest tokens alone (no tenancy to check against)', async () => {
    const guest = jwt.sign({ phone: PHONE, tid: null, scopes: ['guest:explore'] }, 'test-secret');
    const { err, req } = await run(guest);
    expect(err).toBeUndefined();
    expect(req.user.scopes).toEqual(['guest:explore']);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('passes a database failure on as an error rather than letting the request through', async () => {
    db.execute.mockRejectedValue(new Error('pool exhausted'));
    const { err } = await run(tokenFor(['TENANT:ADMIN']));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('pool exhausted');
  });
});
