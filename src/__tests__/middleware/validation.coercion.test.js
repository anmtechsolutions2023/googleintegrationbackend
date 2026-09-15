// Validation does not only CHECK a body, it normalises one — and the normalised
// version has to be what reaches the service.
//
// optionalEntityId turns the empty string a blank dropdown posts into null, and
// read-only echoes a form sends back are .strip()ed. All of that lived in Joi's
// `value` and was then discarded: 67 of the 74 controllers read req.body, so
// the service got exactly what the browser sent. A cleared dropdown validated
// as null and still arrived as '', which MySQL refuses as a foreign key.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const Joi = require('joi');
const { validateBody } = require('../../middleware/validation');
const { optionalEntityId, entityId } = require('../../utils/idSchema');

const run = (schema, body) => {
  const req = { body };
  const next = jest.fn();
  validateBody(schema)(req, {}, next);
  return { req, next, err: next.mock.calls[0] && next.mock.calls[0][0] };
};

describe('the body a controller receives is the COERCED one', () => {
  const schema = Joi.object({
    Name: Joi.string().required(),
    MeatTypeId: optionalEntityId,
    CategoryName: Joi.any().optional().strip(),
  });

  it('a blank dropdown reaches the controller as null, not as an empty string', () => {
    const { req, err } = run(schema, { Name: 'Paneer Tikka', MeatTypeId: '' });
    expect(err).toBeUndefined();
    expect(req.body.MeatTypeId).toBeNull();
  });

  it('a stripped echo never reaches the controller at all', () => {
    const { req } = run(schema, { Name: 'x', CategoryName: 'Starters' });
    expect(req.body).not.toHaveProperty('CategoryName');
  });

  it('an omitted optional reference stays omitted', () => {
    const { req } = run(schema, { Name: 'x' });
    expect(req.body).not.toHaveProperty('MeatTypeId');
  });

  it('a real id is passed through untouched', () => {
    const id = 'h0000001-mtyp-0000-0000-000000000001';
    const { req } = run(schema, { Name: 'x', MeatTypeId: id });
    expect(req.body.MeatTypeId).toBe(id);
  });

  // The seven controllers already written against it must keep working.
  it('still populates req.validatedBody', () => {
    const { req } = run(schema, { Name: 'x', MeatTypeId: '' });
    expect(req.validatedBody).toEqual(req.body);
  });

  it('refuses a bad body without touching it', () => {
    const { req, err } = run(schema, { MeatTypeId: 'nope' });
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(req.body).toEqual({ MeatTypeId: 'nope' });
  });

  // Unknown keys are deliberately NOT stripped globally (config.VALIDATION
  // .STRIP_UNKNOWN is false); only fields a schema explicitly strips are
  // dropped. Assigning the coerced body back must not change that.
  it('leaves an unknown key alone rather than silently dropping it', () => {
    const loose = Joi.object({ Name: Joi.string() }).unknown(true);
    const { req } = run(loose, { Name: 'x', Extra: 1 });
    expect(req.body.Extra).toBe(1);
  });

  it('a required id is still required', () => {
    const strict = Joi.object({ Ref: entityId.required() });
    expect(run(strict, {}).err).toBeDefined();
  });
});
