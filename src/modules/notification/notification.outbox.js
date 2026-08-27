// src/modules/notification/notification.outbox.js
// An intent to tell somebody, made as durable as the thing that caused it.
//
// ── The rule this file exists to enforce ────────────────────────────────────
// A notification must NEVER participate in the transaction that triggered it.
// If a refund called a mail provider inline, a provider timeout would roll the
// refund back — and a refund that silently un-happened because SMTP hung is a
// far worse failure than a late email.
//
// So the transaction writes a ROW. That is the transactional-outbox pattern,
// and it is the only safe shape here: the intent commits atomically with the
// refund, and delivery happens somewhere else, later, with retries.
//
// ── There is deliberately no worker ─────────────────────────────────────────
// This system has no mail transport, no SMS provider and no job runner —
// nodemailer, twilio, sendgrid, bull and agenda are all absent from
// package.json. Building any of them is a subsystem of its own and larger than
// the feature that needed it.
//
// The rows are written anyway, from day one, for two reasons: nothing is lost
// in the meantime, and when a worker is eventually built it drains a real
// backlog rather than starting cold with no history. `readSource` below is what
// makes the queue observable in the meantime.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const { withConnection } = require('../../utils/dbHelper');
const { logger } = require('../../utils/logger');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Record an intent to notify, on the CALLER'S transaction.
 *
 * Never throws for a reason the caller should care about: this must not be able
 * to fail a refund. A row that could not be written is logged and swallowed —
 * losing a notification is bad, losing the refund is worse.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {Object} event
 * @param {string} event.eventType  - RETURN_RECORDED | REFUND_SETTLED | …
 * @param {string} event.audience   - 'customer' | 'manager' | 'frontdesk'
 * @param {string} [event.sourceType]
 * @param {string} [event.sourceId]
 * @param {Object} [event.payload]  - Everything the template will need, captured
 *   AT WRITE TIME: a worker that re-read the document later could render a
 *   message describing a state the event never had.
 * @returns {Promise<string|null>} The outbox row id, or null if it could not be written.
 */
const enqueueTx = async (conn, event, tenantId, userEmail) => {
  const id = uuidv4();
  try {
    await conn.execute(QUERIES.NOTIFICATION_OUTBOX.INSERT, [
      id, tenantId,
      event.eventType,
      event.audience || 'customer',
      event.sourceType ?? null,
      event.sourceId ?? null,
      toJson(event.payload ?? {}),
      userEmail, userEmail,
    ]);
    return id;
  } catch (err) {
    logger.warn('Notification outbox write failed — the triggering work is unaffected', {
      eventType: event.eventType, tenantId, error: err.message,
    });
    return null;
  }
};

/**
 * What was queued about one document. The observability half of "there is no
 * worker yet": a manager can still see that a customer was due to be told.
 */
const readSource = async (sourceType, sourceId, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(
    QUERIES.NOTIFICATION_OUTBOX.SELECT_BY_SOURCE, [tenantId, sourceType, sourceId],
  );
  return rows;
});

module.exports = { enqueueTx, readSource };
