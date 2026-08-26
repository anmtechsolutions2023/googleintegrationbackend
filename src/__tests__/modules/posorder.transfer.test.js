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
const makeConn = (orders, tables, kots = []) => {
  const oStore = new Map(orders.map((o) => [o.Id, { ...o }]));
  const tStore = new Map(tables.map((t) => [t.Id, { ...t }]));
  // Kitchen tickets. A transfer that ignores them either misroutes the food or —
  // on merge — cannot delete the order at all, because pos_kot.OrderId is a
  // FOREIGN KEY with no ON DELETE.
  const kStore = new Map(kots.map((k) => [k.Id, { ...k }]));
  const parseItems = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  // Venue snapshot columns, in the order POS_ORDER.INSERT/UPDATE bind them.
  const venueOf = (p, at) => ({
    TableName: p[at], FloorId: p[at + 1], FloorName: p[at + 2], TableCapacity: p[at + 3],
  });

  const conn = {
    oStore, tStore, kStore,
    execute: jest.fn(async (sql, params) => {
      if (sql.startsWith('SELECT * FROM pos_order')) {
        const row = oStore.get(params[0]);
        return [row ? [{ ...row }] : []];
      }
      if (sql.startsWith('SELECT * FROM pos_table')) {
        const row = tStore.get(params[0]);
        return [row ? [{ ...row }] : []];
      }
      // resolveVenueTx — the floor plan as it stands right now.
      if (sql.startsWith('SELECT t.Name AS TableName')) {
        const t = tStore.get(params[0]);
        return [t ? [{
          TableName: t.Name, TableCapacity: t.Capacity ?? null,
          FloorId: t.FloorId ?? null, FloorName: t.FloorName ?? null,
        }] : []];
      }
      // findLiveKotTx — does this round already have a ticket?
      if (sql.startsWith('SELECT Id, KotNo, Status FROM pos_kot')) {
        const live = [...kStore.values()].find(
          (k) => k.OrderId === params[0] &&
            String(k.Status || 'pending').toLowerCase() !== 'cancelled',
        );
        return [live ? [{ Id: live.Id, KotNo: live.KotNo, Status: live.Status ?? 'pending' }] : []];
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
        // ChannelId binds between OrderType and Status, so everything after it
        // sits one place further along than it used to.
        const id = params[17];
        oStore.set(id, {
          ...oStore.get(id), OrderNo: params[0], TableId: params[1],
          ChannelId: params[4], Status: params[5],
          Items: parseItems(params[6]), SubTotal: params[7], TaxAmount: params[8],
          Total: params[9], BranchDetailId: params[10], ...venueOf(params, 11),
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO pos_order')) {
        oStore.set(params[0], {
          Id: params[0], OrderNo: params[2], TableId: params[3],
          ChannelId: params[6], Status: params[7],
          Items: parseItems(params[8]), SubTotal: params[9], TaxAmount: params[10],
          Total: params[11], BranchDetailId: params[12], ...venueOf(params, 13),
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
      // ── Kitchen tickets ──────────────────────────────────────────────────
      if (sql.startsWith('UPDATE pos_kot SET TableId')) {
        const [tableId, , orderId] = params;
        kStore.forEach((k, id) => {
          if (k.OrderId === orderId) kStore.set(id, { ...k, TableId: tableId });
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE pos_kot SET OrderId')) {
        const [toOrderId, toTableId, , fromOrderId] = params;
        kStore.forEach((k, id) => {
          if (k.OrderId === fromOrderId) {
            kStore.set(id, { ...k, OrderId: toOrderId, TableId: toTableId });
          }
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO pos_kot')) {
        kStore.set(params[0], {
          Id: params[0], KotNo: params[2], OrderId: params[3], TableId: params[4],
          Items: parseItems(params[5]), Status: params[6],
        });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }),
  };
  return conn;
};

const TABLES = [
  { Id: 't1', Name: 'T1', FloorId: 'ground', FloorName: 'Ground', Capacity: 4, BranchDetailId: 'br-1', Status: 'occupied' },
  { Id: 't2', Name: 'R4', FloorId: 'rooftop', FloorName: 'Rooftop', Capacity: 6, BranchDetailId: 'br-1', Status: 'free' },
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
      [{ Id: 'o1', TableId: 't1', Status: 'open', Items: [line()], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' }],
      TABLES,
    );
    const res = await transfer(conn, { scope: 'orders', orderIds: ['o1'], toTableId: 't2' }, 'tn', 'u@x');

    expect(conn.oStore.get('o1').TableId).toBe('t2');
    expect(conn.tStore.get('t1').Status).toBe('free');     // source emptied
    expect(conn.tStore.get('t2').Status).toBe('occupied');      // destination now busy
    expect(res.undo).toEqual({ scope: 'orders', orderIds: ['o1'], toTableId: 't1' });
  });
});

// ── items scope (split lines off a round) ────────────────────────────────────
describe('transfer · items', () => {
  const twoLineOrder = () => ([{
    Id: 'o1', TableId: 't1', Status: 'open', OrderType: 'dinein',
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
      { Id: 'o1', TableId: 't1', Status: 'open', Items: [line({ name: 'A' })], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' },
      { Id: 'o2', TableId: 't2', Status: 'open', Items: [line({ name: 'B' })], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' },
    ], TABLES);

    const res = await transfer(conn, { scope: 'merge', sourceOrderId: 'o2', targetOrderId: 'o1' }, 'tn', 'u@x');

    expect(conn.oStore.has('o2')).toBe(false);          // source deleted
    const tgt = conn.oStore.get('o1');
    expect(tgt.Items.map((l) => l.name)).toEqual(['A', 'B']);
    expect(tgt.Total).toBe(236);
    expect(res.deletedOrderId).toBe('o2');
  });
});

// ── the ticket and the venue follow the food ─────────────────────────────────
// Transfer used to touch neither pos_kot nor the venue snapshot, so the pass
// kept delivering to the table the guests had left and the revenue kept
// reporting against it. A merge also fails outright if a ticket is left behind,
// since pos_kot.OrderId is a FOREIGN KEY with no ON DELETE.
describe('transfer · tickets and venue follow the round', () => {
  const kot = (id, orderId, tableId) => ({ Id: id, KotNo: `KOT-${id}`, OrderId: orderId, TableId: tableId });

  it('moves a reassigned round’s ticket to the new table', async () => {
    const conn = makeConn(
      [{ Id: 'o1', TableId: 't1', Status: 'open', Items: [line()], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' }],
      TABLES,
      [kot('k1', 'o1', 't1')],
    );
    await transfer(conn, { scope: 'orders', orderIds: ['o1'], toTableId: 't2' }, 'tn', 'u@x');

    expect(conn.kStore.get('k1').TableId).toBe('t2');
  });

  const splitOrder = () => ([{
    Id: 'o1', TableId: 't1', Status: 'open', OrderType: 'dinein',
    Items: [line({ name: 'Paneer' }), line({ name: 'Naan' })],
    SubTotal: 200, TaxAmount: 36, Total: 236, BranchDetailId: 'br-1',
  }]);

  const splitPayload = { scope: 'items', sourceOrderId: 'o1', items: [{ index: 0, qty: 1 }], toTableId: 't2' };

  it('fires a ticket for the split when the source was already sent', async () => {
    // That food is already cooking; the pass needs to know where it now goes.
    const conn = makeConn(splitOrder(), TABLES, [kot('k1', 'o1', 't1')]);
    const res = await transfer(conn, splitPayload, 'tn', 'u@x');

    const created = [...conn.kStore.values()].find((k) => k.OrderId === res.createdOrderId);
    expect(created).toBeDefined();
    expect(created.TableId).toBe('t2');
    expect(created.Items[0].name).toBe('Paneer');
  });

  it('fires NOTHING for the split when the source was never sent', async () => {
    // Sending is the cashier's deliberate act. Conjuring a ticket here would put
    // food on the pass that nobody asked the kitchen to cook.
    const conn = makeConn(splitOrder(), TABLES, []);
    const res = await transfer(conn, splitPayload, 'tn', 'u@x');

    expect(conn.kStore.size).toBe(0);
    expect(conn.oStore.get(res.createdOrderId).Status).toBe('open');
  });

  it('repoints the merged round’s ticket before deleting the order', async () => {
    const conn = makeConn([
      { Id: 'o1', TableId: 't1', Status: 'open', Items: [line({ name: 'A' })], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' },
      { Id: 'o2', TableId: 't2', Status: 'open', Items: [line({ name: 'B' })], SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1' },
    ], TABLES, [kot('k2', 'o2', 't2')]);

    await transfer(conn, { scope: 'merge', sourceOrderId: 'o2', targetOrderId: 'o1' }, 'tn', 'u@x');

    // No ticket is left pointing at the deleted order.
    expect(conn.kStore.get('k2').OrderId).toBe('o1');
    expect(conn.kStore.get('k2').TableId).toBe('t1');
    expect(conn.oStore.has('o2')).toBe(false);
  });

  it('re-stamps the venue when a round moves table', async () => {
    // The round really was served at the new table, so its snapshot must follow
    // it — otherwise the revenue keeps reporting against the table the guests
    // left, and the floor totals never reconcile.
    const conn = makeConn(
      [{
        Id: 'o1', TableId: 't1', Status: 'open', Items: [line()],
        SubTotal: 100, TaxAmount: 18, Total: 118, BranchDetailId: 'br-1',
        TableName: 'T1', FloorId: 'ground', FloorName: 'Ground', TableCapacity: 4,
      }],
      TABLES,
    );
    await transfer(conn, { scope: 'orders', orderIds: ['o1'], toTableId: 't2' }, 'tn', 'u@x');

    expect(conn.oStore.get('o1')).toMatchObject({
      TableName: 'R4', FloorId: 'rooftop', FloorName: 'Rooftop', TableCapacity: 6,
    });
  });

  it('stamps the destination venue on a split round', async () => {
    const conn = makeConn(splitOrder(), TABLES, []);
    const res = await transfer(conn, splitPayload, 'tn', 'u@x');

    expect(conn.oStore.get(res.createdOrderId)).toMatchObject({
      TableName: 'R4', FloorId: 'rooftop', FloorName: 'Rooftop',
    });
  });

  it('repoints the ticket BEFORE the delete, not after', async () => {
    const conn = makeConn([
      { Id: 'o1', TableId: 't1', Status: 'open', Items: [line({ name: 'A' })], SubTotal: 100, TaxAmount: 18, Total: 118 },
      { Id: 'o2', TableId: 't2', Status: 'open', Items: [line({ name: 'B' })], SubTotal: 100, TaxAmount: 18, Total: 118 },
    ], TABLES, [kot('k2', 'o2', 't2')]);

    await transfer(conn, { scope: 'merge', sourceOrderId: 'o2', targetOrderId: 'o1' }, 'tn', 'u@x');

    const sqls = conn.execute.mock.calls.map(([sql]) => sql);
    const repoint = sqls.findIndex((s) => s.startsWith('UPDATE pos_kot SET OrderId'));
    const del = sqls.findIndex((s) => s.startsWith('DELETE FROM pos_order'));
    expect(repoint).toBeGreaterThanOrEqual(0);
    expect(repoint).toBeLessThan(del);
  });
});
