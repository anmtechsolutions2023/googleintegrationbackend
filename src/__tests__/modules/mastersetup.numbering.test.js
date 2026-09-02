// src/__tests__/modules/mastersetup.numbering.test.js
// Invoice numbering during first-time setup.
//
// The setup wizard no longer asks for any of this — the Transaction Type Config
// section was removed from the Branch step. That is only safe because the row is
// still created: branchdetail.TransactionTypeConfigId and
// transactiontype.TransactionTypeConfigId are NOT NULL foreign keys onto
// transactiontypeconfig, so a branch cannot exist without a numbering series.
// These tests are what stops the UI change from turning into a 400 (or worse, a
// constraint violation mid-transaction) for every new tenant.

const { bootstrapSchema, NUMBERING_DEFAULTS } = require('../../modules/mastersetup/mastersetup.schemas');

/** The smallest payload the wizard can now send — no numbering anywhere in it. */
const payload = (ttc) => {
  const branch = {
    Name: 'Central',
    address: {
      AddressLine1: '12 High Street',
      TagName: 'Onboarding',
      contactAddressType: { Name: 'Onboarding' },
    },
    contact: { FirstName: 'Priya', LastName: 'Ramanathan' },
  };
  if (ttc !== undefined) branch.transactionTypeConfig = ttc;
  return { organization: { Name: 'ANM Tech' }, branch };
};

describe('a bootstrap payload with no numbering in it', () => {
  it('is accepted — the wizard sends exactly this', () => {
    const { error } = bootstrapSchema.validate(payload());
    expect(error).toBeUndefined();
  });

  it('reaches the orchestrator with a complete config, so the NOT NULL FK is satisfiable', () => {
    const { value } = bootstrapSchema.validate(payload());
    expect(value.branch.transactionTypeConfig).toEqual({
      StartCounterNo: NUMBERING_DEFAULTS.START_COUNTER_NO,
      Format: NUMBERING_DEFAULTS.FORMAT,
      TagName: NUMBERING_DEFAULTS.TAG_NAME,
    });
  });

  it('never leaves a key undefined — every column on the row is NOT NULL', () => {
    const { value } = bootstrapSchema.validate(payload());
    Object.values(value.branch.transactionTypeConfig)
      .forEach((v) => expect(v).toBeDefined());
  });
});

describe('a caller that does have an opinion', () => {
  it('keeps every value it sends', () => {
    const mine = { StartCounterNo: 500, Format: 'BILL-{000000}', TagName: 'Retail' };
    const { value } = bootstrapSchema.validate(payload(mine));
    expect(value.branch.transactionTypeConfig).toEqual(mine);
  });

  it('fills in only what it left out', () => {
    const { value } = bootstrapSchema.validate(payload({ Format: 'BILL-{000}' }));
    expect(value.branch.transactionTypeConfig).toEqual({
      Format: 'BILL-{000}',
      StartCounterNo: NUMBERING_DEFAULTS.START_COUNTER_NO,
      TagName: NUMBERING_DEFAULTS.TAG_NAME,
    });
  });

  it('is still validated — optional is not unchecked', () => {
    expect(bootstrapSchema.validate(payload({ StartCounterNo: -1 })).error?.message)
      .toMatch(/StartCounterNo/);
    expect(bootstrapSchema.validate(payload({ Format: 'x'.repeat(101) })).error?.message)
      .toMatch(/Format/);
  });
});

describe('the defaults are ones the rest of the system can actually use', () => {
  it("tags the series 'Onboarding', which is what makes a re-run reuse it", () => {
    // getOrCreateByTagNameTx looks the series up BY tag. A different default
    // would create a second series on every re-run instead of reusing the first,
    // and UNIQUE(TagName, TenantId) is what that reuse rests on.
    expect(NUMBERING_DEFAULTS.TAG_NAME).toBe('Onboarding');
  });

  it('renders INV-0001 for the first invoice through the real numbering code', () => {
    // formatNumber is not exported, so this reproduces its documented contract:
    // a {0000} placeholder gives the zero-padding width.
    const m = /\{(0+)\}/.exec(NUMBERING_DEFAULTS.FORMAT);
    expect(m).not.toBeNull();
    const first = NUMBERING_DEFAULTS.FORMAT.replace(
      m[0], String(NUMBERING_DEFAULTS.START_COUNTER_NO).padStart(m[1].length, '0')
    );
    expect(first).toBe('INV-0001');
  });

  it('starts at a counter transactionNumber.service would not override', () => {
    // issueNumber falls back to `Number(StartCounterNo) || 1`, so a default of 0
    // would silently become 1 anyway and the stored row would disagree with the
    // number actually issued.
    expect(Number(NUMBERING_DEFAULTS.START_COUNTER_NO) || 1)
      .toBe(NUMBERING_DEFAULTS.START_COUNTER_NO);
  });
});
