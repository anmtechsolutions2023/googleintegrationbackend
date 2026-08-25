// src/modules/invitation/invitation.controller.js
// HTTP layer for tenant invitations.

const service = require('./invitation.service');
const { asyncHandler, extractUserContext } = require('../../utils/controllerHelper');
const { successResponse, createdResponse, noContentResponse } = require('../../utils/responseHelper');
const { validateBody, validateParams } = require('../../middleware/validation');
const { createInvitationSchema, invitationIdParamSchema } = require('./invitation.schemas');
const { logger } = require('../../utils/logger');

// Every handler takes its tenancy from the TOKEN. Nothing here reads a tenant
// id from the request — that is what keeps a tenant admin inside their own
// tenancy without a further check.
const create = asyncHandler(async (req, res) => {
  const { userEmail, tenantId } = extractUserContext(req);
  const { email, roleIds, isAdmin, fullName, phone, branchDetailId } = req.validatedBody;
  logger.info('Invitation.create called', { tenantId, email, isAdmin });

  const invitation = await service.createInvitation({
    tenantId, email, roleIds, isAdmin,
    profile: { fullName, phone, branchDetailId },
    invitedBy: userEmail,
  });
  createdResponse(res, invitation, 'Invitation sent');
});

const list = asyncHandler(async (req, res) => {
  const { tenantId } = extractUserContext(req);
  const invitations = await service.listInvitations(tenantId);
  successResponse(res, 'Invitations retrieved', invitations);
});

const revoke = asyncHandler(async (req, res) => {
  const { tenantId } = extractUserContext(req);
  logger.info('Invitation.revoke called', { tenantId, id: req.params.id });
  await service.revokeInvitation(req.params.id, tenantId);
  noContentResponse(res, 'Invitation revoked');
});

module.exports = {
  create: [validateBody(createInvitationSchema), create],
  list: [list],
  revoke: [validateParams(invitationIdParamSchema), revoke],
};
