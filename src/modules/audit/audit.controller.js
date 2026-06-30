// src/modules/audit/audit.controller.js
// Controller for audit log retrieval. Enforces 3-tier visibility:
//   SUPER_ADMIN  → all logs, all tenants, all users
//   TENANT_ADMIN → all logs within their own tenant
//   SELF (default) → only their own logs within their tenant

const Joi = require('joi');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { SCOPES, AUDIT_CATEGORIES, DEFAULTS } = require('../../config/constants');
const auditService = require('./audit.service');

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

const auditQuerySchema = Joi.object({
  // Shared filters (all tiers)
  category:  Joi.string().valid(...Object.values(AUDIT_CATEGORIES)).optional(),
  logLevel:  Joi.string().valid(...LOG_LEVELS).optional(),
  startDate: Joi.string().isoDate().optional(),
  endDate:   Joi.string().isoDate().optional(),
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(DEFAULTS.AUDIT_MAX_LIMIT).default(DEFAULTS.AUDIT_LIMIT),
  // Tenant Admin+ only
  userEmail: Joi.string().email().optional(),
  // Super Admin only
  tenantId:  Joi.string().optional(),
});

/**
 * GET /api/audit/logs
 * Query params vary by visibility tier.
 */
const getAuditLogs = async (req, res, next) => {
  try {
    logger.info('Get audit logs request', { user: req.user.email });

    const { error, value } = auditQuerySchema.validate(req.query, { abortEarly: true });
    if (error) {
      return next(new HttpError(
        `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
        MESSAGES.HTTP_STATUS.BAD_REQUEST
      ));
    }

    const isSuperAdmin  = req.user.scopes.includes(SCOPES.TENANT_SUPER_ADMIN);
    const isTenantAdmin = req.user.scopes.includes(SCOPES.TENANT_ADMIN);

    let visibilityLevel;
    let filters;

    if (isSuperAdmin) {
      visibilityLevel = 'SUPER_ADMIN';
      filters = {
        tenantId:  value.tenantId  || undefined,
        userEmail: value.userEmail || undefined,
      };
    } else if (isTenantAdmin) {
      visibilityLevel = 'TENANT_ADMIN';
      filters = {
        tenantId:  req.user.tid,
        userEmail: value.userEmail || undefined,
      };
    } else {
      visibilityLevel = 'SELF';
      filters = {
        tenantId:  req.user.tid,
        userEmail: req.user.email,
      };
    }

    // Apply shared filters for all tiers
    filters.category  = value.category  || undefined;
    filters.logLevel  = value.logLevel  || undefined;
    filters.startDate = value.startDate || undefined;
    filters.endDate   = value.endDate   || undefined;
    filters.page      = value.page;
    filters.limit     = value.limit;

    const result = await auditService.getAuditLogs(filters);

    logger.info('Audit logs retrieved', { count: result.rows.length, visibilityLevel });
    res.json({
      message: MESSAGES.SUCCESS.AUDIT_LOGS_RETRIEVED,
      logs: result.rows,
      pagination: {
        total:      result.total,
        page:       result.page,
        limit:      result.limit,
        totalPages: result.totalPages,
      },
      visibilityLevel,
      appliedFilters: {
        tenantId:  filters.tenantId  || null,
        userEmail: filters.userEmail || null,
        category:  filters.category  || null,
        logLevel:  filters.logLevel  || null,
        startDate: filters.startDate || null,
        endDate:   filters.endDate   || null,
      },
    });
  } catch (error) {
    logger.error('Get audit logs controller error', error);
    next(error);
  }
};

/**
 * GET /api/audit/categories
 * Returns the valid audit category list for populating filter dropdowns.
 * Available to any authenticated user.
 */
const getCategories = (req, res) => {
  const categories = Object.entries(AUDIT_CATEGORIES).map(([key, value]) => ({
    value,
    label: key
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' '),
  }));
  res.json({ categories });
};

module.exports = { getAuditLogs, getCategories };
