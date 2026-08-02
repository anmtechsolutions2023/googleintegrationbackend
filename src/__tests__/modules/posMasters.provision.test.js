// Unit tests for the per-tenant POS/ledger master-data provisioner. A tiny mock
// connection lets us assert what gets inserted, without a database.

const { provisionPosMasters } = require('../../modules/mastersetup/posMasters.provision');

// `existing=false` → nothing is seeded yet (every SELECT misses); `true` → every
// master already exists (every SELECT hits), which must insert nothing.
const makeConn = (existing) => {
  const inserted = [];
  const execute = jest.fn(async (sql) => {
    const s = sql.trim();
    if (s.startsWith('SELECT')) return [existing ? [{ Id: 'existing' }] : []];
    if (s.startsWith('INSERT')) {
      inserted.push(s.match(/INSERT INTO (\w+)/)[1]);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
  return { execute, inserted };
};

const countBy = (arr, t) => arr.filter((x) => x === t).length;

describe('provisionPosMasters', () => {
  it('seeds the full POS + ledger master set for a fresh tenant', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1', configId: 'cfg1' }, 'u@x');

    expect(countBy(conn.inserted, 'paymentmode')).toBe(4);          // Cash/Card/UPI/Wallet
    expect(countBy(conn.inserted, 'paymentreceivedtype')).toBe(4);  // Full/Partial/Advance/Refund
    expect(countBy(conn.inserted, 'accounttypebase')).toBe(4);      // Sales/Cash/Bank/Wallet
    expect(countBy(conn.inserted, 'transactiontypestatus')).toBe(5);
    expect(countBy(conn.inserted, 'transactiontype')).toBe(1);      // POS Sale
    expect(countBy(conn.inserted, 'transactiontypebaseconversion')).toBe(5);
  });

  it('links the POS Sale type to the tenant’s numbering config', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1', configId: 'cfg1' }, 'u@x');

    const call = conn.execute.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO transactiontype (Id, Name, TransactionTypeConfigId'),
    );
    expect(call[1]).toEqual(expect.arrayContaining(['POS Sale', 'cfg1', 't1']));
  });

  it('is idempotent — inserts nothing when the masters already exist', async () => {
    const conn = makeConn(true);
    await provisionPosMasters(conn, { tenantId: 't1', configId: 'cfg1' }, 'u@x');
    expect(conn.inserted).toHaveLength(0);
  });
});
