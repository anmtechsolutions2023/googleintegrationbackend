// src/modules/invitation/invitation.schemas.js
// Joi validation for tenant invitations.

const Joi = require('joi');

// The tenancy is NOT accepted here. It comes from req.user.tid so a tenant
// admin can only invite into their own — the same mistake the approval
// endpoints made by trusting a tenantId in the body.
const createInvitationSchema = Joi.object({
  email: Joi.string().email().max(255).required().lowercase().trim(),
  // Roles the invitee receives on acceptance. Optional: an invitation with no
  // roles is legitimate (a placeholder membership an admin fills in later), and
  // the acceptance path warns rather than failing.
  roleIds: Joi.array().items(Joi.string()).default([]),
  // TENANT:ADMIN comes from user_tenants.is_admin, never from a role, so
  // inviting a co-admin is only possible through this flag.
  isAdmin: Joi.boolean().default(false),
  // Staff details, applied to the membership when the invitation is claimed.
  // Adding a staff member IS inviting them, so these travel with the invite
  // rather than needing a second edit once the person appears.
  fullName: Joi.string().max(100).allow(null, '').trim(),
  phone: Joi.string().max(20).allow(null, '').trim(),
  branchDetailId: Joi.string().uuid().allow(null, ''),
});

const invitationIdParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createInvitationSchema, invitationIdParamSchema };
