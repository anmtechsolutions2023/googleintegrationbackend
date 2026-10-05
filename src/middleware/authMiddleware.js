// src/middleware/authMiddleware.js
// Middleware for JWT authentication and scope-based authorization.
// Handles token verification and permission checks for multi-tenant access.

const jwt = require('jsonwebtoken')
const { HttpError } = require('./errorHandler')
const MESSAGES = require('../config/messages')
const { JWT_SECRET } = require('../config/envConfig')
const { SCOPES } = require('../config/constants')
const liveAccess = require('./liveAccess')

/**
 * Middleware to authenticate JWT tokens.
 * Verifies the token, attaches user info to req.user, and — for a tenant
 * member — replaces the token's scopes with their access as it stands now
 * (see liveAccess). A token that fails verification is 401, the status the
 * browser treats as "sign in again"; it used to be 403, which left a user with
 * a dead token signed in and every call refused.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next function.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers[MESSAGES.HTTP_HEADER.AUTHORIZATION]
  const token =
    authHeader && authHeader.split(' ')[MESSAGES.HTTP_HEADER.BEARER_SPLIT_INDEX]

  if (!token) {
    return next(
      new HttpError(
        MESSAGES.ERROR.INVALID_TOKEN,
        MESSAGES.HTTP_STATUS.UNAUTHORIZED
      )
    )
  }

  let user
  try {
    user = jwt.verify(token, JWT_SECRET)
    // null tid is valid for guest tokens; only undefined means malformed
    if (user.tid === undefined || !Array.isArray(user.scopes)) {
      throw new Error(MESSAGES.ERROR.INVALID_TOKEN_PAYLOAD)
    }
  } catch {
    return next(
      new HttpError(
        MESSAGES.ERROR.INVALID_TOKEN,
        MESSAGES.HTTP_STATUS.UNAUTHORIZED
      )
    )
  }
  req.user = user

  // Outside the try: an error thrown further down the chain is that handler's
  // error, not a bad token, and must not be reported as one.
  if (!liveAccess.applies(user)) return next()
  liveAccess.refresh(req, res).then(() => next(), next)
}

/**
 * Middleware to check if the user has at least one of the required scopes.
 * @param {...string} requiredScopes - The scopes required for access (e.g., 'TENANT:ADMIN').
 * @returns {Function} Middleware function.
 */
const checkScope = (...requiredScopes) => {
  return (req, res, next) => {
    const userScopes = req.user && req.user.scopes

    if (!userScopes || userScopes.length === 0) {
      return next(
        new HttpError(
          `${MESSAGES.ERROR.FORBIDDEN_NO_SCOPES}${req.user.tid}.`,
          MESSAGES.HTTP_STATUS.FORBIDDEN
        )
      )
    }

    // Super admin bypass: a scope like TENANT:SUPER_ADMIN grants all access
    if (userScopes.includes(SCOPES.TENANT_SUPER_ADMIN)) {
      return next()
    }

    const hasAccess = requiredScopes.some((scope) => userScopes.includes(scope))

    if (hasAccess) {
      return next()
    } else {
      return next(
        new HttpError(
          `${MESSAGES.ERROR.FORBIDDEN_MISSING_SCOPE}[${requiredScopes.join(
            ', '
          )}].`,
          MESSAGES.HTTP_STATUS.FORBIDDEN
        )
      )
    }
  }
}

/**
 * Middleware that only allows users with the guest:explore scope.
 * Blocks approved users from hitting onboarding-only endpoints.
 */
const checkGuestScope = (req, res, next) => {
  const userScopes = req.user && req.user.scopes
  if (!userScopes || !userScopes.includes(SCOPES.GUEST_EXPLORE)) {
    return next(
      new HttpError(
        `${MESSAGES.ERROR.FORBIDDEN_MISSING_SCOPE}[${SCOPES.GUEST_EXPLORE}].`,
        MESSAGES.HTTP_STATUS.FORBIDDEN
      )
    )
  }
  next()
}

module.exports = {
  authenticateToken,
  checkScope,
  checkGuestScope,
}

// /**
//  * 2. Custom Authorization Check based on Role/Scope.
//  */
// const authorizeRole = (requiredRoles) => {
//   return (req, res, next) => {
//     const userRole = req.user.role

//     if (!userRole) {
//       return next(new HttpError('Role information missing in token.', 401))
//     }

//     if (requiredRoles.includes(userRole)) {
//       next()
//     } else {
//       return next(
//         new HttpError(
//           `Forbidden. Role '${userRole}' does not have the required access scope.`,
//           403
//         )
//       )
//     }
//   }
// }

// module.exports = {
//   authenticateToken,
//   authorizeRole,
// }
// src/
