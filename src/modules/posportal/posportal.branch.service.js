// src/modules/posportal/posportal.branch.service.js
// Which of our branches is which store on a portal — and whether it is open.
//
// Two responsibilities that genuinely belong together because they are the same
// row: the MAPPING an inbound order resolves through (portal + external store →
// our branch) and the KILL SWITCH that stops one branch taking orders from one
// portal. Separating them would mean two services reading and writing the same
// table with the same invariants.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');

class PosPortalBranchService extends BaseCRUDService {
  constructor() {
    super('POS Portal Branch', QUERIES.POS_PORTAL_BRANCH);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.PortalId ?? null,
      data.BranchDetailId ?? null,
      data.ExternalStoreId ?? null,
      data.IsOnline !== undefined ? data.IsOnline : true,
      data.PausedUntil ?? null,
      data.PauseReason ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.PortalId !== undefined ? data.PortalId : existing.PortalId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.ExternalStoreId !== undefined ? data.ExternalStoreId : existing.ExternalStoreId,
      data.IsOnline !== undefined ? data.IsOnline : existing.IsOnline,
      data.PausedUntil !== undefined ? data.PausedUntil : existing.PausedUntil,
      data.PauseReason !== undefined ? data.PauseReason : existing.PauseReason,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  /** Every store mapping for one portal, with the branch named. */
  async listByPortal(portalId, tenantId) {
    return withConnection(async (connection) => {
      const [rows] = await connection.execute(
        QUERIES.POS_PORTAL_BRANCH.SELECT_BY_PORTAL,
        [portalId, tenantId],
      );
      return rows;
    });
  }

  /**
   * Domain action: stop, or resume, taking orders here.
   *
   * Its own statement rather than a general update, for the reason a kill
   * switch usually needs one — the person reaching for it is in a rush, and a
   * full-row PUT from a stale form would silently roll back whatever else
   * changed since that form was loaded.
   *
   * `minutes` is advisory: it records when someone intended to reopen so the
   * queue can show "22 min left". IsOnline stays the truth, and nothing
   * auto-resumes — a branch that went down for a power cut should not quietly
   * start taking orders again on a timer.
   *
   * @param {string} id - pos_portal_branch id
   * @param {Object} data - { IsOnline, PauseMinutes?, PauseReason? }
   */
  async setOnline(id, data, tenantId, userPhone) {
    return withConnection(async (connection) => {
      const [rows] = await connection.execute(
        QUERIES.POS_PORTAL_BRANCH.SELECT_BY_ID, [id, tenantId],
      );
      if (!rows.length) {
        throw new HttpError('Portal branch mapping not found', MESSAGES.HTTP_STATUS.NOT_FOUND);
      }

      const isOnline = !!data.IsOnline;
      const pausedUntil = !isOnline && data.PauseMinutes
        ? new Date(Date.now() + Number(data.PauseMinutes) * 60000)
        : null;

      await connection.execute(QUERIES.POS_PORTAL_BRANCH.SET_ONLINE, [
        isOnline ? 1 : 0,
        pausedUntil,
        isOnline ? null : (data.PauseReason ?? null),
        userPhone,
        id,
        tenantId,
      ]);

      logger.info('POS Portal branch availability changed', {
        id, tenantId, isOnline, pausedUntil,
      });
      return { ...rows[0], IsOnline: isOnline ? 1 : 0, PausedUntil: pausedUntil };
    });
  }

  /**
   * Resolve an inbound order's branch.
   *
   * Returns null for an unknown store rather than throwing. The ingest pipeline
   * parks such an order as `needs_mapping` and shows it on the dashboard — an
   * order dropped because a join table was missing a row is a customer whose
   * food never arrives, and the portal will not send it again.
   */
  async findByExternalStore(conn, portalId, externalStoreId, tenantId) {
    if (!externalStoreId) return null;
    const [rows] = await conn.execute(
      QUERIES.POS_PORTAL_BRANCH.SELECT_BY_EXTERNAL_STORE,
      [portalId, externalStoreId, tenantId],
    );
    return rows.length ? rows[0] : null;
  }
}

const service = new PosPortalBranchService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
  listByPortal: (portalId, tenantId) => service.listByPortal(portalId, tenantId),
  setOnline: (id, data, tenantId, userPhone) => service.setOnline(id, data, tenantId, userPhone),
  findByExternalStore: (conn, portalId, storeId, tenantId) =>
    service.findByExternalStore(conn, portalId, storeId, tenantId),
};
