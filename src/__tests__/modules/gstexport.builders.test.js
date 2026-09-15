const b = require('../../modules/gstexport/gstexport.builders');
const zip = require('../../utils/zip');

const GSTIN = '29ABCDE1234F1Z5';
const BUYER = '29PQRSX5678K1Z3';

const comps = (half) => JSON.stringify([
  { name: 'CGST', rate: 2.5, amount: half },
  { name: 'SGST', rate: 2.5, amount: half },
]);

const doc = (over) => ({
  Id: 'd1', TransactionNo: 'INV-0001', TransactionDate: '2026-08-05', BranchName: 'Main',
  NetAmount: 0, TaxAmount: 0, DiscountAmount: 0, RoundOff: 0, GrossAmount: 0,
  TaxMode: 'gst', BuyerGstin: null, BuyerLegalName: null, CustomerName: null,
  ReversesLogId: null, TypeName: 'POS Sale', StatusName: 'SETTLED', Source: null,
  ...over,
});
const line = (over) => ({
  LogId: 'd1', LineNo: 1, ItemId: 'i1', Quantity: 1, UnitPrice: 239,
  NetAmount: 227.62, DiscountAmount: 0, TaxAmount: 11.38, GrossAmount: 239,
  TaxComponents: comps(5.69), Variants: null, Addons: null, TaxCharged: 1,
  ItemName: 'Fried Rice', SACCode: '996331', HSNCode: null, ...over,
});

// One month: a B2C sale, a B2B sale, a B2C credit note, an aggregator order,
// a sale issued with GST off, an exempt line, and a cancelled invoice.
const month = () => ({
  documents: [
    doc({ Id: 'd1', TransactionNo: 'INV-0001', NetAmount: 227.62, TaxAmount: 11.38, GrossAmount: 239 }),
    doc({ Id: 'd2', TransactionNo: 'INV-0002', NetAmount: 1000, TaxAmount: 50, GrossAmount: 1050,
      BuyerGstin: BUYER, BuyerLegalName: 'Acme Foods' }),
    doc({ Id: 'd3', TransactionNo: 'CN-0001', TypeName: 'POS Return', NetAmount: 227.62, TaxAmount: 11.38,
      GrossAmount: 239, ReversesLogId: 'd1', OriginalNo: 'INV-0001' }),
    doc({ Id: 'd4', TransactionNo: 'INV-0003', NetAmount: 400, TaxAmount: 0, GrossAmount: 400,
      Source: JSON.stringify({ portalName: 'Zomato', portalGstin: null }) }),
    doc({ Id: 'd5', TransactionNo: 'INV-0004', TaxMode: 'composition', NetAmount: 219, TaxAmount: 0, GrossAmount: 219 }),
    doc({ Id: 'd6', TransactionNo: 'INV-0005', NetAmount: 40, TaxAmount: 0, GrossAmount: 40 }),
    doc({ Id: 'd7', TransactionNo: 'INV-0006', StatusName: 'CANCELLED', NetAmount: 100, TaxAmount: 5, GrossAmount: 105 }),
  ],
  lines: [
    line({ LogId: 'd1' }),
    line({ LogId: 'd2', NetAmount: 1000, TaxAmount: 50, GrossAmount: 1050, TaxComponents: comps(25) }),
    line({ LogId: 'd3' }),
    line({ LogId: 'd4', NetAmount: 400, TaxAmount: 0, GrossAmount: 400, TaxComponents: '[]' }),
    line({ LogId: 'd5', NetAmount: 219, TaxAmount: 0, GrossAmount: 219, TaxComponents: '[]', TaxCharged: 0 }),
    line({ LogId: 'd6', NetAmount: 40, TaxAmount: 0, GrossAmount: 40, TaxComponents: '[]', ItemName: 'Water', SACCode: null }),
    line({ LogId: 'd7', NetAmount: 100, TaxAmount: 5, GrossAmount: 105, TaxComponents: comps(2.5) }),
  ],
  tenders: new Map([['d1', 'UPI']]),
});

const analyse = () => {
  const model = b.buildModel(month());
  const acc = b.classify(model, GSTIN);
  const tie = b.tieOut(model, acc);
  return { model, acc, tie };
};

const rows = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n').map((r) => r.split(','));

describe('GST export — classification', () => {
  test('a B2C credit note nets into b2cs rather than being listed', () => {
    const { acc } = analyse();
    const sheet = rows(b.sheetB2cs(acc));
    // INV-0001 227.62 minus CN-0001 227.62 → nothing left at 5%; the B2B sale
    // is not in b2cs at all.
    expect(sheet).toHaveLength(1);
  });

  test('a sale with a buyer GSTIN is B2B, with place of supply from the branch', () => {
    const { acc } = analyse();
    const [header, first] = rows(b.sheetB2b(acc));
    expect(header[0]).toBe('GSTIN/UIN of Recipient');
    expect(first).toEqual([BUYER, 'Acme Foods', 'INV-0002', '05-Aug-2026', '1050.00',
      '29-Karnataka', 'N', '', 'Regular B2B', '', '5', '1000.00', '0.00']);
  });

  test('aggregator orders go to eco.csv, not to any taxable sheet', () => {
    const { acc } = analyse();
    const [, eco] = rows(b.sheetEco(acc));
    expect(eco.slice(0, 4)).toEqual(['Liable to pay tax u/s 9(5)', '', 'Zomato', '400.00']);
    expect(acc.portalsWithoutGstin.has('Zomato')).toBe(true);
  });

  test('a document issued with GST off is kept out of GSTR-1 and in its own file', () => {
    const { model, acc } = analyse();
    expect(acc.withoutGst.docs.has('d5')).toBe(true);
    const out = b.sheetWithoutGst(model);
    expect(out.bills).toBe(1);
    expect(out.csv.startsWith('﻿')).toBe(true);
    expect(out.csv).toContain('INV-0004');
    expect(out.csv).toContain('composition');
  });

  test('a 0% line is reported as exempted, and flagged for its missing code', () => {
    const { acc } = analyse();
    const exemp = rows(b.sheetExemp(acc));
    expect(exemp[4]).toEqual(['Intra-State supplies to unregistered persons', '0.00', '40.00', '0.00']);
    expect([...acc.missingCodes]).toEqual(['Water']);
  });

  test('3.1(a) is the taxable total after netting, with the tax split', () => {
    const { acc } = analyse();
    expect(acc.t31a.taxable).toBe(100000); // 1000.00 in paise: B2C sale and its note cancel
    expect(acc.t31a.cgst).toBe(2500);
    expect(acc.t31a.sgst).toBe(2500);
  });

  test('a cancelled invoice counts in docs.csv and nowhere else', () => {
    const { model } = analyse();
    const docs = rows(b.sheetDocs(model));
    expect(docs[1]).toEqual(['Invoices for outward supply', 'INV-0001', 'INV-0006', '6', '1']);
    expect(docs[2]).toEqual(['Credit Note', 'CN-0001', 'CN-0001', '1', '0']);
  });

  test('ties out to the document headers', () => {
    const { tie } = analyse();
    expect(tie.matches).toBe(true);
    expect(tie.ledgerNet).toBe(tie.returnNet);
  });

  test('a header that disagrees with its lines is reported, not smoothed over', () => {
    const data = month();
    data.documents[0].NetAmount = 230;
    const model = b.buildModel(data);
    const acc = b.classify(model, GSTIN);
    const tie = b.tieOut(model, acc);
    expect(tie.matches).toBe(false);
    const checks = b.checksFor({ model, acc, tie, branch: { gstin: GSTIN }, filing: null });
    expect(checks.find((c) => c.key === 'tieout').level).toBe('warn');
  });

  test('a branch with no GSTIN blocks the pack', () => {
    const { model, acc, tie } = analyse();
    const checks = b.checksFor({ model, acc, tie, branch: { gstin: null }, filing: null });
    expect(checks[0]).toMatchObject({ key: 'gstin', level: 'block' });
  });
});

describe('GST export — details', () => {
  test('a single unnamed GST component is split half and half', () => {
    const s = b.splitComponents([{ name: 'GST 5%', rate: 5, amount: 11.39 }]);
    expect(s.rate).toBe(5);
    expect(s.cgst + s.sgst).toBe(1139);
    expect(Math.abs(s.cgst - s.sgst)).toBeLessThanOrEqual(1);
  });

  test('dates are written the way the offline tool reads them', () => {
    expect(b.portalDate('2026-08-07')).toBe('07-Aug-2026');
    expect(b.portalDate(new Date(2026, 11, 31))).toBe('31-Dec-2026');
  });

  test('document series report gaps', () => {
    const series = b.docSeries([{ number: 'INV-0009' }, { number: 'INV-0012' }, { number: 'INV-0010' }]);
    expect(series).toMatchObject({ from: 'INV-0009', to: 'INV-0012', total: 3, gaps: 1 });
  });

  test('the register carries every line, signed for credit notes', () => {
    const { model, acc } = analyse();
    const register = rows(b.sheetRegister(model, acc.pos));
    const note = register.find((r) => r[0] === 'CN-0001');
    expect(note[2]).toBe('Credit Note');
    expect(note[16]).toBe('-227.62');
  });
});

describe('zip writer', () => {
  test('crc32 matches the reference value', () => {
    expect(zip.crc32(Buffer.from('hello'))).toBe(0x3610a686);
  });

  test('writes a readable archive with every entry in the central directory', () => {
    const buf = zip.build([{ name: 'a.csv', data: 'x,y\r\n1,2\r\n' }, { name: 'README.txt', data: 'hi' }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const end = buf.length - 22;
    expect(buf.readUInt32LE(end)).toBe(0x06054b50);
    expect(buf.readUInt16LE(end + 10)).toBe(2);
    const cdOffset = buf.readUInt32LE(end + 16);
    expect(buf.readUInt32LE(cdOffset)).toBe(0x02014b50);
  });

  test('refuses duplicate entry names', () => {
    expect(() => zip.build([{ name: 'a', data: '' }, { name: 'a', data: '' }])).toThrow(/unique/);
  });
});
