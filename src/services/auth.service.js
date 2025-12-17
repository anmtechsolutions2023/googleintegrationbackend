// src/services/auth.service.js
const { OAuth2Client } = require('google-auth-library')
const jwt = require('jsonwebtoken')
const db = require('../config/db')
require('dotenv').config()

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const JWT_SECRET = process.env.JWT_SECRET
const GOOGLE_OAUTH2_CLIENT = new OAuth2Client(GOOGLE_CLIENT_ID)

const validateGoogleToken = async (idToken) => {
  try {
    const ticket = await GOOGLE_OAUTH2_CLIENT.verifyIdToken({
      idToken: idToken,
      audience: GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()

    if (!payload || !payload.email) {
      throw new Error('Invalid token payload or missing email.')
    }

    return { email: payload.email, name: payload.name, googleId: payload.sub }
  } catch (error) {
    throw new Error(`Google token validation failed: ${error.message}`)
  }
}

/**
 * 2. Find and select a tenant, then retrieve the user's permissions (scopes) for that tenant.
 * @param {object} userData - Data from validated Google token.
 * @returns {object} { user: ..., tenantId: ..., permissions: [...] }
 */
const findAndGetPermissions = async (userData) => {
  console.log('Inside findAndGetPermissions with userData:', userData)
  const connection = await db.getConnection()
  try {
    // let [rows] = await connection.execute(
    //   'SELECT email, name, role FROM users WHERE email = ?',
    //   [userData.email]
    // )

    // if (rows.length > 0) {
    //   return rows[0]
    // } else {
    //   const defaultRole = 'viewer'
    //   const query =
    //     'INSERT INTO users (google_id, email, name, role) VALUES (?, ?, ?, ?)'
    //   await connection.execute(query, [
    //     userData.googleId,
    //     userData.email,
    //     userData.name,
    //     defaultRole,
    //   ])

    //   return { email: userData.email, name: userData.name, role: defaultRole }
    // }
    const userEmail = userData.email

    // Step 1: Find all tenants associated with the user
    const [tenantRows] = await connection.execute(
      'SELECT tenant_id, is_admin FROM user_tenants WHERE user_email = ? AND is_active = TRUE',
      [userEmail]
    )

    if (tenantRows.length === 0) {
      throw new Error('User is not associated with any active tenant.')
    }

    // --- Simplified Logic: Automatically select the first tenant (or an admin tenant) ---
    // In a real app, the client would send the desired tenant_id.
    // For this demo, we auto-select the first one found.
    const selectedTenant = tenantRows[0]
    const tenantId = selectedTenant.tenant_id

    // Step 2: Retrieve all active features (scopes) for the selected tenant
    const permissionsQuery = `
            SELECT f.feature_short_name, f.scope
            FROM features f
            JOIN tenant_features tf ON f.feature_id = tf.feature_id
            WHERE tf.tenant_id = ? AND tf.is_active = TRUE AND f.is_active = TRUE
        `
    const [featureRows] = await connection.execute(permissionsQuery, [tenantId])

    // Transform into a programmatic scope list (e.g., ['reports:READ', 'billing:WRITE'])
    const permissions = featureRows.map(
      (row) => `${row.feature_short_name}:${row.scope}`
    )

    // Add 'ADMIN' scope if the user is an admin for this tenant
    if (selectedTenant.is_admin) {
      permissions.push('TENANT:ADMIN')
    }

    return {
      email: userEmail,
      name: userData.name,
      tenantId,
      permissions,
    }
  } catch (error) {
    console.error('Multi-Tenant Auth Error:', error)
    throw new Error('Database operation failed during authentication.')
  } finally {
    connection.release()
  }
}

// const generateAppToken = (user) => {
//   const appPayload = {
//     email: user.email,
//     name: user.name,
//     role: user.role,
//     iss: 'MyAppServer',
//   }

//   return jwt.sign(appPayload, JWT_SECRET, { expiresIn: '1h' })
// }

/**
 * 3. Generates a new internal application JWT including the tenant ID and permissions array.
 */
const generateAppToken = (userPermissions) => {
  const appPayload = {
    email: userPermissions.email,
    name: userPermissions.name,
    tid: userPermissions.tenantId, // The current active tenant ID
    scopes: userPermissions.permissions, // The list of granted permissions/scopes
    iss: 'MyAppServer',
  }

  return jwt.sign(appPayload, JWT_SECRET, { expiresIn: '1h' })
}

// module.exports = {
//   validateGoogleToken,
//   findOrCreateUser,
//   generateAppToken,
// }

module.exports = {
  validateGoogleToken,
  findAndGetPermissions,
  generateAppToken,
}
