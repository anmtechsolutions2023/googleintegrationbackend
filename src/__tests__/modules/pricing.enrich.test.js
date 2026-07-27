// src/__tests__/modules/pricing.enrich.test.js
// The expand-path enricher: batching, quantity scaling, and the "absent price is
// not an error" rule.

jest.mock('../../modules/pricing/pricing.service', () => ({
  priceCostInfos: jest.fn(),
}));

const { attachBreakdown, attachBreakdownToOne } = require('../../modules/pricing/pricing.enrich');
const pricingService = require('../../modules/pricing/pricing.service');
const { computeTax } = require('../../utils/taxCalculator');

const TENANT = 'tenant-1';
const GST18 = [
  { id: 'c1', name: 'CGST', rate: 9 },
  { id: 's1', name: 'SGST', rate: 9 },
];

const breakdownFor = (amount, isTaxIncluded = false) => ({
  costInfoId: 'ci1',
  found: true,
  taxGroupId: 'tg1',
  taxGroupName: 'GST18',
  ...computeTax({ amount, isTaxIncluded, components: GST18 }),
});

beforeEach(() => {
  pricingService.priceCostInfos.mockResolvedValue(
    new Map([['ci1', breakdownFor('100')]]),
  );
});

afterEach(() => jest.clearAllMocks());

describe('attachBreakdown', () => {
  it('attaches the breakdown resolved from CostInfoId', async () => {
    const [row] = await attachBreakdown([{ Id: 'i1', CostInfoId: 'ci1' }], TENANT);
    expect(row.TaxBreakdown.netAmount).toBe(100);
    expect(row.TaxBreakdown.taxAmount).toBe(18);
    expect(row.TaxBreakdown.grossAmount).toBe(118);
  });

  it('keeps the original row fields intact', async () => {
    const [row] = await attachBreakdown([{ Id: 'i1', Name: 'Dosa', CostInfoId: 'ci1' }], TENANT);
    expect(row.Id).toBe('i1');
    expect(row.Name).toBe('Dosa');
  });

  it('prices a whole page with ONE service call', async () => {
    await attachBreakdown(
      [
        { Id: 'a', CostInfoId: 'ci1' },
        { Id: 'b', CostInfoId: 'ci1' },
        { Id: 'c', CostInfoId: 'ci1' },
      ],
      TENANT,
    );
    expect(pricingService.priceCostInfos).toHaveBeenCalledTimes(1);
  });

  it('supports a custom id field (costinfo prices itself)', async () => {
    pricingService.priceCostInfos.mockResolvedValue(
      new Map([['self-1', { ...breakdownFor('100'), costInfoId: 'self-1' }]]),
    );
    const [row] = await attachBreakdown([{ Id: 'self-1' }], TENANT, { idField: 'Id' });
    expect(row.TaxBreakdown.taxAmount).toBe(18);
    expect(pricingService.priceCostInfos).toHaveBeenCalledWith(['self-1'], TENANT);
  });

  it('sets TaxBreakdown to null when the row has no cost link', async () => {
    // An item with no price yet is normal, not an error.
    const [row] = await attachBreakdown([{ Id: 'i1', CostInfoId: null }], TENANT);
    expect(row.TaxBreakdown).toBeNull();
    expect(row.Id).toBe('i1');
  });

  it('sets TaxBreakdown to null when the costinfo cannot be resolved', async () => {
    pricingService.priceCostInfos.mockResolvedValue(
      new Map([['ci1', { costInfoId: 'ci1', found: false }]]),
    );
    const [row] = await attachBreakdown([{ CostInfoId: 'ci1' }], TENANT);
    expect(row.TaxBreakdown).toBeNull();
  });

  it('skips the query entirely when no row has a cost link', async () => {
    const rows = await attachBreakdown([{ Id: 'a' }, { Id: 'b' }], TENANT);
    expect(rows.every((r) => r.TaxBreakdown === null)).toBe(true);
    expect(pricingService.priceCostInfos).not.toHaveBeenCalled();
  });

  it('handles an empty page', async () => {
    expect(await attachBreakdown([], TENANT)).toEqual([]);
    expect(pricingService.priceCostInfos).not.toHaveBeenCalled();
  });
});

describe('attachBreakdown — quantity scaling (batchdetail)', () => {
  const opts = { idField: 'CostInfoId', quantityField: 'Quantity' };

  it('scales the breakdown to the row quantity', async () => {
    const [row] = await attachBreakdown(
      [{ CostInfoId: 'ci1', Quantity: '3' }],
      TENANT,
      opts,
    );
    expect(row.TaxBreakdown.lineAmount).toBe(300);
    expect(row.TaxBreakdown.taxAmount).toBe(54);
    expect(row.TaxBreakdown.grossAmount).toBe(354);
  });

  it('leaves a quantity of 1 at the unit breakdown', async () => {
    const [row] = await attachBreakdown([{ CostInfoId: 'ci1', Quantity: 1 }], TENANT, opts);
    expect(row.TaxBreakdown.taxAmount).toBe(18);
  });

  it.each([[null], [undefined], ['']])(
    'treats an absent quantity (%p) as unrecorded, not as zero',
    async (quantity) => {
      // Number(null) === 0, so without an explicit absence check this would
      // silently price the batch at nothing.
      const [row] = await attachBreakdown([{ CostInfoId: 'ci1', Quantity: quantity }], TENANT, opts);
      expect(row.TaxBreakdown.taxAmount).toBe(18);
    },
  );

  it('falls back to the unit breakdown for a non-numeric quantity', async () => {
    const [row] = await attachBreakdown([{ CostInfoId: 'ci1', Quantity: 'abc' }], TENANT, opts);
    expect(row.TaxBreakdown.taxAmount).toBe(18);
  });

  it('honours a recorded quantity of 0 — that line is genuinely worth nothing', async () => {
    const [row] = await attachBreakdown([{ CostInfoId: 'ci1', Quantity: 0 }], TENANT, opts);
    expect(row.TaxBreakdown.lineAmount).toBe(0);
    expect(row.TaxBreakdown.taxAmount).toBe(0);
  });

  it('components still sum exactly after scaling', async () => {
    pricingService.priceCostInfos.mockResolvedValue(
      new Map([['ci1', breakdownFor('33.33')]]),
    );
    const [row] = await attachBreakdown(
      [{ CostInfoId: 'ci1', Quantity: 7 }],
      TENANT,
      opts,
    );
    const sum = row.TaxBreakdown.components.reduce((s, c) => s + c.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(row.TaxBreakdown.taxAmount);
  });
});

describe('attachBreakdownToOne', () => {
  it('enriches a single row', async () => {
    const row = await attachBreakdownToOne({ Id: 'i1', CostInfoId: 'ci1' }, TENANT);
    expect(row.TaxBreakdown.grossAmount).toBe(118);
  });

  it('passes null/undefined through untouched', async () => {
    expect(await attachBreakdownToOne(null, TENANT)).toBeNull();
    expect(await attachBreakdownToOne(undefined, TENANT)).toBeUndefined();
  });
});
