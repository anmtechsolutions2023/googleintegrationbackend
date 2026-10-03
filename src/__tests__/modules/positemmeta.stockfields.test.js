const { updateSchema } = require('../../modules/positemmeta/positemmeta.schemas');

// The exact PUT body the Menu Master edit form sent when it failed.
const payload = {
  ItemDetailId: 'fbb9057a-cf3d-4c40-9064-291c436ace4a',
  FoodTypeId: '1c64e94e-c978-4184-88bb-5fa4df63922d',
  Channels: null, Prices: null, Variants: null,
  ServesCount: null, PortionSize: null, MeatTypeId: null, PrepTimeMinutes: null,
  StockTracked: true, MaxPerOrder: '',
  BranchDetailId: 'c26d58d8-7d9f-4777-aa2b-867c143dc886', Active: true,
  ChannelIds: [], VariantIds: [], AddonGroupIds: [], TagIds: [],
  MeatTypeName: null, CategoryId: '010779ec-b3d6-4d0c-a388-ab8e10ded1bc',
  CategoryName: 'Tea', ItemName: 'Plain Tea', OwnTags: [], CategoryTags: [],
  CategoryAvailableNow: true, CategoryOpensAt: null,
  stockState: 'unlimited', remaining: null, maxPerOrder: null,
};

describe('the Menu Master edit form posts its whole row back', () => {
  // THE BUG: attachStock added three computed fields to the GET, and the edit
  // form sends everything it was seeded with. A read-only field the user never
  // touched must not be what refuses the save.
  it('accepts the row it was given, computed fields included', () => {
    const { error } = updateSchema.validate(payload);
    expect(error).toBeUndefined();
  });

  it('drops the computed fields rather than trying to store them', () => {
    const { value } = updateSchema.validate(payload);
    expect(value.stockState).toBeUndefined();
    expect(value.remaining).toBeUndefined();
    expect(value.maxPerOrder).toBeUndefined();
  });

  it('keeps the two real columns, and reads a blank cap as no cap', () => {
    const { value } = updateSchema.validate(payload);
    expect(value.StockTracked).toBe(true);
    expect(value.MaxPerOrder).toBeNull();
  });
});
