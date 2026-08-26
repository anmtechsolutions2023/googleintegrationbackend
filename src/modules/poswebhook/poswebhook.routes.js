// src/modules/poswebhook/poswebhook.routes.js
// Where portal orders arrive.
//
// ── This router is deliberately unlike every other one ──────────────────────
//   - No authenticateToken. An aggregator has no user and no session; the
//     signature IS the authentication (see poswebhook.auth.js).
//   - Its own body parser, capturing the RAW bytes. Signatures are computed
//     over exactly what was sent — re-serializing the parsed JSON changes key
//     order and whitespace and the digest stops matching.
//   - Its own rate limit. It is the one publicly reachable POST in the app, so
//     it does not get to share the app-wide assumptions.
//   - It answers fast and it answers 200 generously. Aggregators retry hard and
//     de-register endpoints that are slow or flaky; a 500 for a problem only we
//     can fix (an unmapped store) would make them stop sending, which is worse
//     than accepting the order and parking it for a human.

const express = require('express');

const router = express.Router();
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const { asyncHandler } = require('../../utils/controllerHelper');
const { authenticatePortalRequest, loadVerifiedPortal } = require('./poswebhook.auth');
const { ingest } = require('../posportal/posportal.ingest.service');

// ── Rate limit ──────────────────────────────────────────────────────────────
// Deliberately in-process and dependency-free: this exists to stop one noisy or
// hostile caller monopolising the pool, not to be a distributed quota. It is
// keyed per portal code so a busy Zomato cannot starve Swiggy.
//
// The ceiling is generous. A branch at Friday dinner peak takes single-digit
// orders a minute; several hundred a minute is far above any real load and far
// below what would hurt.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 600;
const buckets = new Map();

const rateLimit = (req, res, next) => {
  const key = String(req.params.code || 'unknown').toUpperCase();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.start > WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > MAX_PER_WINDOW) {
    logger.warn('Portal webhook rate limited', { code: key, count: bucket.count });
    return res.status(MESSAGES.HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many requests',
    });
  }
  return next();
};

// Captures the exact bytes alongside the parsed body. `verify` runs before
// parsing completes, which is the only hook that sees the raw buffer.
const rawJson = express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});

/**
 * POST /:code — one inbound event from a portal.
 *
 * Answers 200 for anything the portal cannot fix, including an order we could
 * not map. The body says what happened so an integration can be debugged, but
 * the STATUS CODE is about whether the portal should retry — and for an unknown
 * store, it should not: retrying will not create the mapping.
 */
router.post('/:code', rateLimit, rawJson, asyncHandler(async (req, res) => {
  const { code } = req.params;

  const auth = await authenticatePortalRequest(req, code);
  if (!auth) {
    // One message for "no such portal" and "bad signature" alike: distinguishing
    // them tells an attacker which half to keep working on.
    return res.status(MESSAGES.HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid signature',
    });
  }

  const portal = await loadVerifiedPortal(auth.portal.Id, auth.tenantId);
  if (!portal) {
    logger.error('Portal verified but could not be read back', {
      portalId: auth.portal.Id, tenantId: auth.tenantId,
    });
    return res.status(MESSAGES.HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid signature',
    });
  }

  const result = await ingest({
    portal,
    payload: req.body,
    rawBody: req.rawBody,
    tenantId: auth.tenantId,
    userEmail: `portal:${portal.Code}`,
  });

  logger.info('Portal webhook handled', {
    code, tenantId: auth.tenantId, status: result.status,
  });

  // 200 for processed, duplicate AND needs_mapping — see the note above.
  return res.status(MESSAGES.HTTP_STATUS.OK).json({
    success: true,
    message: `Event ${result.status}`,
    data: {
      status: result.status,
      orderId: result.onlineOrderId,
      duplicate: result.duplicate,
    },
  });
}));

module.exports = router;
