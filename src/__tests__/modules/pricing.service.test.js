// src/__tests__/modules/pricing.service.test.js
// Service-level tests. The chain repository is mocked so these focus on how the
// service composes the pure calculator — batching, document discounts, and the
// per-line/per-document policy. The maths itself is covered in taxCalculator.test.js.

jest.mock('../../modules/pricing/pricing.repository', () => ({
  getChainForCostInfos: jest.fn(),
  getTaxGroupComponents: jest.fn(),
}));
jest.mock('../../modules/positemmeta/positemmeta.repository', () => ({
  getVariantPricesByIds: jest.fn(async () => new Map()),
  getCostInfoIdsByItemMetaIds: jest.fn(async () => new Map()),
}));

const service = require('../../modules/pricing/pricing.service');
const repository = require('../../modules/pricing/pricing.repository');
const itemMetaRepository = require('../../modules/positemmeta/positemmeta.repository');

const TENANT = 'tenant-1';
const CI_100 = 'ci-100';
const CI_50 = 'ci-50';
const CI_INCL = 'ci-incl';
const CI_EXEMPT = 'ci-exempt';

const GST18 = [
  { id: 'c1', name: 'CGST', rate: '9' },
  { id: 's1', name: 'SGST', rate: '9' },
];

const chain = (entries) => new Map(entries.map((e) => [e.costInfoId, e]));

const DEFAULT_CHAIN = () =>
  chain([
    { costInfoId: CI_100, amount: '100', isTaxIncluded: false, taxGroupId: 'tg1', taxGroupName: 'GST18', components: GST18 },
    { costInfoId: CI_50, amount: '50', isTaxIncluded: false, taxGroupId: 'tg1', taxGroupName: 'GST18', components: GST18 },
    { costInfoId: CI_INCL, amount: '100', isTaxIncluded: true, taxGroupId: 'tg1', taxGroupName: 'GST18', components: GST18 },
    { costInfoId: CI_EXEMPT, amount: '100', isTaxIncluded: false, taxGroupId: 'tg2', taxGroupName: 'Exempt', components: [] },
  ]);

const VAR_LARGE = 'var-large';
const VAR_CHEESE = 'var-cheese';
const VARIANTS = () =>
  new Map([
    [VAR_LARGE, { id: VAR_LARGE, name: 'Large', code: 'LG', price: 30 }],
    [VAR_CHEESE, { id: VAR_CHEESE, name: 'Extra Cheese', code: 'EC', price: 20 }],
  ]);

beforeEach(() => {
  repository.getChainForCostInfos.mockResolvedValue(DEFAULT_CHAIN());
  itemMetaRepository.getVariantPricesByIds.mockResolvedValue(VARIANTS());
});

afterEach(() => jest.clearAllMocks());

describe('priceCostInfos', () => {
  it('prices a single costinfo', async () => {
    const result = await service.priceCostInfos([CI_100], TENANT);
    const b = result.get(CI_100);
    expect(b.netAmount).toBe(100);
    expect(b.taxAmount).toBe(18);
    expect(b.grossAmount).toBe(118);
    expect(b.taxGroupName).toBe('GST18');
    expect(b.found).toBe(true);
  });

  it('resolves the whole batch in ONE repository call', async () => {
    await service.priceCostInfos([CI_100, CI_50, CI_INCL], TENANT);
    expect(repository.getChainForCostInfos).toHaveBeenCalledTimes(1);
  });

  it('handles a tax-inclusive price', async () => {
    const b = (await service.priceCostInfos([CI_INCL], TENANT)).get(CI_INCL);
    expect(b.grossAmount).toBe(100);
    expect(b.netAmount).toBe(84.75);
    expect(b.taxAmount).toBe(15.25);
    expect(b.components.map((c) => c.amount)).toEqual([7.63, 7.62]);
  });

  it('treats an empty tax group as exempt', async () => {
    const b = (await service.priceCostInfos([CI_EXEMPT], TENANT)).get(CI_EXEMPT);
    expect(b.taxAmount).toBe(0);
    expect(b.grossAmount).toBe(100);
  });

  it('returns a zeroed breakdown for an unresolvable costinfo', async () => {
    const b = (await service.priceCostInfos(['nope'], TENANT)).get('nope');
    expect(b.found).toBe(false);
    expect(b.grossAmount).toBe(0);
  });

  it('does not hit the database for an empty id list', async () => {
    repository.getChainForCostInfos.mockResolvedValue(new Map());
    const result = await service.priceCostInfos([], TENANT);
    expect(result.size).toBe(0);
  });
});

describe('priceLines — quantities and totals', () => {
  it('prices each line and totals the document', async () => {
    const { lines, totals } = await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 2 },
        { costInfoId: CI_50, quantity: 1 },
      ],
      TENANT,
    );

    expect(lines[0].netAmount).toBe(200);
    expect(lines[0].taxAmount).toBe(36);
    expect(lines[1].netAmount).toBe(50);
    expect(lines[1].taxAmount).toBe(9);

    expect(totals.netAmount).toBe(250);
    expect(totals.taxAmount).toBe(45);
    expect(totals.grossAmount).toBe(295);
  });

  it('returns a per-component footer for the invoice', async () => {
    const { totals } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 2 }],
      TENANT,
    );
    const names = totals.taxByComponent.map((c) => c.name).sort();
    expect(names).toEqual(['CGST', 'SGST']);
    const sum = totals.taxByComponent.reduce((s, c) => s + c.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(totals.taxAmount);
  });

  it('echoes caller passthrough fields', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1, ref: 'cart-line-7' }],
      TENANT,
    );
    expect(lines[0].ref).toBe('cart-line-7');
  });

  it('handles an empty document without touching the database', async () => {
    const { lines, totals } = await service.priceLines([], TENANT);
    expect(lines).toEqual([]);
    expect(totals.grossAmount).toBe(0);
    expect(repository.getChainForCostInfos).not.toHaveBeenCalled();
  });

  it('batches a multi-line document into ONE query', async () => {
    await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 1 },
        { costInfoId: CI_50, quantity: 1 },
        { costInfoId: CI_INCL, quantity: 1 },
      ],
      TENANT,
    );
    expect(repository.getChainForCostInfos).toHaveBeenCalledTimes(1);
  });
});

describe('priceLines — discounts apply before tax', () => {
  it('applies a line discount before tax', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1, discount: { type: 'percent', value: 10 } }],
      TENANT,
    );
    expect(lines[0].discountAmount).toBe(10);
    expect(lines[0].netAmount).toBe(90);
    expect(lines[0].taxAmount).toBe(16.2);
  });

  it('spreads a document discount across lines by value', async () => {
    // 30 off a 150 document → 20 off the 100 line, 10 off the 50 line.
    const { lines, totals } = await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 1 },
        { costInfoId: CI_50, quantity: 1 },
      ],
      TENANT,
      { discount: { type: 'amount', value: 30 } },
    );

    expect(lines[0].discountAmount).toBe(20);
    expect(lines[1].discountAmount).toBe(10);
    expect(totals.discountAmount).toBe(30);
    // Tax is charged on 120, not 150.
    expect(totals.netAmount).toBe(120);
    expect(totals.taxAmount).toBe(21.6);
  });

  it('apportioned discounts always sum back to the document discount', async () => {
    // 10 across 100 + 50 does not divide evenly — largest remainder must absorb it.
    const { lines, totals } = await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 1 },
        { costInfoId: CI_50, quantity: 1 },
      ],
      TENANT,
      { discount: { type: 'amount', value: 10 } },
    );
    const sum = lines.reduce((s, l) => s + l.discountAmount, 0);
    expect(Number(sum.toFixed(2))).toBe(10);
    expect(totals.discountAmount).toBe(10);
  });

  it('supports a percentage document discount', async () => {
    const { totals } = await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 1 },
        { costInfoId: CI_50, quantity: 1 },
      ],
      TENANT,
      { discount: { type: 'percent', value: 10 } },
    );
    expect(totals.discountAmount).toBe(15); // 10% of 150
    expect(totals.netAmount).toBe(135);
  });

  it('combines a line discount and a document discount', async () => {
    const { lines } = await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 1, discount: { type: 'amount', value: 20 } },
        { costInfoId: CI_50, quantity: 1 },
      ],
      TENANT,
      { discount: { type: 'amount', value: 26 } },
    );
    // Line 1 is worth 80 after its own discount, line 2 is worth 50 → 130 total.
    // The 26 document discount splits 16/10 by weight.
    expect(lines[0].discountAmount).toBe(36); // 20 own + 16 share
    expect(lines[1].discountAmount).toBe(10);
  });

  it('caps a document discount at the document value', async () => {
    const { totals } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1 }],
      TENANT,
      { discount: { type: 'amount', value: 5000 } },
    );
    expect(totals.discountAmount).toBe(100);
    expect(totals.netAmount).toBe(0);
    expect(totals.taxAmount).toBe(0);
  });

  it('discounts a tax-inclusive line off the gross, then re-derives net', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_INCL, quantity: 1, discount: { type: 'amount', value: 18 } }],
      TENANT,
    );
    expect(lines[0].grossAmount).toBe(82);
    expect(Number((lines[0].netAmount + lines[0].taxAmount).toFixed(2))).toBe(82);
  });
});

describe('priceLines — variants are a surcharge, not a taxed line', () => {
  it('adds the variant price to the unit price before tax', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE] }],
      TENANT,
    );
    expect(lines[0].baseAmount).toBe(100);
    expect(lines[0].addOnAmount).toBe(30);
    expect(lines[0].unitAmount).toBe(130);
    // Taxed once on 130 at the item's rate — no separate variant tax.
    expect(lines[0].taxAmount).toBe(23.4);
    expect(lines[0].grossAmount).toBe(153.4);
  });

  it('sums several variants', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE, VAR_CHEESE] }],
      TENANT,
    );
    expect(lines[0].addOnAmount).toBe(50);
    expect(lines[0].unitAmount).toBe(150);
    expect(lines[0].taxAmount).toBe(27);
  });

  it('multiplies the surcharge by quantity', async () => {
    const { lines, totals } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 3, variantIds: [VAR_LARGE] }],
      TENANT,
    );
    expect(lines[0].lineAmount).toBe(390);
    expect(totals.netAmount).toBe(390);
    expect(totals.taxAmount).toBe(70.2);
  });

  it('returns the resolved variants for display', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE] }],
      TENANT,
    );
    expect(lines[0].variants).toEqual([
      { id: VAR_LARGE, name: 'Large', code: 'LG', price: 30 },
    ]);
  });

  it('takes prices from the master, ignoring anything the client claims', async () => {
    const { lines } = await service.priceLines(
      // A client trying to make "Large" free.
      [{ costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE], variantPrice: 0 }],
      TENANT,
    );
    expect(lines[0].addOnAmount).toBe(30);
  });

  it('silently drops unknown or inactive variant ids', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE, 'retired'] }],
      TENANT,
    );
    expect(lines[0].addOnAmount).toBe(30);
    expect(lines[0].variants).toHaveLength(1);
  });

  it('folds the surcharge into an inclusive price', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_INCL, quantity: 1, variantIds: [VAR_CHEESE] }],
      TENANT,
    );
    // Menu price 100 incl. + 20 → 120 gross, tax peeled back out of that.
    expect(lines[0].grossAmount).toBe(120);
    expect(Number((lines[0].netAmount + lines[0].taxAmount).toFixed(2))).toBe(120);
  });

  it('resolves all variants across the cart in ONE lookup', async () => {
    await service.priceLines(
      [
        { costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE] },
        { costInfoId: CI_50, quantity: 1, variantIds: [VAR_CHEESE] },
      ],
      TENANT,
    );
    expect(itemMetaRepository.getVariantPricesByIds).toHaveBeenCalledTimes(1);
  });

  it('leaves a line without variants unchanged', async () => {
    const { lines } = await service.priceLines(
      [{ costInfoId: CI_100, quantity: 1 }],
      TENANT,
    );
    expect(lines[0].addOnAmount).toBe(0);
    expect(lines[0].variants).toEqual([]);
    expect(lines[0].taxAmount).toBe(18);
  });

  it('discounts the variant-inclusive amount', async () => {
    const { lines } = await service.priceLines(
      [{
        costInfoId: CI_100, quantity: 1, variantIds: [VAR_LARGE],
        discount: { type: 'amount', value: 30 },
      }],
      TENANT,
    );
    expect(lines[0].netAmount).toBe(100); // 130 − 30
    expect(lines[0].taxAmount).toBe(18);
  });
});

describe('priceLines — per-line rounding policy', () => {
  it('document tax equals the sum of the rounded line taxes', async () => {
    repository.getChainForCostInfos.mockResolvedValue(
      chain([
        { costInfoId: 'a', amount: '33.33', isTaxIncluded: false, taxGroupId: 'tg1', taxGroupName: 'GST18', components: GST18 },
      ]),
    );
    const { lines, totals } = await service.priceLines(
      [
        { costInfoId: 'a', quantity: 1 },
        { costInfoId: 'a', quantity: 1 },
        { costInfoId: 'a', quantity: 1 },
      ],
      TENANT,
    );
    const lineSum = lines.reduce((s, l) => s + l.taxAmount, 0);
    expect(Number(lineSum.toFixed(2))).toBe(totals.taxAmount);
  });
});

describe('getTaxGroupRate', () => {
  it('sums the component rates into an effective rate', async () => {
    repository.getTaxGroupComponents.mockResolvedValue({
      taxGroupId: 'tg1',
      taxGroupName: 'GST18',
      components: GST18,
    });
    const rate = await service.getTaxGroupRate('tg1', TENANT);
    expect(rate.effectiveRate).toBe(18);
    expect(rate.components).toHaveLength(2);
  });

  it('reports 0% for a group with no active types', async () => {
    repository.getTaxGroupComponents.mockResolvedValue({
      taxGroupId: 'tg2',
      taxGroupName: 'Exempt',
      components: [],
    });
    expect((await service.getTaxGroupRate('tg2', TENANT)).effectiveRate).toBe(0);
  });

  it('returns null for an unknown group', async () => {
    repository.getTaxGroupComponents.mockResolvedValue(null);
    expect(await service.getTaxGroupRate('nope', TENANT)).toBeNull();
  });
});
