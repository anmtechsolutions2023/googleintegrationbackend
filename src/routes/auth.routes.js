// src/routes/auth.routes.js
const express = require('express')
const router = express.Router()
// const {
//   validateGoogleToken,
//   findOrCreateUser,
//   generateAppToken,
// } = require('../services/auth.service')
// const { HttpError } = require('../middleware/errorHandler')

// Import the new service function name
const {
  validateGoogleToken,
  findAndGetPermissions,
  generateAppToken,
} = require('../services/auth.service')
const { HttpError } = require('../middleware/errorHandler')

// router.post('/google', async (req, res, next) => {
//   const { id_token } = req.body

//   if (!id_token) {
//     return next(new HttpError('Google ID token is required.', 400))
//   }

//   try {
//     const validatedUser = await validateGoogleToken(id_token)
//     const userWithRole = await findOrCreateUser(validatedUser)
//     const appToken = generateAppToken(userWithRole)

//     res.json({
//       success: true,
//       message: 'Authentication successful. Use this token for API access.',
//       token: appToken,
//       user: {
//         email: userWithRole.email,
//         role: userWithRole.role,
//       },
//     })
//   } catch (error) {
//     error.statusCode = error.statusCode || 401
//     next(error)
//   }
// })

// module.exports = router

router.post('/google', async (req, res, next) => {
  const { id_token } = req.body

  if (!id_token) {
    return next(new HttpError('Google ID token is required.', 400))
  }

  try {
    const validatedUser = await validateGoogleToken(id_token)

    // *** CHANGE: Use the new function to get tenant ID and scopes ***
    const userPermissions = await findAndGetPermissions(validatedUser)

    const appToken = generateAppToken(userPermissions)

    res.json({
      success: true,
      message: 'Authentication successful. Use this token for API access.',
      token: appToken,
      user: {
        email: userPermissions.email,
        tenant_id: userPermissions.tenantId,
        scopes: userPermissions.permissions, // List of effective scopes
      },
    })
  } catch (error) {
    error.statusCode = error.statusCode || 401
    next(error)
  }
})

module.exports = router
