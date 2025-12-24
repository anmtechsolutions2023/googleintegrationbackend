// src/services/auth.service.js
const { OAuth2Client } = require('google-auth-library')
const { captureAudit } = require('../utils/logger')
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
 * Helper: Fetches scopes for a specific user-tenant membership
 */
const getScopesForTenant = async (connection, tenantId, userEmail) => {
  const permissionsQuery = `
    SELECT 
        f.scope,
        f.feature_short_name
    FROM user_tenants ut
    JOIN tenant_features tf ON ut.id = tf.user_tenants_id
    JOIN features f ON tf.feature_id = f.feature_id
    WHERE f.is_active = TRUE 
      AND tf.is_active = TRUE 
      AND ut.is_active = TRUE
      AND ut.tenant_id = ? 
      AND ut.user_email = ?
  `
  const [featureRows] = await connection.execute(permissionsQuery, [
    tenantId,
    userEmail,
  ])
  return featureRows.map((row) => `${row.feature_short_name}:${row.scope}`)
}

/**
 * 1. findAndGetPermissions (Used during Login)
 */
const findAndGetPermissions = async (req, userData) => {
  const connection = await db.getConnection()
  try {
    const userEmail = userData.email

    // Get all available tenants for this user
    const [tenantRows] = await connection.execute(
      'SELECT tenant_id, is_admin FROM user_tenants WHERE user_email = ? AND is_active = TRUE',
      [userEmail]
    )

    if (tenantRows.length === 0) {
      await captureAudit(req, null, userEmail, 'LOGIN_ATTEMPT', '403_NOT_FOUND')
      throw new Error('User is not associated with any active tenant.')
    }

    // Default to the first tenant
    const selectedTenant = tenantRows[0]
    const tenantId = selectedTenant.tenant_id

    // Get permissions for the selected tenant
    const permissions = await getScopesForTenant(
      connection,
      tenantId,
      userEmail
    )

    if (selectedTenant.is_admin) {
      permissions.push('TENANT:ADMIN')
    }

    return {
      email: userEmail,
      name: userData.name,
      tenantId,
      permissions,
      associatedTenants: tenantRows, // Added this to pass to JWT
    }
  } catch (error) {
    console.error('Multi-Tenant Auth Error:', error)
    throw error // Let the controller handle the specific error message
  } finally {
    connection.release()
  }
}

/**
 * 2. switchTenantPermissions (Used during Tenant Switch)
 * Validates target tenant and fetches new scopes.
 */
const switchTenantPermissions = async (
  req,
  userEmail,
  targetTenantId,
  userName
) => {
  const connection = await db.getConnection()
  try {
    // 1. Verify membership for the specific target tenant
    const [tenantRows] = await connection.execute(
      'SELECT tenant_id, is_admin FROM user_tenants WHERE user_email = ? AND is_active = TRUE',
      [userEmail]
    )

    const targetTenant = tenantRows.find((t) => t.tenant_id === targetTenantId)

    if (!targetTenant) {
      await captureAudit(
        req,
        null,
        userEmail,
        'SWITCH_TENANT_DENIED',
        '403_FORBIDDEN'
      )
      throw new Error('Access denied to target tenant.')
    }

    // 2. Fetch new scopes for this tenant
    const permissions = await getScopesForTenant(
      connection,
      targetTenantId,
      userEmail
    )

    if (targetTenant.is_admin) {
      permissions.push('TENANT:ADMIN')
    }

    return {
      email: userEmail,
      name: userName,
      tenantId: targetTenantId,
      permissions,
      associatedTenants: tenantRows, // Keep the list available for future switches
    }
  } catch (error) {
    console.error('Switch Tenant Error:', error)
    throw error
  } finally {
    connection.release()
  }
}

/**
 * 3. Generates the JWT with essential multi-tenant data
 */
const generateAppToken = (userPermissions) => {
  const appPayload = {
    email: userPermissions.email,
    name: userPermissions.name,
    tid: userPermissions.tenantId,
    scopes: userPermissions.permissions,
    // Ensure the array matches the format the Navbar expects: [{tenantId, isAdmin}]
    associatedTenants: userPermissions.associatedTenants.map((t) => ({
      tenantId: t.tenant_id,
      isAdmin: t.is_admin === 1 || t.is_admin === true,
    })),
    iss: 'MyAppServer',
  }

  return jwt.sign(appPayload, JWT_SECRET, { expiresIn: '1h' })
}

module.exports = {
  validateGoogleToken,
  findAndGetPermissions,
  switchTenantPermissions, // New export
  generateAppToken,
}
