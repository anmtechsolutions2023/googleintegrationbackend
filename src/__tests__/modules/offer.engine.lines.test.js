// The seam between the two callers of the offer engine.
//
// posbill.repository.getOrderLinesTx builds cart lines with `id`; the till's
// /preview endpoint takes `itemId` (offer.schemas.previewSchema). Both reach
// the same evaluator through toEvaluatorLines, so it has to answer to both
// spellings — reading only one meant every ITEM_QTY trigger counted zero
// qualifying items on that path, and the cashier was told "not enough items"
// while looking at a cart full of them.

const { toEvaluatorLines } = require('../../modules/posoffer/offer.engine.service');

const BASE = { ref: 'o1#0', name: 'Plain Tea', unitAmount: 15, quantity: 3 };

describe('toEvaluatorLines — item id, either spelling', () => {
  test('reads itemId, as the /preview endpoint sends it', () => {
    const [l] = toEvaluatorLines([{ ...BASE, itemId: 'tea' }]);
    expect(l.itemId).toBe('tea');
  });

  test('reads id, as getOrderLinesTx builds it', () => {
    const [l] = toEvaluatorLines([{ ...BASE, id: 'tea' }]);
    expect(l.itemId).toBe('tea');
  });

  test('prefers itemId when a line somehow carries both', () => {
    const [l] = toEvaluatorLines([{ ...BASE, itemId: 'tea', id: 'something-else' }]);
    expect(l.itemId).toBe('tea');
  });

  test('null rather than undefined when a line names no item', () => {
    const [l] = toEvaluatorLines([BASE]);
    expect(l.itemId).toBeNull();
  });

  test('carries the rest of the shape the evaluator reads', () => {
    const [l] = toEvaluatorLines([{
      ...BASE, itemId: 'tea', categoryId: 'cat-bev', discount: { type: 'percent', value: 10 },
    }]);
    expect(l).toEqual({
      ref: 'o1#0',
      itemId: 'tea',
      categoryId: 'cat-bev',
      name: 'Plain Tea',
      unitAmount: 15,
      quantity: 3,
      hasManualDiscount: true,
    });
  });

  test('an empty or missing list is an empty list, not a throw', () => {
    expect(toEvaluatorLines([])).toEqual([]);
    expect(toEvaluatorLines(null)).toEqual([]);
    expect(toEvaluatorLines(undefined)).toEqual([]);
  });
});
