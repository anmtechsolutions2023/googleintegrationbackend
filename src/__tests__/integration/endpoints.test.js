// src/__tests__/integration/endpoints.test.js
// Comprehensive supertest integration tests for all 31 CRUD API modules.
// Tests every endpoint through the full HTTP stack including middleware and error handling.

// ─────────────────────────────────────────────────────────────────────────────
// JEST MOCKS — must be at the top (jest.mock is hoisted before imports)
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../../config/db', () => ({
  getConnection: jest.fn(),
  execute: jest.fn().mockResolvedValue([[{ affectedRows: 1 }]]),
  query: jest.fn().mockResolvedValue([[{ affectedRows: 1 }]]),
}));

jest.mock('../../config/envConfig', () => ({
  JWT_SECRET: 'integration-test-secret',
  PORT: 3001,
  DB_HOST: 'localhost',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  DB_NAME: 'test',
  GOOGLE_CLIENT_ID: 'test',
  LOG_LEVEL: 'error',
}));

jest.mock('../../config/config', () => ({
  DATABASE: { CONNECTION_LIMIT: 10, QUEUE_LIMIT: 0 },
  AUDIT: { DEFAULT_LIMIT: 100, DEFAULT_OFFSET: 0, DEFAULT_IP: '0.0.0.0' },
  RATE_LIMIT: {
    AUTH_WINDOW_MS: 15 * 60 * 1000,
    AUTH_MAX_REQUESTS: 5,
    STANDARD_HEADERS: true,
    LEGACY_HEADERS: false,
  },
  JWT: { EXPIRATION: '1h', GUEST_EXPIRATION: '15m' },
  SERVER: { DEFAULT_PORT: 5000, JSON_LIMIT: '10mb', CORS_ORIGIN: '*' },
  LOGGING: { DEFAULT_LEVEL: 'error' },
  VALIDATION: { ABORT_EARLY: true, STRIP_UNKNOWN: false },
  IP_DETECTION: { IP_HEADERS: [] },
  FEATURES: {
    ENABLE_AUDIT_LOGGING: true,
    ENABLE_CACHE: true,
    STRICT_SCOPE_CHECK: true,
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  captureAudit: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { registerRoutes } = require('../../config/routes');
const { errorHandler } = require('../../middleware/errorHandler');

// ─────────────────────────────────────────────────────────────────────────────
// TEST CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const TEST_SECRET = 'integration-test-secret';
const TENANT_ID = 'e3845e08-dcc2-11f0-8e78-0242ac110002';
const RECORD_ID = 'f1f1f1f1-0000-0000-0000-000000000001';
const UUID_1 = 'a1b2c3d4-1111-1111-1111-111111111111';

// Token factories
const adminToken = () =>
  'Bearer ' +
  jwt.sign(
    { tid: TENANT_ID, email: 'admin@test.com', scopes: ['TENANT:ADMIN'] },
    TEST_SECRET
  );

// A VIEWER carries READ on every previously-open category (matches the
// role_permissions seed) so it can read but not write.
const VIEWER_READ_SCOPES = [
  'MASTER_DATA:READ', 'ORGANIZATION:READ', 'TRANSACTIONS:READ',
  'INVENTORY:READ', 'CONTACTS:READ', 'PAYMENTS:READ',
  'POS_CONFIG:READ', 'POS_ORDER:READ', 'POS_KITCHEN:READ',
  'POS_BILLING:READ', 'POS_CRM:READ', 'POS_OPS:READ',
];
const viewerToken = () =>
  'Bearer ' +
  jwt.sign(
    { tid: TENANT_ID, email: 'viewer@test.com', scopes: ['TENANT:VIEWER', ...VIEWER_READ_SCOPES] },
    TEST_SECRET
  );

const iamAdminToken = () =>
  'Bearer ' +
  jwt.sign(
    { tid: TENANT_ID, email: 'iamadmin@test.com', scopes: ['admin:access'] },
    TEST_SECRET
  );

const guestToken = () =>
  'Bearer ' +
  jwt.sign(
    { tid: null, email: 'guest@test.com', scopes: ['guest:explore'] },
    TEST_SECRET
  );

// Read-only business user granted the new AUDIT:READ scope (no admin:access).
const auditReadToken = () =>
  'Bearer ' +
  jwt.sign(
    { tid: TENANT_ID, email: 'auditor@test.com', scopes: [...VIEWER_READ_SCOPES, 'AUDIT:READ'] },
    TEST_SECRET
  );

// Shared mock row returned by SELECT queries.
// Contains every field referenced across all 31 module services.
const MOCK_ROW = {
  Id: RECORD_ID,
  TenantId: TENANT_ID,
  Active: 1,
  Name: 'Test',
  Type: 'Test',
  UnitName: 'Test',
  IsPrimary: 0,
  BatchNo: 'Test',
  BranchName: 'Test',
  ProviderName: 'Test',
  TagName: 'test-tag',
  Lat: 12.97,
  Lng: 77.59,
  Amount: '100',
  GrossAmount: '100',
  TotalAmount: '100',
  TransactionNo: 'T-001',
  Timestamp: '2026-05-31 10:00:00',
  StartCounterNo: 1,
  Prefix: 'INV',
  Format: 'INV-{SEQ}',
  Value: '18',
  Factor: 100,
  FirstName: 'John',
  LastName: 'Doe',
  AddressLine1: '123 Main St',
  BranchId: UUID_1,
  UserGroupId: UUID_1,
  MapProviderId: UUID_1,
  LocationDetailId: UUID_1,
  TransactionTypeConfigId: UUID_1,
  AccountTypeBaseId: UUID_1,
  TransactionDetailLogId: UUID_1,
  PaymentModeId: UUID_1,
  PaymentDetailId: UUID_1,
  PaymentModeTransactionDetailId: UUID_1,
  PaymentReceivedTypeId: UUID_1,
  TaxGroupId: UUID_1,
  TaxTypeId: UUID_1,
  CreatedOn: '2026-05-31 10:00:00',
  UpdatedOn: '2026-05-31 10:00:00',
  CreatedBy: 'admin@test.com',
  UpdatedBy: 'admin@test.com',
};

// ─────────────────────────────────────────────────────────────────────────────
// MOCK CONNECTION
// ─────────────────────────────────────────────────────────────────────────────

const mockConnection = {
  execute: jest.fn(),
  query: jest.fn(),
  release: jest.fn(),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
};

/** Default execute implementation — dispatches on SQL verb.
 *  Uses 'COUNT(' (with paren) to distinguish aggregate queries from table names
 *  that contain "count" as a substring (e.g. "accounttypebase"). */
const defaultExecuteImpl = (sql) => {
  const s = (sql || '').toUpperCase();
  if (s.includes('COUNT(')) return Promise.resolve([[{ total: 1 }]]);
  if (s.includes('SELECT')) return Promise.resolve([[MOCK_ROW]]);
  return Promise.resolve([[{ affectedRows: 1 }]]);
};

/** Default query implementation — used by paginated list fetches */
const defaultQueryImpl = () => Promise.resolve([[MOCK_ROW]]);

/** Implementation that returns empty for SELECT → triggers 404 paths.
 *  Uses 'COUNT(' (with paren) to distinguish aggregate queries from table names
 *  that happen to contain the word "count" (e.g. "accounttypebase"). */
const notFoundExecuteImpl = (sql) => {
  const s = (sql || '').toUpperCase();
  if (s.includes('COUNT(')) return Promise.resolve([[{ total: 0 }]]);
  if (s.includes('SELECT')) return Promise.resolve([[]]); // empty → 404
  return Promise.resolve([[{ affectedRows: 0 }]]);
};

// ─────────────────────────────────────────────────────────────────────────────
// MODULE DEFINITIONS
// All 31 CRUD API paths with fully-valid create request bodies.
// Bodies are validated to satisfy every Joi .required() field in each module.
// ─────────────────────────────────────────────────────────────────────────────

const MODULES = [
  // 1
  {
    path: '/api/taxtypes',
    // Name: string required, Value: number required
    body: { Name: 'GST', Value: 18, Active: true },
  },
  // 2
  {
    path: '/api/uom',
    // UnitName: string required
    body: { UnitName: 'KG', IsPrimary: false, Active: true },
  },
  // 3
  {
    path: '/api/categories',
    // Name: string required
    body: { Name: 'Electronics', Active: true },
  },
  // 4
  {
    path: '/api/transactiontypeconfigs',
    // StartCounterNo: number required, Format: string required, TagName: string required
    body: { StartCounterNo: 1001, Format: 'INV-{SEQ}', TagName: 'inv-config', Active: true },
  },
  // 5
  {
    path: '/api/organizations',
    // Name: string required
    body: { Name: 'Acme Corp', Active: true },
  },
  // 6
  {
    path: '/api/uomfactors',
    // PrimaryUOMId, SecondaryUOMId: uuid required; Factor: number required
    body: { PrimaryUOMId: UUID_1, SecondaryUOMId: UUID_1, Factor: 1000, Active: true },
  },
  // 7
  {
    path: '/api/transactiontypes',
    // Name: string required, TransactionTypeConfigId: uuid required
    body: { Name: 'Sales', TransactionTypeConfigId: UUID_1, Active: true },
  },
  // 8
  {
    path: '/api/accounttypes',
    // Name: string required
    body: { Name: 'Expense', Active: true },
  },
  // 9
  {
    path: '/api/accounttypebases',
    // Name: string required
    body: { Name: 'Sales', Active: true },
  },
  // 10
  {
    path: '/api/transactiontypestatuses',
    // Name: string required
    body: { Name: 'Pending', Active: true },
  },
  // 11
  {
    path: '/api/contactaddresstypes',
    // Name: string required
    body: { Name: 'Home', Active: true },
  },
  // 12
  {
    path: '/api/taxgroups',
    // Name: string required
    body: { Name: 'GST 18%', Active: true },
  },
  // 13
  {
    path: '/api/taxgrouptaxtypemappers',
    // TaxGroupId, TaxTypeId: uuid required
    body: { TaxGroupId: UUID_1, TaxTypeId: UUID_1, Active: true },
  },
  // 14
  {
    path: '/api/mapproviders',
    // ProviderName: string required
    body: { ProviderName: 'Google Maps', Active: true },
  },
  // 15
  {
    path: '/api/locationdetails',
    // Lat, Lng: number required (Joi number type — not string)
    body: { Lat: 12.9716, Lng: 77.5946, Active: true },
  },
  // 16
  {
    path: '/api/mapproviderlocationmappers',
    // MapProviderId, LocationDetailId: uuid required; TagName: string required
    body: { MapProviderId: UUID_1, LocationDetailId: UUID_1, TagName: 'map-loc-tag', Active: true },
  },
  // 17
  {
    path: '/api/contactdetails',
    // FirstName, LastName: string required
    body: { FirstName: 'John', LastName: 'Doe', Active: true },
  },
  // 18
  {
    path: '/api/addressdetails',
    // AddressLine1, TagName: string required; ContactAddressTypeId: uuid required (DB NOT NULL).
    // MapProviderLocationMapperId (Location Mapper) is optional/nullable — omitted here on purpose.
    body: {
      AddressLine1: '123 Main St',
      TagName: 'addr-tag-001',
      ContactAddressTypeId: UUID_1,
      Active: true,
    },
  },
  // 19
  {
    path: '/api/costinfos',
    // Amount: number required (Joi number — not string)
    body: { Amount: 1000, TaxGroupId: UUID_1, IsTaxIncluded: false, Active: true },
  },
  // 20
  {
    path: '/api/branchdetails',
    // BranchName OR Name required (schema uses .or())
    // updateBody must also supply BranchName or Name — { Active: false } alone fails .or()
    body: { BranchName: 'HQ', Active: true },
    updateBody: { BranchName: 'Updated HQ' },
  },
  // 21
  {
    path: '/api/branchusergroupmappers',
    // BranchDetailId, UserGroupId: uuid required
    body: { BranchDetailId: UUID_1, UserGroupId: UUID_1, Active: true },
  },
  // 22
  {
    path: '/api/batchdetails',
    // BatchNo: string required
    body: { BatchNo: 'B-001', IsNonReturnable: false, Active: true },
  },
  // 23
  {
    path: '/api/itemdetails',
    // Name: string required
    body: { Name: 'Widget', Active: true },
  },
  // 24
  {
    path: '/api/transactiontypebaseconversions',
    // TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId: uuid required
    body: {
      TransactionTypeConfigId: UUID_1,
      FromTransactionTypeStatusId: UUID_1,
      ToTransactionTypeStatusId: UUID_1,
      Active: true,
    },
  },
  // 25
  {
    path: '/api/transactiondetaillogs',
    // TransactionNo: string required, TransactionTypeConfigId: uuid required, TransactionDate required
    body: {
      TransactionNo: 'INV-001',
      TransactionTypeConfigId: UUID_1,
      TransactionDate: '2026-05-31',
      Active: true,
    },
  },
  // 26
  {
    path: '/api/transactionitemdetails',
    // TransactionDetailLogId, ItemId: uuid required
    body: { TransactionDetailLogId: UUID_1, ItemId: UUID_1, Active: true },
  },
  // 27
  {
    path: '/api/transactiontypeconversionmappers',
    // TransactionTypeBaseCoversionId, TransactionDetailLogId, TransactionTypeStatusId: uuid required
    body: {
      TransactionTypeBaseCoversionId: UUID_1,
      TransactionDetailLogId: UUID_1,
      TransactionTypeStatusId: UUID_1,
      Active: true,
    },
  },
  // 28
  {
    path: '/api/paymentreceivedtypes',
    // Type: string required
    body: { Type: 'Full Payment', Active: true },
  },
  // 29
  {
    path: '/api/paymentmodes',
    // Type: string required
    body: { Type: 'Cash', Active: true },
  },
  // 30
  {
    path: '/api/paymentmodetransactiondetails',
    // PaymentModeId: uuid required
    body: { PaymentModeId: UUID_1, Active: true },
  },
  // 31
  {
    path: '/api/paymentdetails',
    // AccountTypeBaseId, TransactionDetailLogId: uuid required; TotalAmount, GrossAmount: string required
    body: {
      AccountTypeBaseId: UUID_1,
      TransactionDetailLogId: UUID_1,
      TotalAmount: '1000',
      GrossAmount: '1000',
      Active: true,
    },
  },
  // 32
  {
    path: '/api/paymentbreakups',
    // AccountTypeBaseId, PaymentDetailId, PaymentModeTransactionDetailId, PaymentReceivedTypeId: uuid required
    // Timestamp: date required
    body: {
      AccountTypeBaseId: UUID_1,
      PaymentDetailId: UUID_1,
      PaymentModeTransactionDetailId: UUID_1,
      PaymentReceivedTypeId: UUID_1,
      Timestamp: '2026-05-31T10:00:00.000Z',
      Active: true,
    },
  },

  // ─── POS (Front Desk) modules ───
  { path: '/api/pos/floors', body: { Name: 'Main Dining', Active: true } },
  { path: '/api/pos/tables', body: { Name: 'Table 1', Active: true }, updateBody: { Status: 'Occupied' } },
  { path: '/api/pos/food-types', body: { Name: 'Veg', Code: 'veg', IsVeg: true, Active: true }, updateBody: { Name: 'Non-Veg' } },
  { path: '/api/pos/item-meta', body: { ItemDetailId: UUID_1, FoodTypeId: UUID_1, Channels: { dinein: true }, Prices: { dinein: 100 }, Variants: [], BranchDetailId: UUID_1, Active: true }, updateBody: { FoodTypeId: UUID_1 } },
  { path: '/api/pos/customers', body: { Name: 'Rahul Verma', Phone: '9876543210', Active: true } },
  { path: '/api/pos/orders', body: { OrderNo: 'ORD-1', Active: true }, updateBody: { Status: 'closed' } },
  { path: '/api/pos/kots', body: { KotNo: 'KOT-1', Active: true }, updateBody: { Status: 'ready' } },
  { path: '/api/pos/bills', body: { BillNo: 'BILL-1', Active: true }, updateBody: { Status: 'paid' } },
  { path: '/api/pos/online-orders', body: { Platform: 'Swiggy', Active: true }, updateBody: { Status: 'accepted' } },
  { path: '/api/pos/feedback', body: { CustomerName: 'Rahul', Rating: 5, Active: true }, updateBody: { Rating: 4 } },
  { path: '/api/pos/tokens', body: { TokenNumber: 1, Active: true }, updateBody: { Status: 'called' } },
  { path: '/api/pos/expenses', body: { Category: 'Groceries', Amount: 500, Active: true }, updateBody: { Amount: 600 } },
  { path: '/api/pos/staff', body: { Name: 'Head Chef', Role: 'Kitchen', Active: true }, updateBody: { Role: 'Manager' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// BUILD APP ONCE
//
// The suite is bound to a single long-lived listener rather than passing the
// bare express app to supertest. `request(server)` spins up a NEW http server on a
// fresh ephemeral port for every call — this file issues ~1165 of them, and the
// resulting port churn intermittently reused a port still in TIME_WAIT, so a
// request would come back as a bare 400 with an empty body (Node's clientError
// response, never our errorHandler). Reusing one listener removes that race.
// ─────────────────────────────────────────────────────────────────────────────

let app;
let server;

beforeAll((done) => {
  app = express();
  app.use(cors());
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => {
  if (server) server.close(done);
  else done();
});

// ─────────────────────────────────────────────────────────────────────────────
// RESET MOCKS BEFORE EACH TEST
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  const db = require('../../config/db');
  db.getConnection.mockResolvedValue(mockConnection);
  db.execute.mockResolvedValue([[{ affectedRows: 1 }]]);

  mockConnection.execute.mockImplementation(defaultExecuteImpl);
  mockConnection.query.mockImplementation(defaultQueryImpl);
  mockConnection.release.mockReturnValue(undefined);
  mockConnection.beginTransaction.mockResolvedValue(undefined);
  mockConnection.commit.mockResolvedValue(undefined);
  mockConnection.rollback.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — restore default mocks (used after deliberately overriding them)
// ─────────────────────────────────────────────────────────────────────────────

function restoreDefaultMocks() {
  const db = require('../../config/db');
  db.getConnection.mockResolvedValue(mockConnection);
  mockConnection.execute.mockImplementation(defaultExecuteImpl);
  mockConnection.query.mockImplementation(defaultQueryImpl);
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATED INTEGRATION TESTS — one describe block per module (32 modules)
// ─────────────────────────────────────────────────────────────────────────────

MODULES.forEach(({ path: basePath, body: createBody, updateBody }) => {
  // Default PUT body is { Active: false }; modules with special update validation
  // (e.g. branchdetails requires BranchName or Name) can override via updateBody.
  const putBody = updateBody || { Active: false };
  describe(`Integration: ${basePath}`, () => {

    // ── GET list ──────────────────────────────────────────────────────────────

    it('GET list — no token → 401', async () => {
      const res = await request(server).get(basePath);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('GET list — with admin token → 200', async () => {
      const res = await request(server)
        .get(basePath)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET list — with viewer token → 200', async () => {
      const res = await request(server)
        .get(basePath)
        .set('Authorization', viewerToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET list — with query params page=1&limit=5 → 200', async () => {
      const res = await request(server)
        .get(`${basePath}?page=1&limit=5`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    // ── GET by ID ─────────────────────────────────────────────────────────────

    it('GET /:id — valid UUID, record found → 200', async () => {
      const res = await request(server)
        .get(`${basePath}/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:id — valid UUID, record not found → 404', async () => {
      mockConnection.execute.mockImplementation(notFoundExecuteImpl);
      try {
        const res = await request(server)
          .get(`${basePath}/${RECORD_ID}`)
          .set('Authorization', adminToken());
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      } finally {
        restoreDefaultMocks();
      }
    });

    it('GET /:id — no token → 401', async () => {
      const res = await request(server).get(`${basePath}/${RECORD_ID}`);
      expect(res.status).toBe(401);
    });

    it('GET /:id — invalid UUID format → 400', async () => {
      const res = await request(server)
        .get(`${basePath}/not-a-uuid`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    // ── POST ──────────────────────────────────────────────────────────────────

    it('POST — no token → 401', async () => {
      const res = await request(server).post(basePath).send(createBody);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('POST — viewer scope → 403', async () => {
      const res = await request(server)
        .post(basePath)
        .set('Authorization', viewerToken())
        .send(createBody);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('POST — admin token, empty body → 400', async () => {
      const res = await request(server)
        .post(basePath)
        .set('Authorization', adminToken())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST — admin token, valid body → 201', async () => {
      const res = await request(server)
        .post(basePath)
        .set('Authorization', adminToken())
        .send(createBody);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    // ── PUT ───────────────────────────────────────────────────────────────────

    it('PUT /:id — no token → 401', async () => {
      const res = await request(server)
        .put(`${basePath}/${RECORD_ID}`)
        .send(putBody);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('PUT /:id — viewer scope → 403', async () => {
      const res = await request(server)
        .put(`${basePath}/${RECORD_ID}`)
        .set('Authorization', viewerToken())
        .send(putBody);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('PUT /:id — invalid UUID → 400', async () => {
      const res = await request(server)
        .put(`${basePath}/not-a-uuid`)
        .set('Authorization', adminToken())
        .send(putBody);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('PUT /:id — admin token, valid body → 200', async () => {
      const res = await request(server)
        .put(`${basePath}/${RECORD_ID}`)
        .set('Authorization', adminToken())
        .send(putBody);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('PUT /:id — admin token, record not found → 404', async () => {
      mockConnection.execute.mockImplementation(notFoundExecuteImpl);
      try {
        const res = await request(server)
          .put(`${basePath}/${RECORD_ID}`)
          .set('Authorization', adminToken())
          .send(putBody);
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      } finally {
        restoreDefaultMocks();
      }
    });

    // ── DELETE ────────────────────────────────────────────────────────────────

    it('DELETE /:id — no token → 401', async () => {
      const res = await request(server).delete(`${basePath}/${RECORD_ID}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /:id — viewer scope → 403', async () => {
      const res = await request(server)
        .delete(`${basePath}/${RECORD_ID}`)
        .set('Authorization', viewerToken());
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /:id — invalid UUID → 400', async () => {
      const res = await request(server)
        .delete(`${basePath}/not-a-uuid`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /:id — admin token, valid ID → 204', async () => {
      const res = await request(server)
        .delete(`${basePath}/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(204);
    });

    it('DELETE /:id — admin token, record not found → 404', async () => {
      mockConnection.execute.mockImplementation(notFoundExecuteImpl);
      try {
        const res = await request(server)
          .delete(`${basePath}/${RECORD_ID}`)
          .set('Authorization', adminToken());
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      } finally {
        restoreDefaultMocks();
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth middleware edge cases', () => {
  it('should return 403 for a token signed with wrong secret', async () => {
    const badToken =
      'Bearer ' +
      jwt.sign(
        { tid: TENANT_ID, email: 'hacker@test.com', scopes: ['TENANT:ADMIN'] },
        'wrong-secret'
      );
    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', badToken);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 when Authorization header is missing', async () => {
    const res = await request(server).get('/api/uom');
    expect(res.status).toBe(401);
  });

  it('should return 403 when token is missing tid field', async () => {
    const noTidToken =
      'Bearer ' +
      jwt.sign(
        { email: 'user@test.com', scopes: ['TENANT:ADMIN'] },
        TEST_SECRET
      );
    const res = await request(server)
      .get('/api/categories')
      .set('Authorization', noTidToken);
    expect(res.status).toBe(403);
  });

  it('should return 403 when token is missing scopes field', async () => {
    const noScopesToken =
      'Bearer ' +
      jwt.sign({ tid: TENANT_ID, email: 'user@test.com' }, TEST_SECRET);
    const res = await request(server)
      .get('/api/categories')
      .set('Authorization', noScopesToken);
    expect(res.status).toBe(403);
  });

  it('TENANT:SUPER_ADMIN bypasses scope check on POST', async () => {
    const superAdminToken =
      'Bearer ' +
      jwt.sign(
        {
          tid: TENANT_ID,
          email: 'superadmin@test.com',
          scopes: ['TENANT:SUPER_ADMIN'],
        },
        TEST_SECRET
      );
    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', superAdminToken)
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('should return 403 when token has empty scopes array on write', async () => {
    const emptyScope =
      'Bearer ' +
      jwt.sign(
        { tid: TENANT_ID, email: 'empty@test.com', scopes: [] },
        TEST_SECRET
      );
    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', emptyScope)
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 on malformed Bearer token value', async () => {
    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', 'Bearer notavalidjwt');
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('Error handler — duplicate entry', () => {
  it('should return 409 with DUPLICATE_ENTRY on ER_DUP_ENTRY during INSERT', async () => {
    // For POST to reach INSERT, SELECT must succeed (returns MOCK_ROW to pass all checks)
    // but the actual INSERT execute must throw the duplicate error.
    let callIndex = 0;
    mockConnection.execute.mockImplementation((sql) => {
      const s = (sql || '').toUpperCase();
      if (s.includes('COUNT')) return Promise.resolve([[{ total: 0 }]]);
      if (s.startsWith('SELECT') || s.includes('WHERE')) {
        // First SELECT check passes (no conflict found)
        callIndex++;
        return Promise.resolve([[MOCK_ROW]]);
      }
      // INSERT path → throw duplicate error
      const err = new Error("Duplicate entry 'value' for key 'PRIMARY'");
      err.code = 'ER_DUP_ENTRY';
      err.errno = 1062;
      return Promise.reject(err);
    });

    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({ Name: 'GST', Value: 18, Active: true });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DUPLICATE_ENTRY');
  });
});

describe('Error handler — foreign key constraint', () => {
  it('should return 409 with RESOURCE_IN_USE on ER_ROW_IS_REFERENCED_2 during DELETE', async () => {
    // SELECT for existence check → record found; DELETE → FK error
    mockConnection.execute.mockImplementation((sql) => {
      const s = (sql || '').toUpperCase();
      if (s.includes('COUNT')) return Promise.resolve([[{ total: 1 }]]);
      if (s.includes('SELECT')) return Promise.resolve([[MOCK_ROW]]);
      // DELETE path → FK constraint error
      const err = new Error(
        'Cannot delete parent row: a foreign key constraint fails (`db`.`child`, CONSTRAINT `fk_name` FOREIGN KEY (`ParentId`) REFERENCES `parent` (`Id`))'
      );
      err.code = 'ER_ROW_IS_REFERENCED_2';
      err.errno = 1451;
      err.sqlMessage = err.message;
      return Promise.reject(err);
    });

    const res = await request(server)
      .delete(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken());

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('RESOURCE_IN_USE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Pagination query parameter validation', () => {
  it('should return 400 when page=0 (below minimum of 1)', async () => {
    const res = await request(server)
      .get('/api/taxtypes?page=0')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when limit exceeds maximum (>100)', async () => {
    const res = await request(server)
      .get('/api/taxtypes?limit=101')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when limit=0', async () => {
    const res = await request(server)
      .get('/api/taxtypes?limit=0')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 200 for valid page=2&limit=20', async () => {
    const res = await request(server)
      .get('/api/taxtypes?page=2&limit=20')
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 200 for page=1&limit=100 (max limit)', async () => {
    const res = await request(server)
      .get('/api/uom?page=1&limit=100')
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT-TYPE HANDLING
// ─────────────────────────────────────────────────────────────────────────────

describe('Content-Type handling', () => {
  it('should return 201 with explicit application/json Content-Type', async () => {
    const res = await request(server)
      .post('/api/categories')
      .set('Authorization', adminToken())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ Name: 'Electronics', Active: true }));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE FAILURE SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe('Database failure handling', () => {
  it('GET list — db.getConnection rejects → 500', async () => {
    const db = require('../../config/db');
    db.getConnection.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', adminToken());
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('POST — execute INSERT rejects with generic error → 500', async () => {
    mockConnection.execute.mockImplementation((sql) => {
      const s = (sql || '').toUpperCase();
      if (s.includes('COUNT')) return Promise.resolve([[{ total: 0 }]]);
      // Any SELECT used during create returns a row so we don't hit 404 path
      if (s.includes('SELECT')) return Promise.resolve([[MOCK_ROW]]);
      return Promise.reject(new Error('DB write failed unexpectedly'));
    });

    const res = await request(server)
      .post('/api/categories')
      .set('Authorization', adminToken())
      .send({ Name: 'Electronics', Active: true });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('GET by ID — execute SELECT rejects → 500', async () => {
    mockConnection.execute.mockImplementation(() =>
      Promise.reject(new Error('DB read failed'))
    );

    const res = await request(server)
      .get(`/api/categories/${RECORD_ID}`)
      .set('Authorization', adminToken());
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BODY VALIDATION — module-specific required-field checks
// ─────────────────────────────────────────────────────────────────────────────

describe('Body validation — required fields', () => {
  it('POST /api/transactiontypeconfigs — missing TagName → 400', async () => {
    const res = await request(server)
      .post('/api/transactiontypeconfigs')
      .set('Authorization', adminToken())
      // StartCounterNo and Format present but TagName missing
      .send({ StartCounterNo: 1001, Format: 'INV-{SEQ}' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/uomfactors — missing Factor → 400', async () => {
    const res = await request(server)
      .post('/api/uomfactors')
      .set('Authorization', adminToken())
      .send({ PrimaryUOMId: UUID_1, SecondaryUOMId: UUID_1 }); // Factor omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/addressdetails — missing AddressLine1 → 400', async () => {
    const res = await request(server)
      .post('/api/addressdetails')
      .set('Authorization', adminToken())
      .send({ TagName: 'addr-tag-001' }); // AddressLine1 omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/mapproviderlocationmappers — missing TagName → 400', async () => {
    const res = await request(server)
      .post('/api/mapproviderlocationmappers')
      .set('Authorization', adminToken())
      .send({ MapProviderId: UUID_1, LocationDetailId: UUID_1 }); // TagName omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/locationdetails — missing Lng → 400', async () => {
    const res = await request(server)
      .post('/api/locationdetails')
      .set('Authorization', adminToken())
      .send({ Lat: 12.97 }); // Lng omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/transactiontypes — missing TransactionTypeConfigId → 400', async () => {
    const res = await request(server)
      .post('/api/transactiontypes')
      .set('Authorization', adminToken())
      .send({ Name: 'Sales' }); // TransactionTypeConfigId omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/paymentbreakups — missing Timestamp → 400', async () => {
    const res = await request(server)
      .post('/api/paymentbreakups')
      .set('Authorization', adminToken())
      .send({
        AccountTypeBaseId: UUID_1,
        PaymentDetailId: UUID_1,
        PaymentModeTransactionDetailId: UUID_1,
        PaymentReceivedTypeId: UUID_1,
        // Timestamp omitted
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/taxgrouptaxtypemappers — missing TaxTypeId → 400', async () => {
    const res = await request(server)
      .post('/api/taxgrouptaxtypemappers')
      .set('Authorization', adminToken())
      .send({ TaxGroupId: UUID_1 }); // TaxTypeId omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/transactiontypeconversionmappers — missing TransactionTypeStatusId → 400', async () => {
    const res = await request(server)
      .post('/api/transactiontypeconversionmappers')
      .set('Authorization', adminToken())
      .send({
        TransactionTypeBaseCoversionId: UUID_1,
        TransactionDetailLogId: UUID_1,
        // TransactionTypeStatusId omitted
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/paymentdetails — missing TotalAmount → 400', async () => {
    const res = await request(server)
      .post('/api/paymentdetails')
      .set('Authorization', adminToken())
      .send({
        AccountTypeBaseId: UUID_1,
        TransactionDetailLogId: UUID_1,
        GrossAmount: '1000',
        // TotalAmount omitted
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PUT /:id — empty body → 400 (at least one field required)', async () => {
    const res = await request(server)
      .put(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CORS HEADERS
// ─────────────────────────────────────────────────────────────────────────────

describe('CORS headers', () => {
  it('should include Access-Control-Allow-Origin header on GET', async () => {
    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', adminToken())
      .set('Origin', 'http://example.com');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('OPTIONS preflight should succeed (200 or 204)', async () => {
    const res = await request(server)
      .options('/api/taxtypes')
      .set('Origin', 'http://example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect([200, 204]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROOT HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe('Root health check', () => {
  it('GET / → 200 with API metadata', async () => {
    const res = await request(server).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOGGER MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit routes — AUDIT:READ / admin:access gating', () => {
  ['/api/audit/logs', '/api/audit/categories'].forEach((p) => {
    it(`GET ${p} — no token → 401`, async () => {
      const res = await request(server).get(p);
      expect(res.status).toBe(401);
    });

    it(`GET ${p} — read-only user without AUDIT:READ → 403`, async () => {
      const res = await request(server).get(p).set('Authorization', viewerToken());
      expect(res.status).toBe(403);
    });

    it(`GET ${p} — AUDIT:READ token → not 403/401`, async () => {
      mockConnection.execute.mockImplementation(defaultExecuteImpl);
      mockConnection.query.mockImplementation(defaultQueryImpl);
      const res = await request(server).get(p).set('Authorization', auditReadToken());
      expect(res.status).toBe(200);
    });

    it(`GET ${p} — admin:access token still allowed → 200`, async () => {
      mockConnection.execute.mockImplementation(defaultExecuteImpl);
      mockConnection.query.mockImplementation(defaultQueryImpl);
      const res = await request(server).get(p).set('Authorization', iamAdminToken());
      expect(res.status).toBe(200);
    });
  });
});

describe('Master-data bootstrap — POST /api/master-data/bootstrap', () => {
  const validBootstrap = () => ({
    organization: { Name: 'ANM Tech' },
    branch: {
      Name: 'Main Branch',
      address: {
        AddressLine1: '12 MG Road', TagName: 'HQ',
        contactAddressType: { Name: 'Registered' },
        locationMapper: {
          TagName: 'HQ-LOC',
          mapProvider: { ProviderName: 'Google' },
          locationDetail: { Lat: 12.97, Lng: 77.59 },
        },
      },
      contact: { FirstName: 'Ravi', LastName: 'K' },
      transactionTypeConfig: { StartCounterNo: 1, Format: 'INV-{0000}', TagName: 'Invoice' },
    },
    item: {
      Name: 'Masala Dosa',
      category: { Name: 'South Indian' },
      uom: { UnitName: 'Plate' },
      costInfo: { Amount: 120, taxGroup: { Name: 'GST5' } },
    },
  });

  it('no token → 401', async () => {
    const res = await request(server).post('/api/master-data/bootstrap').send(validBootstrap());
    expect(res.status).toBe(401);
  });

  it('read-only scope (no TENANT:ADMIN) → 403', async () => {
    const res = await request(server)
      .post('/api/master-data/bootstrap')
      .set('Authorization', viewerToken())
      .send(validBootstrap());
    expect(res.status).toBe(403);
  });

  it('missing branch → 400', async () => {
    const body = validBootstrap();
    delete body.branch;
    const res = await request(server)
      .post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('admin, valid tree → 201 with an id map, inside one committed transaction', async () => {
    mockConnection.execute.mockImplementation(defaultExecuteImpl);
    const res = await request(server)
      .post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send(validBootstrap());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        organization: expect.any(String),
        branch: expect.any(String),
        item: expect.any(String),
        taxGroup: expect.any(String),
      })
    );
    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(mockConnection.commit).toHaveBeenCalled();
  });

  it('admin, valid tree WITHOUT locationMapper → 201 (Location Mapper optional)', async () => {
    mockConnection.execute.mockImplementation(defaultExecuteImpl);
    const body = validBootstrap();
    delete body.branch.address.locationMapper;
    const res = await request(server)
      .post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockConnection.commit).toHaveBeenCalled();
  });

  it('mid-transaction failure → rolls back, nothing committed, → 500', async () => {
    // Fail the branch insert; everything must roll back.
    mockConnection.execute.mockImplementation((sql) => {
      if ((sql || '').includes('INSERT INTO branchdetail')) {
        return Promise.reject(new Error('branch insert failed'));
      }
      return defaultExecuteImpl(sql);
    });
    const res = await request(server)
      .post('/api/master-data/bootstrap')
      .set('Authorization', adminToken())
      .send(validBootstrap());
    expect(res.status).toBe(500);
    expect(mockConnection.rollback).toHaveBeenCalled();
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });
});

describe('Audit logger middleware', () => {
  it('should call db.execute for audit logging after authenticated POST', async () => {
    const db = require('../../config/db');

    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({ Name: 'GST', Value: 18, Active: true });

    expect(res.status).toBe(201);
    // auditLog() middleware calls db.execute with INSERT_MIDDLEWARE
    expect(db.execute).toHaveBeenCalled();
  });

  it('should call db.execute for audit logging after authenticated GET list', async () => {
    const db = require('../../config/db');

    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', adminToken());

    expect(res.status).toBe(200);
    expect(db.execute).toHaveBeenCalled();
  });

  it('should NOT call db.execute for audit when request is unauthenticated (no token)', async () => {
    const db = require('../../config/db');

    await request(server).get('/api/taxtypes'); // no token → 401 before auditLog runs

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('audit log INSERT should NOT block response on db error', async () => {
    const db = require('../../config/db');
    // Make audit INSERT fail silently (auditLogger catches the error)
    db.execute.mockRejectedValue(new Error('Audit DB failure'));

    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', adminToken());

    // Route still returns 200 despite audit log failure
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE SHAPE ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('Response shape assertions', () => {
  it('GET list response has success:true', async () => {
    const res = await request(server)
      .get('/api/taxtypes')
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('GET by ID response has success:true', async () => {
    const res = await request(server)
      .get(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('POST 201 response has success:true', async () => {
    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('success', true);
  });

  it('PUT 200 response has success:true', async () => {
    const res = await request(server)
      .put(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken())
      .send({ Active: false });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('DELETE 204 response has empty body', async () => {
    const res = await request(server)
      .delete(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken());
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('401 response has success:false and message', async () => {
    const res = await request(server).get('/api/taxtypes');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  it('403 response has success:false and message', async () => {
    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', viewerToken())
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  it('400 response has success:false and message', async () => {
    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  it('404 response has success:false and message', async () => {
    mockConnection.execute.mockImplementation(notFoundExecuteImpl);
    try {
      const res = await request(server)
        .get(`/api/taxtypes/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('message');
    } finally {
      restoreDefaultMocks();
    }
  });

  it('409 DUPLICATE_ENTRY has success:false and error field', async () => {
    mockConnection.execute.mockImplementation((sql) => {
      const s = (sql || '').toUpperCase();
      if (s.includes('COUNT')) return Promise.resolve([[{ total: 0 }]]);
      if (s.includes('SELECT')) return Promise.resolve([[MOCK_ROW]]);
      const err = new Error("Duplicate entry");
      err.code = 'ER_DUP_ENTRY';
      err.errno = 1062;
      return Promise.reject(err);
    });

    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({ Name: 'GST', Value: 18, Active: true });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error', 'DUPLICATE_ENTRY');
  });

  it('500 error response has success:false and message', async () => {
    const db = require('../../config/db');
    db.getConnection.mockRejectedValueOnce(new Error('Unexpected DB error'));

    const res = await request(server)
      .get('/api/uom')
      .set('Authorization', adminToken());
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IAM — ONBOARDING GUEST ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Onboarding guest endpoints', () => {
  const ONBOARDING_ROW = {
    id: RECORD_ID,
    status: 'PENDING',
    request_note: 'Let me in',
    rejection_reason: null,
    requested_at: '2026-01-01T00:00:00Z',
  };

  it('GET /api/onboarding/status — no token → 401', async () => {
    const res = await request(server).get('/api/onboarding/status');
    expect(res.status).toBe(401);
  });

  it('GET /api/onboarding/status — non-guest (no guest:explore scope) → 403', async () => {
    const res = await request(server)
      .get('/api/onboarding/status')
      .set('Authorization', adminToken());
    expect(res.status).toBe(403);
  });

  it('GET /api/onboarding/status — guest token, record found → 200', async () => {
    mockConnection.execute.mockResolvedValueOnce([[ONBOARDING_ROW]]);
    const res = await request(server)
      .get('/api/onboarding/status')
      .set('Authorization', guestToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/onboarding/status — guest token, no record → 404', async () => {
    mockConnection.execute.mockResolvedValueOnce([[]]);
    const res = await request(server)
      .get('/api/onboarding/status')
      .set('Authorization', guestToken());
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('PUT /api/onboarding/note — no token → 401', async () => {
    const res = await request(server)
      .put('/api/onboarding/note')
      .send({ requestNote: 'Please add me' });
    expect(res.status).toBe(401);
  });

  it('PUT /api/onboarding/note — guest token → 200', async () => {
    mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(server)
      .put('/api/onboarding/note')
      .set('Authorization', guestToken())
      .send({ requestNote: 'Updated note' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IAM — ADMIN ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin IAM endpoints — auth guards', () => {
  const ADMIN_PATHS = [
    '/api/admin/onboarding-requests',
    '/api/admin/users',
    '/api/admin/roles',
    '/api/admin/features',
  ];

  ADMIN_PATHS.forEach((p) => {
    it(`GET ${p} — no token → 401`, async () => {
      const res = await request(server).get(p);
      expect(res.status).toBe(401);
    });

    it(`GET ${p} — no admin:access scope → 403`, async () => {
      const res = await request(server)
        .get(p)
        .set('Authorization', adminToken()); // has TENANT:ADMIN, not admin:access
      expect(res.status).toBe(403);
    });

    it(`GET ${p} — admin:access token → 200`, async () => {
      mockConnection.execute.mockImplementation(defaultExecuteImpl);
      mockConnection.query.mockImplementation(defaultQueryImpl);
      const res = await request(server)
        .get(p)
        .set('Authorization', iamAdminToken());
      expect([200, 404]).toContain(res.status);
    });
  });
});

describe('Admin IAM endpoints — role management', () => {
  it('POST /api/admin/roles — missing name → 400', async () => {
    const res = await request(server)
      .post('/api/admin/roles')
      .set('Authorization', iamAdminToken())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/admin/roles — valid body → 201', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: RECORD_ID, name: 'Editor' }]]);
    const res = await request(server)
      .post('/api/admin/roles')
      .set('Authorization', iamAdminToken())
      .send({ name: 'Editor', description: 'Can edit records' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('Admin IAM endpoints — role permissions with non-UUID roleId', () => {
  // roles.id is a VARCHAR(50) prefixed identifier (e.g. 'r0000001-iam0-...'),
  // NOT a strict UUID. The route must accept it, not reject with a 400.
  it('GET /api/admin/roles/:roleId/permissions — prefixed string id → not 400', async () => {
    mockConnection.execute.mockImplementation(defaultExecuteImpl);
    mockConnection.query.mockImplementation(defaultQueryImpl);
    const res = await request(server)
      .get('/api/admin/roles/r0000001-iam0-0000-0000-000000000001/permissions')
      .set('Authorization', iamAdminToken());
    expect(res.status).not.toBe(400);
  });

  it('GET /api/admin/roles/:roleId/permissions — empty-ish id still validated', async () => {
    const res = await request(server)
      .get('/api/admin/roles/%20/permissions')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(400);
  });
});

describe('Admin IAM endpoints — feature management', () => {
  it('POST /api/admin/features — missing required fields → 400', async () => {
    const res = await request(server)
      .post('/api/admin/features')
      .set('Authorization', iamAdminToken())
      .send({ displayName: 'Reports' }); // featureShortName and scope missing
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/features — valid → 201', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ feature_id: RECORD_ID, scope: 'READ' }]]);
    const res = await request(server)
      .post('/api/admin/features')
      .set('Authorization', iamAdminToken())
      .send({ featureShortName: 'REPORTS', scope: 'READ', displayName: 'Reports Read' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('Admin IAM endpoints — user status update', () => {
  it('PUT /api/admin/users/user@test.com/status — invalid status → 400', async () => {
    const res = await request(server)
      .put('/api/admin/users/user@test.com/status')
      .set('Authorization', iamAdminToken())
      .send({ status: 'BANNED' }); // not valid
    expect(res.status).toBe(400);
  });

  it('PUT /api/admin/users/user@test.com/status — ACTIVE → 200', async () => {
    mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(server)
      .put('/api/admin/users/user@test.com/status')
      .set('Authorization', iamAdminToken())
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NULL-TID GUEST TOKEN — authenticateToken edge case
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth middleware — null tid guest token', () => {
  it('null-tid guest token fails checkScope on POST route (scope guard returns 403)', async () => {
    const res = await request(server)
      .post('/api/taxtypes')
      .set('Authorization', guestToken())
      .send({ Name: 'GST', Value: 18, Active: true });
    // guest:explore scope cannot satisfy TENANT:ADMIN write scope → 403
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-MODULE SMOKE TESTS — spot-check a sample from each module group
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-module smoke tests', () => {
  const samplePaths = [
    '/api/taxtypes',
    '/api/uom',
    '/api/categories',
    '/api/organizations',
    '/api/taxgroups',
    '/api/mapproviders',
    '/api/paymentmodes',
    '/api/paymentreceivedtypes',
    '/api/accounttypes',
    '/api/accounttypebases',
    '/api/transactiontypestatuses',
    '/api/contactaddresstypes',
    '/api/batchdetails',
    '/api/itemdetails',
    '/api/transactiondetaillogs',
    '/api/transactionitemdetails',
    '/api/transactiontypeconversionmappers',
    '/api/paymentdetails',
    '/api/paymentbreakups',
  ];

  samplePaths.forEach((p) => {
    it(`GET ${p} — authenticated → 200`, async () => {
      const res = await request(server)
        .get(p)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it(`GET ${p}/${RECORD_ID} — authenticated → 200`, async () => {
      const res = await request(server)
        .get(`${p}/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN IAM — Part 2I endpoints (PUT approve/reject, shorter /onboarding path)
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin IAM — GET /api/admin/onboarding', () => {
  it('no token → 401', async () => {
    const res = await request(server).get('/api/admin/onboarding');
    expect(res.status).toBe(401);
  });

  it('no admin:access scope → 403', async () => {
    const res = await request(server)
      .get('/api/admin/onboarding')
      .set('Authorization', adminToken());
    expect(res.status).toBe(403);
  });

  it('admin:access token, default status PENDING → 200 with data + pagination', async () => {
    const res = await request(server)
      .get('/api/admin/onboarding')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
  });

  it('?status=ALL → 200', async () => {
    const res = await request(server)
      .get('/api/admin/onboarding?status=ALL')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('?status=APPROVED → 200', async () => {
    const res = await request(server)
      .get('/api/admin/onboarding?status=APPROVED')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
  });

  it('invalid status value → 400', async () => {
    const res = await request(server)
      .get('/api/admin/onboarding?status=UNKNOWN')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Admin IAM — PUT /api/admin/onboarding/:id/approve', () => {
  it('no token → 401', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(401);
  });

  it('no admin:access scope → 403', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .set('Authorization', adminToken())
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(403);
  });

  it('invalid UUID in :id → 400', async () => {
    const res = await request(server)
      .put('/api/admin/onboarding/not-a-valid-uuid/approve')
      .set('Authorization', iamAdminToken())
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('missing tenantId in body → 400', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .set('Authorization', iamAdminToken())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('request not found (not PENDING) → 404', async () => {
    mockConnection.execute.mockResolvedValueOnce([[]]); // no matching PENDING row
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .set('Authorization', iamAdminToken())
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(404);
  });

  it('user already exists in tenant → 409', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: RECORD_ID, email: 'guest@test.com', name: 'Guest' }]]) // request found
      .mockResolvedValueOnce([[{ id: UUID_1 }]]); // user already provisioned
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .set('Authorization', iamAdminToken())
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(409);
  });

  it('valid approval without roleIds → 200', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: RECORD_ID, email: 'guest@test.com', name: 'Guest' }]]) // request found
      .mockResolvedValueOnce([[]])  // user not yet in tenant
      .mockResolvedValue([[{ affectedRows: 1 }]]); // INSERT user_tenants, UPDATE onboarding_requests
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .set('Authorization', iamAdminToken())
      .send({ tenantId: TENANT_ID }); // roleIds omitted — Joi defaults to []
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ email: 'guest@test.com', tenantId: TENANT_ID });
  });

  it('valid approval with roleIds → 200, data includes roleIds', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: RECORD_ID, email: 'guest@test.com', name: 'Guest' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValue([[{ affectedRows: 1 }]]);
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/approve`)
      .set('Authorization', iamAdminToken())
      .send({ tenantId: TENANT_ID, roleIds: [UUID_1] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.roleIds).toEqual([UUID_1]);
  });
});

describe('Admin IAM — PUT /api/admin/onboarding/:id/reject', () => {
  it('no token → 401', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reject`)
      .send({ rejectionReason: 'Not eligible' });
    expect(res.status).toBe(401);
  });

  it('no admin:access scope → 403', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reject`)
      .set('Authorization', adminToken())
      .send({ rejectionReason: 'Not eligible' });
    expect(res.status).toBe(403);
  });

  it('invalid UUID in :id → 400', async () => {
    const res = await request(server)
      .put('/api/admin/onboarding/not-a-uuid/reject')
      .set('Authorization', iamAdminToken())
      .send({ rejectionReason: 'Not eligible' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('missing rejectionReason → 400', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reject`)
      .set('Authorization', iamAdminToken())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('request not found or already reviewed → 404', async () => {
    mockConnection.execute.mockResolvedValueOnce([[]]); // no PENDING row
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reject`)
      .set('Authorization', iamAdminToken())
      .send({ rejectionReason: 'Not eligible' });
    expect(res.status).toBe(404);
  });

  it('valid rejection → 200', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: RECORD_ID, email: 'guest@test.com' }]]) // request found
      .mockResolvedValueOnce([[{ affectedRows: 1 }]]); // UPDATE status
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reject`)
      .set('Authorization', iamAdminToken())
      .send({ rejectionReason: 'Not eligible at this time' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Admin IAM — PUT /api/admin/onboarding/:id/reopen', () => {
  it('no token → 401', async () => {
    const res = await request(server).put(`/api/admin/onboarding/${RECORD_ID}/reopen`);
    expect(res.status).toBe(401);
  });

  it('no admin:access scope → 403', async () => {
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reopen`)
      .set('Authorization', adminToken());
    expect(res.status).toBe(403);
  });

  it('invalid UUID in :id → 400', async () => {
    const res = await request(server)
      .put('/api/admin/onboarding/not-a-uuid/reopen')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('no REJECTED request found → 404', async () => {
    mockConnection.execute.mockResolvedValueOnce([[]]); // no REJECTED row
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reopen`)
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(404);
  });

  it('valid reopen of a rejected request → 200', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: RECORD_ID, email: 'guest@test.com', status: 'REJECTED' }]]) // rejected row found
      .mockResolvedValueOnce([[{ affectedRows: 1 }]]); // UPDATE back to PENDING
    const res = await request(server)
      .put(`/api/admin/onboarding/${RECORD_ID}/reopen`)
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Admin IAM — onboarding list status filter', () => {
  it('status=ALL returns rows without a status filter (no 400)', async () => {
    mockConnection.execute.mockImplementation(defaultExecuteImpl);
    mockConnection.query.mockImplementation(defaultQueryImpl);
    const res = await request(server)
      .get('/api/admin/onboarding?status=ALL')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('status=CANCELLED is accepted (no 400)', async () => {
    mockConnection.execute.mockImplementation(defaultExecuteImpl);
    mockConnection.query.mockImplementation(defaultQueryImpl);
    const res = await request(server)
      .get('/api/admin/onboarding?status=CANCELLED')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
  });

  it('unknown status → 400', async () => {
    const res = await request(server)
      .get('/api/admin/onboarding?status=BOGUS')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(400);
  });
});

describe('Admin IAM — GET /api/admin/users/:email/roles', () => {
  it('no token → 401', async () => {
    const res = await request(server).get('/api/admin/users/user@test.com/roles');
    expect(res.status).toBe(401);
  });

  it('no admin:access scope → 403', async () => {
    const res = await request(server)
      .get('/api/admin/users/user@test.com/roles')
      .set('Authorization', adminToken());
    expect(res.status).toBe(403);
  });

  it('user not found in tenant → 404', async () => {
    mockConnection.execute.mockResolvedValueOnce([[]]); // not in user_tenants
    const res = await request(server)
      .get('/api/admin/users/user@test.com/roles')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(404);
  });

  it('user found, returns roles array → 200', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: UUID_1 }]]) // user exists in tenant
      .mockResolvedValueOnce([[{ ...MOCK_ROW, role_name: 'EDITOR', is_system_role: 0 }]]); // roles
    const res = await request(server)
      .get('/api/admin/users/user@test.com/roles')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('user found, no roles assigned → 200 with empty array', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: UUID_1 }]]) // user exists in tenant
      .mockResolvedValueOnce([[]]); // no roles
    const res = await request(server)
      .get('/api/admin/users/user@test.com/roles')
      .set('Authorization', iamAdminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POS DOMAIN ACTIONS — HTTP-level tests (beyond CRUD)
// Covers auth (401), scope denial (403), validation (400), success, not-found (404)
// for: fire-KOT, mark-KOT-ready, settle-bill.
// ─────────────────────────────────────────────────────────────────────────────

describe('POS domain action: POST /api/pos/orders/:id/fire-kot', () => {
  const path = `/api/pos/orders/${RECORD_ID}/fire-kot`;

  it('no token → 401', async () => {
    const res = await request(server).post(path).send({});
    expect(res.status).toBe(401);
  });

  it('viewer scope → 403', async () => {
    const res = await request(server).post(path).set('Authorization', viewerToken()).send({});
    expect(res.status).toBe(403);
  });

  it('invalid UUID → 400', async () => {
    const res = await request(server)
      .post('/api/pos/orders/not-a-uuid/fire-kot')
      .set('Authorization', adminToken())
      .send({});
    expect(res.status).toBe(400);
  });

  it('admin, valid order → 201 with KOT summary', async () => {
    const res = await request(server).post(path).set('Authorization', adminToken()).send({ KotNo: 'KOT-1' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // This codebase returns the payload in `message` (the `data` field carries the text).
    expect(res.body.message).toHaveProperty('KotId');
  });

  it('order not found → 404', async () => {
    mockConnection.execute.mockImplementation(notFoundExecuteImpl);
    try {
      const res = await request(server).post(path).set('Authorization', adminToken()).send({});
      expect(res.status).toBe(404);
    } finally {
      restoreDefaultMocks();
    }
  });
});

describe('POS domain action: PATCH /api/pos/kots/:id/ready', () => {
  const path = `/api/pos/kots/${RECORD_ID}/ready`;

  it('no token → 401', async () => {
    const res = await request(server).patch(path);
    expect(res.status).toBe(401);
  });

  it('viewer scope → 403', async () => {
    const res = await request(server).patch(path).set('Authorization', viewerToken());
    expect(res.status).toBe(403);
  });

  it('invalid UUID → 400', async () => {
    const res = await request(server)
      .patch('/api/pos/kots/not-a-uuid/ready')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
  });

  it('admin, valid KOT → 200', async () => {
    const res = await request(server).patch(path).set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('KOT not found → 404', async () => {
    mockConnection.execute.mockImplementation(notFoundExecuteImpl);
    try {
      const res = await request(server).patch(path).set('Authorization', adminToken());
      expect(res.status).toBe(404);
    } finally {
      restoreDefaultMocks();
    }
  });
});

describe('POS domain action: POST /api/pos/bills/:id/settle', () => {
  const path = `/api/pos/bills/${RECORD_ID}/settle`;
  const validBody = { Payments: [{ mode: 'cash', amount: 100 }], Discount: 0 };

  it('no token → 401', async () => {
    const res = await request(server).post(path).send(validBody);
    expect(res.status).toBe(401);
  });

  it('viewer scope → 403', async () => {
    const res = await request(server).post(path).set('Authorization', viewerToken()).send(validBody);
    expect(res.status).toBe(403);
  });

  it('invalid UUID → 400', async () => {
    const res = await request(server)
      .post('/api/pos/bills/not-a-uuid/settle')
      .set('Authorization', adminToken())
      .send(validBody);
    expect(res.status).toBe(400);
  });

  it('missing Payments → 400', async () => {
    const res = await request(server).post(path).set('Authorization', adminToken()).send({});
    expect(res.status).toBe(400);
  });

  it('admin, valid settle → 200', async () => {
    const res = await request(server).post(path).set('Authorization', adminToken()).send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('bill not found → 404', async () => {
    mockConnection.execute.mockImplementation(notFoundExecuteImpl);
    try {
      const res = await request(server).post(path).set('Authorization', adminToken()).send(validBody);
      expect(res.status).toBe(404);
    } finally {
      restoreDefaultMocks();
    }
  });
});
