// src/modules/auth/otp.service.js
// The lifecycle of a one-time code: issue it, then spend it exactly once.
//
// Two properties this file exists to guarantee:
//
//   1. A code can be spent ONCE. Not "usually once" — the consume is a
//      compare-and-set on consumed_at inside a transaction, so two verifies
//      racing on one challenge produce one session.
//
//   2. Requesting a code COSTS MONEY. Every limit is really a spend control
//      wearing a security hat, and all of them are counted in the database
//      rather than in memory.
//
// WHO may receive a code and WHICH limits apply differ by purpose (staff
// sign-in vs a diner at a table); those decisions live in otp.policies.js so
// this file stays the same for every purpose.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §7.2, §9 and QR_TABLE_ORDERING_DESIGN.md §4.2.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const config = require('../../config/config');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const { toE164, maskForLog } = require('../../utils/phone');
const { generateCode, hashCode, verifyCode, expiryFrom } = require('../../utils/otp');
const whatsapp = require('../whatsapp/whatsapp.client');
const whatsappHealth = require('../whatsapp/whatsapp.health');
const { PURPOSE, STAFF_PURPOSES, policyFor } = require('./otp.policies');

const RATE_LIMITS = require('../../config/rateLimits');

// Every throttle lives in rateLimits.js. `config.OTP` keeps only the PEPPER,
// which is a secret rather than a limit.
const OTP = config.OTP;
const { OTP_REQUEST, OTP_VERIFY } = RATE_LIMITS;

/**
 * Issues a challenge and sends the code.
 *
 * For staff sign-in the response is the SAME whether or not the number is
 * registered — same shape, same challenge id, same countdown. An unregistered
 * number is recorded and nothing is sent, which closes enumeration and removes
 * the cheapest way to run up the bill.
 *
 * @param {Object} p
 * @param {string} p.phone - As typed. Normalised here.
 * @param {string} [p.purpose] - LOGIN (default), SIGNUP or DINER.
 * @param {string} [p.ip]
 * @param {string} [p.contextRef] - DINER: the QR code (pos_table_qr.Id) asked at.
 * @param {string} [p.tenantId] - DINER: that code's tenant, for the restaurant cap.
 * @returns {Promise<{challengeId: string, expiresInSeconds: number, resendInSeconds: number}>}
 */
const requestOtp = async ({
  phone, purpose = PURPOSE.LOGIN, ip = null, contextRef = null, tenantId = null,
}) => {
  const e164 = toE164(phone);
  if (!e164) throw new HttpError(MESSAGES.ERROR.INVALID_PHONE, 400);

  const policy = policyFor(purpose);
  const ctx = { phone: e164, purpose, ip, contextRef, tenantId };

  return withConnection(async (conn) => {
    await policy.assertWithinLimits(conn, ctx);

    // An unconfigured WhatsApp is a deployment fault, not a user's. Answer 503
    // rather than letting the client's configuration assertion surface as a
    // 500 — normally unreachable, because whatsapp.health stops the process at
    // boot before anyone can reach a login screen.
    if (!whatsappHealth.isConfigured()) {
      logger.error('OTP requested while WhatsApp is unconfigured', {
        missing: whatsappHealth.missingKeys(),
      });
      throw new HttpError(MESSAGES.ERROR.OTP_UNAVAILABLE, 503);
    }

    const shouldSend = await policy.shouldSend(conn, ctx);

    // Only one code may ever be live for a number and purpose.
    await conn.execute(QUERIES.AUTH_OTP.CONSUME_LIVE_FOR_PHONE, [e164, purpose]);

    const id = uuidv4();
    const code = generateCode();
    await conn.execute(QUERIES.AUTH_OTP.INSERT, [
      id, e164, purpose,
      hashCode(code, OTP.PEPPER),
      expiryFrom(OTP_VERIFY.TTL_SECONDS),
      ip, contextRef, tenantId,
    ]);

    if (!shouldSend) {
      // Recorded, never sent. The caller cannot tell this apart from a hit.
      logger.info('OTP requested for an unknown number — nothing sent', {
        phone: maskForLog(e164),
      });
    } else {
      const sent = await whatsapp.sendOtp(e164, code);
      if (sent.ok) {
        await conn.execute(QUERIES.AUTH_OTP.SET_SENT, [sent.wamid, id]);
      } else {
        await conn.execute(QUERIES.AUTH_OTP.SET_FAILED, [
          sent.errorCode ?? 'TRANSPORT', id,
        ]);
        // 131026 means the number has no WhatsApp account: a dead end for this
        // user, and worth saying so rather than letting them retry forever.
        // Everything else is our problem and must not read as "wrong number".
        if (!sent.transportError
            && !whatsapp.isInfrastructureFailure(sent.errorCode)) {
          throw new HttpError(policy.noWhatsappMessage, 400);
        }
        throw new HttpError(MESSAGES.ERROR.OTP_SEND_FAILED, 502);
      }
    }

    return {
      challengeId: id,
      expiresInSeconds: OTP_VERIFY.TTL_SECONDS,
      resendInSeconds: OTP_REQUEST.RESEND_COOLDOWN_SECONDS,
    };
  });
};

/**
 * Spends a challenge, or explains why it could not be spent.
 *
 * Returns the verified number. Issuing the session is the caller's job — this
 * function's only promise is that the number was proven, exactly once.
 *
 * FAILURES ARE COMMITTED, THEN THROWN. The attempt counter and the lock-out
 * are writes, and withTransaction rolls back on a throw: throwing from inside
 * the transaction undid the very write that counts the wrong guess, so the
 * five-attempt ceiling never engaged. The transaction therefore returns an
 * outcome, commits, and only then is the error raised.
 *
 * @param {Object} p
 * @param {string} p.challengeId
 * @param {string} p.code
 * @param {string[]} [p.expectedPurposes] - Which purposes this caller may spend.
 *        Defaults to staff sign-in, so no existing caller can spend a DINER code.
 * @param {string} [p.contextRef] - When set, the challenge must have been
 *        requested at this QR code (a code asked for at table 4 cannot open a
 *        session at table 9).
 * @returns {Promise<{phone: string, purpose: string, tenantId: string|null}>}
 */
const verifyOtp = async ({
  challengeId, code, expectedPurposes = STAFF_PURPOSES, contextRef = null,
}) => {
  const outcome = await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.AUTH_OTP.SELECT_LIVE_BY_ID, [String(challengeId || '')],
    );
    // Consumed, expired, never existed, issued for another purpose or at
    // another table — all one answer. Distinguishing them tells an attacker
    // which challenge ids are real.
    if (rows.length === 0) return { error: MESSAGES.ERROR.OTP_EXPIRED, status: 410 };
    const challenge = rows[0];
    if (!expectedPurposes.includes(challenge.purpose)) {
      return { error: MESSAGES.ERROR.OTP_EXPIRED, status: 410 };
    }
    if (contextRef && challenge.context_ref !== contextRef) {
      return { error: MESSAGES.ERROR.OTP_EXPIRED, status: 410 };
    }

    if (challenge.attempts >= OTP_VERIFY.MAX_ATTEMPTS) {
      await conn.execute(QUERIES.AUTH_OTP.CONSUME, [challenge.id]);
      return { error: MESSAGES.ERROR.OTP_LOCKED, status: 429 };
    }

    if (!verifyCode(code, challenge.code_hash, OTP.PEPPER)) {
      await conn.execute(QUERIES.AUTH_OTP.BUMP_ATTEMPTS, [challenge.id]);
      return { error: MESSAGES.ERROR.OTP_INVALID, status: 400 };
    }

    // The compare-and-set. Two requests can both reach here with the same live
    // row; only the one whose UPDATE matches consumed_at IS NULL may proceed.
    const [consumed] = await conn.execute(QUERIES.AUTH_OTP.CONSUME, [challenge.id]);
    if (consumed.affectedRows !== 1) {
      return { error: MESSAGES.ERROR.OTP_EXPIRED, status: 410 };
    }
    return { challenge };
  });

  if (outcome.error) throw new HttpError(outcome.error, outcome.status);

  const { challenge } = outcome;
  logger.info('OTP verified', {
    phone: maskForLog(challenge.phone), purpose: challenge.purpose,
  });
  return {
    phone: challenge.phone,
    purpose: challenge.purpose,
    tenantId: challenge.tenant_id ?? null,
  };
};

/** Delivery receipts from the webhook. Advisory: never grants anything. */
const recordDelivery = async (wamid, status, failureCode = null) =>
  withConnection(async (conn) => {
    const [r] = await conn.execute(
      QUERIES.AUTH_OTP.SET_DELIVERY_BY_WAMID,
      [status, failureCode, wamid],
    );
    return r.affectedRows > 0;
  });

module.exports = {
  requestOtp, verifyOtp, recordDelivery, PURPOSE, STAFF_PURPOSES,
};
