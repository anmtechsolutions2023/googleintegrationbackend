// Options and add-ons on paper: a setting on the bill, a visibility on the ticket.

const {
  DOC, VISIBILITY, fieldDef, allowedValues, defaultsOf,
} = require('../../modules/posreceipt/receipt.catalogue');

describe('the bill', () => {
  it('itemises options and add-ons by default, with names-only and hidden as choices', () => {
    const field = fieldDef(DOC.BILL, 'itemOptions');
    expect(field).toBeDefined();
    expect(allowedValues(field)).toEqual(['itemised', 'names', 'hidden']);
    expect(defaultsOf(DOC.BILL).itemOptions).toBe('itemised');
  });

  it('sits with the other item fields', () => {
    expect(fieldDef(DOC.BILL, 'itemOptions').section).toBe('items');
  });
});

describe('the kitchen ticket', () => {
  it('always prints what was chosen — it changes what is cooked', () => {
    const field = fieldDef(DOC.KOT, 'itemOptions');
    expect(field.default).toBe(VISIBILITY.ALWAYS);
    expect(allowedValues(field)).toContain(VISIBILITY.NEVER);
  });
});
