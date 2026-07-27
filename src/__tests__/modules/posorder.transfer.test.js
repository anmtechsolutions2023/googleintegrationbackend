// Unit tests for the table-transfer domain logic. A small stateful mock stands
// in for the transaction connection so we can assert the resulting orders and
// table occupancy after a move — without a database.

const { transfer, sumTotals, scaleLine, remainderLine } = require('../../modules/posorder/posorder.transfer');

const line = (over = {}) => ({
  name: 'Item', qty: 1, price: 100, costInfoId: 'ci-1',
  netAmount: 100, taxAmount: 18, grossAmount: 118, taxPct: 18,
  taxComponents: [{ name: 'CGST', rate: 9, amount: 9 }, { name: 'SGST', rate: 9, amount: 9 }],
  ...over,
});

// In-memory DB behind a mysql2-shaped execute(sql, params) → [rows|result].
const makeConn = (orders, tables) => {
  const oStore = new Map(orders.map((o) => [o.Id, { ...o }]));
  const tStore = new Map(tables.map((t) => [t.Id, { ...t }]));
  const parseItems = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  const conn = {
    oStore, tStore,
    execute: jest.fn(async (sql, params) => {
      if (sql.startsWith('SELECT * FROM pos_order')) {
        const row = oStore.get(params[0]);
        return [row ? [{ ...row }] : []];
      }
      if (sql.startsWith('SELECT * FROM pos_table')) {
        const row = tStore.get(params[0]);
        return [row ? [{ ...row }] : []];
      }
      if (sql.startsWith('SELECT Id FROM pos_order')) {
        const [, tableId] = params;
        const open = [...oStore.values()].filter(
          (o) => o.TableId === tableId &&
            !['closed', 'settled', 'cancelled'].includes(String(o.Status || '').toLowerCase()),
        );
        return [open.map((o) => ({ Id: o.Id }))];
      }
      if (sql.startsWith('UPDATE pos_order SET OrderNo')) {
        const id = params[12];
        oStore.set(id, {
          ...oStore.get(id), OrderNo: params[0], TableId: params[1], Status: params[4],
          Items: parseItems(params[5]), SubTotal: params[6], TaxAmount: params[7],
          Total: params[8], BranchDetailId: params[9],
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO pos_order')) {
        oStore.set(params[0], {
          Id: params[0], OrderNo: params[2], TableId: params[3], Status: params[6],
          Items: parseItems(params[7]), SubTotal: params[8], TaxAmount: params[9],
          Total: params[10], BranchDetailId: params[11],
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM pos_order')) {
        oStore.delete(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE pos_table SET Name')) {
        const id = params[8];
        tStore.set(id, { ...tStore.get(id), Status: params[3], CurrentOrderId: params[4] });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }),
  };
  return conn;
};

const TABLES = [
  { Id: 't1', Name: 'T1', FloorId: 'ground', Capacity: 4, BranchDetailId: 'br-1', Status: 'Occupied' },
  { Id: 't2', Name: 'R4', FloorId: 'rooftop', Capacity: 4, BranchDetailId: 'br-1', Status: 'Available' },
];

// ── pure helpers ─────────────────────────────────────────────────────────────
describe('snapshot math', () => {
  it('sums line snapshots into order totals', () => {
    expect(sumTotals([line(), line({ netAmount: 40, taxAmount: 0, grossAmount: 40 })]))
      .toEqual({ SubTotal: 140, TaxAmount: 18, Total: 158 });
  });

  it('scales a partial move by the qty ratio', () => {
    const s = scaleLine(line({ qty: 3, netAmount: 300, taxAmount: 54, grossAmount: 354 }), 2);
    expect(s.qty).toBe(2);
    expect(s).toMatchObject({ netAmount: 200, taxAmount: 36, grossAmount: 236 });
    expect(s.taxComponents[0].amount).toBe(6); // 9 * 2/3
  });

  it('remainder + moved sum back to the original', () => {
    const orig = line({ qty: 3, netAmount: 300, taxAmount: 54, grossAmount: 354 });
    const moved = scaleLine(orig, 2);
    const rem = remainderLine(orig, 2);
    expect(rem.qty).toBe(1);
    expect(rem.netAmount + moved.netAmount).toBe(300);
    expect(rem.grossAmount + moved.grossAmount).toBe(354);
  });
});

// ── orders scope (whole round / table) ───────────────────────────────────────
describe('transfer · orders', () => {
  it('reassigns a round to the destination table and frees the source', async () => {
    const conn = makeConn(
      [{ Id: 'o1', TableId: 't1', Status: 'Active', Items: [line()], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' }],
      TABLES,
    );
    const res = await transfer(conn, { scope: 'orders', orderIds: ['o1'], toTableId: 't2' }, 'tn', 'u@x');

    expect(conn.oStore.get('o1').TableId).toBe('t2');
    expect(conn.tStore.get('t1').Status).toBe('Available');     // source emptied
    expect(conn.tStore.get('t2').Status).toBe('Occupied');      // destination now busy
    expect(res.undo).toEqual({ scope: 'orders', orderIds: ['o1'], toTableId: 't1' });
  });
});

// ── items scope (split lines off a round) ────────────────────────────────────
describe('transfer · items', () => {
  const twoLineOrder = () => ([{
    Id: 'o1', TableId: 't1', Status: 'Active', OrderType: 'Dine-in',
    Items: [line({ name: 'Paneer' }), line({ name: 'Naan', qty: 3, netAmount: 300, taxAmount: 54, grossAmount: 354 })],
    SubTotal: 400, TaxAmount: 72, Total: 472, BranchDetailId: 'br-1',
  }]);

  it('moves a whole line into a new round on the destination', async () => {
    const conn = makeConn(twoLineOrder(), TABLES);
    const res = await transfer(conn, { scope: 'items', sourceOrderId: 'o1', items: [{ index: 0, qty: 1 }], toTableId: 't2' }, 'tn', 'u@x');

    // Source keeps only the Naan line.
    const src = conn.oStore.get('o1');
    expect(src.Items).toHaveLength(1);
    expect(src.Items[0].name).toBe('Naan');
    expect(src.Total).toBe(354);

    // A new order was created on t2 with the moved Paneer.
    const dest = conn.oStore.get(res.createdOrderId);
    expect(dest.TableId).toBe('t2');
    expect(dest.Items[0].name).toBe('Paneer');
    expect(dest.Total).toBe(118);

    // Reversible by merging the new round back into the source.
    expect(res.undo).toEqual({ scope: 'merge', sourceOrderId: res.createdOrderId, targetOrderId: 'o1' });
  });

  it('splits a partial quantity, keeping the remainder on the source', async () => {
    const conn = makeConn(twoLineOrder(), TABLES);
    const res = await transfer(conn, { scope: 'items', sourceOrderId: 'o1', items: [{ index: 1, qty: 2 }], toTableId: 't2' }, 'tn', 'u@x');

    const src = conn.oStore.get('o1');
    const naan = src.Items.find((l) => l.name === 'Naan');
    expect(naan.qty).toBe(1);                 // 1 of 3 stays
    expect(naan.grossAmount).toBe(118);       // 354 * 1/3

    const dest = conn.oStore.get(res.createdOrderId);
    expect(dest.Items[0].qty).toBe(2);        // 2 of 3 moved
    expect(dest.Items[0].grossAmount).toBe(236);
  });

  it('reassigns instead of emptying when every line is selected', async () => {
    const conn = makeConn(twoLineOrder(), TABLES);
    const res = await transfer(conn, {
      scope: 'items', sourceOrderId: 'o1', toTableId: 't2',
      items: [{ index: 0, qty: 1 }, { index: 1, qty: 3 }],
    }, 'tn', 'u@x');

    expect(res.createdOrderId).toBeNull();
    expect(conn.oStore.get('o1').TableId).toBe('t2');   // moved wholesale
    expect(res.undo).toEqual({ scope: 'orders', orderIds: ['o1'], toTableId: 't1' });
  });
});

// ── merge scope (the reversal) ───────────────────────────────────────────────
describe('transfer · merge', () => {
  it('folds one round into another and deletes the emptied order', async () => {
    const conn = makeConn([
      { Id: 'o1', TableId: 't1', Status: 'Active', Items: [line({ name: 'A' })], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' },
      { Id: 'o2', TableId: 't2', Status: 'Active', Items: [line({ name: 'B' })], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' },
    ], TABLES);

    const res = await transfer(conn, { scope: 'merge', sourceOrderId: 'o2', targetOrderId: 'o1' }, 'tn', 'u@x');

    expect(conn.oStore.has('o2')).toBe(false);          // source deleted
    const tgt = conn.oStore.get('o1');
    expect(tgt.Items.map((l) => l.name)).toEqual(['A', 'B']);
    expect(tgt.Total).toBe(236);
    expect(res.deletedOrderId).toBe('o2');
  });
});
