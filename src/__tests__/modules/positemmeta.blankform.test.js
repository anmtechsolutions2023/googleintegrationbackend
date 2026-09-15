// The Menu Items form, saved with only its required fields filled in.
//
// Two rules meet here, and both failed in ways that named the wrong culprit:
//
//   1. An empty control posts '', not nothing. A cleared <select> and an
//      emptied <input type="number"> both do it, and the error complained
//      about the very field the user had deliberately left blank:
//        "MeatTypeId" is not allowed to be empty
//        "ServesCount" must be a number
//
//   2. ANYTHING A READ RETURNS, A WRITE MUST ACCEPT BACK. The form is seeded
//      from a GET and posts the whole row, so a read-only field it never
//      touched must not be what refuses the save. joinedEchoes covers the
//      columns the SELECT joins in; it cannot see fields the SERVICE attaches
//      afterwards, and those are exactly the ones that got missed.

const { validateBody } = require('../../middleware/validation');
const { createSchema, updateSchema } = require('../../modules/positemmeta/positemmeta.schemas');

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const REQUIRED = {
  ItemDetailId: 'f4c33126-6f1a-4d62-ba43-026387df4acf',
  FoodTypeId: 'f0000001-ftyp-0000-0000-000000000001',
  BranchDetailId: '7a8579e7-7ae6-4798-b159-1fc558fafcaa',
};

// Every optional control, left blank, exactly as a browser posts them.
const BLANKS = {
  MeatTypeId: '', CostInfoId: '', ServesCount: '', PortionSize: '', PrepTimeMinutes: '',
  Nutrition: { ServingSizeG: '', Calories: '', ProteinG: '', CarbohydrateG: '', SugarG: '', FatG: '', SaturatedFatG: '', FibreG: '', SodiumMg: '', Allergens: '' },
};

// Read-only fields a GET returns and the form round-trips untouched.
const ECHOES = {
  ItemName: 'Paneer Tikka', CategoryId: 'c1', CategoryName: 'Starters',
  CostInfoAmount: 279, FoodTypeName: 'Veg', FoodTypeIsVeg: 1, MeatTypeName: null,
  OwnTags: [], CategoryTags: [], TaxBreakdown: { effectiveRate: 5 },
  // Attached by attachAvailability, AFTER the query — invisible to joinedEchoes.
  CategoryAvailableNow: true, CategoryOpensAt: null,
};

const post = (schema, body) => {
  const req = { body: { ...body } };
  let err;
  validateBody(schema)(req, {}, (e) => { err = e; });
  return { body: req.body, err };
};

describe('saving the form with every optional field left blank', () => {
  it('is accepted on create', () => {
    expect(post(createSchema, { ...REQUIRED, ...BLANKS }).err).toBeUndefined();
  });

  it('is accepted on update', () => {
    expect(post(updateSchema, { ...REQUIRED, ...BLANKS }).err).toBeUndefined();
  });

  it('reaches the service as NULL, not as empty strings', () => {
    const { body } = post(createSchema, { ...REQUIRED, ...BLANKS });
    expect(body.MeatTypeId).toBeNull();
    expect(body.CostInfoId).toBeNull();
    expect(body.ServesCount).toBeNull();
    expect(body.PrepTimeMinutes).toBeNull();
  });

  it('nulls the figures inside the nutrition panel too', () => {
    const { body } = post(createSchema, { ...REQUIRED, ...BLANKS });
    expect(body.Nutrition.Calories).toBeNull();
    expect(body.Nutrition.ProteinG).toBeNull();
  });

  it('accepts a nutrition panel cleared as a whole', () => {
    const { body, err } = post(createSchema, { ...REQUIRED, Nutrition: '' });
    expect(err).toBeUndefined();
    // null is what syncNutrition reads as "remove the row".
    expect(body.Nutrition).toBeNull();
  });

  it('leaves an omitted nutrition block omitted, so a PATCH means "leave alone"', () => {
    const { body } = post(updateSchema, { ...REQUIRED });
    expect(body).not.toHaveProperty('Nutrition');
  });
});

describe('the form round-trips a GET response', () => {
  const full = { ...REQUIRED, ...BLANKS, ...ECHOES, Active: true };

  it('is accepted on create', () => {
    expect(post(createSchema, full).err).toBeUndefined();
  });

  it('is accepted on update', () => {
    expect(post(updateSchema, full).err).toBeUndefined();
  });

  it('drops every read-only field before the service sees it', () => {
    const { body } = post(createSchema, full);
    Object.keys(ECHOES).forEach((k) => expect(body).not.toHaveProperty(k));
  });

  // The two the SQL-derived tolerance could never have covered.
  it('tolerates the availability pair the service attaches after the query', () => {
    const { err } = post(createSchema, {
      ...REQUIRED, CategoryAvailableNow: false, CategoryOpensAt: '07:00:00',
    });
    expect(err).toBeUndefined();
  });
});

describe('it is still a validator', () => {
  it('refuses a serving count that is not whole', () => {
    expect(post(createSchema, { ...REQUIRED, ServesCount: 2.5 }).err).toBeDefined();
  });

  it('refuses a reference that is not an id', () => {
    expect(post(createSchema, { ...REQUIRED, MeatTypeId: 'nope' }).err).toBeDefined();
  });

  it('names the figure inside the panel, not just the panel', () => {
    const { err } = post(createSchema, { ...REQUIRED, Nutrition: { Calories: -5 } });
    expect(err.message).toMatch(/Calories/);
  });

  it('still requires what is required', () => {
    expect(post(createSchema, { ...BLANKS }).err).toBeDefined();
  });
});
