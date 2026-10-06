// src/__tests__/modules/menu.clear.test.js
// Clearing the menu: the typed phrase, what is deleted versus hidden, and
// that taking dishes off the menu keeps their hours.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { clearMenu } = require('../../modules/menu/menu.clear');

// i-sold is on a bill, i-offer is named by an offer, i-open (meta m-open) is
// on a table's open order; i-free is none of these.
const route = (sql, params) => {
  if (sql.startsWith('SELECT Id FROM itemdetail')) return [[{ Id: 'i-sold' }, { Id: 'i-offer' }, { Id: 'i-open' }, { Id: 'i-free' }]];
  if (sql.includes('FROM transactionitemdetail')) return [[{ Id: 'i-sold' }]];
  if (sql.includes('TriggerItemId AS Id')) return [[{ Id: 'i-offer' }]];
  if (sql.startsWith('SELECT Id, ItemDetailId FROM pos_item_meta')) return [[{ Id: 'm-open', ItemDetailId: 'i-open' }, { Id: 'm-free', ItemDetailId: 'i-free' }]];
  if (sql.includes('FROM pos_order')) return [[{ Items: JSON.stringify([{ id: 'm-open', qty: 1 }]) }]];
  if (sql.startsWith('SELECT COUNT(*)')) return [[{ n: 2 }]];
  if (sql.startsWith('DELETE FROM pos_category_schedule')) return [{ affectedRows: 42 }];
  if (sql.startsWith('DELETE FROM pos_item_daily_stock')) return [{ affectedRows: 3 }];
  if (/^(UPDATE|DELETE)/.test(sql.trim())) return [{ affectedRows: Math.max(params.length - 1, 0) }];
  return [[]];
};

const statements = () => mockConn.execute.mock.calls.map(([sql]) => sql.trim());

beforeEach(() => {
  mockConn.execute.mockReset();
  mockConn.execute.mockImplementation(async (sql, params = []) => route(sql, params));
});

describe('clearing the menu', () => {
  it('refuses to clear without the typed phrase', async () => {
    await expect(clearMenu({ mode: 'empty', confirm: 'clear' }, { dryRun: false }, 't1'))
      .rejects.toMatchObject({ statusCode: 400, message: 'Type CLEAR MENU to confirm.' });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('accepts the phrase in any case', async () => {
    await expect(clearMenu({ mode: 'hide', confirm: ' clear menu ' }, { dryRun: false }, 't1')).resolves.toMatchObject({ mode: 'hide' });
  });

  it('a preview needs no phrase and returns the same counts', async () => {
    const r = await clearMenu({ mode: 'empty' }, { dryRun: true }, 't1');
    expect(r).toMatchObject({ dishes: 4, deleted: 1, hidden: 3 });
  });

  it('deletes only the dish nothing points at; hides sold, offer and open-order dishes', async () => {
    const r = await clearMenu({ mode: 'empty', confirm: 'CLEAR MENU' }, { dryRun: false }, 't1');
    expect(r.keptBecause).toEqual({ sold: 1, offers: 1, openOrders: 1 });
    expect(r.deleted).toBe(1);
    expect(r.hidden).toBe(3);

    const del = mockConn.execute.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM itemdetail'));
    expect(del[1]).toEqual(['t1', 'i-free']);
    const hide = mockConn.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE itemdetail SET Active = 0'));
    expect(hide[1]).toEqual(['t1', 'i-sold', 'i-offer', 'i-open']);
  });

  it('starting empty clears the hours and today\'s counts', async () => {
    const r = await clearMenu({ mode: 'empty', confirm: 'CLEAR MENU' }, { dryRun: false }, 't1');
    expect(r.hoursCleared).toBe(42);
    expect(r.countsCleared).toBe(3);
  });

  it('taking dishes off the menu hides them all and keeps hours and counts', async () => {
    const r = await clearMenu({ mode: 'hide', confirm: 'CLEAR MENU' }, { dryRun: false }, 't1');
    expect(r.hidden).toBe(4);
    expect(r.deleted).toBe(0);
    expect(statements().some((s) => s.startsWith('DELETE'))).toBe(false);
  });

  it('removes unused masters only when asked', async () => {
    await clearMenu({ mode: 'empty', confirm: 'CLEAR MENU' }, { dryRun: false }, 't1');
    expect(statements().some((s) => s.startsWith('DELETE FROM categorydetail'))).toBe(false);

    mockConn.execute.mockClear();
    await clearMenu({ mode: 'empty', removeUnused: true, confirm: 'CLEAR MENU' }, { dryRun: false }, 't1');
    const s = statements();
    ['categorydetail', 'pos_menu_tag', 'pos_variant', 'pos_addon_group']
      .forEach((t) => expect(s.some((x) => x.startsWith(`DELETE FROM ${t}`))).toBe(true));
  });
});
