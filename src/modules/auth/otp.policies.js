// src/modules/auth/otp.policies.js
// WHO may be sent a one-time code, and WHICH limits stand in front of the send —
// one policy per purpose.
//
// otp.service owns the mechanics that never vary: mint, hash, store, send,
// spend exactly once. What varies by purpose is two decisions, and they live
// here so a new purpose is a new policy rather than another branch inside the
// service (open/closed):
//
//   shouldSend        — staff sign-in answers identically for unknown numbers
//                       and sends them nothing (enumeration + cost). A diner
//                       is BY DEFINITION an unknown number, so that rule means
//                       nothing for them and they are always sent a code.
//   assertWithinLimits — every limit is a spend control. Staff and diners share
//                       the per-number, per-IP and cooldown rules, but each has
//                       its own daily breaker: when the staff one trips the POS
//                       stops letting anybody sign in, so diner traffic must
//                       never count towards it (QR_TABLE_ORDERING_DESIGN.md D4).
//
// Every count is read from auth_otp_challenge, never from memory: an in-process
// counter resets on deploy and is per-instance, which turns a cap into a
// suggestion.

const { QUERIES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const RATE_LIMITS = require('../../config/rateLimits');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const appConfig = require('../appconfig/appconfig.service');

const { OTP_REQUEST, COST, DINER } = RATE_LIMITS;

const PURPOSE = { LOGIN: 'LOGIN', SIGNUP: 'SIGNUP', DINER: 'DINER' };

/** The purposes a staff sign-in verify will accept. */
const STAFF_PURPOSES = Object.freeze([PURPOSE.LOGIN, PURPOSE.SIGNUP]);

const count = async (conn, sql, params = []) => {
  const [[row]] = await conn.execute(sql, params);
  return Number(row.n);
};

/**
 * The rules every purpose obeys: one number cannot be flooded, one device
 * cannot walk a range, and a resend waits for the last message to land.
 */
const assertSharedLimits = async (conn, { phone, ip }) => {
  const perPhone = await count(
    conn, QUERIES.AUTH_OTP.COUNT_RECENT_FOR_PHONE, [phone, OTP_REQUEST.WINDOW_SECONDS],
  );
  if (perPhone >= OTP_REQUEST.MAX_PER_PHONE) {
    throw new HttpError(MESSAGES.ERROR.OTP_TOO_MANY, 429);
  }

  if (ip) {
    const perIp = await count(
      conn, QUERIES.AUTH_OTP.COUNT_RECENT_FOR_IP, [ip, OTP_REQUEST.WINDOW_SECONDS],
    );
    if (perIp >= OTP_REQUEST.MAX_PER_IP) {
      throw new HttpError(MESSAGES.ERROR.OTP_TOO_MANY, 429);
    }
  }

  const [last] = await conn.execute(QUERIES.AUTH_OTP.SELECT_LAST_FOR_PHONE, [phone]);
  if (last.length > 0) {
    const since = (Date.now() - new Date(last[0].created_at).getTime()) / 1000;
    if (since < OTP_REQUEST.RESEND_COOLDOWN_SECONDS) {
      throw new HttpError(MESSAGES.ERROR.OTP_TOO_SOON, 429);
    }
  }
};

/**
 * Does this number belong to somebody who can sign in? A membership, or a live
 * invitation waiting to be claimed — which is how an invited person's FIRST
 * sign-in works.
 */
const isKnownNumber = async (conn, phone) => {
  const [members] = await conn.execute(QUERIES.USER_TENANTS.SELECT, [phone]);
  if (members.length > 0) return true;
  const [invites] = await conn.execute(QUERIES.INVITATIONS.SELECT_CLAIMABLE, [phone]);
  return invites.length > 0;
};

/** Staff sign-in and business sign-up. Behaviour unchanged from before policies. */
const staffPolicy = {
  noWhatsappMessage: MESSAGES.ERROR.OTP_NO_WHATSAPP,

  async assertWithinLimits(conn, ctx) {
    const sent = await count(conn, QUERIES.AUTH_OTP.COUNT_SENT_TODAY);
    if (sent >= COST.DAILY_SEND_CAP) {
      // Deliberately loud: this is the circuit breaker tripping, and somebody
      // needs to know whether it is growth or abuse before it trips again.
      logger.error('OTP daily send cap reached — WhatsApp sign-in is suspended', {
        cap: COST.DAILY_SEND_CAP,
      });
      throw new HttpError(MESSAGES.ERROR.OTP_UNAVAILABLE, 503);
    }
    await assertSharedLimits(conn, ctx);
  },

  // A known number always may. An UNKNOWN one may when self-signup is enabled,
  // because then the answer to "who is this stranger" is "a new tenant" — the
  // same switch governs whether they are provisioned on the other side of the
  // code, so gating the send on anything else lets the two disagree.
  async shouldSend(conn, { phone, purpose }) {
    if (purpose === PURPOSE.SIGNUP) return true;
    if (await appConfig.isAutoApproveEnabled(conn)) return true;
    return isKnownNumber(conn, phone);
  },
};

/** A guest at a table, verifying before they order. */
const dinerPolicy = {
  noWhatsappMessage: MESSAGES.ERROR.QR_NO_WHATSAPP,

  async assertWithinLimits(conn, ctx) {
    const { contextRef, tenantId } = ctx;

    const platform = await count(conn, QUERIES.AUTH_OTP.COUNT_DINER_SENT_TODAY);
    if (platform >= DINER.DAILY_SEND_CAP) {
      logger.error('Diner OTP daily cap reached — QR ordering codes are paused platform-wide', {
        cap: DINER.DAILY_SEND_CAP,
      });
      throw new HttpError(MESSAGES.ERROR.QR_DINER_CODES_PAUSED, 503);
    }

    if (tenantId) {
      const tenant = await count(
        conn, QUERIES.AUTH_OTP.COUNT_DINER_SENT_TODAY_FOR_TENANT, [tenantId],
      );
      if (tenant >= DINER.TENANT_DAILY_CAP) {
        logger.warn('Diner OTP cap reached for a restaurant', {
          tenantId, cap: DINER.TENANT_DAILY_CAP,
        });
        throw new HttpError(MESSAGES.ERROR.QR_DINER_CODES_PAUSED, 503);
      }
    }

    if (contextRef) {
      const perTable = await count(
        conn, QUERIES.AUTH_OTP.COUNT_RECENT_FOR_CONTEXT,
        [contextRef, OTP_REQUEST.WINDOW_SECONDS],
      );
      if (perTable >= DINER.MAX_PER_TABLE) {
        throw new HttpError(MESSAGES.ERROR.OTP_TOO_MANY, 429);
      }
    }

    await assertSharedLimits(conn, ctx);
  },

  async shouldSend() {
    return true;
  },
};

const POLICIES = {
  [PURPOSE.LOGIN]: staffPolicy,
  [PURPOSE.SIGNUP]: staffPolicy,
  [PURPOSE.DINER]: dinerPolicy,
};

/**
 * The policy for a purpose. An unknown purpose is a programming error, not a
 * user one — refusing loudly beats falling back to a policy that sends.
 * @param {string} purpose
 * @returns {{assertWithinLimits: Function, shouldSend: Function, noWhatsappMessage: string}}
 */
const policyFor = (purpose) => {
  const policy = POLICIES[purpose];
  if (!policy) throw new Error(`No OTP policy for purpose "${purpose}"`);
  return policy;
};

module.exports = {
  PURPOSE,
  STAFF_PURPOSES,
  policyFor,
  // Exported for their own tests.
  staffPolicy,
  dinerPolicy,
  assertSharedLimits,
};
