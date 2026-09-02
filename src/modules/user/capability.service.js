// src/modules/user/capability.service.js
//
// "What can I actually do here?" — the scopes on a token, answered in words.
//
// Resolved on the SERVER rather than shipped to the browser as a catalogue to
// join: the wording, the grouping and the fallback then live in one place, and
// a client cannot render a permission the server would describe differently.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const {
  GROUPS, NAMES, SCREENS, RANKS, LEVEL, LEVEL_LABEL, RANKED, humanise,
} = require('./capability.catalogue');

/**
 * Group capabilities for one set of scopes.
 *
 * READ and WRITE on the same subject are ONE line stating the level, not two:
 * "Billing · Full access" is what somebody wants to know, and a list of 28
 * chips is what they were reading before.
 *
 * @param {Array<string>} scopes - Straight off the token.
 * @returns {Promise<Object>} { ranks, groups, unmatched }
 */
const resolveForScopes = async (scopes) => {
  const held = [...new Set(scopes || [])];

  // The database's own wording, keyed by subject, for anything LABELS omits.
  const rows = await withConnection(async (conn) => {
    const [r] = await conn.execute(QUERIES.FEATURES.SELECT_ALL);
    return r || [];
  });
  const fromDb = new Map();
  rows.forEach((r) => {
    if (!fromDb.has(r.feature_short_name)) {
      // "Front Desk — Billing Manage" → "Front Desk — Billing": the level is
      // stated once per line, so carrying it in the name repeats it.
      fromDb.set(r.feature_short_name, String(r.display_name || '')
        .replace(/\s+—\s+(View|Manage|Approve)(\s*\/\s*Reject)?$/i, '').trim());
    }
  });

  const ranks = [];
  const bySubject = new Map();

  held.forEach((scope) => {
    if (RANKS[scope]) { ranks.push({ scope, ...RANKS[scope] }); return; }

    const [subject, action = ''] = String(scope).split(':');
    const level = LEVEL[action.toUpperCase()] || 'view';
    const entry = bySubject.get(subject) || { subject, scopes: [], level: 'view' };
    entry.scopes.push(scope);
    // Keep the strongest level any held scope on this subject grants.
    if (RANKED.indexOf(level) > RANKED.indexOf(entry.level)) entry.level = level;
    bySubject.set(subject, entry);
  });

  const describe = (e) => ({
    label: NAMES[e.subject] || fromDb.get(e.subject) || humanise(e.scopes[0]),
    level: e.level,
    levelLabel: LEVEL_LABEL[e.level],
    scopes: e.scopes.sort(),
    // The menu items this actually opens, generated from the routing rather
    // than described by hand. Empty for scopes whose screens live outside
    // Front Desk, and the UI simply shows nothing rather than guessing.
    screens: SCREENS[e.subject] || [],
    // True when nothing but the last-resort formatter could name it — the UI
    // flags it, and it means a name or a features row is missing.
    named: !!(NAMES[e.subject] || fromDb.get(e.subject)),
  });

  const placed = new Set();
  const groups = GROUPS.map((g) => {
    const capabilities = g.members
      .filter((m) => bySubject.has(m))
      .map((m) => { placed.add(m); return describe(bySubject.get(m)); });
    return { key: g.key, label: g.label, capabilities };
  }).filter((g) => g.capabilities.length > 0);

  // Anything the groups do not claim still gets shown, in its own group. A
  // permission omitted because no group listed it is a permission somebody
  // holds and cannot see.
  const rest = [...bySubject.values()]
    .filter((e) => !placed.has(e.subject))
    .map(describe);
  if (rest.length) groups.push({ key: 'other', label: 'Other', capabilities: rest });

  return {
    ranks,
    groups,
    // For support: the raw strings, always available, never the primary view.
    scopes: held.sort(),
  };
};

module.exports = { resolveForScopes };
