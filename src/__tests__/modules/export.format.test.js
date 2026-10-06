// src/__tests__/modules/export.format.test.js
// How values are written into an export. Each rule here exists because the
// alternative breaks in Excel: a mobile becomes 9.85E+09, a date flips day and
// month, a credit note adds to sales instead of taking away.

const f = require('../../modules/export/export.format');

describe('export.format', () => {
  describe('mobile', () => {
    it('writes an Indian mobile with a space so Excel keeps it as text', () => {
      expect(f.mobile('9845012345', { mask: false })).toBe('98450 12345');
    });

    it('drops a +91 or leading 0, and never writes a leading +', () => {
      expect(f.mobile('+91 98450 12345', { mask: false })).toBe('98450 12345');
      expect(f.mobile('09845012345', { mask: false })).toBe('98450 12345');
    });

    it('masks by default, keeping enough to tell two guests apart', () => {
      expect(f.mobile('9845012345')).toBe('98450 •••45');
    });

    it('masks a number that is not ten digits down to its last two', () => {
      expect(f.mobile('4412345678901')).toBe('•••01');
    });

    it('writes nothing for no number', () => {
      expect(f.mobile(null)).toBe('');
      expect(f.mobile('')).toBe('');
    });
  });

  describe('dates', () => {
    it('reads a DATE column on its UTC calendar day', () => {
      expect(f.date(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
      expect(f.date('2026-10-05')).toBe('2026-10-05');
      expect(f.date(null)).toBe('');
    });

    it('writes a DATETIME as local wall-clock to the minute', () => {
      const d = new Date(2026, 9, 5, 15, 30, 12);
      expect(f.dateTime(d)).toBe('2026-10-05 15:30');
    });

    it('cuts a TIME to hours and minutes', () => {
      expect(f.time('18:00:00')).toBe('18:00');
    });
  });

  describe('numbers', () => {
    it('writes money with two decimals and an optional sign', () => {
      expect(f.amount('840')).toBe('840.00');
      expect(f.amount(210, -1)).toBe('-210.00');
      expect(f.amount(null)).toBe('0.00');
    });

    it('writes quantities without trailing zeros', () => {
      expect(f.qty('2.0000')).toBe('2');
      expect(f.qty('2.5000')).toBe('2.5');
    });

    it('writes a share with one decimal, and 0.0 of nothing', () => {
      expect(f.percent(1532000, 2502800)).toBe('61.2');
      expect(f.percent(5, 0)).toBe('0.0');
    });
  });

  describe('taxSplit', () => {
    it('puts CGST, SGST and IGST in their columns and everything else in Other', () => {
      expect(f.taxSplit([
        { name: 'CGST', amount: 20 }, { name: 'SGST', amount: 20 }, { name: 'Cess', amount: 3 },
      ])).toEqual({ CGST: 20, SGST: 20, IGST: 0, Other: 3 });
    });

    it('accepts the JSON column as text', () => {
      expect(f.taxSplit('[{"name":"IGST","amount":18}]').IGST).toBe(18);
    });

    it('counts UTGST as the state half', () => {
      expect(f.taxSplit([{ name: 'UTGST', amount: 9 }]).SGST).toBe(9);
    });
  });

  describe('choices', () => {
    it('writes variants with their surcharge', () => {
      expect(f.choices([{ name: 'Large', price: 20 }])).toBe('Large (+20)');
    });

    it('writes add-ons with their group', () => {
      expect(f.choices([
        { name: 'Extra cheese', price: 20, groupName: 'Toppings' }, { name: 'Mint', price: 0, groupName: 'Dips' },
      ], { withGroup: true })).toBe('Toppings: Extra cheese (+20); Dips: Mint');
    });
  });

  describe('staffName', () => {
    it('names a member and hides a former one behind their last four digits', () => {
      const names = new Map([['9845012345', { name: 'Kavya Rao' }]]);
      expect(f.staffName(names, '9845012345')).toBe('Kavya Rao');
      expect(f.staffName(names, '9000011111')).toBe('•••• 1111');
      expect(f.staffName(names, null)).toBe('');
    });
  });

  it('slugs a branch name for the file name', () => {
    expect(f.slug('Indiranagar — Main Road')).toBe('indiranagar-main-road');
    expect(f.slug('')).toBe('branch');
  });

  it('labels an hour of the day as a band', () => {
    expect(f.hourBand(20)).toBe('20:00–21:00');
    expect(f.hourBand(23)).toBe('23:00–00:00');
  });
});
