// src/modules/posqr/posqr.limits.service.js
// The diner code limits, read-only, with today's usage for this restaurant.
//
// The values live in ONE place — config/rateLimits.js, each overridable by an
// environment variable — and are not editable from any screen: they are spend
// controls on the platform's WhatsApp account, not a per-restaurant preference.
// This only reports them, so a manager can see why codes paused.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const RATE_LIMITS = require('../../config/rateLimits');

const { OTP_REQUEST, OTP_VERIFY, DINER } = RATE_LIMITS;

/** The limits as a list a screen can render row by row. */
const describeLimits = () => [
  { key: 'perPhone', label: 'Codes per mobile number', value: OTP_REQUEST.MAX_PER_PHONE, per: `${OTP_REQUEST.WINDOW_SECONDS / 60} min`, scope: 'Each number', env: 'OTP_MAX_PER_PHONE', sharedWithStaff: true },
  { key: 'perIp', label: 'Codes per device', value: OTP_REQUEST.MAX_PER_IP, per: `${OTP_REQUEST.WINDOW_SECONDS / 60} min`, scope: 'Each IP address', env: 'OTP_MAX_PER_IP', sharedWithStaff: true },
  { key: 'resend', label: 'Wait before resend', value: OTP_REQUEST.RESEND_COOLDOWN_SECONDS, per: 'seconds', scope: 'Each number', env: 'OTP_RESEND_COOLDOWN_SECONDS', sharedWithStaff: true },
  { key: 'attempts', label: 'Wrong tries per code', value: OTP_VERIFY.MAX_ATTEMPTS, per: null, scope: 'Each code', env: 'OTP_MAX_ATTEMPTS', sharedWithStaff: true },
  { key: 'ttl', label: 'Code valid for', value: OTP_VERIFY.TTL_SECONDS, per: 'seconds', scope: 'Each code', env: 'OTP_TTL_SECONDS', sharedWithStaff: true },
  { key: 'perTable', label: 'Codes per table', value: DINER.MAX_PER_TABLE, per: `${OTP_REQUEST.WINDOW_SECONDS / 60} min`, scope: 'Each QR code', env: 'DINER_MAX_PER_TABLE', sharedWithStaff: false },
  { key: 'perTenant', label: 'Codes per restaurant', value: DINER.TENANT_DAILY_CAP, per: 'day', scope: 'Each restaurant, all branches', env: 'DINER_TENANT_DAILY_CAP', sharedWithStaff: false },
  { key: 'platform', label: 'Codes, whole platform', value: DINER.DAILY_SEND_CAP, per: 'day', scope: 'All diners, never staff', env: 'DINER_DAILY_SEND_CAP', sharedWithStaff: false },
  { key: 'session', label: 'Diner session length', value: DINER.SESSION_TTL_SECONDS, per: 'seconds', scope: 'Each sign-in', env: 'DINER_SESSION_TTL_SECONDS', sharedWithStaff: false },
];

/**
 * @param {string} tenantId
 * @returns {Promise<{limits: Array<Object>, usage: {sentToday: number, tenantDailyCap: number}}>}
 */
const getLimits = (tenantId) =>
  withConnection(async (conn) => {
    const [[row]] = await conn.execute(
      QUERIES.AUTH_OTP.COUNT_DINER_SENT_TODAY_FOR_TENANT, [tenantId],
    );
    return {
      limits: describeLimits(),
      usage: { sentToday: Number(row.n) || 0, tenantDailyCap: DINER.TENANT_DAILY_CAP },
    };
  });

module.exports = { getLimits, describeLimits };
