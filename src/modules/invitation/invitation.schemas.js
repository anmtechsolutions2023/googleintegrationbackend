// src/modules/invitation/invitation.schemas.js
// Joi validation for tenant invitations.

const Joi = require('joi');
const { phoneField } = require('../../utils/phoneSchema');

// The tenancy is NOT accepted here. It comes from req.user.tid so a tenant
// admin can only invite into their own — the same mistake the approval
// endpoints made by trusting a tenantId in the body.
const createInvitationSchema = Joi.object({
  phone: phoneField().required(),
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
  //
  // fullName is REQUIRED, unlike the email era. user_tenants.full_name is now
  // NOT NULL because a bare '+919876543210' identifies nobody in a user list,
  // an audit trail or a tenant switcher — an address at least usually carried a
  // name inside it. Allowing null here would fail at the INSERT instead.
  fullName: Joi.string().max(100).required().trim(),
  branchDetailId: Joi.string().uuid().allow(null, ''),
  // NOTE: there is deliberately no second `phone` key here. There used to be —
  // a staff-profile field beside the identity — and when the identity was
  // renamed to `phone` the two collided. Joi keeps the LAST definition, so the
  // duplicate silently replaced phoneField() with a plain string: invitations
  // would have been stored un-normalised, and every claim-at-login lookup would
  // have missed. The staff-profile column is gone; the identity is the number.
});

const invitationIdParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createInvitationSchema, invitationIdParamSchema };
