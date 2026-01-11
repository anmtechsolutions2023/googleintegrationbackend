// src/controllers/protected.controller.js
// Controller layer for protected routes.
// Handles request/response logic, input validation, and error handling.

const Joi = require('joi')
const { logger } = require('../utils/logger')
const MESSAGES = require('../config/messages')
const { HttpError } = require('../middleware/errorHandler')
const protectedService = require('../services/protected.service')
const { generateAppToken } = require('../services/auth.service')

// Validation schemas
const switchTenantSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
})

const auditLogsQuerySchema = Joi.object({
  userEmail: Joi.string().email().optional(),
})

/**
 * Handles tenant switching.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const switchTenant = async (req, res, next) => {
  try {
    logger.info('Switch tenant request', { user: req.user.email })

    // Validate input
    const { error, value } = switchTenantSchema.validate(req.body)
    if (error) {
      logger.warn('Switch tenant validation failed', { error: error.details })
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      )
    }

    const { tenantId } = value
    const userEmail = req.user.email
    const userName = req.user.name

    // Call service
    const newPermissions = await protectedService.switchTenantPermissions(
      req,
      userEmail,
      tenantId,
      userName
    )
    const newToken = generateAppToken(newPermissions)

    logger.info('Tenant switched successfully', { userEmail, tenantId })
    res.json({
      success: true,
      message: `${MESSAGES.SUCCESS.TENANT_SWITCH}${tenantId}`,
      token: newToken,
    })
  } catch (error) {
    logger.error('Switch tenant controller error', error)
    next(error)
  }
}

/**
 * Handles audit logs retrieval.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const getAuditLogs = async (req, res, next) => {
  try {
    logger.info('Get audit logs request', { user: req.user.email })

    // Validate query params
    const { error, value } = auditLogsQuerySchema.validate(req.query)
    if (error) {
      logger.warn('Audit logs validation failed', { error: error.details })
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      )
    }

    // Get user tenants
    const allRows = await protectedService.getUserTenants(req.user.email)
    const adminTenants = allRows
      .filter((row) => row.tenant_id === req.user.tid && row.is_admin)
      .map((row) => row.tenant_id)

    const isAdmin = adminTenants.length > 0
    const filters = {
      tenantIds: isAdmin ? adminTenants : [req.user.tid],
      userEmail: isAdmin ? value.userEmail : req.user.email,
    }

    // Call service
    const logs = await protectedService.getAuditLogs(filters)

    logger.info('Audit logs retrieved', { count: logs.length })
    res.json({
      message: MESSAGES.SUCCESS.AUDIT_LOGS_RETRIEVED,
      logs,
      isAdmin,
      associatedTenants: allRows.map((row) => ({
        tenantId: row.tenant_id,
        isAdmin: row.is_admin,
      })),
    })
  } catch (error) {
    logger.error('Get audit logs controller error', error)
    next(error)
  }
}

/**
 * Handles general data access (placeholder for other endpoints).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getGeneralData = (req, res) => {
  logger.info('General data access', { user: req.user.email })
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.GENERAL_ACCESS}`,
    resource: 'general_info',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
}

/**
 * Handles logout (simple response).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const logout = (req, res) => {
  logger.info('User logout', { user: req.user.email })
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.LOGOUT}`,
    resource: 'logout',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
}

/**
 * Handles admin settings access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getAdminSettings = (req, res) => {
  logger.info('Admin settings access', { user: req.user.email })
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.ADMIN_ACCESS}`,
    resource: 'admin_config',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
}

/**
 * Handles reports access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getReports = (req, res) => {
  logger.info('Reports access', { user: req.user.email })
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.REPORTS_ACCESS}`,
    resource: 'reports',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
}

/**
 * Handles billing access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getBilling = (req, res) => {
  logger.info('Billing access', { user: req.user.email })
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.BILLING_ACCESS}`,
    resource: 'billing',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
}

module.exports = {
  switchTenant,
  getAuditLogs,
  getGeneralData,
  logout,
  getAdminSettings,
  getReports,
  getBilling,
}
