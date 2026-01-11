// src/routes/auth.routes.js
// Authentication routes.
// Thin layer that delegates to controllers.

const express = require('express')
const rateLimit = require('express-rate-limit')
const config = require('../config/config')
const MESSAGES = require('../config/messages')
const router = express.Router()
const authController = require('../controllers/auth.controller')

// Rate limiter for auth routes - see src/config/config.js for settings
const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT.AUTH_WINDOW_MS,
  max: config.RATE_LIMIT.AUTH_MAX_REQUESTS,
  message: MESSAGES.ERROR.RATE_LIMIT_EXCEEDED,
  standardHeaders: config.RATE_LIMIT.STANDARD_HEADERS,
  legacyHeaders: config.RATE_LIMIT.LEGACY_HEADERS,
})

/**
 * POST /api/auth/google
 * Authenticates user via Google ID token.
 */
router.post('/google', authLimiter, authController.googleAuth)

module.exports = router
