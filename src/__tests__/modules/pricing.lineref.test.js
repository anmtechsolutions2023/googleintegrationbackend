// A cart line's correlation key has to fit the ids it is built from.
//
// The till builds it as [menuRowId, ...variantIds, ...addonIds].join('|'). The
// quote capped it at a flat 100 characters, which ONE dish with TWO add-ons
// already exceeds (3 × 36 + 2 = 110). The quote came back 400, the till fell
// back to an untaxed total, and the cashier read "Tax could not be calculated"
// on an ordinary order. The offer preview carried its own flat 120 on the same
// key and would have failed at three.

const {
  quoteSchema, lineRef, LINE_REF_MAX, MAX_VARIANTS_PER_LINE, MAX_ADDONS_PER_LINE,
} = require('../../modules/pricing/pricing.schemas');
const { previewSchema } = require('../../modules/posoffer/offer.schemas');

const ID = 'f4c33126-6f1a-4d62-ba43-026387df4acf';
const keyOf = (idCount) => Array.from({ length: idCount }, () => ID).join('|');

const quote = (ref) => quoteSchema.validate({ lines: [{ costInfoId: ID, quantity: 1, ref }] }).error;
const preview = (ref) => previewSchema.validate({
  branchId: null, posCustomerId: null, lines: [{ ref, unitAmount: 1, quantity: 1 }],
}).error;

describe('the quote accepts the key the till actually builds', () => {
  it('a dish with two add-ons — the case that broke', () => {
    expect(keyOf(3)).toHaveLength(110);
    expect(quote(keyOf(3))).toBeUndefined();
  });

  it('a dish with several add-ons and variants', () => {
    expect(quote(keyOf(12))).toBeUndefined();
  });

  // The cap is derived from the line's own selection limits, so the largest
  // selection the schema permits must always produce an acceptable key.
  it('the largest selection the line schema itself permits', () => {
    const ids = 1 + MAX_VARIANTS_PER_LINE + MAX_ADDONS_PER_LINE;
    expect(quote(keyOf(ids))).toBeUndefined();
  });
});

describe('the offer preview receives the same key under the same cap', () => {
  it('a dish with three add-ons, which the old flat 120 refused', () => {
    expect(keyOf(4).length).toBeGreaterThan(120);
    expect(preview(keyOf(4))).toBeUndefined();
  });

  it('agrees with the quote at every size', () => {
    [1, 3, 4, 20, 71].forEach((n) => {
      expect(Boolean(preview(keyOf(n)))).toBe(Boolean(quote(keyOf(n))));
    });
  });
});

describe('it is still a cap', () => {
  it('refuses a key longer than any real selection could make', () => {
    const tooLong = 'x'.repeat(LINE_REF_MAX + 1);
    expect(quote(tooLong)).toBeDefined();
    expect(preview(tooLong)).toBeDefined();
  });

  it('is exported as one rule, so a third endpoint cannot pick its own number', () => {
    expect(lineRef.validate('a').error).toBeUndefined();
  });
});

describe('a line split off by its kitchen note', () => {
  // The same dish with the same options but a different note is its own cart
  // line, keyed with a short suffix. The cap reserves a segment for it.
  it('still fits when the largest selection carries the suffix', () => {
    const ids = 1 + MAX_VARIANTS_PER_LINE + MAX_ADDONS_PER_LINE;
    const key = `${keyOf(ids)}|n20`;
    expect(key.length).toBeLessThanOrEqual(LINE_REF_MAX);
    expect(quote(key)).toBeUndefined();
    expect(preview(key)).toBeUndefined();
  });
});

