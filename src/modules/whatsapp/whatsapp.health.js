// src/modules/whatsapp/whatsapp.health.js
// Fail at boot, not at the till.
//
// Sign-in is WhatsApp-only. A missing secret, a paused template or a revoked
// token means NOBODY can sign in — at every branch, at once. The difference
// between finding that out from a boot log and finding it out from a manager
// during a dinner rush is the whole point of this file.
//
// Configuration is checked synchronously and hard: a missing secret stops the
// process. Meta's own state is checked over the network and only warns, because
// a transient Graph API failure at boot must not stop a server that is
// otherwise fine — the running system degrades far better than one that will
// not start.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §8.5.

const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const client = require('./whatsapp.client');

// Two groups, because they gate different things and conflating them is wrong
// in both directions.
//
// SENDING is what sign-in depends on. Without these nobody can log in.
const REQUIRED_TO_SEND = {
  WA_PHONE_NUMBER_ID: config.WHATSAPP.PHONE_NUMBER_ID,
  WA_ACCESS_TOKEN: config.WHATSAPP.ACCESS_TOKEN,
  OTP_PEPPER: config.OTP.PEPPER,
};

// The WEBHOOK is delivery receipts only — observability, never authentication.
// Requiring these to send would refuse every login over a feature that has
// nothing to do with sending, and would make local development impossible
// without a public HTTPS tunnel nobody needs in order to receive a code.
const REQUIRED_FOR_WEBHOOK = {
  WA_APP_SECRET: config.WHATSAPP.APP_SECRET,
  WA_WEBHOOK_VERIFY_TOKEN: config.WHATSAPP.WEBHOOK_VERIFY_TOKEN,
};

/** True when a code can actually be sent. This is what gates sign-in. */
const isConfigured = () => Object.values(REQUIRED_TO_SEND).every(Boolean);

/** True when Meta's delivery receipts can be accepted and verified. */
const isWebhookConfigured = () =>
  Object.values(REQUIRED_FOR_WEBHOOK).every(Boolean);

/** Which ones are missing — for the message, never for a log of their values. */
const missingKeys = () =>
  Object.entries(REQUIRED_TO_SEND).filter(([, v]) => !v).map(([k]) => k);

const missingWebhookKeys = () =>
  Object.entries(REQUIRED_FOR_WEBHOOK).filter(([, v]) => !v).map(([k]) => k);

/**
 * Checks configuration, then Meta.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.strict=true] - Exit the process when configuration is
 *        missing. False in tests and for tooling that legitimately runs without
 *        a WhatsApp setup.
 */
const check = async ({ strict = true } = {}) => {
  const missing = missingKeys();
  if (missing.length) {
    const message =
      `WhatsApp sign-in is not configured — missing ${missing.join(', ')}. `
      + 'Nobody can sign in without these. Set them, or use `npm run admin:token` '
      + 'for break-glass access.';
    if (strict) {
      // Written straight to stderr, NOT through winston. The console transport
      // writes asynchronously, and process.exit tears the process down before
      // that flushes — so logger.error here produces an exit code 1 with a
      // completely silent log, which is worse than not checking at all.
      process.stderr.write(`\n  FATAL: ${message}\n\n`);
      process.exit(1);
    }
    logger.warn(message);
    return { ok: false, missing };
  }

  // The webhook is a separate concern: missing config there costs delivery
  // receipts, not logins, so it warns in every environment and blocks none.
  const missingHook = missingWebhookKeys();
  if (missingHook.length) {
    logger.warn(
      `WhatsApp delivery receipts are disabled — missing ${missingHook.join(', ')}. `
      + 'Sign-in still works; you just cannot tell a failed send from an unread one.',
    );
  }

  // Beyond here the process stays up whatever Meta says. A paused template is
  // a real outage, but so is refusing to start over a five-second Graph blip.
  const template = await client.getTemplateStatus();
  if (!template.ok) {
    logger.warn('Could not confirm the OTP template with Meta', {
      error: template.errorMessage,
    });
  } else if (!template.approved) {
    logger.error('OTP template is not APPROVED — sign-in will fail', {
      template: config.WHATSAPP.TEMPLATE_OTP_NAME,
      status: template.status ?? 'not found',
    });
  } else {
    logger.info('OTP template confirmed APPROVED', {
      template: config.WHATSAPP.TEMPLATE_OTP_NAME,
    });
  }

  const health = await client.getNumberHealth();
  if (health.ok) {
    const rating = health.quality_rating;
    // With no second way in, a falling rating predicts a login outage. Worth
    // hearing about on the transition, not on the first failed send.
    const log = rating && rating !== 'GREEN' ? logger.warn : logger.info;
    log.call(logger, 'WhatsApp number health', {
      name: health.verified_name, quality: rating,
    });
  }

  return { ok: true, templateApproved: !!template.approved };
};

module.exports = {
  check,
  isConfigured,
  isWebhookConfigured,
  missingKeys,
  missingWebhookKeys,
};
