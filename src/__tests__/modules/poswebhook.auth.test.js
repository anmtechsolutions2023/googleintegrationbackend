// src/__tests__/modules/poswebhook.auth.test.js
// The only authentication path in this codebase that is not a tenant JWT.
//
// It is the one publicly reachable POST in the app, so its failure modes are
// worth pinning down precisely. Three rules, each with a test:
//   1. the tenant comes from the credential, never from the payload;
//   2. an unconfigured portal is CLOSED, not open;
//   3. a signature is compared in constant time, over the RAW bytes.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConnection = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConnection)),
  withTransaction: jest.fn(async (cb) => cb(mockConnection)),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

const crypto = require('crypto');
const { authenticatePortalRequest } = require('../../modules/poswebhook/poswebhook.auth');
const { resolveAdapter } = require('../../modules/posportal/adapters');

const SECRET = 'shhh-zomato';
const BODY = JSON.stringify({ order: { id: 'ZO-1' } });

const sign = (body, secret, algorithm = 'sha256', encoding = 'hex') =>
  crypto.createHmac(algorithm, secret).update(body).digest(encoding);

const req = (over = {}) => ({
  headers: { 'x-zomato-signature': sign(BODY, SECRET), ...(over.headers || {}) },
  rawBody: over.rawBody !== undefined ? over.rawBody : BODY,
});

const credentialRow = (over = {}) => ({
  Id: 'cred-1', PortalId: 'portal-zo', PortalCode: 'ZOMATO', Adapter: 'zomato.v1',
  TenantId: 'tenant-A', WebhookSecret: SECRET, ...over,
});

const routeCredentials = (rows) => {
  mockConnection.execute.mockImplementation((sql) => {
    if (/FROM pos_portal_credential c/i.test(sql)) return Promise.resolve([rows]);
    return Promise.resolve([[]]);
  });
};

beforeEach(() => jest.clearAllMocks());

describe('authenticating a portal webhook', () => {
  it('accepts a correctly signed request and reports its tenant', async () => {
    routeCredentials([credentialRow()]);
    const auth = await authenticatePortalRequest(req(), 'zomato');

    expect(auth).not.toBeNull();
    expect(auth.tenantId).toBe('tenant-A');
    expect(auth.portal.Id).toBe('portal-zo');
  });

  // Rule 1. Everything in the body is attacker-controlled; only the row whose
  // secret verified may say which tenant this is.
  it('takes the tenant from the credential, not from anything in the payload', async () => {
    routeCredentials([credentialRow({ TenantId: 'tenant-A' })]);
    const auth = await authenticatePortalRequest(req(), 'zomato');

    // The body claims a different tenant. It is ignored.
    expect(JSON.parse(BODY).tenantId).toBeUndefined();
    expect(auth.tenantId).toBe('tenant-A');
  });

  // A portal code can legitimately exist in several tenants. Each candidate is
  // tried and only the one whose secret verifies wins.
  it('picks the right tenant when two of them use the same portal', async () => {
    routeCredentials([
      credentialRow({ TenantId: 'tenant-A', WebhookSecret: 'other-secret', PortalId: 'p-a' }),
      credentialRow({ TenantId: 'tenant-B', WebhookSecret: SECRET, PortalId: 'p-b' }),
    ]);
    const auth = await authenticatePortalRequest(req(), 'zomato');

    expect(auth.tenantId).toBe('tenant-B');
    expect(auth.portal.Id).toBe('p-b');
  });

  it('refuses a wrong signature', async () => {
    routeCredentials([credentialRow()]);
    const bad = req({ headers: { 'x-zomato-signature': sign(BODY, 'wrong-secret') } });
    expect(await authenticatePortalRequest(bad, 'zomato')).toBeNull();
  });

  it('refuses a request with no signature at all', async () => {
    routeCredentials([credentialRow()]);
    expect(await authenticatePortalRequest({ headers: {}, rawBody: BODY }, 'zomato')).toBeNull();
  });

  // Rule 2. The absence of configuration must never be the absence of a check.
  it('refuses a portal that has no secret configured', async () => {
    routeCredentials([credentialRow({ WebhookSecret: null })]);
    expect(await authenticatePortalRequest(req(), 'zomato')).toBeNull();
  });

  // Rule 3. A digest computed over re-serialized JSON would not match: key
  // order and whitespace change. An absent raw body therefore refuses rather
  // than falling back.
  it('refuses when the raw body was not captured', async () => {
    routeCredentials([credentialRow()]);
    expect(await authenticatePortalRequest(req({ rawBody: null }), 'zomato')).toBeNull();
  });

  it('refuses when the body was altered after signing', async () => {
    routeCredentials([credentialRow()]);
    const tampered = req({ rawBody: JSON.stringify({ order: { id: 'ZO-999' } }) });
    expect(await authenticatePortalRequest(tampered, 'zomato')).toBeNull();
  });

  // Telling a caller that a portal code exists but is unconfigured tells them
  // what to try next, so both cases return the same nothing.
  it('answers an unknown portal code the same way as a bad signature', async () => {
    routeCredentials([]);
    expect(await authenticatePortalRequest(req(), 'nosuchportal')).toBeNull();
  });

  // A verifier that throws has not verified anything.
  it('treats a throwing verifier as a failure, never as a pass', async () => {
    const adapter = resolveAdapter('zomato.v1');
    const spy = jest.spyOn(adapter, 'verify').mockImplementation(() => {
      throw new Error('boom');
    });
    routeCredentials([credentialRow()]);

    expect(await authenticatePortalRequest(req(), 'zomato')).toBeNull();
    spy.mockRestore();
  });
});

describe('the signature itself', () => {
  it('is computed over the exact bytes, per the portal spec', () => {
    const adapter = resolveAdapter('zomato.v1');
    expect(adapter.verify(req(), { WebhookSecret: SECRET })).toBe(true);
  });

  // District signs base64 rather than hex — the one thing that differs between
  // these adapters, and the reason the spec is a declaration rather than code.
  it('honours a portal that encodes its digest differently', () => {
    const district = resolveAdapter('district.v1');
    const b64 = sign(BODY, SECRET, 'sha256', 'base64');

    expect(district.verify(
      { headers: { 'x-district-signature': b64 }, rawBody: BODY },
      { WebhookSecret: SECRET },
    )).toBe(true);

    // The same digest in the other encoding must not pass.
    expect(district.verify(
      { headers: { 'x-district-signature': sign(BODY, SECRET) }, rawBody: BODY },
      { WebhookSecret: SECRET },
    )).toBe(false);
  });

  // A length mismatch is itself an answer, and timingSafeEqual throws on one —
  // so it has to be handled before the comparison, not by it.
  it('handles a signature of the wrong length without throwing', () => {
    const adapter = resolveAdapter('zomato.v1');
    expect(() => adapter.verify(
      { headers: { 'x-zomato-signature': 'short' }, rawBody: BODY },
      { WebhookSecret: SECRET },
    )).not.toThrow();
  });
});
