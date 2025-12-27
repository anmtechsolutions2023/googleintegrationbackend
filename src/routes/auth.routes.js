// src/routes/auth.routes.js
// Routes for authentication, including Google OAuth login.
// Handles token validation, user permissions, and JWT generation.

const express = require('express')
const router = express.Router()
const { captureAudit } = require('../utils/logger')
const MESSAGES = require('../config/messages')
const { STATUSES } = require('../config/constants')

// Import the service functions
const {
  validateGoogleToken,
  findAndGetPermissions,
  generateAppToken,
} = require('../services/auth.service')
const { HttpError } = require('../middleware/errorHandler')

/**
 * POST /api/auth/google
 * Authenticates user via Google ID token, retrieves permissions, and issues JWT.
 */
router.post('/google', async (req, res, next) => {
  const { id_token } = req.body

  if (!id_token) {
    return next(new HttpError(MESSAGES.ERROR.MISSING_GOOGLE_TOKEN, 400))
  }

  try {
    const validatedUser = await validateGoogleToken(id_token)
    const userPermissions = await findAndGetPermissions(req, validatedUser)
    const appToken = generateAppToken(userPermissions)

    // LOG SUCCESS
    await captureAudit(
      req,
      userPermissions.tenantId,
      userPermissions.email,
      STATUSES.LOGIN_SUCCESS,
      STATUSES.SUCCESS
    )

    res.json({
      success: true,
      message: MESSAGES.SUCCESS.AUTH,
      token: appToken,
      user: {
        email: userPermissions.email,
        tenant_id: userPermissions.tenantId,
        scopes: userPermissions.permissions,
      },
    })
  } catch (error) {
    await captureAudit(
      req,
      null,
      'SYSTEM',
      STATUSES.LOGIN_CRASH,
      STATUSES.UNAUTHORIZED
    )
    error.statusCode = error.statusCode || 401
    next(error)
  }
})

module.exports = router
