/**
 * mockFactory.js
 *
 * Factory functions for creating and configuring mock DB connections.
 * Each function has a single, focused responsibility.
 *
 * DIP: tests depend on this abstraction, not on concrete mock objects.
 * SRP: each function does exactly one thing.
 * ISP: callers import only the helpers they need.
 */

const TENANT_ID = 'e3845e08-dcc2-11f0-8e78-0242ac110002';
const RECORD_ID = 'f1f1f1f1-0000-0000-0000-000000000001';

/**
 * Creates a fresh mock database connection.
 * Callers must hold a reference; reassign jest mock implementations as needed.
 */
const createMockConnection = () => ({
  execute:          jest.fn(),
  query:            jest.fn(),
  release:          jest.fn(),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit:           jest.fn().mockResolvedValue(undefined),
  rollback:         jest.fn().mockResolvedValue(undefined),
});

/**
 * Configures execute + query to return `row` for SELECT/COUNT queries
 * and `{ affectedRows: 1 }` for everything else (INSERT / UPDATE / DELETE).
 *
 * Satisfies the sequence used by BaseCRUDService.update:
 *   1. SELECT_BY_ID  → row
 *   2. UPDATE        → affectedRows
 *   3. SELECT_BY_ID  → row  (post-update fetch)
 */
const setupReadWriteMock = (connection, row) => {
  connection.execute.mockImplementation((sql) => {
    const upper = (sql || '').toUpperCase();
    if (upper.includes('COUNT(')) return Promise.resolve([[{ total: 1 }]]);
    if (upper.includes('SELECT'))  return Promise.resolve([[row]]);
    return Promise.resolve([[{ affectedRows: 1 }]]);
  });
  connection.query.mockResolvedValue([[row]]);
};

/**
 * Configures execute to return `{ affectedRows: 1 }` for INSERT statements.
 * Use this for isolated create tests that don't need a SELECT response.
 */
const setupInsertMock = (connection) => {
  connection.execute.mockResolvedValue([[{ affectedRows: 1 }]]);
};

/**
 * Configures execute to return an empty result set for SELECT queries.
 * Used to simulate "record not found" scenarios.
 */
const setupNotFoundMock = (connection) => {
  connection.execute.mockResolvedValue([[]]); // empty rows
};

/**
 * Builds a minimal existing-record row for SELECT_BY_ID responses.
 * Spread `extra` fields to add entity-specific columns.
 */
const buildExistingRow = (extra = {}) => ({
  Id:       RECORD_ID,
  TenantId: TENANT_ID,
  Active:   1,
  Name:     'ExistingRecord',
  ...extra,
});

module.exports = {
  TENANT_ID,
  RECORD_ID,
  createMockConnection,
  setupReadWriteMock,
  setupInsertMock,
  setupNotFoundMock,
  buildExistingRow,
};
