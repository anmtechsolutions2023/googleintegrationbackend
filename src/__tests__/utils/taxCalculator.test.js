// src/__tests__/utils/taxCalculator.test.js
// The rounding rules are the whole reason this module exists, so they get the
// heaviest coverage. No mocks anywhere — taxCalculator is pure by design.

const {
  parseMoney,
  toMinor,
  fromMinor,
  allocate,
  computeTax,
  sumLines,
} = require('../../utils/taxCalculator');

const GST18 = [
  { id: 'c1', name: 'CGST', rate: 9 },
  { id: 's1', name: 'SGST', rate: 9 },
];

describe('parseMoney — master data stores money as VARCHAR', () => {
  it.each([
    ['120', 120],
    ['120.50', 120.5],
    ['  120  ', 120],
    ['1,200.50', 1200.5],
    [120.5, 120.5],
    ['', 0],
    ['abc', 0],
    [null, 0],
    [undefined, 0],
    [NaN, 0],
  ])('parses %p → %p', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });
});

describe('toMinor — exact decimal conversion', () => {
  it.each([
    ['120', 12000],
    ['120.50', 12050],
    ['0.01', 1],
    [0, 0],
    ['-5.25', -525],
  ])('converts %p → %p paise', (input, expected) => {
    expect(toMinor(input)).toBe(expected);
  });

  it('rounds 1.005 UP, which naive float maths gets wrong', () => {
    // Math.round(1.005 * 100) === 100 because 1.005 is stored as 1.00499999…
    expect(toMinor('1.005')).toBe(101);
  });

  it('survives float artefacts from arithmetic', () => {
    expect(toMinor(0.1 + 0.2)).toBe(30); // 0.30000000000000004
  });

  it('round-trips through fromMinor', () => {
    expect(fromMinor(toMinor('99.99'))).toBe(99.99);
  });
});

describe('allocate — largest remainder', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(allocate(1800, [900, 900])).toEqual([900, 900]);
  });

  it('gives the odd unit to the largest remainder', () => {
    // 1525 paise across two equal weights → 762.5 each; one side gets the extra.
    expect(allocate(1525, [900, 900])).toEqual([763, 762]);
  });

  it('always sums back to the total', () => {
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('is deterministic for identical weights (ties break on index)', () => {
    expect(allocate(1525, [900, 900])).toEqual(allocate(1525, [900, 900]));
  });

  it('returns zeros when there are no weights to divide by', () => {
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
  });

  it('handles an empty component list', () => {
    expect(allocate(500, [])).toEqual([]);
  });

  it('weights unequal rates proportionally', () => {
    // 12% split as 5% + 7% over 100 paise of tax
    expect(allocate(100, [500, 700])).toEqual([42, 58]);
  });

  // Property test: the invariant that makes invoices foot.
  it('sums exactly to the total for 500 random cases', () => {
    for (let i = 0; i < 500; i += 1) {
      const total = Math.floor(Math.random() * 100000);
      const n = 1 + Math.floor(Math.random() * 4);
      const weights = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 2000));
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
});

describe('computeTax — exclusive prices', () => {
  it('adds tax on top', () => {
    const r = computeTax({ amount: '100', isTaxIncluded: false, components: GST18 });
    expect(r.netAmount).toBe(100);
    expect(r.taxAmount).toBe(18);
    expect(r.grossAmount).toBe(118);
    expect(r.effectiveRate).toBe(18);
  });

  it('splits components evenly when they divide cleanly', () => {
    const r = computeTax({ amount: '100', components: GST18 });
    expect(r.components.map((c) => c.amount)).toEqual([9, 9]);
  });

  it('net + tax always equals gross', () => {
    const r = computeTax({ amount: '99.99', components: GST18 });
    expect(r.netAmount + r.taxAmount).toBeCloseTo(r.grossAmount, 2);
  });
});

describe('computeTax — inclusive prices', () => {
  // The case from the design doc: naive rounding reports 15.26 against a 15.25 total.
  it('peels tax back out of a tax-inclusive amount', () => {
    const r = computeTax({ amount: '100', isTaxIncluded: true, components: GST18 });
    expect(r.grossAmount).toBe(100);
    expect(r.netAmount).toBe(84.75);
    expect(r.taxAmount).toBe(15.25);
  });

  it('allocates the components so they sum to the tax exactly', () => {
    const r = computeTax({ amount: '100', isTaxIncluded: true, components: GST18 });
    expect(r.components.map((c) => c.amount)).toEqual([7.63, 7.62]);
    const sum = r.components.reduce((s, c) => s + c.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(r.taxAmount);
  });

  it('never rounds net and tax independently', () => {
    const r = computeTax({ amount: '100', isTaxIncluded: true, components: GST18 });
    expect(Number((r.netAmount + r.taxAmount).toFixed(2))).toBe(r.grossAmount);
  });
});

describe('computeTax — zero and exempt groups', () => {
  it('treats an empty component list as exempt, not an error', () => {
    const r = computeTax({ amount: '100', components: [] });
    expect(r.taxAmount).toBe(0);
    expect(r.netAmount).toBe(100);
    expect(r.grossAmount).toBe(100);
    expect(r.effectiveRate).toBe(0);
  });

  it('treats an all-zero-rate group as exempt', () => {
    const r = computeTax({ amount: '100', components: [{ name: 'NIL', rate: 0 }] });
    expect(r.taxAmount).toBe(0);
    expect(r.components[0].amount).toBe(0);
  });

  it('handles a zero amount', () => {
    const r = computeTax({ amount: '0', components: GST18 });
    expect(r.taxAmount).toBe(0);
    expect(r.grossAmount).toBe(0);
  });
});

describe('computeTax — quantity', () => {
  it('taxes the whole line, not each unit', () => {
    const r = computeTax({ amount: '100', quantity: 3, components: GST18 });
    expect(r.lineAmount).toBe(300);
    expect(r.taxAmount).toBe(54);
    expect(r.grossAmount).toBe(354);
  });

  it('supports fractional quantities', () => {
    const r = computeTax({ amount: '100', quantity: 2.5, components: GST18 });
    expect(r.lineAmount).toBe(250);
    expect(r.taxAmount).toBe(45);
  });

  it('defaults quantity to 1', () => {
    expect(computeTax({ amount: '100', components: GST18 }).quantity).toBe(1);
  });
});

describe('computeTax — discount applies BEFORE tax (settled policy)', () => {
  it('taxes the discounted amount, not the list price', () => {
    const r = computeTax({
      amount: '100',
      components: GST18,
      discount: { type: 'percent', value: 10 },
    });
    expect(r.discountAmount).toBe(10);
    expect(r.netAmount).toBe(90);
    expect(r.taxAmount).toBe(16.2); // 90 × 18%, NOT 18
    expect(r.grossAmount).toBe(106.2);
  });

  it('supports a flat amount discount', () => {
    const r = computeTax({
      amount: '100',
      components: GST18,
      discount: { type: 'amount', value: 25 },
    });
    expect(r.netAmount).toBe(75);
    expect(r.taxAmount).toBe(13.5);
  });

  it('for an inclusive price, discounts the gross then re-derives net', () => {
    const r = computeTax({
      amount: '118',
      isTaxIncluded: true,
      components: GST18,
      discount: { type: 'amount', value: 18 },
    });
    expect(r.grossAmount).toBe(100);
    expect(r.netAmount).toBe(84.75);
    expect(r.taxAmount).toBe(15.25);
  });

  it('a discount can zero a line but never make it negative', () => {
    const r = computeTax({
      amount: '50',
      components: GST18,
      discount: { type: 'amount', value: 500 },
    });
    expect(r.discountAmount).toBe(50);
    expect(r.netAmount).toBe(0);
    expect(r.taxAmount).toBe(0);
    expect(r.grossAmount).toBe(0);
  });

  it('ignores a null/zero discount', () => {
    expect(computeTax({ amount: '100', components: GST18, discount: null }).taxAmount).toBe(18);
    expect(
      computeTax({ amount: '100', components: GST18, discount: { type: 'percent', value: 0 } })
        .taxAmount,
    ).toBe(18);
  });
});

describe('computeTax — add-on (variants) folds into the unit price', () => {
  it('raises the taxed amount rather than being taxed separately', () => {
    // Dosa 100 + cheese 30 → tax is charged on 130, at the ITEM's rate.
    const r = computeTax({ amount: '100', addOn: '30', components: GST18 });
    expect(r.baseAmount).toBe(100);
    expect(r.addOnAmount).toBe(30);
    expect(r.unitAmount).toBe(130);
    expect(r.netAmount).toBe(130);
    expect(r.taxAmount).toBe(23.4); // 130 × 18%, not 18 + a separate 5.40
    expect(r.grossAmount).toBe(153.4);
  });

  it('multiplies with quantity', () => {
    const r = computeTax({ amount: '100', addOn: '30', quantity: 2, components: GST18 });
    expect(r.lineAmount).toBe(260);
    expect(r.taxAmount).toBe(46.8);
  });

  it('inherits the item tax group — no separate rate for the add-on', () => {
    const r = computeTax({ amount: '100', addOn: '50', components: GST18 });
    // One effective rate over the combined amount.
    expect(r.effectiveRate).toBe(18);
    expect(r.components.map((c) => c.amount)).toEqual([13.5, 13.5]);
  });

  it('follows an inclusive price convention', () => {
    // Menu shows 100 incl. tax; a 18 add-on makes the printed price 118.
    const r = computeTax({ amount: '100', addOn: '18', isTaxIncluded: true, components: GST18 });
    expect(r.grossAmount).toBe(118);
    expect(r.netAmount).toBe(100);
    expect(r.taxAmount).toBe(18);
  });

  it('applies a discount after the add-on, still before tax', () => {
    const r = computeTax({
      amount: '100', addOn: '30', components: GST18,
      discount: { type: 'amount', value: 30 },
    });
    expect(r.netAmount).toBe(100); // 130 − 30
    expect(r.taxAmount).toBe(18);
  });

  it('defaults to no add-on', () => {
    expect(computeTax({ amount: '100', components: GST18 }).addOnAmount).toBe(0);
  });

  it('ignores a null/garbage add-on', () => {
    expect(computeTax({ amount: '100', addOn: null, components: GST18 }).unitAmount).toBe(100);
    expect(computeTax({ amount: '100', addOn: 'abc', components: GST18 }).unitAmount).toBe(100);
  });

  it('components still sum exactly with an add-on', () => {
    const r = computeTax({ amount: '33.33', addOn: '11.11', isTaxIncluded: true, components: GST18 });
    const sum = r.components.reduce((s, c) => s + c.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(r.taxAmount);
  });
});

describe('computeTax — component invariant across many inputs', () => {
  it('components always sum to taxAmount', () => {
    const rateSets = [
      [{ name: 'A', rate: 9 }, { name: 'B', rate: 9 }],
      [{ name: 'A', rate: 2.5 }, { name: 'B', rate: 2.5 }, { name: 'C', rate: 2.5 }],
      [{ name: 'A', rate: 5 }, { name: 'B', rate: 7 }],
      [{ name: 'A', rate: 0.5 }],
    ];
    for (let cents = 1; cents <= 400; cents += 1) {
      rateSets.forEach((components) => {
        [true, false].forEach((isTaxIncluded) => {
          const r = computeTax({ amount: (cents / 100).toFixed(2), isTaxIncluded, components });
          const sum = r.components.reduce((s, c) => s + Math.round(c.amount * 100), 0);
          expect(sum).toBe(Math.round(r.taxAmount * 100));
        });
      });
    }
  });
});

describe('sumLines — document totals', () => {
  const line = (amount, qty = 1) =>
    computeTax({ amount, quantity: qty, components: GST18 });

  it('adds line amounts into document totals', () => {
    const totals = sumLines([line('100'), line('50')]);
    expect(totals.netAmount).toBe(150);
    expect(totals.taxAmount).toBe(27);
    expect(totals.grossAmount).toBe(177);
  });

  it('per-line rounding: lines add up to the printed total', () => {
    // 33.33 × 3 lines — the case from the design doc.
    const lines = [line('33.33'), line('33.33'), line('33.34')];
    const totals = sumLines(lines);
    const lineTaxSum = lines.reduce((s, l) => s + l.taxAmount, 0);
    expect(Number(lineTaxSum.toFixed(2))).toBe(totals.taxAmount);
  });

  it('groups components by name for the invoice footer', () => {
    const totals = sumLines([line('100'), line('100')]);
    expect(totals.taxByComponent).toHaveLength(2);
    const cgst = totals.taxByComponent.find((c) => c.name === 'CGST');
    expect(cgst.amount).toBe(18); // 9 + 9 across two lines
  });

  it('footer components sum to the document tax', () => {
    const totals = sumLines([line('99.99'), line('33.33', 2), line('1.01')]);
    const sum = totals.taxByComponent.reduce((s, c) => s + c.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(totals.taxAmount);
  });

  it('handles an empty document', () => {
    const totals = sumLines([]);
    expect(totals.netAmount).toBe(0);
    expect(totals.taxAmount).toBe(0);
    expect(totals.taxByComponent).toEqual([]);
  });
});
