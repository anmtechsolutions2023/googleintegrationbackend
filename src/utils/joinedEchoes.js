// src/utils/joinedEchoes.js
// Write-schema tolerance for the columns a module's SELECT joins in.
//
// An edit form is seeded from a GET response and sends the whole thing back on
// the next PUT. So every `AS Alias` a module's SELECT adds — a joined name, a
// derived count — arrives on the next write, and a strict write schema that has
// never heard of it rejects the ENTIRE update with "not allowed".
//
// pricing.enrich.taxBreakdownEcho already solved this for one field. The
// problem with solving it one field at a time is that the fix lives in a hand-
// maintained list that has to be updated every time somebody adds a join, in
// TWO repositories — the Joi whitelist here and PosCrudPage's SYSTEM_FIELDS
// denylist on the client. Both drifted, in thirteen modules, and the symptom is
// always the same: a form that loads perfectly and refuses to save.
//
// Deriving the list FROM the query removes the second list entirely. Add a
// join, and its alias is tolerated on write automatically.
//
// Aliases that are also real inputs (positemmeta's ChannelIds, say, which is a
// JSON_ARRAYAGG on the way out and a writable array on the way in) must keep
// their real rules: spread this FIRST in the schema literal so the module's own
// field definitions override it.

const Joi = require('joi');

// `AS Alias` — the only way a non-column reaches a read payload.
const ALIAS = /\bAS\s+([A-Za-z_][\w]*)/gi;

// COUNT(*) AS total belongs to pagination, never to a row.
const NOT_A_ROW_FIELD = new Set(['total']);

/**
 * Joi fragment accepting — and dropping — every alias a module's reads add.
 *
 * Accepted and stripped rather than merely permitted: the value is re-derived
 * on the way out regardless of what a client sends, so letting one through to
 * the write layer could only ever cause harm.
 *
 * @param {Object} queries - The module's QUERIES entry (QUERIES.POS_ITEM_META).
 * @returns {Object<string, Joi.Schema>} Spread into a Joi.object literal.
 */
const joinedEchoes = (queries) => {
  const sql = [
    queries?.SELECT_ALL,
    queries?.SELECT_BY_ID,
    queries?.SELECT_BY_ID_WITH_DETAILS,
  ]
    .filter((s) => typeof s === 'string')
    .join('\n');

  const echoes = {};
  for (const [, alias] of sql.matchAll(ALIAS)) {
    if (NOT_A_ROW_FIELD.has(alias)) continue;
    echoes[alias] = Joi.any().optional().strip();
  }
  return echoes;
};

module.exports = { joinedEchoes };
