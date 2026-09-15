// src/modules/posorder/kitchenNotes.js
// What the kitchen is told about a dish, and about the whole order.
//
// Two different instructions with two different homes:
//   - a DISH note ("less spicy") rides on its order line, inside Items, so it
//     travels with the line: into the kitchen ticket's snapshot, through a table
//     transfer, and onto the invoice line at settle;
//   - an ORDER note ("pack sauces separately") and the no-cutlery flag sit on
//     the round itself, the same pair a portal order already carries.
//
// The till's limit is enforced here and nowhere else. A portal order is NOT
// held to it: the aggregator has already taken the customer's money, and
// refusing their instruction would strand a paid order.

const { HttpError } = require('../../middleware/errorHandler');
const { KITCHEN_NOTES } = require('../../config/constants');

/** Single-spaced and trimmed. Anything that is not text is not a note. */
const tidy = (raw) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '');

/**
 * A line's note, cleaned. Reads `note` first and falls back to `notes`, which
 * is what a portal order line calls the same thing.
 * @param {Object} line
 * @returns {string|null}
 */
const lineNoteOf = (line) => {
  if (!line || typeof line !== 'object') return null;
  return tidy(line.note ?? line.notes) || null;
};

/**
 * Items with every note cleaned into `note`. A line whose note is blank loses
 * the key rather than storing an empty string on every dish.
 *
 * Items that are not an array are handed back untouched — the order schema
 * accepts an object there, and the pricer already treats it as unpriceable.
 *
 * @param {Array|*} items
 * @returns {Array|*}
 */
const withCleanNotes = (items) => {
  if (!Array.isArray(items)) return items;
  return items.map((line) => {
    if (!line || typeof line !== 'object') return line;
    const out = { ...line };
    const note = lineNoteOf(line);
    if (note) out.note = note;
    else delete out.note;
    return out;
  });
};

/**
 * Refuses a till order whose dish note will not fit on the ticket, naming the
 * line. Truncating instead would print half an allergy.
 * @param {Array|*} items
 * @throws {HttpError} 400
 */
const assertNotesFit = (items) => {
  if (!Array.isArray(items)) return;
  items.forEach((line, index) => {
    const note = lineNoteOf(line);
    if (note && note.length > KITCHEN_NOTES.LINE_MAX) {
      const name = line.name ? `"${line.name}"` : `line ${index + 1}`;
      throw new HttpError(
        `The kitchen note on ${name} is ${note.length} characters; keep it to ${KITCHEN_NOTES.LINE_MAX}.`,
        400,
      );
    }
  });
};

/**
 * The whole-order note, cleaned, or null when there is nothing in it.
 * @param {*} raw
 * @returns {string|null}
 */
const cleanInstructions = (raw) => tidy(raw) || null;

module.exports = {
  lineNoteOf,
  withCleanNotes,
  assertNotesFit,
  cleanInstructions,
};
