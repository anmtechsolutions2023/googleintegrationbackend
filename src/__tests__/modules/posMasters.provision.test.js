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

const paramsOf = (conn, fragment) =>
  conn.execute.mock.calls.filter(([sql]) => sql.includes(fragment)).map(([, p]) => p);

describe('provisionPosMasters', () => {
  it('seeds the full POS + ledger master set for a fresh tenant', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1', configId: 'cfg1' }, 'u@x');

    // Cash/Card/UPI/Wallet, plus one settlement tender per portal — per portal
    // rather than one shared "Aggregator", because reconciling a payout means
    // answering what ONE portal owes us.
    expect(countBy(conn.inserted, 'paymentmode')).toBe(7);
    expect(countBy(conn.inserted, 'paymentreceivedtype')).toBe(5);  // + Payment (money out)
    // + Aggregator Receivable and Portal Commission: aggregator money is owed to
    // us weeks later, so it must not book to Cash.
    expect(countBy(conn.inserted, 'accounttypebase')).toBe(7);
    expect(countBy(conn.inserted, 'transactiontypestatus')).toBe(5);
    expect(countBy(conn.inserted, 'transactiontype')).toBe(2);      // POS Sale + Expense
    expect(countBy(conn.inserted, 'expense_category')).toBe(7);
    expect(countBy(conn.inserted, 'asset_category')).toBe(5);
    expect(countBy(conn.inserted, 'pos_food_type')).toBe(3);        // Veg/Vegan/Non-Veg
    expect(countBy(conn.inserted, 'pos_channel')).toBe(3);          // Dine In/Takeaway/Online
    expect(countBy(conn.inserted, 'pos_portal')).toBe(3);           // Zomato/Swiggy/District
    // One numbering series per document type: sales, expenses, orders, KOTs,
    // bills, counter tokens.
    expect(countBy(conn.inserted, 'transactiontypeconfig')).toBe(6);
    // 5 sale transitions + 3 expense transitions.
    expect(countBy(conn.inserted, 'transactiontypebaseconversion')).toBe(8);
  });

  it('gives every document type its OWN numbering series', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const configs = paramsOf(conn, 'INSERT INTO transactiontypeconfig');
    expect(configs.map((p) => p[4])).toEqual([
      'POS_SALE', 'EXPENSE', 'POS_ORDER', 'POS_KOT', 'POS_BILL', 'POS_TOKEN',
    ]);
    expect(configs.map((p) => p[3])).toEqual([
      'INV-{0000}', 'EXP-{0000}', 'ORD-{0000}', 'KOT-{0000}', 'BILL-{0000}', 'TOK-{0000}',
    ]);
  });

  // pos_item_meta.FoodTypeId is NOT NULL, so a tenant with no food types cannot
  // create a single menu item — this is what makes it a provisioning concern
  // rather than something the user sets up by hand.
  it('seeds the food types a menu item cannot be created without', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const types = paramsOf(conn, 'INSERT INTO pos_food_type')
      .map((p) => ({ name: p[1], code: p[2], isVeg: p[4] }));

    expect(types).toEqual([
      { name: 'Veg', code: 'VEG', isVeg: 1 },
      { name: 'Vegan', code: 'VEGAN', isVeg: 1 },
      { name: 'Non-Veg', code: 'NONVEG', isVeg: 0 },
    ]);
  });

  // UNIQUE is (Code, TenantId), so get-or-create has to key on Code. Keying on
  // Name would let a renamed 'Veg' be re-inserted and hit the constraint.
  it('keys food types on Code, matching UNIQUE (Code, TenantId)', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const lookups = conn.execute.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('FROM pos_food_type'));

    expect(lookups).toHaveLength(3);
    lookups.forEach((sql) => expect(sql).toContain('WHERE Code = ?'));
  });

  it('numbers documents off their own series, not the onboarding config', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1', configId: 'cfg-onboarding' }, 'u@x');

    const [posSale] = paramsOf(conn, 'INSERT INTO transactiontype (Id, Name, TransactionTypeConfigId');
    expect(posSale).toEqual(expect.arrayContaining(['POS Sale', 't1']));
    // Invoices must not number off onboarding paperwork.
    expect(posSale).not.toContain('cfg-onboarding');
  });

  it('maps each tender to the account the money lands in', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const modes = paramsOf(conn, 'INSERT INTO paymentmode')
      .map((p) => ({ type: p[1], account: p[2] }));

    // Every mode must carry an account, or its takings are invisible to cash flow.
    expect(modes).toHaveLength(7);
    modes.forEach((m) => expect(m.account).toBeTruthy());

    const byType = Object.fromEntries(modes.map((m) => [m.type, m.account]));
    expect(byType.Card).toBe(byType.UPI);      // both land in Bank
    expect(byType.Cash).not.toBe(byType.Card); // cash does not

    // Aggregator money is owed to us for weeks — booking it as Cash would put
    // money in a till that never saw it and break the cash session.
    expect(byType['Zomato Settlement']).not.toBe(byType.Cash);
    expect(byType['Zomato Settlement']).toBe(byType['Swiggy Settlement']);
  });

  it('gives every account a Kind so cash flow can classify it', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const kinds = paramsOf(conn, 'INSERT INTO accounttypebase').map((p) => p[2]);
    expect(kinds).toEqual([
      'INCOME', 'ASSET', 'ASSET', 'ASSET', 'EXPENSE',
      'ASSET',    // Aggregator Receivable
      'EXPENSE',  // Portal Commission
    ]);
  });

  // A portal is a seller ON a channel, not a channel. If the link were not made
  // here, every seeded portal would arrive orphaned and its listings could not
  // be gated on "is this sold online at all".
  it('parents every seeded portal on the ONLINE channel', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const portals = paramsOf(conn, 'INSERT INTO pos_portal')
      .map((p) => ({ name: p[1], code: p[2], channelId: p[3], color: p[4], short: p[5] }));

    expect(portals.map((p) => p.code)).toEqual(['ZOMATO', 'SWIGGY', 'DISTRICT']);
    portals.forEach((p) => {
      expect(p.channelId).toBeTruthy();
      // Colour and monogram are DATA so the queue can tell portals apart
      // without a stylesheet edit or a switch on a platform name.
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(p.short).toHaveLength(2);
    });
    // All three sell on the same channel.
    expect(new Set(portals.map((p) => p.channelId)).size).toBe(1);
  });

  // Everything downstream of accept works identically whether an order arrived
  // over a webhook or was keyed in, so a portal ships usable before anyone has
  // credentials for it.
  it('seeds portals on the manual adapter, so orders can be keyed in from day one', async () => {
    const conn = makeConn(false);
    await provisionPosMasters(conn, { tenantId: 't1' }, 'u@x');

    const sql = conn.execute.mock.calls
      .map(([q]) => q)
      .find((q) => q.includes('INSERT INTO pos_portal'));
    expect(sql).toContain("'manual'");
  });

  it('is idempotent — inserts nothing when the masters already exist', async () => {
    const conn = makeConn(true);
    await provisionPosMasters(conn, { tenantId: 't1', configId: 'cfg1' }, 'u@x');
    expect(conn.inserted).toHaveLength(0);
  });
});
