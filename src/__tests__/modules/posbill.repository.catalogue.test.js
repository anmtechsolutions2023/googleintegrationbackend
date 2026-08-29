// src/__tests__/modules/posbill.repository.catalogue.test.js
//
// TWO ID SPACES THAT MUST MEET.
//
// A round records the MENU entry a waiter tapped (pos_item_meta.Id). An offer
// triggers on the CATALOGUE item (itemdetail.Id) and its category. Nothing in
// the order carries the second, so the bill has to resolve it.
//
// It did not, and the failure was silent in the worst way: every ITEM_QTY
// trigger counted ZERO qualifying items on a real bill, so no item-based offer
// could ever apply at settle — while the till's preview, reading a cart the
// front end had built with catalogue ids, cheerfully showed the offer as
// available. Preview said yes, the bill said no, and neither said why.

const repository = require('../../modules/posbill/posbill.repository');

const META_CHAI = 'meta-chai';
const META_DOSA = 'meta-dosa';
const ITEM_CHAI = 'item-chai';
const ITEM_DOSA = 'item-dosa';
const CAT_BEV = 'cat-beverages';
const TENANT = 'tenant-1';

const orderRow = (id, items) => ({ Id: id, Items: items });

const item = (over = {}) => ({
  id: META_CHAI, name: 'Masala Chai', price: 25, qty: 1, ...over,
});

/**
 * A connection that answers the two reads getOrderLinesTx makes, in order:
 * the order rows, then the catalogue lookup.
 */
const connWith = (rows, catRows) => {
  const calls = [];
  return {
    calls,
    execute: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return calls.length === 1 ? [rows] : [catRows];
    }),
  };
};

describe('resolving a menu entry to the catalogue item behind it', () => {
  test('a line carries the catalogue item and its category, not the menu id', async () => {
    const conn = connWith(
      [orderRow('o1', [item()])],
      [{ MetaId: META_CHAI, ItemDetailId: ITEM_CHAI, CategoryId: CAT_BEV }],
    );

    const [line] = await repository.getOrderLinesTx(conn, ['o1'], TENANT);

    expect(line.itemId).toBe(ITEM_CHAI);
    expect(line.categoryId).toBe(CAT_BEV);
    // The menu id is still there — the bill prints from it.
    expect(line.id).toBe(META_CHAI);
  });

  test('the whole cart is resolved in ONE read, not one per line', async () => {
    // Six lines on a table's bill must not be six round trips.
    const conn = connWith(
      [orderRow('o1', [
        item(), item(), item({ id: META_DOSA, name: 'Dosa' }),
      ])],
      [
        { MetaId: META_CHAI, ItemDetailId: ITEM_CHAI, CategoryId: CAT_BEV },
        { MetaId: META_DOSA, ItemDetailId: ITEM_DOSA, CategoryId: null },
      ],
    );

    const lines = await repository.getOrderLinesTx(conn, ['o1'], TENANT);

    expect(conn.execute).toHaveBeenCalledTimes(2);
    // Deduplicated: two chai lines ask for one id.
    const catalogueParams = conn.calls[1].params;
    expect(catalogueParams).toEqual([TENANT, META_CHAI, META_DOSA]);
    expect(lines.map((l) => l.itemId)).toEqual([ITEM_CHAI, ITEM_CHAI, ITEM_DOSA]);
  });

  test('the catalogue read is tenant-scoped', async () => {
    const conn = connWith([orderRow('o1', [item()])], []);
    await repository.getOrderLinesTx(conn, ['o1'], TENANT);
    expect(conn.calls[1].params[0]).toBe(TENANT);
  });

  test('a menu entry with no catalogue item behind it yields null, not the menu id', async () => {
    // Passing the menu id through as itemId would be worse than nothing: the
    // offer would match on an id space it was never written against, and
    // whether it fired would depend on a uuid collision.
    const conn = connWith([orderRow('o1', [item()])], []);

    const [line] = await repository.getOrderLinesTx(conn, ['o1'], TENANT);

    expect(line.itemId).toBeNull();
    expect(line.categoryId).toBeNull();
  });

  test('an uncategorised item resolves its item and leaves the category null', async () => {
    const conn = connWith(
      [orderRow('o1', [item({ id: META_DOSA })])],
      [{ MetaId: META_DOSA, ItemDetailId: ITEM_DOSA, CategoryId: null }],
    );

    const [line] = await repository.getOrderLinesTx(conn, ['o1'], TENANT);

    expect(line.itemId).toBe(ITEM_DOSA);
    expect(line.categoryId).toBeNull();
  });

  test('an empty round makes no catalogue read at all', async () => {
    const conn = connWith([orderRow('o1', [])], []);
    const lines = await repository.getOrderLinesTx(conn, ['o1'], TENANT);
    expect(lines).toEqual([]);
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });

  test('rounds ordered before offers existed still resolve', async () => {
    // Historic rows store `Id`, current ones store `id`. Reading only one
    // spelling is how a table open across a deploy loses its offers.
    const conn = connWith(
      [orderRow('o1', [{ Id: META_CHAI, name: 'Masala Chai', price: 25, qty: 2 }])],
      [{ MetaId: META_CHAI, ItemDetailId: ITEM_CHAI, CategoryId: CAT_BEV }],
    );

    const [line] = await repository.getOrderLinesTx(conn, ['o1'], TENANT);

    expect(line.itemId).toBe(ITEM_CHAI);
    expect(line.quantity).toBe(2);
  });

  test('several rounds on one table share a single catalogue read', async () => {
    const conn = connWith(
      [orderRow('o1', [item()]), orderRow('o2', [item()])],
      [{ MetaId: META_CHAI, ItemDetailId: ITEM_CHAI, CategoryId: CAT_BEV }],
    );

    const lines = await repository.getOrderLinesTx(conn, ['o1', 'o2'], TENANT);

    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(lines.map((l) => l.itemId)).toEqual([ITEM_CHAI, ITEM_CHAI]);
    // Refs stay per-round, so a discount on one round cannot land on another.
    expect(lines.map((l) => l.ref)).toEqual(['o1#0', 'o2#0']);
  });
});
