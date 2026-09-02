// src/modules/user/capability.catalogue.js
//
// Turns the scope strings a JWT carries into something a cashier can read.
//
// NAMES ARE CURATED; WHAT THEY OPEN IS GENERATED
// scope-screens.json is derived from the frontend's navigation.js — the file
// that already decides which scope opens which menu item — so the list of
// screens under each capability cannot drift from the routing. The short NAME
// is still a judgement call and lives here, but a test asserts every generated
// subject has one, so adding a menu item cannot quietly produce a nameless
// capability.
//
// This exists because the first version was hand-written and four of its
// labels were wrong: POS_OPS was described as opening the Tables screen, which
// it does not, and POS_CONFIG was called "settings" when it opens nine screens.
//
// THREE LAYERS, AND THE THIRD IS THE POINT
//   1. NAMES + scope-screens.json — the wording somebody reads.
//   2. features.display_name — the database's own wording, for anything the
//      generated file does not cover.
//   3. humanise() — a deterministic rewrite of the raw scope string.
//
// Layer 3 means a scope can NEVER reach a screen as `POS_ORDER:WRITE`. A
// permission somebody holds must always be explainable, including one added
// after this file was written.

const { SCOPES } = require('../../config/constants');
const scopeScreens = require('../../config/scope-screens.json');

/** subject -> the screens it opens, from the generated binding. */
const SCREENS = Object.fromEntries(
  scopeScreens.subjects.map((s) => [s.subject, s.screens]),
);

// Where each capability belongs, in the words of the person reading it. Keyed
// on feature_short_name — the half of the scope before the colon.
const GROUPS = [
  { key: 'front-desk', label: 'Front Desk',
    members: ['POS_ORDER', 'POS_BILLING', 'POS_KITCHEN', 'POS_OPS', 'POS_CRM', 'POS_CONFIG', 'POS_REPORTS'] },
  { key: 'money', label: 'Money',
    members: ['TRANSACTIONS', 'PAYMENTS', 'EXPENSE'] },
  { key: 'catalogue', label: 'Catalogue & stock',
    members: ['MASTER_DATA', 'INVENTORY', 'ASSET'] },
  { key: 'business', label: 'Business',
    members: ['ORGANIZATION', 'CONTACTS', 'AUDIT'] },
];

// Plain-language names. The database's own display_name ("Front Desk — Ops
// Manage") is accurate but written for whoever built the permission; these are
// written for whoever holds it.
const NAMES = {
  POS_ORDER:    'Orders & tables',
  POS_KITCHEN:  'Kitchen display',
  POS_OPS:      'Queue, tracking & expenses',
  POS_BILLING:  'Cash drawer',
  POS_CONFIG:   'Menu & setup',
  POS_CRM:      'Customers',
  POS_REPORTS:  'Front desk reports',
  TRANSACTIONS: 'Books',
  ASSET:        'Assets',
  EXPENSE:      'Expense approvals',
  INVENTORY:    'Inventory',
  // Screens outside Front Desk, so the generated binding does not cover them.
  MASTER_DATA:  'Menu and master data',
  ORGANIZATION: 'Organization and branches',
  CONTACTS:     'Contacts and addresses',
  PAYMENTS:     'Payments',
  AUDIT:        'Audit logs',
};

// Scopes that are NOT features: they are ranks or states, granted by a flag on
// the membership rather than by a role, so no features row will ever exist for
// them. Surfaced separately from the capability list.
const RANKS = {
  [SCOPES.TENANT_SUPER_ADMIN]: {
    label: 'Platform super administrator',
    note: 'Can see and manage every restaurant on this platform.',
  },
  [SCOPES.TENANT_ADMIN]: {
    label: 'Administrator of this restaurant',
    note: 'Can do everything below, plus manage people and their access.',
  },
  [SCOPES.ADMIN_ACCESS]: {
    label: 'Administration area',
    note: 'Can open the administration screens.',
  },
  [SCOPES.GUEST_EXPLORE]: {
    label: 'Awaiting approval',
    note: 'Signed in, but not yet admitted to a restaurant.',
  },
};

/** How much of a capability somebody has, worst-to-best. */
const LEVEL = { READ: 'view', WRITE: 'full', UPDATE: 'full', APPROVE: 'approve' };
const LEVEL_LABEL = { view: 'View only', full: 'Full access', approve: 'Approve' };
const RANKED = ['view', 'approve', 'full'];

/**
 * A readable name for a scope nothing else knows about.
 *
 * `POS_ORDER:WRITE` → `Pos order — Manage`. Not elegant, but it is a sentence
 * rather than a code, and it means a scope added tomorrow is legible today.
 *
 * @param {string} scope
 * @returns {string}
 */
const humanise = (scope) => {
  const [subject = '', action = ''] = String(scope).split(':');
  const words = subject.replace(/_/g, ' ').toLowerCase().trim();
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  const verb = { READ: 'View', WRITE: 'Manage', UPDATE: 'Manage', APPROVE: 'Approve' }[action.toUpperCase()];
  return verb ? `${name} — ${verb}` : name || String(scope);
};

module.exports = { GROUPS, NAMES, SCREENS, RANKS, LEVEL, LEVEL_LABEL, RANKED, humanise };
