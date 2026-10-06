// src/config/permissionRules.js
// Which permissions are pointless without others.
//
// A role editor that lets an admin tick "Orders — Manage" without "Orders —
// View" produces a role whose API calls succeed but whose screens never appear:
// the frontend offers each screen on its READ scope. These rules close that.
// The role editor ticks the requirement for the admin and says why, and the
// server adds it anyway on save, so no role can be stored in a state that
// half-works.
//
// The frontend keeps the same rules in src/config/permissionRules.js. Change
// both together.

/**
 * Extra requirements beyond the general "Manage needs View" rule.
 * Approving something you cannot see is not a job anybody can do.
 */
const REQUIRES = {
  // Expense claims are listed on Money › Expenses, which opens on POS_OPS:READ.
  'EXPENSE:APPROVE': ['POS_OPS:READ'],
  // Refunds and return settlements are made from the Ledger and Returns
  // screens, which open on TRANSACTIONS:READ.
  'REFUND:APPROVE': ['TRANSACTIONS:READ'],
  // Customer exports are downloaded from Guests › Customers, which opens on
  // POS_CRM:READ.
  'CUSTOMER:EXPORT': ['POS_CRM:READ'],
};

/**
 * The permissions a key needs, one level deep.
 * @param {string} key - "FEATURE:SCOPE".
 * @returns {string[]}
 */
const requirementsOf = (key) => {
  const [subject, level] = String(key).split(':');
  const needs = level === 'WRITE' ? [`${subject}:READ`] : [];
  return needs.concat(REQUIRES[key] || []);
};

/**
 * A set of keys plus everything it needs, transitively. Keys that are not in
 * `available` (not in the catalogue, or inactive) are never added.
 *
 * @param {string[]} keys
 * @param {Set<string>|string[]} available
 * @returns {string[]} The closed set, in a stable order.
 */
const withRequirements = (keys, available) => {
  const can = available instanceof Set ? available : new Set(available);
  const out = new Set(keys);
  const queue = [...keys];
  while (queue.length) {
    for (const need of requirementsOf(queue.shift())) {
      if (can.has(need) && !out.has(need)) {
        out.add(need);
        queue.push(need);
      }
    }
  }
  return [...out].sort();
};

module.exports = { REQUIRES, requirementsOf, withRequirements };
