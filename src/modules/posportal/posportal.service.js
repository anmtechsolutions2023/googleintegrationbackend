// src/modules/posportal/posportal.service.js
// The portal master — the aggregators that sell on our behalf.
//
// Extends BaseCRUDService like every other master in this codebase, so the
// list/read/create/update/delete behaviour, pagination and error shapes are the
// ones the rest of the app already produces. What is added here is only what is
// genuinely specific to a portal: resolving its default channel, and keeping
// credentials off every read path.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES, POS_ONLINE_CHANNEL_CODE } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * The tenant's ONLINE channel, if they have one.
 *
 * A portal sells on a channel, so a portal with no channel is a portal whose
 * listings cannot be gated. Resolved rather than required: a tenant who has not
 * created channels yet should be able to record a portal and fix the link
 * later, not be blocked at the first screen.
 *
 * @param {Object} conn
 * @param {string} tenantId
 * @returns {Promise<string|null>}
 */
const findOnlineChannelId = async (conn, tenantId) => {
  const [rows] = await conn.execute(
    'SELECT Id FROM pos_channel WHERE Code = ? AND TenantId = ? AND Active = 1 LIMIT 1',
    [POS_ONLINE_CHANNEL_CODE, tenantId],
  );
  return rows.length ? rows[0].Id : null;
};

class PosPortalService extends BaseCRUDService {
  constructor() {
    super('POS Portal', QUERIES.POS_PORTAL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.ChannelId ?? null,
      data.Adapter ?? 'manual',
      data.ColorHex ?? null,
      data.ShortCode ?? null,
      data.CommissionPct !== undefined ? data.CommissionPct : 0,
      data.CommissionAccountTypeBaseId ?? null,
      data.SettlementPaymentModeId ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.ChannelId !== undefined ? data.ChannelId : existing.ChannelId,
      data.Adapter !== undefined ? data.Adapter : existing.Adapter,
      data.ColorHex !== undefined ? data.ColorHex : existing.ColorHex,
      data.ShortCode !== undefined ? data.ShortCode : existing.ShortCode,
      data.CommissionPct !== undefined ? data.CommissionPct : existing.CommissionPct,
      data.CommissionAccountTypeBaseId !== undefined
        ? data.CommissionAccountTypeBaseId
        : existing.CommissionAccountTypeBaseId,
      data.SettlementPaymentModeId !== undefined
        ? data.SettlementPaymentModeId
        : existing.SettlementPaymentModeId,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }

  /**
   * A portal defaults to the tenant's ONLINE channel when the caller did not
   * name one, because that is what a portal always is and asking again on
   * every form is friction with one right answer.
   */
  async create(data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const ChannelId = data.ChannelId ?? (await findOnlineChannelId(connection, tenantId));
      return this.createTx(connection, { ...data, ChannelId }, tenantId, userEmail);
    });
  }

  /**
   * Deleting a portal that has taken orders would take the orders with it (the
   * FK) or be refused by the database with a message nobody can act on. Neither
   * is acceptable for a record with financial history behind it, so a portal
   * with orders is deactivated instead and the caller is told why.
   */
  async delete(id, tenantId) {
    return withConnection(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT COUNT(*) AS total FROM pos_online_order WHERE PortalId = ? AND TenantId = ?',
        [id, tenantId],
      );
      if (Number(rows[0]?.total || 0) > 0) {
        throw new HttpError(
          'This portal has orders against it. Deactivate it instead — deleting would remove their history.',
          MESSAGES.HTTP_STATUS.CONFLICT,
        );
      }
      await connection.execute(this.queries.DELETE, [id, tenantId]);
      logger.info('POS Portal deleted', { id, tenantId });
    });
  }

  /**
   * The credentials for a portal, for the OUTBOUND path only.
   *
   * Never routed: no GET returns this. The dispatch service reads it to talk to
   * the portal, and the webhook reads its own copy by portal code.
   *
   * @returns {Promise<Object|null>}
   */
  async getCredential(portalId, tenantId) {
    return withConnection(async (connection) => {
      const [rows] = await connection.execute(
        QUERIES.POS_PORTAL_CREDENTIAL.SELECT_BY_PORTAL,
        [portalId, tenantId],
      );
      return rows.length ? rows[0] : null;
    });
  }

  /**
   * Writes a portal's secrets, without ever reading them back.
   *
   * Upsert by portal, and a field the caller omitted keeps its stored value —
   * so a form that shows "••••" for an existing secret and submits nothing does
   * not blank it, which is the classic way credential screens destroy working
   * integrations.
   */
  async saveCredential(portalId, data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        QUERIES.POS_PORTAL_CREDENTIAL.SELECT_BY_PORTAL,
        [portalId, tenantId],
      );
      const existing = rows.length ? rows[0] : null;
      const pick = (key) => (data[key] !== undefined ? data[key] : existing?.[key] ?? null);

      if (!existing) {
        await connection.execute(QUERIES.POS_PORTAL_CREDENTIAL.INSERT, [
          uuidv4(), tenantId, portalId,
          data.WebhookSecret ?? null, data.ApiKey ?? null, data.ApiSecret ?? null,
          data.ApiBaseUrl ?? null, data.TokenExpiresOn ?? null,
          data.Active !== undefined ? data.Active : 1,
          userEmail, userEmail,
        ]);
      } else {
        await connection.execute(QUERIES.POS_PORTAL_CREDENTIAL.UPDATE, [
          pick('WebhookSecret'), pick('ApiKey'), pick('ApiSecret'), pick('ApiBaseUrl'),
          pick('TokenExpiresOn'),
          data.Active !== undefined ? data.Active : existing.Active,
          userEmail, existing.Id, tenantId,
        ]);
      }

      logger.info('POS Portal credential saved', { portalId, tenantId });
      // What is returned is deliberately a receipt, not the secrets.
      return { portalId, configured: true };
    });
  }
}

const service = new PosPortalService();

module.exports = {
  getAll: (tenantId, page, limit, expand) => service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  getCredential: (portalId, tenantId) => service.getCredential(portalId, tenantId),
  saveCredential: (portalId, data, tenantId, userEmail) =>
    service.saveCredential(portalId, data, tenantId, userEmail),
  findOnlineChannelId,
};
