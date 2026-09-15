// Fields a person is allowed to leave blank.
//
// An empty form control does not post nothing. A cleared <select> posts '', and
// so does an emptied <input type="number"> — and Joi's own rules refuse both:
//
//     400  Validation error: "MeatTypeId" is not allowed to be empty
//     400  Validation error: "ServesCount" must be a number
//
// each complaining about a field the user had deliberately left blank, and each
// blocking the whole save.

const Joi = require('joi');
const { blankable, optionalNumber, optionalObject } = require('../../utils/optionalFields');

const run = (schema, v) => Joi.object({ f: schema }).validate(v);

describe('optionalNumber', () => {
  const S = optionalNumber({ min: 0, max: 255, integer: true });

  it('accepts an emptied number input', () => {
    expect(run(S, { f: '' }).error).toBeUndefined();
  });

  // undefined means "not sent, leave it alone"; null means "clear it". A
  // cleared box that became undefined would keep the old value — the user
  // empties Serves, saves, and the old count is still there.
  it('stores a blank as NULL, not undefined', () => {
    expect(run(S, { f: '' }).value.f).toBeNull();
  });

  it('leaves an omitted field omitted', () => {
    expect(run(S, {}).value).not.toHaveProperty('f');
  });

  // An <input type="number"> posts the STRING "42".
  it('coerces the string a form actually posts', () => {
    expect(run(S, { f: '42' }).value.f).toBe(42);
  });

  it('still enforces its bounds', () => {
    expect(run(S, { f: -1 }).error).toBeDefined();
    expect(run(S, { f: 999 }).error).toBeDefined();
    expect(run(S, { f: 2.5 }).error).toBeDefined();
    expect(run(S, { f: 'abc' }).error).toBeDefined();
  });

  it('says what is wrong AND that blank is allowed', () => {
    expect(run(S, { f: 999 }).error.message)
      .toMatch(/whole number, at least 0 and at most 255 — or left blank/);
  });

  it('allows a decimal when it is not asked to be whole', () => {
    expect(run(optionalNumber({ min: 0 }), { f: 250.5 }).value.f).toBe(250.5);
  });

  it('needs no bounds at all', () => {
    expect(run(optionalNumber(), { f: -7 }).value.f).toBe(-7);
  });
});

describe('optionalObject', () => {
  const inner = Joi.object({ Calories: optionalNumber({ min: 0 }) });
  const S = optionalObject(inner, 'a set of nutrition figures');

  it('accepts a panel the user never filled in', () => {
    expect(run(S, { f: '' }).value.f).toBeNull();
    expect(run(S, { f: null }).value.f).toBeNull();
  });

  it('accepts a panel opened and left empty', () => {
    expect(run(S, { f: {} }).error).toBeUndefined();
  });

  it('accepts figures typed into it', () => {
    expect(run(S, { f: { Calories: '250' } }).value.f.Calories).toBe(250);
  });

  it('accepts blank figures inside a filled-in panel', () => {
    expect(run(S, { f: { Calories: '' } }).value.f.Calories).toBeNull();
  });

  // Naming the panel but not the box is a worse message than the one this
  // replaced: it says which section to look at and not which field.
  it('names the offending field inside, not just the panel', () => {
    expect(run(S, { f: { Calories: -5 } }).error.message).toMatch(/Calories/);
  });

  it('still refuses something that is not an object at all', () => {
    expect(run(S, { f: 'garbage' }).error.message).toMatch(/a set of nutrition figures/);
  });
});

describe('blankable — the shared primitive', () => {
  it('is what optionalEntityId is built from, so ids behave identically', () => {
    const { optionalEntityId } = require('../../utils/idSchema');
    expect(run(optionalEntityId, { f: '' }).value.f).toBeNull();
    expect(run(optionalEntityId, { f: 'nope' }).error).toBeDefined();
  });

  it('passes a non-blank value through its own rule', () => {
    const S = blankable(Joi.string().min(3), 'too short');
    expect(run(S, { f: 'abc' }).value.f).toBe('abc');
    expect(run(S, { f: 'ab' }).error.message).toBe('too short');
  });

  // Only '' and null are forgiven — 0 and false are real values.
  it('does not treat 0 or false as blank', () => {
    expect(run(optionalNumber({ min: 0 }), { f: 0 }).value.f).toBe(0);
    expect(run(blankable(Joi.boolean(), 'x'), { f: false }).value.f).toBe(false);
  });
});
