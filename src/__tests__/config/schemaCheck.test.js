// This project deploys by recreating the database, not by migration, so code and
// schema drift apart whenever someone pulls without recreating. The symptom is
// awful to read: every affected write 500s with "Unknown column", which looks
// like a bad request payload rather than a stale database. This check exists to
// say so once, at boot, in words.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { assertSchemaIsCurrent, findMissingColumns, REQUIRED_COLUMNS } = require('../../config/schemaCheck');
const { logger } = require('../../utils/logger');

/** Answers information_schema with the columns a healthy database would have. */
const withColumns = (drop = []) => {
  const rows = [];
  Object.entries(REQUIRED_COLUMNS).forEach(([table, cols]) => {
    cols.forEach((c) => {
      if (!drop.includes(c)) rows.push({ TABLE_NAME: table, COLUMN_NAME: c });
    });
  });
  mockConn.execute.mockResolvedValue([rows]);
};

beforeEach(() => { jest.clearAllMocks(); withColumns(); });

describe('schema check', () => {
  it('passes when the database matches the build', async () => {
    await expect(assertSchemaIsCurrent()).resolves.toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('names exactly which columns are missing', async () => {
    // Naming them is the whole point: "Unknown column 'TableName'" arrives
    // attached to a blameless request, hours after the actual cause.
    withColumns(['TableName', 'LineDiscounts']);

    await expect(assertSchemaIsCurrent()).resolves.toBe(false);

    const [message] = logger.error.mock.calls[0];
    expect(message).toMatch(/pos_order: TableName/);
    expect(message).toMatch(/pos_bill: LineDiscounts/);
  });

  it('says what to do about it', async () => {
    withColumns(['TableName']);
    await assertSchemaIsCurrent();
    expect(logger.error.mock.calls[0][0]).toMatch(/Recreate the database/i);
  });

  it('reports only the tables that actually drifted', async () => {
    withColumns(['ItemDiscountAmount']);
    const drift = await findMissingColumns();
    expect(drift).toEqual([{ table: 'transactionitemdetail', missing: ['ItemDiscountAmount'] }]);
  });

  it('scopes the lookup to the current database', async () => {
    // Another schema on the same server having the column proves nothing.
    await assertSchemaIsCurrent();
    expect(String(mockConn.execute.mock.calls[0][0])).toMatch(/TABLE_SCHEMA = DATABASE\(\)/);
  });

  it('never takes the server down over its own failure', async () => {
    // A check that can halt startup is a check that gets deleted the first time
    // it misfires.
    mockConn.execute.mockRejectedValue(new Error('connection refused'));
    await expect(assertSchemaIsCurrent()).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
