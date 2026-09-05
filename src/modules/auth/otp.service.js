// src/modules/auth/otp.service.js
// The lifecycle of a one-time code: issue it, then spend it exactly once.
//
// Two properties this file exists to guarantee:
//
//   1. A code can be spent ONCE. Not "usually once" — the consume is a
//      compare-and-set on consumed_at inside the transaction that issues the
//      token, so two verifies racing on one challenge produce one session.
//
//   2. Requesting a code COSTS MONEY. Every limit here is really a spend
//      control wearing a security hat, and all of them are counted in the
//      database rather than in memory: an in-process counter resets on deploy
//      and is per-instance, which turns a cap into a suggestion.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §7.2 and §9.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const config = require('../../config/config');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const { toE164, maskForLog } = require('../../utils/phone');
const { generateCode, hashCode, verifyCode, expiryFrom } = require('../../utils/otp');
const appConfig = require('../appconfig/appconfig.service');
const whatsapp = require('../whatsapp/whatsapp.client');
const whatsappHealth = require('../whatsapp/whatsapp.health');

const RATE_LIMITS = require('../../config/rateLimits');

// Every throttle lives in rateLimits.js. `config.OTP` keeps only the PEPPER,
// which is a secret rather than a limit.
const OTP = config.OTP;
const { OTP_REQUEST, OTP_VERIFY, COST } = RATE_LIMITS;

const PURPOSE = { LOGIN: 'LOGIN', SIGNUP: 'SIGNUP' };

/**
 * Does this number belong to somebody who can sign in?
 *
 * A membership, or a live invitation waiting to be claimed. The invitation case
 * is what lets an invited person's FIRST sign-in work: they have no membership
 * yet, and the OTP is what proves the number is theirs.
 */
const isKnownNumber = async (conn, phone) => {
  const [members] = await conn.execute(QUERIES.USER_TENANTS.SELECT, [phone]);
  if (members.length > 0) return true;
  const [invites] = await conn.execute(QUERIES.INVITATIONS.SELECT_CLAIMABLE, [phone]);
  return invites.length > 0;
};

/** Every limit that stands between an open endpoint and your Meta invoice. */
const assertWithinLimits = async (conn, phone, ip) => {
  const [[daily]] = await conn.execute(QUERIES.AUTH_OTP.COUNT_SENT_TODAY);
  if (Number(daily.n) >= COST.DAILY_SEND_CAP) {
    // Deliberately loud: this is the circuit breaker tripping, and somebody
    // needs to know whether it is growth or abuse before it trips again.
    logger.error('OTP daily send cap reached — WhatsApp sign-in is suspended', {
      cap: COST.DAILY_SEND_CAP,
    });
    throw new HttpError(MESSAGES.ERROR.OTP_UNAVAILABLE, 503);
  }

  const [[perPhone]] = await conn.execute(
    QUERIES.AUTH_OTP.COUNT_RECENT_FOR_PHONE, [phone, OTP_REQUEST.WINDOW_SECONDS],
  );
  if (Number(perPhone.n) >= OTP_REQUEST.MAX_PER_PHONE) {
    throw new HttpError(MESSAGES.ERROR.OTP_TOO_MANY, 429);
  }

  if (ip) {
    const [[perIp]] = await conn.execute(
      QUERIES.AUTH_OTP.COUNT_RECENT_FOR_IP, [ip, OTP_REQUEST.WINDOW_SECONDS],
    );
    if (Number(perIp.n) >= OTP_REQUEST.MAX_PER_IP) {
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
 * Issues a challenge and sends the code.
 *
 * The response is the SAME whether or not the number is registered — same
 * shape, same challenge id, same countdown. An unregistered number is recorded
 * and nothing is sent, which closes enumeration and removes the cheapest way to
 * run up the bill. The cost is that a typo waits out the countdown, which is
 * what the "sign in another way" escape hatch on the login screen is for.
 *
 * @param {Object} p
 * @param {string} p.phone - As typed. Normalised here.
 * @param {string} [p.purpose] - LOGIN (default) or SIGNUP.
 * @param {string} [p.ip]
 * @returns {Promise<{challengeId: string, expiresInSeconds: number, resendInSeconds: number}>}
 */
const requestOtp = async ({ phone, purpose = PURPOSE.LOGIN, ip = null }) => {
  const e164 = toE164(phone);
  if (!e164) throw new HttpError(MESSAGES.ERROR.INVALID_PHONE, 400);

  return withConnection(async (conn) => {
    await assertWithinLimits(conn, e164, ip);

    // SIGNUP is by definition an unknown number; LOGIN must already be someone.
    // An unconfigured WhatsApp is a deployment fault, not a user's. Answer 503
    // rather than letting the client's configuration assertion surface as a
    // 500 — and normally this is unreachable, because whatsapp.health stops the
    // process at boot before anyone can reach a login screen.
    if (!whatsappHealth.isConfigured()) {
      logger.error('OTP requested while WhatsApp is unconfigured', {
        missing: whatsappHealth.missingKeys(),
      });
      throw new HttpError(MESSAGES.ERROR.OTP_UNAVAILABLE, 503);
    }

    // Who may receive a code.
    //
    // A known number always may — a membership, or a live invitation waiting to
    // be claimed, which is how an invited person's FIRST sign-in works.
    //
    // An UNKNOWN number may when self-signup is enabled, because then the
    // product's answer to "who is this stranger" is "a new tenant" rather than
    // "nobody". The same switch already governs whether they are provisioned on
    // the other side of the code, so gating the send on anything else lets the
    // two disagree: either a code that arrives and leads nowhere, or a tenancy
    // nobody can reach.
    //
    // The cost is real and deliberate: anyone with a SIM can start this, and
    // every attempt is billed before a human sees it. OTP_DAILY_SEND_CAP bounds
    // it, and the per-IP limit — which counts every request, sent or not —
    // bounds the rate.
    const selfSignupAllowed = await appConfig.isAutoApproveEnabled(conn);
    const shouldSend =
      purpose === PURPOSE.SIGNUP
      || selfSignupAllowed
      || (await isKnownNumber(conn, e164));

    // Only one code may ever be live for a number.
    await conn.execute(QUERIES.AUTH_OTP.CONSUME_LIVE_FOR_PHONE, [e164]);

    const id = uuidv4();
    const code = generateCode();
    await conn.execute(QUERIES.AUTH_OTP.INSERT, [
      id, e164, purpose,
      hashCode(code, OTP.PEPPER),
      expiryFrom(OTP_VERIFY.TTL_SECONDS),
      ip,
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
          throw new HttpError(MESSAGES.ERROR.OTP_NO_WHATSAPP, 400);
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
 * @returns {Promise<{phone: string, purpose: string}>}
 */
const verifyOtp = async ({ challengeId, code }) =>
  withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.AUTH_OTP.SELECT_LIVE_BY_ID, [String(challengeId || '')],
    );
    // Consumed, expired or never existed — all one answer. Distinguishing them
    // tells an attacker which challenge ids are real.
    if (rows.length === 0) throw new HttpError(MESSAGES.ERROR.OTP_EXPIRED, 410);

    const challenge = rows[0];

    if (challenge.attempts >= OTP_VERIFY.MAX_ATTEMPTS) {
      await conn.execute(QUERIES.AUTH_OTP.CONSUME, [challenge.id]);
      throw new HttpError(MESSAGES.ERROR.OTP_LOCKED, 429);
    }

    if (!verifyCode(code, challenge.code_hash, OTP.PEPPER)) {
      await conn.execute(QUERIES.AUTH_OTP.BUMP_ATTEMPTS, [challenge.id]);
      throw new HttpError(MESSAGES.ERROR.OTP_INVALID, 400);
    }

    // The compare-and-set. Two requests can both reach here with the same live
    // row; only the one whose UPDATE matches consumed_at IS NULL may proceed.
    const [consumed] = await conn.execute(QUERIES.AUTH_OTP.CONSUME, [challenge.id]);
    if (consumed.affectedRows !== 1) {
      throw new HttpError(MESSAGES.ERROR.OTP_EXPIRED, 410);
    }

    logger.info('OTP verified', {
      phone: maskForLog(challenge.phone), purpose: challenge.purpose,
    });
    return { phone: challenge.phone, purpose: challenge.purpose };
  });

/** Delivery receipts from the webhook. Advisory: never grants anything. */
const recordDelivery = async (wamid, status, failureCode = null) =>
  withConnection(async (conn) => {
    const [r] = await conn.execute(
      QUERIES.AUTH_OTP.SET_DELIVERY_BY_WAMID,
      [status, failureCode, wamid],
    );
    return r.affectedRows > 0;
  });

module.exports = { requestOtp, verifyOtp, recordDelivery, PURPOSE };
