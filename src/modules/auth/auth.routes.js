// src/modules/auth/auth.routes.js
// Authentication routes. Thin layer that delegates to controllers.

const express = require('express');
const rateLimit = require('express-rate-limit');
const RATE_LIMITS = require('../../config/rateLimits');
const MESSAGES = require('../../config/messages');
const router = express.Router();
const authController = require('./auth.controller');

// Coarse per-IP limiter, unchanged from the Google era. It is NOT the spend
// control — that lives in otp.service, counted in the database, because this
// one is per-instance, resets on deploy, and is skipped entirely in
// development. A limiter with those three properties can guard an endpoint but
// must never be the only thing standing between an open route and an invoice.
const isDev = process.env.NODE_ENV === 'development';
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.HTTP.WINDOW_MS,
  max: RATE_LIMITS.HTTP.MAX_REQUESTS,
  message: MESSAGES.ERROR.RATE_LIMIT_EXCEEDED,
  standardHeaders: RATE_LIMITS.HTTP.STANDARD_HEADERS,
  legacyHeaders: RATE_LIMITS.HTTP.LEGACY_HEADERS,
  skip: () => isDev && RATE_LIMITS.HTTP.SKIP_IN_DEVELOPMENT,
});

/**
 * POST /api/auth/otp/request
 * Sends a one-time code over WhatsApp. Answers identically for a registered
 * and an unregistered number.
 */
router.post('/otp/request', authLimiter, authController.requestOtp);

/**
 * POST /api/auth/otp/verify
 * Spends the code and returns a session token.
 */
router.post('/otp/verify', authLimiter, authController.verifyOtp);

module.exports = router;
