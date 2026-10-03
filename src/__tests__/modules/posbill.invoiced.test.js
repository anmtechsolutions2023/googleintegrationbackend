// src/__tests__/modules/posbill.invoiced.test.js
// A round already on an invoiced bill must never be invoiced again.
//
// The defect this guards: a part-paid table stayed open at the till, a second
// Settle built a NEW bill over the same rounds, and the same food was invoiced
// twice. The balance belongs in Money → Dues instead.

const repository = require('../../modules/posbill/posbill.repository');

const conn = { execute: jest.fn() };
beforeEach(() => conn.execute.mockReset());

describe('assertNotInvoicedElsewhereTx', () => {
  it('refuses a round that is on another invoiced bill, naming both', async () => {
    conn.execute.mockResolvedValue([[{ OrderNo: 'ORD-0002', TransactionNo: 'INV-0002' }]]);
    await expect(repository.assertNotInvoicedElsewhereTx(conn, 'bill-2', ['o-2'], 't-1'))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/ORD-0002.*INV-0002.*Dues/) });
  });

  it('lets a round through when no other invoiced bill holds it', async () => {
    conn.execute.mockResolvedValue([[]]);
    await expect(repository.assertNotInvoicedElsewhereTx(conn, 'bill-2', ['o-2'], 't-1')).resolves.toBeUndefined();
  });

  it('excludes the bill being settled and binds one placeholder per round', async () => {
    conn.execute.mockResolvedValue([[]]);
    await repository.assertNotInvoicedElsewhereTx(conn, 'bill-2', ['o-1', 'o-2', 'o-1'], 't-1');
    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/bo\.BillId <> \?/);
    expect(sql).toMatch(/IN \(\?, \?\)/);
    expect(params).toEqual(['t-1', 'bill-2', 'o-1', 'o-2']);
  });

  it('asks nothing when there are no rounds', async () => {
    await repository.assertNotInvoicedElsewhereTx(conn, 'bill-2', [], 't-1');
    expect(conn.execute).not.toHaveBeenCalled();
  });
});
