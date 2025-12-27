// src/middleware/authMiddleware.js
// Middleware for JWT authentication and scope-based authorization.
// Handles token verification and permission checks for multi-tenant access.

const jwt = require('jsonwebtoken')
const { HttpError } = require('./errorHandler')
const MESSAGES = require('../config/messages')

const JWT_SECRET = process.env.JWT_SECRET

/**
 * Middleware to authenticate JWT tokens.
 * Verifies the token and attaches user info to req.user.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next function.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return next(new HttpError(MESSAGES.ERROR.INVALID_TOKEN, 401))
  }

  try {
    const user = jwt.verify(token, JWT_SECRET)
    // Ensure token has expected payload for multi-tenancy
    if (!user.tid || !Array.isArray(user.scopes)) {
      throw new Error('Token payload missing tenant ID or scopes.')
    }
    req.user = user
    next()
  } catch (error) {
    return next(new HttpError(MESSAGES.ERROR.INVALID_TOKEN, 403))
  }
}

/**
 * Middleware to check if the user has at least one of the required scopes.
 * @param {...string} requiredScopes - The scopes required for access (e.g., 'TENANT:ADMIN').
 * @returns {Function} Middleware function.
 */
const checkScope = (...requiredScopes) => {
  return (req, res, next) => {
    const userScopes = req.user.scopes

    if (!userScopes || userScopes.length === 0) {
      return next(
        new HttpError(
          `${MESSAGES.ERROR.FORBIDDEN_NO_SCOPES}${req.user.tid}.`,
          403
        )
      )
    }

    const hasAccess = requiredScopes.some((scope) => userScopes.includes(scope))

    if (hasAccess) {
      next()
    } else {
      return next(
        new HttpError(
          `${MESSAGES.ERROR.FORBIDDEN_MISSING_SCOPE}[${requiredScopes.join(
            ', '
          )}].`,
          403
        )
      )
    }
  }
}

module.exports = {
  authenticateToken,
  checkScope,
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
