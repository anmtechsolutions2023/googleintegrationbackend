// src/modules/possetting/possetting.service.js
// Per-branch POS preferences.
//
// Branch-scoped rather than tenant-scoped: a food-court counter and a fine-dine
// outlet under one owner legitimately want different behaviour. The global
// app_settings table is deliberately NOT reused — it is super-admin owned and
// system-wide, so a value written there would apply to every tenant on the
// platform at once.
//
// A branch with no row is a valid, meaningful state: it means "use the
// default". Reads therefore never assume a row exists, and writes never need a
// provisioning step before a branch can be configured.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const {
  QUERIES,
  POS_SETTING_KEYS,
  TOKEN_NUMBERING,
  TOKEN_NUMBERING_DEFAULT,
} = require('../../config/constants');

// Every key this module recognises, with the value it falls back to. Unknown
// keys are rejected at the schema, so this list IS the contract.
const DEFAULTS = {
  [POS_SETTING_KEYS.TOKEN_NUMBERING]: TOKEN_NUMBERING_DEFAULT,
};

/**
 * Reads one setting on an OPEN connection, falling back to the default.
 *
 * Takes a connection rather than opening its own so a caller already inside a
 * transaction — issuing a token during a settle, say — reads the setting on the
 * same connection it is writing on, instead of deadlocking against itself on
 * the pool.
 *
 * @param {Object} conn - Open connection or transaction connection.
 * @param {string} key
 * @param {string} branchId
 * @param {string} tenantId
 * @returns {Promise<string>}
 */
const resolveTx = async (conn, key, branchId, tenantId) => {
  const fallback = DEFAULTS[key] ?? null;
  if (!branchId) return fallback;

  const [rows] = await conn.execute(QUERIES.POS_SETTING.SELECT_VALUE, [
    tenantId, branchId, key,
  ]);
  const value = rows.length > 0 ? rows[0].SettingValue : null;
  return value == null || value === '' ? fallback : value;
};

/**
 * The token numbering mode in force for a branch.
 * @returns {Promise<'daily'|'series'>}
 */
const resolveTokenNumberingTx = async (conn, branchId, tenantId) => {
  const mode = await resolveTx(
    conn, POS_SETTING_KEYS.TOKEN_NUMBERING, branchId, tenantId,
  );
  // An unrecognised stored value (hand-edited row, older release) must not make
  // the till unnumberable — fall back rather than throw on the sale path.
  return Object.values(TOKEN_NUMBERING).includes(mode) ? mode : TOKEN_NUMBERING_DEFAULT;
};

/**
 * Every setting for one branch, with defaults filled in for keys never set.
 * The UI renders from this, so it must be complete rather than sparse.
 * @returns {Promise<Object>} e.g. { 'token.numbering': 'daily' }
 */
const getBranchSettings = (branchId, tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.POS_SETTING.SELECT_BY_BRANCH, [
      tenantId, branchId,
    ]);
    const stored = {};
    rows.forEach((r) => { stored[r.SettingKey] = r.SettingValue; });
    return { ...DEFAULTS, ...stored };
  });

/**
 * Upserts a validated patch of settings for one branch.
 * @param {string} branchId
 * @param {Object} patch - { '<key>': '<value>' } — keys already validated.
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<Object>} The branch's resulting settings.
 */
const setBranchSettings = async (branchId, patch, tenantId, userEmail) => {
  await withConnection(async (conn) => {
    for (const [key, value] of Object.entries(patch)) {
      await conn.execute(QUERIES.POS_SETTING.UPSERT, [
        uuidv4(), tenantId, branchId, key, value, userEmail, userEmail,
      ]);
    }
  });
  return getBranchSettings(branchId, tenantId);
};

module.exports = {
  DEFAULTS,
  resolveTx,
  resolveTokenNumberingTx,
  getBranchSettings,
  setBranchSettings,
};
