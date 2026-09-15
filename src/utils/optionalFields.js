// src/utils/optionalFields.js
// Fields a person is allowed to leave blank.
//
// WHY THIS EXISTS
// An empty form control does not post nothing. A cleared <select> posts '', and
// so does an emptied <input type="number">. Joi's own rules refuse both:
//
//     400  Validation error: "MeatTypeId" is not allowed to be empty
//     400  Validation error: "ServesCount" must be a number
//
// — each complaining about a field the user had deliberately left blank, and
// each blocking the whole save. It is never one field: every optional control
// in the application posts the same empty string.
//
// A BLANK CONTROL MEANS NULL, and deliberately not undefined. The two are
// different instructions on a PATCH: undefined means "not sent, leave it
// alone", null means "clear it". Mapping a cleared field to undefined would
// silently keep the old value — the user empties Serves, saves, and the old
// count is still there. Null is also what these columns actually hold; '' is
// not a number and not a valid foreign key.

const Joi = require('joi');

/**
 * Accepts a blank control, stores NULL, and otherwise applies `schema`.
 *
 * Written as a custom rule rather than `.allow(null, '')` because Joi returns
 * an allowed value AS-IS: there is no transform step in which to convert it.
 * Returning the schema's own coerced value matters too — an
 * `<input type="number">` posts the string "42", and Joi.number() is what turns
 * it into 42.
 *
 * @param {Joi.Schema} schema the rule that applies when the field is NOT blank
 * @param {string} message what to say when it fails that rule
 * @returns {Joi.Schema}
 */
const blankable = (schema, message) => Joi.any()
  .custom((value, helpers) => {
    if (value === '' || value === null) return null;

    const { error, value: coerced } = schema.validate(value);
    if (!error) return coerced;

    // For an OBJECT, the inner error already names the key that is wrong
    // ("Calories" must be greater than or equal to 0). Swallowing that for a
    // blanket "Nutrition must be a set of figures" tells the user which panel
    // to look at and not which box — a worse message than the one this rule
    // replaced. Surface it, qualified by the field the panel belongs to.
    const inner = error.details && error.details[0];
    if (inner && inner.path && inner.path.length > 0) {
      // Unquote the inner label so the two do not read as two separate
      // fields: `"Nutrition" → Calories must be …`, not `"Nutrition"."Calories"`.
      const detail = inner.message.replace(/^"([^"]+)"\s*/, "$1 ");
      return helpers.message({ custom: `{{#label}} → ${detail}` });
    }

    return helpers.error('any.invalid');
  })
  .messages({ 'any.invalid': message });

/**
 * An optional number: blank means null, "42" means 42.
 *
 * @param {Object} [opts]
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @param {boolean} [opts.integer] whole numbers only
 * @returns {Joi.Schema}
 */
const optionalNumber = ({ min, max, integer = false } = {}) => {
  let rule = Joi.number();
  if (integer) rule = rule.integer();
  if (min !== undefined) rule = rule.min(min);
  if (max !== undefined) rule = rule.max(max);

  const bounds = [
    min !== undefined ? `at least ${min}` : null,
    max !== undefined ? `at most ${max}` : null,
  ].filter(Boolean).join(' and ');

  return blankable(
    rule,
    `{{#label}} must be ${integer ? 'a whole number' : 'a number'}`
    + `${bounds ? `, ${bounds}` : ''} — or left blank.`,
  );
};

/** An optional object: blank means null, so a cleared block removes its row. */
const optionalObject = (schema, label = 'a set of values') => blankable(
  schema,
  `{{#label}} must be ${label}, or left blank.`,
);

module.exports = { blankable, optionalNumber, optionalObject };
