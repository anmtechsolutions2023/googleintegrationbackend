// src/middleware/authMiddleware.js (UPDATED)
const jwt = require('jsonwebtoken')
const { HttpError } = require('./errorHandler')
require('dotenv').config()

const JWT_SECRET = process.env.JWT_SECRET

// 1. (authenticateToken remains the same)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return next(
      new HttpError('Access denied. No application token provided.', 401)
    )
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
    return next(new HttpError('Invalid or expired application token.', 403))
  }
}

/**
 * 2. NEW Authorization Check: Verifies if the user's token has the required feature scope.
 * @param {string} requiredScope - The specific scope needed (e.g., 'reports:WRITE', 'TENANT:ADMIN').
 */
const checkScope = (requiredScope) => {
  return (req, res, next) => {
    const userScopes = req.user.scopes

    if (!userScopes || userScopes.length === 0) {
      return next(
        new HttpError(
          `Forbidden. No active permissions found for tenant ${req.user.tid}.`,
          403
        )
      )
    }

    // // Check if the required scope is present in the user's granted scopes array
    // if (userScopes.includes(requiredScope)) {
    //   next()
    // } else {
    //   return next(
    //     new HttpError(
    //       `Forbidden. Missing required scope: ${requiredScope}.`,
    //       403
    //     )
    //   )
    // }

    // requiredScopes is now an array of strings passed from the route
    const hasAccess = requiredScope.some((scope) => userScopes.includes(scope))

    if (hasAccess) {
      next()
    } else {
      return next(
        new HttpError(
          `Forbidden. Access requires one of these scopes: [${requiredScopes.join(
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
  checkScope, // Renamed and changed functionality
}

// // src/middleware/authMiddleware.js
// const jwt = require('jsonwebtoken')
// const { HttpError } = require('./errorHandler')
// require('dotenv').config()

// const JWT_SECRET = process.env.JWT_SECRET

// /**
//  * 1. Validates the internal application JWT.
//  */
// const authenticateToken = (req, res, next) => {
//   const authHeader = req.headers['authorization']
//   const token = authHeader && authHeader.split(' ')[1]

//   if (!token) {
//     return next(
//       new HttpError('Access denied. No application token provided.', 401)
//     )
//   }

//   try {
//     const user = jwt.verify(token, JWT_SECRET)
//     req.user = user
//     next()
//   } catch (error) {
//     return next(new HttpError('Invalid or expired application token.', 403))
//   }
// }

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
