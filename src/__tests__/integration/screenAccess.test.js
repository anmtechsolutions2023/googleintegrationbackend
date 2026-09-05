// src/__tests__/integration/screenAccess.test.js
//
// The invariant: **every screen a role is offered, that role can load.**
//
// Menus and route guards were written independently, so they drifted. Billing
// is offered on POS_ORDER:READ but is built from the floor plan, the tables,
// the menu and the variants — all POS_CONFIG — so a waiter was shown the till
// and refused its contents. Twelve screen/scope pairs were broken that way,
// across three shapes nobody was looking for: reference data owned by another
// module, fetches made by a child component (a picker, a modal) rather than by
// the page, and actions offered without the scope to perform them.
//
// This test is what makes "did we get them all?" answerable. For every screen,
// for every scope that puts it in the sidebar, it mints a token carrying ONLY
// that scope and calls everything the screen loads. Nothing may 403.
//
// It runs against the real Express app with a mocked database, so it costs no
// fixtures and no DB in CI. It asserts only on 403 — whether a handler then
// finds a row is not this file's business.

jest.mock('../../config/db', () => ({
  getConnection: jest.fn(),
  execute: jest.fn().mockResolvedValue([[{ affectedRows: 1 }]]),
  query: jest.fn().mockResolvedValue([[{ affectedRows: 1 }]]),
}));

jest.mock('../../config/envConfig', () => ({
  JWT_SECRET: 'screen-access-test-secret',
  PORT: 3001,
  DB_HOST: 'localhost', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test',
  GOOGLE_CLIENT_ID: 'test', LOG_LEVEL: 'error',
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { registerRoutes } = require('../../config/routes');
const { errorHandler } = require('../../middleware/errorHandler');
const { SCREENS } = require('../fixtures/screens');

const SECRET = 'screen-access-test-secret';
const TENANT = 'e3845e08-dcc2-11f0-8e78-0242ac110002';
const ORDER_ID = 'f1f1f1f1-0000-0000-0000-000000000001';
const BRANCH_ID = 'b1b1b1b1-0000-0000-0000-000000000001';

const app = express();
app.use(express.json());
registerRoutes(app);
app.use(errorHandler);
const server = app.listen(0);
afterAll((done) => { server.close(done); });

const MOCK_ROW = { Id: ORDER_ID, Name: 'Mock', Active: 1, TenantId: TENANT };
const mockConnection = {
  execute: jest.fn(), query: jest.fn(), release: jest.fn(),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  jest.clearAllMocks();
  const db = require('../../config/db');
  db.getConnection.mockResolvedValue(mockConnection);
  db.execute.mockResolvedValue([[{ affectedRows: 1 }]]);
  mockConnection.execute.mockImplementation((sql) => {
    const s = String(sql || '').toUpperCase();
    if (s.includes('COUNT(')) return Promise.resolve([[{ total: 1 }]]);
    if (s.includes('SELECT')) return Promise.resolve([[MOCK_ROW]]);
    return Promise.resolve([[{ affectedRows: 1 }]]);
  });
  mockConnection.query.mockResolvedValue([[MOCK_ROW]]);
});

// A token carrying exactly one scope. The point is to prove the guard admits
// THAT scope — a token with several would hide which one did the work.
const tokenWith = (...scopes) =>
  'Bearer ' + jwt.sign({ tid: TENANT, phone: '+919222200005', scopes }, SECRET);

const resolve = (path) =>
  path.replace('ORDER_ID', ORDER_ID).replace('BRANCH_ID', BRANCH_ID).replace('TENANT_ID', TENANT);

// ─────────────────────────────────────────────────────────────────────────────
// Every screen loads for everyone it is offered to
// ─────────────────────────────────────────────────────────────────────────────

describe.each(SCREENS.map((s) => [s.screen, s]))('%s', (_name, screen) => {
  describe.each(screen.shownTo)('offered on %s', (scope) => {
    it.each(screen.loads.map((p) => [p]))('loads %s', async (path) => {
      const res = await request(server)
        .get(resolve(path))
        .set('Authorization', tokenWith(scope));

      // 404/400/500 are the handler's business; 403 means the menu lied.
      expect({ path, status: res.status, refused: res.status === 403 })
        .toEqual({ path, status: res.status, refused: false });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// …and only offers what it can do
// ─────────────────────────────────────────────────────────────────────────────

const WITH_ACTIONS = SCREENS.filter((s) => s.actions?.length);

describe.each(WITH_ACTIONS.map((s) => [s.screen, s]))('%s — actions', (_name, screen) => {
  it.each(screen.actions.map((a) => [`${a.verb.toUpperCase()} ${a.path}`, a]))(
    '%s needs its own scope', async (_label, action) => {
      // Held: admitted.
      const allowed = await request(server)[action.verb](resolve(action.path))
        .set('Authorization', tokenWith(action.needs)).send({});
      expect(allowed.status).not.toBe(403);

      // Not held — only the scope that reveals the screen: refused. This is the
      // half the UI must mirror by hiding the control; the server refusing it
      // is what makes hiding it honest rather than the only defence.
      const refused = await request(server)[action.verb](resolve(action.path))
        .set('Authorization', tokenWith(screen.shownTo[0])).send({});
      if (screen.shownTo[0] !== action.needs) expect(refused.status).toBe(403);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixture itself
// ─────────────────────────────────────────────────────────────────────────────

describe('the screen fixture', () => {
  it('declares a scope and at least one request for every screen', () => {
    SCREENS.forEach((s) => {
      expect(s.shownTo.length).toBeGreaterThan(0);
      expect(s.loads.length).toBeGreaterThan(0);
    });
  });

  it('names each screen once', () => {
    const names = SCREENS.map((s) => s.screen);
    expect(new Set(names).size).toBe(names.length);
  });

  // Guards are the authority. A screen listed as needing a scope that no longer
  // exists would silently pass every assertion above.
  it('uses only scopes the application defines', () => {
    const { SCOPES } = require('../../config/constants');
    const known = new Set(Object.values(SCOPES));
    SCREENS.forEach((s) => {
      s.shownTo.forEach((sc) => expect(known.has(sc)).toBe(true));
      (s.actions || []).forEach((a) => expect(known.has(a.needs)).toBe(true));
    });
  });
});
