// src/__tests__/modules/export.service.test.js
// CSV exports: who may take which file, and what the file says.
//
// The permission half matters most. An export is gated on the scope its own
// screen opens on — except customer data, which needs CUSTOMER:EXPORT — and the
// one rule that must never slip is that a front-of-house manager with
// POS_CRM:READ cannot walk off with every guest's mobile.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const catalogue = require('../../modules/export/export.catalogue');
const service = require('../../modules/export/export.service');
const { IMPORT_COLUMNS } = require('../../modules/export/definitions/menu');
const { segmentOf, whenRuns } = require('../../modules/export/definitions/guests');
const { SCOPES } = require('../../config/constants');

const TENANT = 'tenant-1';
const BRANCH = '6f1c2a3e-4b5d-4c6e-8f70-9a1b2c3d4e5f';
const userWith = (...scopes) => ({ tid: TENANT, phone: '9999999999', name: 'Tester', scopes });
const ADMIN = userWith(SCOPES.TENANT_ADMIN);
const BOM = '﻿';

const lines = (csv) => csv.replace(BOM, '').trim().split('\r\n');

describe('export.catalogue', () => {
  it('gives every export a unique key, a file stem, columns and a loader', () => {
    expect(catalogue.DEFINITIONS.length).toBeGreaterThanOrEqual(25);
    catalogue.DEFINITIONS.forEach((d) => {
      expect(d.key).toMatch(/^[a-z][a-z-]+$/);
      expect(d.fileStem).toBeTruthy();
      expect(typeof d.load).toBe('function');
      expect(d.columns.length).toBeGreaterThan(0);
      expect(Array.isArray(d.scopes)).toBe(true);
      // Every grouped column names a group the dialog can offer.
      d.columns.filter(([, , g]) => g).forEach(([, , g]) => expect(d.groups).toHaveProperty(g));
    });
  });

  it('lets an admin take everything', () => {
    expect(catalogue.visibleTo([SCOPES.TENANT_ADMIN])).toHaveLength(catalogue.DEFINITIONS.length);
    expect(catalogue.visibleTo([SCOPES.TENANT_SUPER_ADMIN])).toHaveLength(catalogue.DEFINITIONS.length);
  });

  it('keeps customer data from POS_CRM:READ alone', () => {
    const keys = catalogue.visibleTo([SCOPES.POS_CRM_READ]).map((d) => d.key);
    expect(keys).toContain('feedback');
    expect(keys).not.toContain('customers');
    expect(keys).not.toContain('loyalty');
    expect(keys).not.toContain('lapsed');
  });

  it('opens customer data to CUSTOMER:EXPORT', () => {
    const keys = catalogue.visibleTo([SCOPES.CUSTOMER_EXPORT]).map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['customers', 'loyalty', 'lapsed']));
  });

  it('gates each Money export on the scope its screen opens on', () => {
    const books = catalogue.visibleTo([SCOPES.TRANSACTIONS_READ]).map((d) => d.key);
    expect(books).toEqual(expect.arrayContaining(['ledger-documents', 'ledger-lines', 'payments', 'returns', 'dues', 'sales']));
    expect(books).not.toContain('expenses');
    expect(books).not.toContain('assets');

    const cashier = catalogue.visibleTo([SCOPES.POS_BILLING_READ]).map((d) => d.key);
    expect(cashier).toEqual(expect.arrayContaining(['dues', 'cash-sessions', 'daily-stock']));
    expect(cashier).not.toContain('ledger-documents');
  });

  it('lets only admins and CUSTOMER:EXPORT holders un-mask', () => {
    expect(catalogue.canUnmask([SCOPES.TENANT_ADMIN])).toBe(true);
    expect(catalogue.canUnmask([SCOPES.CUSTOMER_EXPORT])).toBe(true);
    expect(catalogue.canUnmask([SCOPES.TRANSACTIONS_READ, SCOPES.POS_CRM_READ])).toBe(false);
  });

  it('writes the menu in the import template\'s exact columns, so it re-imports', () => {
    expect(IMPORT_COLUMNS).toEqual(['name', 'category', 'unit', 'price', 'tax_group', 'tax_components',
      'food_type', 'code', 'description', 'tax_included', 'hsn', 'sac']);
    const def = catalogue.find('menu-items');
    expect(def.columns.map(([h]) => h)).toEqual(IMPORT_COLUMNS);
  });
});

describe('export.service', () => {
  beforeEach(() => mockConn.execute.mockReset());

  const LEDGER_ROWS = [
    {
      TransactionNo: 'INV/IND/2610/0412', TransactionDate: new Date('2026-10-01T00:00:00Z'), SettledAt: null,
      TypeName: 'POS Sale', StatusName: 'SETTLED', BranchName: 'Indiranagar',
      CustomerName: 'Riya Sharma', CustomerMobile: '9845012345', BuyerGstin: null, BuyerLegalName: null,
      NetAmount: '800.0000', TaxAmount: '40.0000', DiscountAmount: '0', RoundOff: '0', GrossAmount: '840.0000',
      TaxByComponent: [{ name: 'CGST', amount: 20 }, { name: 'SGST', amount: 20 }],
      WriteOffAmount: '0', Paid: '840.0000', Returned: '210.0000', ReversesNo: null,
    },
    {
      TransactionNo: 'CN/IND/2610/0007', TransactionDate: new Date('2026-10-02T00:00:00Z'), SettledAt: null,
      TypeName: 'POS Return', StatusName: 'SETTLED', BranchName: 'Indiranagar',
      CustomerName: '=HYPERLINK("x")', CustomerMobile: null, BuyerGstin: null, BuyerLegalName: null,
      NetAmount: '200', TaxAmount: '10', DiscountAmount: '0', RoundOff: '0', GrossAmount: '210',
      TaxByComponent: '[{"name":"CGST","amount":5},{"name":"SGST","amount":5}]',
      WriteOffAmount: '0', Paid: '-210', Returned: '0', ReversesNo: 'INV/IND/2610/0412',
    },
  ];

  const custom = { preset: 'custom', fromDate: '2026-10-01', toDate: '2026-10-06' };

  it('writes the ledger with a BOM, ISO dates, masked mobiles and negative credit notes', async () => {
    mockConn.execute.mockResolvedValueOnce([LEDGER_ROWS]);
    const out = await service.run('ledger-documents', custom, ADMIN);

    expect(out.csv.startsWith(BOM)).toBe(true);
    expect(out.fileName).toBe('ledger_all-branches_2026-10-01_to_2026-10-06.csv');
    expect(out.rowCount).toBe(2);

    const [header, sale, note] = lines(out.csv);
    expect(header.split(',')).toEqual(expect.arrayContaining(['Date', 'Document No', 'CGST', 'Gross', 'Due']));
    expect(sale).toContain('2026-10-01,INV/IND/2610/0412,Sale,Settled');
    expect(sale).toContain('98450 •••45');
    expect(sale).not.toContain('9845012345');
    expect(note).toContain('-210.00');
    expect(note).toContain('Credit note');
    // A guest-typed formula is defused, not executed.
    expect(note).toContain('"\'=HYPERLINK(""x"")"');
  });

  it('works out Due the way the Dues screen does — returns come off first', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ ...LEDGER_ROWS[0], Paid: '500', Returned: '210' }]]);
    const out = await service.run('ledger-documents', custom, ADMIN);
    const header = lines(out.csv)[0].split(',');
    const row = lines(out.csv)[1].split(',');
    expect(row[header.indexOf('Due')]).toBe('130.00');
  });

  it('writes mobiles in full only when an allowed person asks', async () => {
    mockConn.execute.mockResolvedValue([LEDGER_ROWS]);
    const admin = await service.run('ledger-documents', { ...custom, unmask: true }, ADMIN);
    expect(admin.csv).toContain('98450 12345');

    const books = await service.run('ledger-documents', { ...custom, unmask: true }, userWith(SCOPES.TRANSACTIONS_READ));
    expect(books.csv).toContain('98450 •••45');
    expect(books.details).toContain('mobiles masked');
  });

  it('leaves out column groups that were not asked for', async () => {
    mockConn.execute.mockResolvedValue([LEDGER_ROWS]);
    const out = await service.run('ledger-documents', { ...custom, groups: '' }, ADMIN);
    const header = lines(out.csv)[0];
    expect(header).not.toContain('CGST');
    expect(header).not.toContain('Buyer GSTIN');
    expect(header).toContain('Tax');
  });

  it('passes the branch, type and status into the query', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ Id: BRANCH, BranchName: 'Indiranagar', GSTIN: null }]])
      .mockResolvedValueOnce([[]]);
    const out = await service.run('ledger-documents', { ...custom, branchId: BRANCH, type: 'sale', status: 'SETTLED' }, ADMIN);
    const [sql, params] = mockConn.execute.mock.calls[1];
    expect(sql).toContain('t.Name = ?');
    expect(sql).toContain('s.Name = ?');
    expect(params).toEqual([TENANT, BRANCH, BRANCH, '2026-10-01', '2026-10-06', 'POS Sale', 'SETTLED']);
    expect(out.fileName).toBe('ledger_indiranagar_2026-10-01_to_2026-10-06.csv');
  });

  it('refuses customer data without CUSTOMER:EXPORT', async () => {
    await expect(service.run('customers', {}, userWith(SCOPES.POS_CRM_READ)))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('answers 404 for an export that does not exist', async () => {
    await expect(service.run('everything', {}, ADMIN)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a range longer than a year', async () => {
    await expect(service.run('ledger-documents', { preset: 'custom', fromDate: '2024-01-01', toDate: '2026-01-01' }, ADMIN))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a filter value the export does not know', async () => {
    await expect(service.run('expenses', { status: 'SETTLED' }, ADMIN)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('names staff, never their mobile', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{
        BranchName: 'Indiranagar', CashierPhone: '9000000001', ShiftLabel: 'Morning',
        OpenedAt: new Date(2026, 9, 5, 8, 0), ClosedAt: new Date(2026, 9, 5, 15, 30),
        OpeningFloat: '2000', ExpectedCash: '6390', CountedCash: '6340', Variance: '-50',
        Status: 'closed', Notes: null, OpenedBy: '9000000001', ClosedBy: '9000000002',
      }]])
      .mockResolvedValueOnce([[{ id: 'm1', user_phone: '9000000001', full_name: 'Rahul Verma' }]]);
    const out = await service.run('cash-sessions', custom, ADMIN);
    const row = lines(out.csv)[1];
    expect(row).toContain('Rahul Verma');
    expect(row).toContain('•••• 0002');
    expect(row).toContain('4390.00'); // cash movement = expected − float
    expect(out.csv).not.toContain('9000000001');
  });

  it('builds the loyalty running balance from the opening balance', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[
        { Id: 'e1', CustomerId: 'c1', CreatedOn: new Date(2026, 9, 1, 13, 41), Name: 'Riya', Phone: '9845012345',
          EntryType: 'EARN', Points: 42, SourceType: 'BILL', SourceNo: 'INV/1', Reason: null, BranchDetailId: 'b1', BranchName: 'Indiranagar', CreatedBy: null },
        { Id: 'e2', CustomerId: 'c1', CreatedOn: new Date(2026, 9, 2, 12, 20), Name: 'Riya', Phone: '9845012345',
          EntryType: 'REVERSAL', Points: -10, SourceType: 'RETURN', SourceNo: 'CN/1', Reason: 'Return', BranchDetailId: 'b2', BranchName: 'Koramangala', CreatedBy: null },
      ]])
      .mockResolvedValueOnce([[{ CustomerId: 'c1', Opening: '380' }]]);
    const out = await service.run('loyalty', custom, userWith(SCOPES.CUSTOMER_EXPORT));
    const [, earn, reverse] = lines(out.csv);
    expect(earn).toContain(',42,422,');
    expect(reverse).toContain('REVERSE,-10,412,');
  });

  it('writes the menu so the importer reads it back', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{
        Name: 'Paneer Tikka', Code: 'STR-04', Description: 'Charred, with mint', HSNCode: null, SACCode: '996331',
        CategoryName: 'Starters', UnitName: 'Plate', Price: '300', IsTaxIncluded: 0,
        TaxGroupId: 'tg5', TaxGroupName: 'GST 5%', FoodTypeName: 'Veg',
      }]])
      .mockResolvedValueOnce([[{ TaxGroupId: 'tg5', Name: 'CGST', Value: '2.5' }, { TaxGroupId: 'tg5', Name: 'SGST', Value: '2.5' }]]);
    const out = await service.run('menu-items', {}, userWith(SCOPES.POS_CONFIG_READ));
    expect(lines(out.csv)).toEqual([
      'name,category,unit,price,tax_group,tax_components,food_type,code,description,tax_included,hsn,sac',
      'Paneer Tikka,Starters,Plate,300,GST 5%,CGST:2.5|SGST:2.5,Veg,STR-04,"Charred, with mint",false,,996331',
    ]);
    expect(out.fileName).toMatch(/^menu-items_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('honours the period and branch on an export with no filters of its own', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ Id: BRANCH, BranchName: 'Koramangala', GSTIN: null }]])
      .mockResolvedValueOnce([[]]);
    const out = await service.run('ledger-lines', { ...custom, branchId: BRANCH }, ADMIN);
    expect(out.fileName).toBe('ledger-lines_koramangala_2026-10-01_to_2026-10-06.csv');
    expect(mockConn.execute.mock.calls[1][1]).toEqual(
      [TENANT, BRANCH, BRANCH, '2026-10-01', '2026-10-06', 'POS Sale', 'POS Return'],
    );
  });

  it('previews the row count and header without a file', async () => {
    mockConn.execute.mockResolvedValueOnce([LEDGER_ROWS]);
    const p = await service.preview('ledger-documents', custom, ADMIN);
    expect(p.rowCount).toBe(2);
    expect(p.masked).toBe(true);
    expect(p.writtenColumns[0]).toBe('Date');
    expect(p.range).toEqual({ from: '2026-10-01', to: '2026-10-06' });
  });

  it('bundles only the reports this person may open', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    const none = userWith(SCOPES.POS_CRM_READ);
    await expect(service.bundle({}, none)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('guest helpers', () => {
  it('sorts a customer into one segment, business first', () => {
    expect(segmentOf({ GSTIN: '29ABCDE1234F1Z5', Visits: 9, DaysAway: 5 })).toBe('Business');
    expect(segmentOf({ Visits: 31, DaysAway: 99 })).toBe('Lapsed');
    expect(segmentOf({ Visits: 4, DaysAway: 10 })).toBe('Regular');
    expect(segmentOf({ Visits: 1, DaysAway: 3 })).toBe('New');
  });

  it('says when a campaign runs', () => {
    expect(whenRuns({ DaysOfWeek: '1,2,3,4,5', StartTime: '16:00:00', EndTime: '18:00:00' })).toBe('Mon–Fri 16:00–18:00');
    expect(whenRuns({ DaysOfWeek: null })).toBe('Every day');
    expect(whenRuns({ DaysOfWeek: '6,7' })).toBe('Sat, Sun');
  });
});
