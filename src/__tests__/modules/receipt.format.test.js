// src/__tests__/modules/receipt.format.test.js
//
// What prints on paper, per branch.
//
// Three rules carry this module, and each one exists because the alternative
// fails quietly: only overrides are stored, a locked field is the law however
// it was stored, and a value that returns to its default deletes its row.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockUuid = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuid}`) }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  findOneOrFail: jest.fn(), findAll: jest.fn(), executeQuery: jest.fn(),
}));

const service = require('../../modules/posreceipt/receipt.format.service');
const catalogue = require('../../modules/posreceipt/receipt.catalogue');

const { VISIBILITY, TAX_MODE } = catalogue;
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const USER = 'admin@test.com';

/**
 * @param {Object} over
 *   over.stored — { 'receipt.bill.token': 'never', … }
 *   over.gstin  — what branchdetail holds
 */
const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/FROM branchdetail b/i.test(q)) {
      return Promise.resolve([[{
        BranchName: over.branchName ?? 'Sarjapura Road',
        GSTIN: over.gstin ?? '29AABCS1429B1ZQ',
        Address: over.address ?? '142 Sarjapura Road, Bengaluru',
      }]]);
    }
    if (/SettingKey LIKE CONCAT/i.test(q)) {
      return Promise.resolve([
        Object.entries(over.stored || {}).map(([SettingKey, SettingValue]) => ({ SettingKey, SettingValue })),
      ]);
    }
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const calls = (re) => mockConn.execute.mock.calls.filter(([sql]) => re.test(String(sql)));
const upserts = () => calls(/INSERT INTO pos_setting/i).map(([, p]) => p);
const deletes = () => calls(/DELETE FROM pos_setting/i).map(([, p]) => p);

const fieldIn = (described, key) =>
  described.sections.flatMap((s) => s.fields).find((f) => f.key === key);

beforeEach(() => { jest.clearAllMocks(); mockUuid = 0; });

describe('resolving a format', () => {
  it('gives a branch that has chosen nothing the full set of defaults', async () => {
    route();
    const out = await service.resolveAll(BRANCH, TENANT);

    expect(out.documents.bill.total).toBe(VISIBILITY.ALWAYS);
    expect(out.documents.bill.paperWidth).toBe('80');
    // The default that makes a kitchen ticket a kitchen ticket.
    expect(out.documents.kot.prices).toBe(VISIBILITY.NEVER);
    expect(out.documents.tokenSlip.token).toBe(VISIBILITY.ALWAYS);
  });

  it('lets an override win over the default', async () => {
    route({ stored: { 'receipt.bill.fssai': VISIBILITY.NEVER, 'receipt.bill.paperWidth': '58' } });
    const out = await service.resolveAll(BRANCH, TENANT);

    expect(out.documents.bill.fssai).toBe(VISIBILITY.NEVER);
    expect(out.documents.bill.paperWidth).toBe('58');
    // …and leaves everything else alone.
    expect(out.documents.bill.address).toBe(VISIBILITY.ALWAYS);
  });

  it('keeps each document separate', async () => {
    route({ stored: { 'receipt.bill.paperWidth': '58' } });
    const out = await service.resolveAll(BRANCH, TENANT);
    expect(out.documents.bill.paperWidth).toBe('58');
    expect(out.documents.kot.paperWidth).toBe('80');
  });
});

describe('the masthead', () => {
  // Returned WITH the format rather than fetched separately: a renderer that
  // has to make a second call is one that can print a bill with no shop name on
  // it when that call fails.
  it('comes back beside the format', async () => {
    route({ branchName: 'Sarjapura Road', gstin: '29AABCS1429B1ZQ' });
    const out = await service.resolveAll(BRANCH, TENANT);
    expect(out.shop).toEqual({
      name: 'Sarjapura Road',
      address: '142 Sarjapura Road, Bengaluru',
      gstin: '29AABCS1429B1ZQ',
      fssai: '',
    });
  });

  // Not a branchdetail column, so it lives beside the format that displays it.
  it('carries the FSSAI licence from the branch settings', async () => {
    route({ stored: { 'receipt.shop.fssai': '11223344556677' } });
    const out = await service.resolveAll(BRANCH, TENANT);
    expect(out.shop.fssai).toBe('11223344556677');
  });
});

describe('the tax mode', () => {
  // Derived from the branch's own GSTIN unless somebody has said otherwise: a
  // branch holding a GSTIN is registered, and one that does not cannot be.
  it('reads GST registration off the branch when nobody has said otherwise', async () => {
    route({ gstin: '29AABCS1429B1ZQ' });
    await expect(service.resolveAll(BRANCH, TENANT)).resolves.toMatchObject({ taxMode: TAX_MODE.GST });
  });

  it('falls to unregistered when the branch holds no GSTIN', async () => {
    route({ gstin: '' });
    await expect(service.resolveAll(BRANCH, TENANT)).resolves.toMatchObject({ taxMode: TAX_MODE.UNREGISTERED });
  });

  // The composition scheme is the case a GSTIN alone cannot tell you about.
  it('lets an explicit mode override what the GSTIN implies', async () => {
    route({ gstin: '29AABCS1429B1ZQ', stored: { 'receipt.taxMode': TAX_MODE.COMPOSITION } });
    await expect(service.resolveAll(BRANCH, TENANT)).resolves.toMatchObject({ taxMode: TAX_MODE.COMPOSITION });
  });

  it('refuses a mode that is not one of the three', async () => {
    route();
    await expect(service.setTaxMode('vat', BRANCH, TENANT, USER)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── The cascade ──────────────────────────────────────────────────────────────
// GST status is a MODE, not a field. Three independent checkboxes could each be
// set wrong; one mode cannot.
describe('what the tax mode decides', () => {
  it('locks the GSTIN on for a registered branch', async () => {
    route({ gstin: '29AABCS1429B1ZQ' });
    const described = await service.describe('bill', BRANCH, TENANT);
    const gstin = fieldIn(described, 'gstin');

    expect(gstin.value).toBe(VISIBILITY.ALWAYS);
    expect(gstin.locked.reason).toMatch(/mandatory on a tax invoice/i);
    expect(gstin.locked.changeAt).toBe('Branch → Tax');
  });

  it('locks the GSTIN off, and the tax rows away, for a composition dealer', async () => {
    route({ stored: { 'receipt.taxMode': TAX_MODE.COMPOSITION } });
    const described = await service.describe('bill', BRANCH, TENANT);

    expect(fieldIn(described, 'gstin').value).toBe(VISIBILITY.NEVER);
    const taxRows = fieldIn(described, 'taxRows');
    expect(taxRows.value).toBe('none');
    expect(taxRows.locked.reason).toMatch(/may not collect tax/i);
  });

  it('locks the composition declaration ON for a composition dealer, and off otherwise', async () => {
    route({ stored: { 'receipt.taxMode': TAX_MODE.COMPOSITION } });
    let described = await service.describe('bill', BRANCH, TENANT);
    expect(fieldIn(described, 'compositionNote').value).toBe(VISIBILITY.ALWAYS);

    route({ gstin: '29AABCS1429B1ZQ' });
    described = await service.describe('bill', BRANCH, TENANT);
    expect(fieldIn(described, 'compositionNote').value).toBe(VISIBILITY.NEVER);
  });

  // THE assertion. A GSTIN stored while a branch was registered must not keep
  // printing after it stops being registered — the lock is the authority on
  // every read, not just at the moment of writing.
  it('overrules a stale override rather than honouring it', async () => {
    route({
      gstin: '',
      stored: { 'receipt.bill.gstin': VISIBILITY.ALWAYS },
    });
    const out = await service.resolveAll(BRANCH, TENANT);
    expect(out.documents.bill.gstin).toBe(VISIBILITY.NEVER);
  });
});

describe('saving', () => {
  // Writing the defaults out would look identical right up until a default
  // changes, at which point every branch that never chose anything is silently
  // pinned to the old one.
  it('stores only what differs from the default', async () => {
    route();
    await service.save('bill', { fssai: VISIBILITY.NEVER }, BRANCH, TENANT, USER);

    expect(upserts()).toHaveLength(1);
    expect(upserts()[0]).toEqual(expect.arrayContaining(['receipt.bill.fssai', VISIBILITY.NEVER]));
  });

  it('DELETES the override when a field is set back to its default', async () => {
    route({ stored: { 'receipt.bill.fssai': VISIBILITY.NEVER } });
    await service.save('bill', { fssai: VISIBILITY.ALWAYS }, BRANCH, TENANT, USER);

    expect(upserts()).toHaveLength(0);
    expect(deletes()[0]).toEqual([TENANT, BRANCH, 'receipt.bill.fssai']);
  });

  // Silently ignoring a locked field means the editor shows one thing and the
  // printer does another — the worst of the three possible outcomes.
  it('refuses a locked field rather than dropping it', async () => {
    route({ gstin: '29AABCS1429B1ZQ' });
    await expect(service.save('bill', { gstin: VISIBILITY.NEVER }, BRANCH, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(upserts()).toHaveLength(0);
  });

  it('refuses a value the field does not accept', async () => {
    route();
    await expect(service.save('bill', { taxRows: 'sometimes' }, BRANCH, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a field that is not on this document', async () => {
    route();
    // `prices` is a kitchen-ticket field. It must not be settable on a bill.
    await expect(service.save('bill', { prices: VISIBILITY.ALWAYS }, BRANCH, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses an unknown document type', async () => {
    route();
    await expect(service.save('menu', { total: VISIBILITY.ALWAYS }, BRANCH, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(service.describe('menu', BRANCH, TENANT))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('caps free text at the length the paper can hold', async () => {
    route();
    await expect(service.save('bill', { footerLine1: 'x'.repeat(300) }, BRANCH, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts free text, including clearing it', async () => {
    route({ stored: { 'receipt.bill.footerLine1': 'Old text' } });
    await service.save('bill', { footerLine1: '' }, BRANCH, TENANT, USER);
    expect(upserts()[0]).toEqual(expect.arrayContaining(['receipt.bill.footerLine1', '']));
  });
});

// ── The three-state control ──────────────────────────────────────────────────
// A boolean gets these wrong: ALWAYS prints "Customer: —" on every walk-in,
// NEVER loses the name for the customers who did give one.
describe('fields that depend on the sale, not on a preference', () => {
  it.each(['token', 'table', 'customer', 'portalOrder'])(
    'offers %s a third state, and defaults to it', async (key) => {
      route();
      const described = await service.describe('bill', BRANCH, TENANT);
      const field = fieldIn(described, key);

      expect(field.states).toContain(VISIBILITY.IF_PRESENT);
      expect(field.value).toBe(VISIBILITY.IF_PRESENT);
    },
  );

  it('does not offer it where the answer cannot vary', async () => {
    route();
    const described = await service.describe('bill', BRANCH, TENANT);
    expect(fieldIn(described, 'cashier').states).not.toContain(VISIBILITY.IF_PRESENT);
  });
});

describe('the editable shape', () => {
  it('carries every document type so the editor renders its own tabs', async () => {
    route();
    const described = await service.describe('bill', BRANCH, TENANT);
    expect(described.documents.map((d) => d.key))
      .toEqual(['bill', 'creditNote', 'kot', 'tokenSlip']);
  });

  it('marks which fields the branch has actually changed', async () => {
    route({ stored: { 'receipt.bill.fssai': VISIBILITY.NEVER } });
    const described = await service.describe('bill', BRANCH, TENANT);

    expect(fieldIn(described, 'fssai').overridden).toBe(true);
    expect(fieldIn(described, 'address').overridden).toBe(false);
    // A locked field is never "overridden" — the branch did not choose it.
    expect(fieldIn(described, 'gstin').overridden).toBe(false);
  });

  it('never leaves a field without a value', async () => {
    route();
    for (const doc of ['bill', 'creditNote', 'kot', 'tokenSlip']) {
      // eslint-disable-next-line no-await-in-loop
      const described = await service.describe(doc, BRANCH, TENANT);
      const fields = described.sections.flatMap((s) => s.fields);
      expect(fields.length).toBeGreaterThan(0);
      fields.forEach((f) => {
        expect(f.value).toBeDefined();
        expect(f.default).toBeDefined();
      });
    }
  });
});

describe('how much paper a document spends', () => {
  // The credit note used to default to TWO copies on the reasoning that a
  // refund wants a signed copy kept. It reads as a bug, not a courtesy: paper
  // comes out twice for a choice nobody made. Every document defaults to one.
  it.each(['bill', 'creditNote', 'kot', 'tokenSlip'])('%s prints once by default', async (doc) => {
    route();
    const out = await service.resolveAll(BRANCH, TENANT);
    expect(out.documents[doc].copies).toBe('1');
  });

  it('still offers a second copy to anyone who wants one', async () => {
    route();
    const described = await service.describe('creditNote', BRANCH, TENANT);
    expect(fieldIn(described, 'copies').options.map((o) => o.value)).toEqual(['1', '2']);
  });
});

describe('the catalogue itself', () => {
  // Everything is generated from it, so a duplicate key or a default outside
  // the allowed set would surface as a UI bug somewhere far away.
  it.each(['bill', 'creditNote', 'kot', 'tokenSlip'])('%s has unique field keys', (doc) => {
    const keys = catalogue.fieldsOf(doc).map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(['bill', 'creditNote', 'kot', 'tokenSlip'])('%s defaults are all legal values', (doc) => {
    catalogue.fieldsOf(doc).forEach((field) => {
      const allowed = catalogue.allowedValues(field);
      if (allowed) expect(allowed).toContain(String(field.default));
    });
  });

  it('keeps every storage key inside the column', () => {
    Object.keys(catalogue.DOCUMENTS).forEach((doc) => {
      catalogue.fieldsOf(doc).forEach((field) => {
        expect(catalogue.settingKey(doc, field.key).length).toBeLessThanOrEqual(100);
      });
    });
  });
});
