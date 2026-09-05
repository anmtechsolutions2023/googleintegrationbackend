// src/modules/whatsapp/whatsapp.webhook.controller.js
// What Meta tells us after the fact.
//
// This endpoint is OBSERVABILITY, never authentication. It can move a challenge
// from SENT to DELIVERED or FAILED; it can never create a session, consume a
// code, or identify a user. Anything arriving here was sent by a party we do
// not control, over a URL that is public by necessity.
//
// Two things it must get right:
//
//   1. Verify the signature over the RAW bytes. Re-serialising the parsed body
//      changes key order and whitespace, and the HMAC stops matching — which is
//      why the route captures req.rawBody before parsing completes.
//
//   2. Answer 200 immediately, work afterwards. Meta retries anything slow or
//      non-200, so a struggling endpoint that answers honestly gets a retry
//      storm on top of whatever was already wrong.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §8.4.

const crypto = require('crypto');
const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const otpService = require('../auth/otp.service');

const WA = config.WHATSAPP;

/**
 * Constant-time check of X-Hub-Signature-256 against the raw body.
 *
 * Keyed with the APP secret — one secret for the whole app, not per tenant.
 * Returns false rather than throwing for every malformed case: a bad signature
 * and an absent one deserve exactly the same answer.
 */
const verifySignature = (req) => {
  const header = req.get('X-Hub-Signature-256') || '';
  if (!header.startsWith('sha256=') || !WA.APP_SECRET || !req.rawBody) return false;

  const expected = crypto
    .createHmac('sha256', WA.APP_SECRET)
    .update(req.rawBody, 'utf8')
    .digest('hex');
  const given = header.slice('sha256='.length);

  if (given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(given, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
};

/**
 * GET — Meta's subscription challenge.
 *
 * Answers with hub.challenge as PLAIN TEXT. Wrapping it in JSON fails
 * verification in a way the console reports only as "could not validate".
 */
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === WA.WEBHOOK_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook subscription verified');
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }

  logger.warn('WhatsApp webhook subscription rejected', { mode });
  return res.sendStatus(403);
};

/** Meta's status vocabulary, mapped onto the column's enum. */
const STATUS_MAP = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Walks the envelope and applies each delivery receipt. */
const applyStatuses = async (body) => {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const status of change?.value?.statuses ?? []) {
        const mapped = STATUS_MAP[status.status];
        if (!mapped || !status.id) continue;

        const failureCode = status.errors?.[0]?.code != null
          ? String(status.errors[0].code)
          : null;

        const matched = await otpService.recordDelivery(status.id, mapped, failureCode);
        if (!matched) {
          // Normal: receipts arrive for messages this table never tracked, and
          // for challenges long since pruned. Not an error, but worth seeing if
          // it becomes the common case.
          logger.debug('Delivery receipt matched no challenge', { wamid: status.id });
        }
      }
    }
  }
};

/**
 * POST — delivery receipts.
 *
 * Always 200 once the signature is good, including when processing fails.
 * Meta cannot fix anything on our side by resending, and a retry loop against
 * a broken handler only adds load to an incident.
 */
const receiveWebhook = (req, res) => {
  if (!verifySignature(req)) {
    logger.warn('WhatsApp webhook signature rejected', { ip: req.ip });
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  // Deliberately after the response, and deliberately not awaited.
  applyStatuses(req.body).catch((err) => {
    logger.error('WhatsApp webhook processing failed', { error: err.message });
  });
};

module.exports = { verifyWebhook, receiveWebhook, verifySignature };
