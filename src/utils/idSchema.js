// src/utils/idSchema.js
// One Joi rule for "this field is a record id".
//
// WHY THIS EXISTS
// Every id in this database is `Id VARCHAR(50)`, and two kinds of value live in
// that column:
//
//   * app-generated ids, which are real RFC-4122 UUIDs from uuidv4(); and
//   * SEEDED ids, which are deliberately mnemonic so a human reading
//     02-seed-data.sql can tell what a row is — 'f0000001-ftyp-0000-0000-
//     000000000001' is a food type, 'p0000001-prtl-...' a portal.
//
// Those mnemonic segments are NOT hexadecimal ('ftyp', 'mtyp', 'prtl', 'chan',
// 'mtag', 'rjsn', 'ldgr', 'txgp'...), so a strict UUID rule REJECTED every
// seeded row. The effect was not subtle: a list loaded fine, and then opening
// any seeded row answered
//
//     400  Validation error: "id" must be a valid GUID
//
// so every seeded master was readable but uneditable, and any form referencing
// one — a menu item's food type, a rejection reason's portal — could not be
// saved at all.
//
// The database is the source of truth, so the validator moves to match the
// column rather than the seed being renumbered to satisfy the validator.
//
// The shape is still checked: 8-4-4-4-12 alphanumeric segments accepts both
// kinds and rejects free text, a path fragment or an injection attempt. It is
// deliberately NOT a bare `Joi.string()` — that would validate nothing.

const Joi = require('joi');
// One implementation of "a blank control means null", shared with the number
// and object rules — the same empty string causes all of them.
const { blankable } = require('./optionalFields');

/**
 * The id grammar shared by generated and seeded rows: UUID layout, but each
 * segment alphanumeric rather than strictly hex.
 */
const ID_PATTERN = /^[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}$/;

/**
 * A record id — a generated UUID or a seeded mnemonic id.
 *
 * Joi schemas are immutable, so this constant is safe to chain off:
 * `entityId.required()`, `entityId.allow(null).optional()`.
 */
const entityId = Joi.string()
  .max(50)
  .pattern(ID_PATTERN)
  .messages({
    'string.pattern.base': '{{#label}} must be a valid record id.',
    'string.max': '{{#label}} is longer than an id can be.',
  });

/**
 * An OPTIONAL reference to another record — a nullable foreign key.
 *
 * An unselected `<select>` posts an empty string, not null and not nothing.
 * `entityId.optional().allow(null)` refuses it, so every form with an optional
 * reference on it failed to save with
 *
 *     400  Validation error: "MeatTypeId" is not allowed to be empty
 *
 * and the field the user had deliberately left blank was the one being
 * complained about. It affected every optional reference in the application,
 * not one field.
 *
 * Blank becomes NULL — see utils/optionalFields for why that, and not
 * undefined, is the right answer on a PATCH.
 */
const optionalEntityId = blankable(entityId, '{{#label}} must be a valid record id.');

/** An array of record ids, for the join-table fields. */
const entityIdArray = Joi.array().items(entityId);

module.exports = { entityId, optionalEntityId, entityIdArray, ID_PATTERN };
