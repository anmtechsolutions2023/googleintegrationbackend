// The GST switch: the guard, the history row, and what counts as a change.

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));
jest.mock('../../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const service = require('../../modules/taxsetting/taxsetting.service');

const TENANT = 't1';

/** Routes each query to a canned answer, and records the writes. */
const database = ({ setting = null, open = [], branches = [], updated = 1 } = {}) => {
  mockConn.execute.mockImplementation(async (sql) => {
    if (sql.includes('FROM branchdetail')) return [branches];
    if (sql.includes('UPDATE branchdetail')) return [{ affectedRows: updated }];
    if (sql.includes('FOR UPDATE')) return [setting ? [setting] : []];
    if (sql.includes('FROM pos_tax_setting')) return [setting ? [{ ...setting, UpdatedOn: null, UpdatedBy: null }] : []];
    if (sql.includes('FROM pos_tax_mode_history')) return [[]];
    if (sql.includes('FROM pos_order')) return [open];
    return [{ affectedRows: 1 }];
  });
};
const writes = (fragment) => mockConn.execute.mock.calls.filter(([sql]) => sql.includes(fragment));

beforeEach(() => jest.clearAllMocks());

describe('GST switch', () => {
  test('no row means GST is charged — what every tenant did before', async () => {
    database();
    const status = await service.getStatus(TENANT);
    expect(status).toMatchObject({ gstCharging: true, offReason: null, taxMode: 'gst' });
  });

  test('turning it off records the setting and one history row', async () => {
    database();
    await service.setStatus({ gstCharging: false, offReason: 'composition' }, TENANT, '+911');
    expect(writes('INSERT INTO pos_tax_setting')[0][1]).toEqual([TENANT, 0, 'composition', '+911', '+911']);
    const [, history] = writes('INSERT INTO pos_tax_mode_history')[0];
    expect(history.slice(1)).toEqual([TENANT, 1, 0, 'composition', '+911']);
  });

  test('is refused while an order is open, naming it', async () => {
    database({ open: [{ Id: 'o1', OrderNo: 'ORD-12', OrderType: 'dinein', TableName: 'T-4', Total: 1062 }] });
    await expect(service.setStatus({ gstCharging: false, offReason: 'unregistered' }, TENANT, '+911'))
      .rejects.toMatchObject({ statusCode: 409, code: 'TAX_SWITCH_BLOCKED', message: expect.stringContaining('ORD-12 (table T-4)') });
    expect(writes('INSERT INTO pos_tax_setting')).toHaveLength(0);
  });

  test('changing only the reason while off is not held up by open orders', async () => {
    database({
      setting: { GstCharging: 0, OffReason: 'composition' },
      open: [{ Id: 'o1', OrderNo: 'ORD-12', OrderType: 'dinein', TableName: 'T-4', Total: 1 }],
    });
    await service.setStatus({ gstCharging: false, offReason: 'unregistered' }, TENANT, '+911');
    expect(writes('INSERT INTO pos_tax_setting')).toHaveLength(1);
  });

  test('saving the value it already has writes nothing', async () => {
    database({ setting: { GstCharging: 1, OffReason: null } });
    await service.setStatus({ gstCharging: true }, TENANT, '+911');
    expect(writes('INSERT INTO')).toHaveLength(0);
  });

  test('tax mode follows the reason', () => {
    expect(service.taxModeOf({ gstCharging: true })).toBe('gst');
    expect(service.taxModeOf({ gstCharging: false, offReason: 'composition' })).toBe('composition');
    expect(service.taxModeOf({ gstCharging: false, offReason: null })).toBe('unregistered');
  });
});

describe('branch GSTIN', () => {
  test('the status lists each branch with its GSTIN and place of supply', async () => {
    database({ branches: [
      { Id: 'b1', BranchName: 'Balagere', GSTIN: null },
      { Id: 'b2', BranchName: 'Indiranagar', GSTIN: ' 29abcde1234f1z5 ' },
      { Id: 'b3', BranchName: 'Old', GSTIN: 'GST-123' },
    ] });
    const status = await service.getStatus(TENANT);
    expect(status.branches).toEqual([
      { id: 'b1', name: 'Balagere', gstin: null, valid: true, placeOfSupply: null },
      { id: 'b2', name: 'Indiranagar', gstin: '29ABCDE1234F1Z5', valid: true, placeOfSupply: '29-Karnataka' },
      { id: 'b3', name: 'Old', gstin: 'GST-123', valid: false, placeOfSupply: null },
    ]);
  });

  test('saves it normalised, scoped to the tenant, and answers with the status', async () => {
    database({ branches: [{ Id: 'b1', BranchName: 'Balagere', GSTIN: '29ABCDE1234F1Z5' }] });
    const status = await service.setBranchGstin('b1', ' 29abcde1234f1z5', TENANT, '+911');
    expect(writes('UPDATE branchdetail')[0][1]).toEqual(['29ABCDE1234F1Z5', '+911', 'b1', TENANT]);
    expect(status.branches[0].gstin).toBe('29ABCDE1234F1Z5');
  });

  test('blank clears it', async () => {
    database();
    await service.setBranchGstin('b1', '', TENANT, '+911');
    expect(writes('UPDATE branchdetail')[0][1][0]).toBeNull();
  });

  test('another tenant\'s branch is not found', async () => {
    database({ updated: 0 });
    await expect(service.setBranchGstin('b9', '29ABCDE1234F1Z5', TENANT, '+911'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('the schema refuses a malformed GSTIN and an unknown state code', () => {
    const { branchGstinSchema } = require('../../modules/taxsetting/taxsetting.schemas');
    expect(branchGstinSchema.validate({ gstin: '29ABCDE1234F1Z5' }).value.gstin).toBe('29ABCDE1234F1Z5');
    expect(branchGstinSchema.validate({ gstin: '29abcde1234f1z5' }).value.gstin).toBe('29ABCDE1234F1Z5');
    expect(branchGstinSchema.validate({ gstin: '' }).error).toBeUndefined();
    expect(branchGstinSchema.validate({ gstin: null }).error).toBeUndefined();
    expect(branchGstinSchema.validate({ gstin: '9876543210' }).error.message).toMatch(/15 characters/);
    expect(branchGstinSchema.validate({ gstin: '99ABCDE1234F1Z5' }).error.message).toMatch(/state code/);
    expect(branchGstinSchema.validate({}).error).toBeDefined();
  });
});
