// One number, one customer.
//
// A customer typed at the till and the same person verifying at a QR table must
// land on ONE row. That only holds if every number is validated and stored in
// the same form (E.164), and a second customer with the same number is refused
// with a sentence rather than a raw duplicate-key error.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockTaken = [];
jest.mock('../../utils/dbHelper', () => ({
  executeQuery: jest.fn(async () => mockTaken),
  withConnection: jest.fn(),
  withTransaction: jest.fn(),
}));

const { createSchema, updateSchema } = require('../../modules/poscustomer/poscustomer.schemas');
const service = require('../../modules/poscustomer/poscustomer.service');
const { executeQuery } = require('../../utils/dbHelper');

beforeEach(() => {
  jest.clearAllMocks();
  mockTaken = [];
});

describe('poscustomer phone validation', () => {
  it('stores a number as typed at the counter in E.164', () => {
    const { value, error } = createSchema.validate({ Name: 'Priya', Phone: '98765 43210' });
    expect(error).toBeUndefined();
    expect(value.Phone).toBe('+919876543210');
  });

  it('refuses something that is not a mobile number', () => {
    expect(createSchema.validate({ Name: 'Priya', Phone: '12345' }).error).toBeDefined();
    expect(updateSchema.validate({ Phone: 'call me' }).error).toBeDefined();
  });

  it('still allows a customer with no number', () => {
    expect(createSchema.validate({ Name: 'Walk-in', Phone: '' }).error).toBeUndefined();
    expect(createSchema.validate({ Name: 'Walk-in', Phone: null }).error).toBeUndefined();
  });

  it('refuses a second customer with the same number, naming the first', async () => {
    mockTaken = [{ Id: 'c-1', Name: 'Priya' }];
    await expect(service.create({ Name: 'Someone', Phone: '+919876543210' }, 't-1', '+91'))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Priya') });
  });

  it('lets an update keep its own number', async () => {
    mockTaken = [];
    // The base update is not wired to a database here; all that matters is that
    // the uniqueness check excluded this customer and raised no conflict.
    const status = await service.update('c-1', { Phone: '+919876543210' }, 't-1', '+91')
      .then(() => null, (e) => e.statusCode);
    expect(status).not.toBe(409);
    expect(executeQuery.mock.calls[0][1]).toEqual(['+919876543210', 't-1', 'c-1']);
  });
});
