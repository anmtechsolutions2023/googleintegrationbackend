// src/modules/posqr/posqr.settings.service.js
// Whether a branch's table codes work, and what a guest may do with them.
//
// Stored in pos_setting like every other per-branch switch, under the keys in
// QR_ORDERING.SETTING_KEYS. No row means the default — OFF — so a branch that
// never opted in has codes that resolve to "not active" even if someone prints
// them. Setting a value back to its default deletes the row rather than storing
// it, the same rule pos_setting follows everywhere else.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, QR_ORDERING } = require('../../config/constants');

const { SETTING_KEYS, MODES, DEFAULTS } = QR_ORDERING;
const PREFIX = 'qr.ordering.';

/**
 * Turns stored strings into the settings object every caller uses.
 * @param {Object<string,string>} stored - SettingKey → SettingValue.
 * @returns {{enabled: boolean, mode: string, canOrder: boolean, showPhotos: boolean}}
 */
const fromStored = (stored = {}) => {
  const rawEnabled = stored[SETTING_KEYS.ENABLED];
  const enabled = rawEnabled === undefined ? DEFAULTS.ENABLED : rawEnabled === 'true';
  const rawMode = stored[SETTING_KEYS.MODE];
  const mode = Object.values(MODES).includes(rawMode) ? rawMode : DEFAULTS.MODE;
  const rawPhotos = stored[SETTING_KEYS.SHOW_PHOTOS];
  const showPhotos = rawPhotos === undefined ? DEFAULTS.SHOW_PHOTOS : rawPhotos === 'true';
  return { enabled, mode, canOrder: enabled && mode === MODES.ORDER, showPhotos };
};

/** On an open connection, so the diner resolve reads it with its other lookups. */
const getSettingsTx = async (conn, branchId, tenantId) => {
  const [rows] = await conn.execute(QUERIES.POS_SETTING.SELECT_BY_PREFIX, [
    tenantId, branchId, PREFIX,
  ]);
  const stored = {};
  rows.forEach((r) => { stored[r.SettingKey] = r.SettingValue; });
  return fromStored(stored);
};

const getSettings = (branchId, tenantId) =>
  withConnection((conn) => getSettingsTx(conn, branchId, tenantId));

/**
 * Applies a partial change. A value equal to its default removes the override.
 * @param {string} branchId
 * @param {{enabled?: boolean, mode?: string, showPhotos?: boolean}} patch - Already validated.
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<{enabled: boolean, mode: string, canOrder: boolean}>}
 */
const setSettings = async (branchId, patch, tenantId, userPhone) =>
  withConnection(async (conn) => {
    const writes = [];
    if (patch.enabled !== undefined) {
      writes.push([SETTING_KEYS.ENABLED, patch.enabled, DEFAULTS.ENABLED]);
    }
    if (patch.mode !== undefined) {
      writes.push([SETTING_KEYS.MODE, patch.mode, DEFAULTS.MODE]);
    }
    if (patch.showPhotos !== undefined) {
      writes.push([SETTING_KEYS.SHOW_PHOTOS, patch.showPhotos, DEFAULTS.SHOW_PHOTOS]);
    }
    for (const [key, value, fallback] of writes) {
      if (value === fallback) {
        await conn.execute(QUERIES.POS_SETTING.DELETE_KEY, [tenantId, branchId, key]);
      } else {
        await conn.execute(QUERIES.POS_SETTING.UPSERT, [
          uuidv4(), tenantId, branchId, key, String(value), userPhone, userPhone,
        ]);
      }
    }
    return getSettingsTx(conn, branchId, tenantId);
  });

module.exports = { getSettings, getSettingsTx, setSettings, fromStored };
