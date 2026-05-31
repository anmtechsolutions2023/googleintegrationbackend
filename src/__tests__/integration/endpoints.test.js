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
  JWT: { EXPIRATION: '1h' },
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

const viewerToken = () =>
  'Bearer ' +
  jwt.sign(
    { tid: TENANT_ID, email: 'viewer@test.com', scopes: ['TENANT:VIEWER'] },
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
    // AddressLine1: string required, TagName: string required
    body: { AddressLine1: '123 Main St', TagName: 'addr-tag-001', Active: true },
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
    // BranchId, UserGroupId: uuid required (schema uses BranchId, NOT BranchDetailId)
    body: { BranchId: UUID_1, UserGroupId: UUID_1, Active: true },
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
];

// ─────────────────────────────────────────────────────────────────────────────
// BUILD APP ONCE
// ─────────────────────────────────────────────────────────────────────────────

let app;

beforeAll(() => {
  app = express();
  app.use(cors());
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandler);
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
      const res = await request(app).get(basePath);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('GET list — with admin token → 200', async () => {
      const res = await request(app)
        .get(basePath)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET list — with viewer token → 200', async () => {
      const res = await request(app)
        .get(basePath)
        .set('Authorization', viewerToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET list — with query params page=1&limit=5 → 200', async () => {
      const res = await request(app)
        .get(`${basePath}?page=1&limit=5`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    // ── GET by ID ─────────────────────────────────────────────────────────────

    it('GET /:id — valid UUID, record found → 200', async () => {
      const res = await request(app)
        .get(`${basePath}/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:id — valid UUID, record not found → 404', async () => {
      mockConnection.execute.mockImplementation(notFoundExecuteImpl);
      try {
        const res = await request(app)
          .get(`${basePath}/${RECORD_ID}`)
          .set('Authorization', adminToken());
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      } finally {
        restoreDefaultMocks();
      }
    });

    it('GET /:id — no token → 401', async () => {
      const res = await request(app).get(`${basePath}/${RECORD_ID}`);
      expect(res.status).toBe(401);
    });

    it('GET /:id — invalid UUID format → 400', async () => {
      const res = await request(app)
        .get(`${basePath}/not-a-uuid`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    // ── POST ──────────────────────────────────────────────────────────────────

    it('POST — no token → 401', async () => {
      const res = await request(app).post(basePath).send(createBody);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('POST — viewer scope → 403', async () => {
      const res = await request(app)
        .post(basePath)
        .set('Authorization', viewerToken())
        .send(createBody);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('POST — admin token, empty body → 400', async () => {
      const res = await request(app)
        .post(basePath)
        .set('Authorization', adminToken())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST — admin token, valid body → 201', async () => {
      const res = await request(app)
        .post(basePath)
        .set('Authorization', adminToken())
        .send(createBody);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    // ── PUT ───────────────────────────────────────────────────────────────────

    it('PUT /:id — no token → 401', async () => {
      const res = await request(app)
        .put(`${basePath}/${RECORD_ID}`)
        .send(putBody);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('PUT /:id — viewer scope → 403', async () => {
      const res = await request(app)
        .put(`${basePath}/${RECORD_ID}`)
        .set('Authorization', viewerToken())
        .send(putBody);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('PUT /:id — invalid UUID → 400', async () => {
      const res = await request(app)
        .put(`${basePath}/not-a-uuid`)
        .set('Authorization', adminToken())
        .send(putBody);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('PUT /:id — admin token, valid body → 200', async () => {
      const res = await request(app)
        .put(`${basePath}/${RECORD_ID}`)
        .set('Authorization', adminToken())
        .send(putBody);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('PUT /:id — admin token, record not found → 404', async () => {
      mockConnection.execute.mockImplementation(notFoundExecuteImpl);
      try {
        const res = await request(app)
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
      const res = await request(app).delete(`${basePath}/${RECORD_ID}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /:id — viewer scope → 403', async () => {
      const res = await request(app)
        .delete(`${basePath}/${RECORD_ID}`)
        .set('Authorization', viewerToken());
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /:id — invalid UUID → 400', async () => {
      const res = await request(app)
        .delete(`${basePath}/not-a-uuid`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /:id — admin token, valid ID → 204', async () => {
      const res = await request(app)
        .delete(`${basePath}/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(204);
    });

    it('DELETE /:id — admin token, record not found → 404', async () => {
      mockConnection.execute.mockImplementation(notFoundExecuteImpl);
      try {
        const res = await request(app)
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
    const res = await request(app)
      .get('/api/taxtypes')
      .set('Authorization', badToken);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/uom');
    expect(res.status).toBe(401);
  });

  it('should return 403 when token is missing tid field', async () => {
    const noTidToken =
      'Bearer ' +
      jwt.sign(
        { email: 'user@test.com', scopes: ['TENANT:ADMIN'] },
        TEST_SECRET
      );
    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', noTidToken);
    expect(res.status).toBe(403);
  });

  it('should return 403 when token is missing scopes field', async () => {
    const noScopesToken =
      'Bearer ' +
      jwt.sign({ tid: TENANT_ID, email: 'user@test.com' }, TEST_SECRET);
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
      .post('/api/taxtypes')
      .set('Authorization', emptyScope)
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 on malformed Bearer token value', async () => {
    const res = await request(app)
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

    const res = await request(app)
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

    const res = await request(app)
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
    const res = await request(app)
      .get('/api/taxtypes?page=0')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when limit exceeds maximum (>100)', async () => {
    const res = await request(app)
      .get('/api/taxtypes?limit=101')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when limit=0', async () => {
    const res = await request(app)
      .get('/api/taxtypes?limit=0')
      .set('Authorization', adminToken());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 200 for valid page=2&limit=20', async () => {
    const res = await request(app)
      .get('/api/taxtypes?page=2&limit=20')
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 200 for page=1&limit=100 (max limit)', async () => {
    const res = await request(app)
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
    const res = await request(app)
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

    const res = await request(app)
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

    const res = await request(app)
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

    const res = await request(app)
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
    const res = await request(app)
      .post('/api/transactiontypeconfigs')
      .set('Authorization', adminToken())
      // StartCounterNo and Format present but TagName missing
      .send({ StartCounterNo: 1001, Format: 'INV-{SEQ}' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/uomfactors — missing Factor → 400', async () => {
    const res = await request(app)
      .post('/api/uomfactors')
      .set('Authorization', adminToken())
      .send({ PrimaryUOMId: UUID_1, SecondaryUOMId: UUID_1 }); // Factor omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/addressdetails — missing AddressLine1 → 400', async () => {
    const res = await request(app)
      .post('/api/addressdetails')
      .set('Authorization', adminToken())
      .send({ TagName: 'addr-tag-001' }); // AddressLine1 omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/mapproviderlocationmappers — missing TagName → 400', async () => {
    const res = await request(app)
      .post('/api/mapproviderlocationmappers')
      .set('Authorization', adminToken())
      .send({ MapProviderId: UUID_1, LocationDetailId: UUID_1 }); // TagName omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/locationdetails — missing Lng → 400', async () => {
    const res = await request(app)
      .post('/api/locationdetails')
      .set('Authorization', adminToken())
      .send({ Lat: 12.97 }); // Lng omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/transactiontypes — missing TransactionTypeConfigId → 400', async () => {
    const res = await request(app)
      .post('/api/transactiontypes')
      .set('Authorization', adminToken())
      .send({ Name: 'Sales' }); // TransactionTypeConfigId omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/paymentbreakups — missing Timestamp → 400', async () => {
    const res = await request(app)
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
    const res = await request(app)
      .post('/api/taxgrouptaxtypemappers')
      .set('Authorization', adminToken())
      .send({ TaxGroupId: UUID_1 }); // TaxTypeId omitted
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/transactiontypeconversionmappers — missing TransactionTypeStatusId → 400', async () => {
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
      .get('/api/taxtypes')
      .set('Authorization', adminToken())
      .set('Origin', 'http://example.com');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('OPTIONS preflight should succeed (200 or 204)', async () => {
    const res = await request(app)
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
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOGGER MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit logger middleware', () => {
  it('should call db.execute for audit logging after authenticated POST', async () => {
    const db = require('../../config/db');

    const res = await request(app)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({ Name: 'GST', Value: 18, Active: true });

    expect(res.status).toBe(201);
    // auditLog() middleware calls db.execute with INSERT_MIDDLEWARE
    expect(db.execute).toHaveBeenCalled();
  });

  it('should call db.execute for audit logging after authenticated GET list', async () => {
    const db = require('../../config/db');

    const res = await request(app)
      .get('/api/taxtypes')
      .set('Authorization', adminToken());

    expect(res.status).toBe(200);
    expect(db.execute).toHaveBeenCalled();
  });

  it('should NOT call db.execute for audit when request is unauthenticated (no token)', async () => {
    const db = require('../../config/db');

    await request(app).get('/api/taxtypes'); // no token → 401 before auditLog runs

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('audit log INSERT should NOT block response on db error', async () => {
    const db = require('../../config/db');
    // Make audit INSERT fail silently (auditLogger catches the error)
    db.execute.mockRejectedValue(new Error('Audit DB failure'));

    const res = await request(app)
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
    const res = await request(app)
      .get('/api/taxtypes')
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('GET by ID response has success:true', async () => {
    const res = await request(app)
      .get(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('POST 201 response has success:true', async () => {
    const res = await request(app)
      .post('/api/taxtypes')
      .set('Authorization', adminToken())
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('success', true);
  });

  it('PUT 200 response has success:true', async () => {
    const res = await request(app)
      .put(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken())
      .send({ Active: false });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('DELETE 204 response has empty body', async () => {
    const res = await request(app)
      .delete(`/api/taxtypes/${RECORD_ID}`)
      .set('Authorization', adminToken());
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('401 response has success:false and message', async () => {
    const res = await request(app).get('/api/taxtypes');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  it('403 response has success:false and message', async () => {
    const res = await request(app)
      .post('/api/taxtypes')
      .set('Authorization', viewerToken())
      .send({ Name: 'GST', Value: 18, Active: true });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  it('400 response has success:false and message', async () => {
    const res = await request(app)
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
      const res = await request(app)
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

    const res = await request(app)
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

    const res = await request(app)
      .get('/api/uom')
      .set('Authorization', adminToken());
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
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
      const res = await request(app)
        .get(p)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it(`GET ${p}/${RECORD_ID} — authenticated → 200`, async () => {
      const res = await request(app)
        .get(`${p}/${RECORD_ID}`)
        .set('Authorization', adminToken());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
