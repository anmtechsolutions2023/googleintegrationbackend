// Kitchen notes: one on each dish, one for the whole order.
//
// The note has to survive every hop between the till and the paper: the order
// line, the round, the kitchen ticket, a table transfer and the invoice line.
// These tests walk each hop with the real code and a fake connection.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const mockConn = { execute: jest.fn(async () => [{ affectedRows: 1 }]) };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  executeQuery: jest.fn(),
}));
jest.mock('../../modules/positemmeta/positemmeta.repository', () => ({
  getInactiveItemMetaIds: jest.fn(async () => new Set()),
  getCostInfoIdsByItemMetaIds: jest.fn(async () => new Map()),
  getVariantPricesByIds: jest.fn(async () => new Map()),
  getAddonPricesByIds: jest.fn(async () => new Map()),
  getAddonRulesByItemMetaIds: jest.fn(async () => new Map()),
  getCategoryIdsByItemMetaIds: jest.fn(async () => new Map()),
}));
jest.mock('../../modules/poscategoryschedule/poscategoryschedule.service', () => {
  const actual = jest.requireActual('../../modules/poscategoryschedule/poscategoryschedule.service');
  return {
    availabilityOf: actual.availabilityOf,
    indexByCategory: actual.indexByCategory,
    getAllForTenant: jest.fn(async () => []),
    getTimeZone: jest.fn(async () => 'Asia/Kolkata'),
  };
});
jest.mock('../../modules/pricing/pricing.service', () => ({
  priceLines: jest.fn(),
  priceSnapshotLines: jest.fn(),
}));
jest.mock('../../modules/posorder/posNumbering', () => ({
  issuePosNumber: jest.fn(async () => 'ORD-0042'),
}));
jest.mock('../../modules/posorder/posVenue', () => ({
  resolveVenueTx: jest.fn(async () => ({
    TableName: null, FloorId: null, FloorName: null, TableCapacity: null,
  })),
}));

const BaseCRUDService = require('../../common/BaseCRUDService');
const repo = require('../../modules/positemmeta/positemmeta.repository');
const pricing = require('../../modules/pricing/pricing.service');
const service = require('../../modules/posorder/posorder.service');
const { writeKot } = require('../../modules/posorder/posKotWriter');
const billRepository = require('../../modules/posbill/posbill.repository');
const {
  lineNoteOf, withCleanNotes, assertNotesFit, cleanInstructions,
} = require('../../modules/posorder/kitchenNotes');
const { KITCHEN_NOTES } = require('../../config/constants');

const TENANT = 'tn';
const USER = '+919876543210';

/** The pos_order INSERT as { column: value }, up to the NOW() column. */
const insertedOrder = () => {
  const call = mockConn.execute.mock.calls.find(([sql]) => /^INSERT INTO pos_order/.test(String(sql)));
  const [sql, params] = call;
  const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((c) => c.trim());
  const upToNow = cols.slice(0, cols.indexOf('CreatedOn'));
  return Object.fromEntries(upToNow.map((c, i) => [c, params[i]]));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConn.execute.mockImplementation(async () => [{ affectedRows: 1 }]);
});

describe('the rules', () => {
  it('tidies a note and reads a portal line\'s `notes` as the same thing', () => {
    expect(lineNoteOf({ note: '  Less   spicy,  No onion ' })).toBe('Less spicy, No onion');
    expect(lineNoteOf({ notes: 'Extra spicy' })).toBe('Extra spicy');
    expect(lineNoteOf({ note: 42 })).toBeNull();
    expect(lineNoteOf(null)).toBeNull();
  });

  it('drops a blank note rather than storing an empty string on every dish', () => {
    const [line] = withCleanNotes([{ name: 'Dosa', note: '   ' }]);
    expect(line).not.toHaveProperty('note');
  });

  it('hands back Items that are not a list untouched', () => {
    const items = { name: 'legacy' };
    expect(withCleanNotes(items)).toBe(items);
  });

  it('refuses a note the ticket cannot hold, naming the dish', () => {
    expect(() => assertNotesFit([{ name: 'Dosa', note: 'x'.repeat(KITCHEN_NOTES.LINE_MAX) }])).not.toThrow();
    expect(() => assertNotesFit([{ name: 'Dosa', note: 'x'.repeat(KITCHEN_NOTES.LINE_MAX + 1) }]))
      .toThrow(/kitchen note on "Dosa" is 141 characters; keep it to 140/);
  });

  it('a blank whole-order note is no note', () => {
    expect(cleanInstructions('   ')).toBeNull();
    expect(cleanInstructions(undefined)).toBeNull();
    expect(cleanInstructions(' Pack  sauces separately ')).toBe('Pack sauces separately');
  });
});

describe('placing a round at the till', () => {
  it('stores the dish note on its line, and the whole-order note and flag on the round', async () => {
    await service.create({
      TableId: null,
      OrderType: 'takeaway',
      Items: [{ id: 'm1', name: 'Veg Triple Fried Rice', qty: 1, note: '  Less spicy,   No onion ' }],
      CookingInstructions: '  Pack sauces separately ',
      NoCutlery: true,
      Active: true,
    }, TENANT, USER);

    const row = insertedOrder();
    expect(JSON.parse(row.Items)[0].note).toBe('Less spicy, No onion');
    expect(row.CookingInstructions).toBe('Pack sauces separately');
    expect(row.NoCutlery).toBe(1);
  });

  it('an order with no notes stores none', async () => {
    await service.create({ Items: [{ id: 'm1', name: 'Dosa', qty: 1 }], Active: true }, TENANT, USER);
    const row = insertedOrder();
    expect(JSON.parse(row.Items)[0]).not.toHaveProperty('note');
    expect(row.CookingInstructions).toBeNull();
    expect(row.NoCutlery).toBe(0);
  });

  it('refuses an over-long dish note before touching the database', async () => {
    await expect(service.create({
      Items: [{ id: 'm1', name: 'Dosa', qty: 1, note: 'x'.repeat(141) }], Active: true,
    }, TENANT, USER)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockConn.execute).not.toHaveBeenCalled();
    expect(repo.getCategoryIdsByItemMetaIds).not.toHaveBeenCalled();
  });
});

describe('editing a round', () => {
  let update;
  beforeEach(() => {
    update = jest.spyOn(BaseCRUDService.prototype, 'update').mockResolvedValue({ ok: true });
  });
  afterEach(() => update.mockRestore());

  it('cleans a changed whole-order note', async () => {
    await service.update('o1', { CookingInstructions: '  Ring the bell ' }, TENANT, USER);
    expect(update).toHaveBeenCalledWith('o1', { CookingInstructions: 'Ring the bell' }, TENANT, USER);
  });

  it('leaves the note alone when the edit does not mention it', async () => {
    await service.update('o1', { Status: 'closed' }, TENANT, USER);
    expect(update).toHaveBeenCalledWith('o1', { Status: 'closed' }, TENANT, USER);
  });

  // Closing or paying for a portal round re-sends its Items. A customer's long
  // instruction must not make that round unpayable.
  it('does not refuse a long portal note on an existing round', async () => {
    const long = 'Please make it mild, my child is eating. '.repeat(8);
    await expect(service.update('o1', { Items: [{ name: 'Pizza', notes: long }] }, TENANT, USER))
      .resolves.toEqual({ ok: true });
    expect(update.mock.calls[0][1].Items[0].note.length).toBeGreaterThan(KITCHEN_NOTES.LINE_MAX);
  });
});

describe('pricing keeps the note', () => {
  it('a priced line still carries it, whichever key it arrived under', async () => {
    repo.getCostInfoIdsByItemMetaIds.mockResolvedValueOnce(new Map([['m1', 'ci-1']]));
    pricing.priceLines.mockResolvedValueOnce({
      lines: [{
        ref: 'L0', unitAmount: 479, baseAmount: 239, variantAmount: 170, addonAmount: 70,
        variants: [], addons: [], effectiveRate: 5, isTaxIncluded: true,
        netAmount: 456.19, taxAmount: 22.81, grossAmount: 479, components: [],
      }],
      totals: { netAmount: 456.19, taxAmount: 22.81, grossAmount: 479 },
    });
    const priced = await service.priceItems([{ id: 'm1', qty: 1, notes: ' Extra spicy ' }], TENANT);
    expect(priced.items[0]).toMatchObject({ note: 'Extra spicy', price: 479, basePrice: 239 });
  });
});

describe('sending to the kitchen', () => {
  it('the ticket snapshots the round\'s instructions and hands them back to print', async () => {
    const conn = { execute: jest.fn(async () => [{ affectedRows: 1 }]) };
    const kot = await writeKot(conn, {
      Id: 'o1', TableId: null, Items: [{ name: 'Dosa', note: 'Less oil' }],
      CookingInstructions: 'Pack sauces separately', NoCutlery: 1,
    }, TENANT, USER, 'KOT-0009');

    expect(kot).toMatchObject({
      KotNo: 'KOT-0009', CookingInstructions: 'Pack sauces separately', NoCutlery: true,
    });
    const [, params] = conn.execute.mock.calls[0];
    expect(JSON.parse(params[5])[0].note).toBe('Less oil');
    expect(params[6]).toBe('Pack sauces separately');
    expect(params[7]).toBe(1);
  });
});

describe('settling carries the dish note to the invoice line', () => {
  const conn = {
    execute: jest.fn(async (sql) => {
      const q = String(sql);
      if (/AS MetaId/i.test(q)) return [[]];
      if (/FROM pos_item_meta WHERE TenantId = \? AND Id IN/i.test(q)) {
        return [[{ Id: 'm1', ItemDetailId: 'item-1' }]];
      }
      return [[{
        Id: 'o1',
        Items: JSON.stringify([
          { id: 'm1', name: 'Veg Triple Fried Rice', qty: 1, price: 479, note: 'Less spicy' },
          { id: 'm1', name: 'Veg Triple Fried Rice', qty: 1, price: 479, notes: ' From the portal ' },
          { id: 'm1', name: 'Veg Triple Fried Rice', qty: 1, price: 479 },
        ]),
      }]];
    }),
  };

  it('reads each round line\'s note, in either spelling', async () => {
    const lines = await billRepository.getOrderLinesTx(conn, ['o1'], TENANT);
    expect(lines.map((l) => l.note)).toEqual(['Less spicy', 'From the portal', null]);
  });

  it('hands it to the ledger with the rest of the priced line', async () => {
    const [line] = await billRepository.toLedgerLinesTx(conn, [
      { id: 'm1', name: 'Veg Triple Fried Rice', quantity: 1, note: 'Less spicy', grossAmount: 479 },
    ], TENANT);
    expect(line).toMatchObject({ itemDetailId: 'item-1', note: 'Less spicy' });
  });
});
