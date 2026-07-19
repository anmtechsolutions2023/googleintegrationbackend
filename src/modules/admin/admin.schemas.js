// src/modules/admin/admin.schemas.js
// Joi validation schemas for all admin module endpoints.

const Joi = require('joi');

const approveRequestSchema = Joi.object({
  tenantId: Joi.string().required(),
  roleIds:  Joi.array().items(Joi.string()).min(1).required(),
});

const rejectRequestSchema = Joi.object({
  reason: Joi.string().max(500).required(),
});

// Simplified approve — roleIds optional (defaults to [])
const approveOnboardingSchema = Joi.object({
  tenantId: Joi.string().required(),
  roleIds:  Joi.array().items(Joi.string()).default([]),
});

// Reject with rejectionReason field name (frontend-facing)
const rejectOnboardingSchema = Joi.object({
  rejectionReason: Joi.string().max(500).required(),
});

const updateUserRolesSchema = Joi.object({
  roleIds: Joi.array().items(Joi.string()).required(),
});

const updateUserStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'SUSPENDED').required(),
});

const updateRolePermissionsSchema = Joi.object({
  featureIds: Joi.array().items(Joi.string()).required(),
});

const createRoleSchema = Joi.object({
  name:        Joi.string().max(100).required(),
  description: Joi.string().max(500).optional().allow(''),
});

const updateRoleSchema = Joi.object({
  name:        Joi.string().max(100).optional(),
  description: Joi.string().max(500).optional().allow(''),
  isActive:    Joi.boolean().optional(),
}).min(1);

const createFeatureSchema = Joi.object({
  featureShortName: Joi.string().max(50).uppercase().required(),
  scope:            Joi.string().max(50).uppercase().required(),
  displayName:      Joi.string().max(100).required(),
  category:         Joi.string().max(50).optional().allow(''),
  description:      Joi.string().max(500).optional().allow(''),
});

const updateFeatureSchema = Joi.object({
  displayName: Joi.string().max(100).optional(),
  scope:       Joi.string().max(50).uppercase().optional(),
  category:    Joi.string().max(50).optional().allow(''),
  description: Joi.string().max(500).optional().allow(''),
  isActive:    Joi.boolean().optional(),
}).min(1);

const listRequestsSchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL').default('PENDING'),
});

const listUsersSchema = Joi.object({
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = {
  approveRequestSchema,
  rejectRequestSchema,
  approveOnboardingSchema,
  rejectOnboardingSchema,
  updateUserRolesSchema,
  updateUserStatusSchema,
  updateRolePermissionsSchema,
  createRoleSchema,
  updateRoleSchema,
  createFeatureSchema,
  updateFeatureSchema,
  listRequestsSchema,
  listUsersSchema,
};
