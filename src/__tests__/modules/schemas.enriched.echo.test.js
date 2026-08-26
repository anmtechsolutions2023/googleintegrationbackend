// src/__tests__/modules/schemas.enriched.echo.test.js
// The round trip: what a read adds, a write must tolerate.
//
// `TaxBreakdown` is computed by pricing.enrich on every read of an enriched
// module. An edit form is seeded from that GET response, so the field comes
// straight back on the next PUT — and a write schema that has never heard of it
// rejects the whole update with 400 "TaxBreakdown is not allowed", which is
// what happened on the menu screen. Accept it, drop it, re-derive it on read.

const positemmeta = require('../../modules/positemmeta/positemmeta.schemas');
const itemdetail  = require('../../modules/itemdetail/itemdetail.schemas');
const costinfo    = require('../../modules/costinfo/costinfo.schemas');
const batchdetail = require('../../modules/batchdetail/batchdetail.schemas');

// Shape as the enricher actually emits it — a nested object with a components
// array, not a scalar. A schema that only tolerated a primitive would still 400.
const TAX_BREAKDOWN = {
  costInfoId: '144960a9-c318-4c63-aae5-df33cb8aa2df',
  found: true,
  taxGroupId: '481afefc-4fba-42ea-aa53-273efc49af6f',
  taxGroupName: 'GST 5%',
  quantity: 1,
  unitAmount: 80,
  netAmount: 76.19,
  taxAmount: 3.81,
  grossAmount: 80,
  effectiveRate: 5,
  isTaxIncluded: true,
  components: [
    { id: '103e168b-7827-42b3-a242-001d9e0509d3', name: 'SGST', rate: 2.5, amount: 1.91 },
    { id: 'd5846555-f79d-4a82-9935-862b46ecd4cd', name: 'CGST', rate: 2.5, amount: 1.9 },
  ],
};

const MINIMAL = {
  positemmeta: {
    ItemDetailId: '498a019f-ab53-4f3f-bfc4-6e8f27f0f8a8',
    FoodTypeId: 'a5f3462e-67b8-4bab-9327-b87173888f2a',
    BranchDetailId: '6bcb3b22-af40-4540-b222-5161f3dba1b7',
  },
  itemdetail:  { Name: 'Mango Lassi' },
  costinfo:    { Amount: 80 },
  batchdetail: { BatchNo: 'B-1' },
};

const SCHEMAS = { positemmeta, itemdetail, costinfo, batchdetail };

describe.each(Object.keys(SCHEMAS))('%s write schemas', (name) => {
  const { createSchema, updateSchema } = SCHEMAS[name];

  it.each([['create', () => createSchema], ['update', () => updateSchema]])(
    'accepts an echoed TaxBreakdown on %s',
    (_op, schema) => {
      const { error } = schema().validate({ ...MINIMAL[name], TaxBreakdown: TAX_BREAKDOWN });
      expect(error).toBeUndefined();
    },
  );

  // Accepting it is only half the fix: it must not reach the service, or a
  // computed value would be handed to an INSERT/UPDATE that has no column for it.
  it.each([['create', () => createSchema], ['update', () => updateSchema]])(
    'strips it from the validated %s payload',
    (_op, schema) => {
      const { value } = schema().validate({ ...MINIMAL[name], TaxBreakdown: TAX_BREAKDOWN });
      expect(value).not.toHaveProperty('TaxBreakdown');
    },
  );

  // The echo is tolerated; genuinely unknown keys are still rejected.
  it('still rejects a key it does not know', () => {
    const { error } = updateSchema.validate({ ...MINIMAL[name], NotAField: 1 });
    expect(error).toBeDefined();
  });
});

// The exact PUT body the menu edit screen sent, which returned
// 400 "TaxBreakdown is not allowed".
it('accepts the menu edit payload that used to 400', () => {
  const { error, value } = positemmeta.updateSchema.validate({
    ItemDetailId: '498a019f-ab53-4f3f-bfc4-6e8f27f0f8a8',
    FoodTypeId: 'a5f3462e-67b8-4bab-9327-b87173888f2a',
    Channels: null,
    Prices: null,
    Variants: null,
    BranchDetailId: '6bcb3b22-af40-4540-b222-5161f3dba1b7',
    Active: true,
    ChannelIds: [],
    VariantIds: [],
    TaxBreakdown: TAX_BREAKDOWN,
  });
  expect(error).toBeUndefined();
  expect(value).not.toHaveProperty('TaxBreakdown');
  expect(value.BranchDetailId).toBe('6bcb3b22-af40-4540-b222-5161f3dba1b7');
});
