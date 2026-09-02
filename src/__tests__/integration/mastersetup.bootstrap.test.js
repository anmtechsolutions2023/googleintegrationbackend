// src/__tests__/integration/mastersetup.bootstrap.test.js
// POST /api/master-data/bootstrap through the FULL HTTP stack.
//
// Exists because the setup wizard stopped sending branch.transactionTypeConfig
// and the schema change that allows that was verified in isolation — the schema
// object was asked directly, and the unit suites passed, but nothing exercised
// route -> auth -> scope -> validateBody -> controller. The shape of the payload
// the browser actually posts is the thing worth pinning, so a future change to
// either side is caught here rather than as a 400 in somebody's DevTools.

jest.mock('../../config/db', () => ({
  getConnection: jest.fn(),
  execute: jest.fn().mockResolvedValue([[{ affectedRows: 1 }]]),
  query: jest.fn().mockResolvedValue([[{ affectedRows: 1 }]]),
}));

jest.mock('../../config/envConfig', () => ({
  JWT_SECRET: 'integration-test-secret',
  PORT: 3001, DB_HOST: 'localhost', DB_USER: 'test', DB_PASSWORD: 'test',
  DB_NAME: 'test', GOOGLE_CLIENT_ID: 'test', LOG_LEVEL: 'error',
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

// The orchestrator is not under test here — what reaches it is.
jest.mock('../../modules/mastersetup/mastersetup.service', () => ({
  bootstrap: jest.fn().mockResolvedValue({ organization: 'org-1', branch: 'br-1' }),
  getStatus: jest.fn(),
}));
jest.mock('../../modules/auth/auth.service', () => ({
  reissueTokenWithSetupComplete: jest.fn(() => 'fresh.jwt.token'),
}));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { registerRoutes } = require('../../config/routes');
const { errorHandler } = require('../../middleware/errorHandler');
const service = require('../../modules/mastersetup/mastersetup.service');
const { NUMBERING_DEFAULTS } = require('../../modules/mastersetup/mastersetup.schemas');

const TEST_SECRET = 'integration-test-secret';
const TENANT_ID = 'e3845e08-dcc2-11f0-8e78-0242ac110002';
const adminToken = () => 'Bearer ' + jwt.sign(
  { tid: TENANT_ID, email: 'admin@test.com', scopes: ['TENANT:ADMIN'] }, TEST_SECRET
);

/**
 * Exactly what MasterDataSetup.buildPayload() now produces for a minimal run:
 * organization + branch, no transactionTypeConfig anywhere, and the blank
 * optional fields already dropped by its clean() pass.
 */
const WIZARD_PAYLOAD = {
  organization: { Name: 'ANM Tech' },
  branch: {
    Name: 'Main',
    address: {
      AddressLine1: '12 MG Road',
      TagName: 'Onboarding',
      contactAddressType: { Name: 'Onboarding' },
    },
    contact: { FirstName: 'Ravi', LastName: 'K' },
  },
};

// supertest binds an ephemeral port per request, so the app is never told to
// listen — registerRoutes installs interval timers (rate-limit sweeps) that
// would otherwise hold the handle open past the suite.
let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandler);
});
beforeEach(() => jest.clearAllMocks());

describe('POST /api/master-data/bootstrap — the payload the wizard actually sends', () => {
  it('is accepted (201), not rejected for a missing transactionTypeConfig', async () => {
    const res = await request(app)
      .post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send(WIZARD_PAYLOAD);

    expect(res.status).toBe(201);
    // The exact 400 this test exists to prevent.
    expect(JSON.stringify(res.body)).not.toMatch(/transactionTypeConfig.*required/);
  });

  it('hands the orchestrator a complete numbering config it never asked for', async () => {
    await request(app).post('/api/master-data/bootstrap')
      .set('Authorization', adminToken()).send(WIZARD_PAYLOAD);

    const [received] = service.bootstrap.mock.calls[0];
    // branchdetail.TransactionTypeConfigId is NOT NULL, so the orchestrator must
    // never be handed a branch without one.
    expect(received.branch.transactionTypeConfig).toEqual({
      StartCounterNo: NUMBERING_DEFAULTS.START_COUNTER_NO,
      Format: NUMBERING_DEFAULTS.FORMAT,
      TagName: NUMBERING_DEFAULTS.TAG_NAME,
    });
  });

  it('still lets a caller who does supply numbering keep it', async () => {
    const mine = { StartCounterNo: 500, Format: 'BILL-{000000}', TagName: 'Retail' };
    await request(app).post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send({ ...WIZARD_PAYLOAD, branch: { ...WIZARD_PAYLOAD.branch, transactionTypeConfig: mine } });

    expect(service.bootstrap.mock.calls[0][0].branch.transactionTypeConfig).toEqual(mine);
  });

  it('still refuses a payload that is genuinely wrong', async () => {
    const res = await request(app).post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send({ organization: { Name: 'X' } });   // no branch at all

    expect(res.status).toBe(400);
    expect(service.bootstrap).not.toHaveBeenCalled();
  });

  it('is still behind auth', async () => {
    const res = await request(app).post('/api/master-data/bootstrap').send(WIZARD_PAYLOAD);
    expect(res.status).toBe(401);
  });
});
