// src/modules/posdine/dine.routes.js
// The public diner API, mounted at /api/dine.
//
// NOT behind authenticateToken — a guest at a table has no staff account. Two
// kinds of route:
//   /:token/...  — anonymous, keyed on the scanned QR token (resolve, logo,
//                  request and verify a code). Rate-limited per IP here, and
//                  per number / table / restaurant / platform in otp.policies.
//   /menu, /orders, /session — behind authenticateDiner: a diner session token
//                  signed with a DIFFERENT key from staff tokens, re-checked
//                  against the live QR code on every request.
//
// Static paths are declared BEFORE /:token so 'menu' is never read as a token.

const express = require('express');
const rateLimit = require('express-rate-limit');
const RATE_LIMITS = require('../../config/rateLimits');
const MESSAGES = require('../../config/messages');
const { authenticateDiner } = require('./dine.middleware');
const controller = require('./dine.controller');

const router = express.Router();

const isDev = process.env.NODE_ENV === 'development';
const dineLimiter = rateLimit({
  windowMs: RATE_LIMITS.HTTP.WINDOW_MS,
  max: RATE_LIMITS.DINER.HTTP_MAX_REQUESTS,
  message: MESSAGES.ERROR.RATE_LIMIT_EXCEEDED,
  standardHeaders: RATE_LIMITS.HTTP.STANDARD_HEADERS,
  legacyHeaders: RATE_LIMITS.HTTP.LEGACY_HEADERS,
  skip: () => isDev && RATE_LIMITS.HTTP.SKIP_IN_DEVELOPMENT,
});

router.use(dineLimiter);

// ── Diner session ──────────────────────────────────────────────────────────
/** GET /session — is my session still valid, and can I order? */
router.get('/session', authenticateDiner, ...controller.getSession);
/** PUT /me — a first-time guest's name (only while they are still "Guest"). */
router.put('/me', authenticateDiner, ...controller.setName);
/** GET /menu — this branch's menu for the QR channel. */
router.get('/menu', authenticateDiner, ...controller.getMenu);
/** POST /orders/quote — price a cart without placing it. */
router.post('/orders/quote', authenticateDiner, ...controller.quote);
/** GET /orders — my rounds at this table this session, with status. */
router.get('/orders', authenticateDiner, ...controller.listOrders);
/** POST /orders — place a round; it waits for staff before the kitchen sees it. */
router.post('/orders', authenticateDiner, ...controller.placeOrder);

// ── Anonymous, keyed on the scanned token ─────────────────────────────────
/** GET /:token — where am I? Branch, table, and whether ordering is on. */
router.get('/:token', ...controller.resolve);
/** GET /:token/logo — the branch logo for the landing screen. */
router.get('/:token/logo', ...controller.logo);
/** POST /:token/otp/request — send a WhatsApp code to this number. */
router.post('/:token/otp/request', ...controller.requestCode);
/** POST /:token/otp/verify — spend it; returns the diner session token. */
router.post('/:token/otp/verify', ...controller.verifyCode);

module.exports = router;
