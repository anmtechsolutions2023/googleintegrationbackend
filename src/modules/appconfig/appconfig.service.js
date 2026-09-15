// src/modules/appconfig/appconfig.service.js
// Global application configuration (key/value app_settings), super-admin owned.
// Currently exposes the onboarding auto-approval flag. Values are stored as
// strings; booleans persist as 'true' / 'false'.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, ONBOARDING, CLOCK } = require('../../config/constants');

const AUTO_APPROVE_KEY = ONBOARDING.SETTING_AUTO_APPROVE;
const TIMEZONE_KEY = CLOCK.SETTING_TIMEZONE;

/**
 * Reads a single setting value (string) or null when absent.
 * @param {string} key
 * @returns {Promise<string|null>}
 */
const getSetting = (key, existingConn) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.APP_SETTINGS.SELECT_BY_KEY, [key]);
    return rows.length > 0 ? rows[0].setting_value : null;
  }, existingConn);

/**
 * True when onboarding auto-approval is enabled. Defaults to false when the
 * setting has never been written (safe default — no behavior change).
 * @returns {Promise<boolean>}
 */
const isAutoApproveEnabled = async (existingConn) => {
  const value = await getSetting(AUTO_APPROVE_KEY, existingConn);
  return value === 'true';
};

/**
 * Returns the public app-config shape consumed by the admin UI.
 * @returns {Promise<Object>}
 */
const getConfig = async () => ({
  autoApproveOnboarding: await isAutoApproveEnabled(),
  // The clock every category schedule is read against. Reported as the
  // effective value, so a blank or unknown setting shows what is ACTUALLY in
  // use rather than an empty box that implies no schedule is running.
  timezone: (await getSetting(TIMEZONE_KEY)) || CLOCK.DEFAULT_TIMEZONE,
});

/**
 * Upserts one setting key.
 * @param {string} key
 * @param {string} value
 * @param {string} updatedBy
 */
const setSetting = (key, value, updatedBy) =>
  withConnection(async (conn) => {
    await conn.execute(QUERIES.APP_SETTINGS.UPSERT, [key, value, updatedBy]);
  });

/**
 * Applies a validated config patch and returns the resulting config.
 * @param {Object} patch - e.g. { autoApproveOnboarding: true }
 * @param {string} updatedBy - Acting super-admin email.
 * @returns {Promise<Object>}
 */
const updateConfig = async (patch, updatedBy) => {
  if (patch.timezone !== undefined) {
    await setSetting(TIMEZONE_KEY, patch.timezone, updatedBy);
    // The schedule service memoises this for five minutes; without dropping it
    // here a change would appear to save and then not take effect.
    // eslint-disable-next-line global-require
    require('../poscategoryschedule/poscategoryschedule.service').forgetTimeZone();
  }
  if (patch.autoApproveOnboarding !== undefined) {
    await setSetting(
      AUTO_APPROVE_KEY,
      patch.autoApproveOnboarding ? 'true' : 'false',
      updatedBy
    );
  }
  return getConfig();
};

module.exports = {
  getSetting,
  isAutoApproveEnabled,
  getConfig,
  setSetting,
  updateConfig,
};
