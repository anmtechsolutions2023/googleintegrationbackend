// src/modules/posportal/posportal.listing.service.js
// One menu item, as one portal lists it: its name there, its price there, and
// whether it is in stock there.
//
// ── The availability gates, and why there are four ──────────────────────────
// They AND together, and each answers a different person's question:
//
//   pos_item_meta.Active        do we make this dish at this branch?
//   pos_item_meta_channel       is it sold on the online channel at all, or is
//                               it dine-in only because it does not travel?
//   pos_portal_listing.Available is it on THIS portal right now — ran out of
//                               prawns, off Zomato, still on Swiggy
//   pos_portal_branch.IsOnline  are we taking orders from this portal at all
//
// Collapsing them into one flag would make the screen lie to somebody. The
// channel gate is enforced here on write (see assertChannelGate) because it is
// the coarse switch: a listing for an item that is not sold online is a listing
// that can never legitimately take an order.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const { priceListings } = require('./posportal.pricing');

class PosPortalListingService extends BaseCRUDService {
  constructor() {
    super('POS Portal Listing', QUERIES.POS_PORTAL_LISTING);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.PortalId ?? null,
      data.ItemMetaId ?? null,
      data.ExternalItemId ?? null,
      data.ListedName ?? null,
      data.ListedDescription ?? null,
      data.PriceOverrideCostInfoId ?? null,
      data.Available !== undefined ? data.Available : true,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.LastSyncedOn ?? null,
      // A brand-new listing has never been published, so it is pending by
      // construction — not 'synced', which would claim the portal knows about a
      // dish it has never been told about.
      data.SyncStatus ?? 'pending',
      data.SyncError ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    // Any change to what the portal shows puts the listing back out of sync.
    // Deriving this rather than trusting the caller is the point: a screen that
    // forgot to send SyncStatus would otherwise leave a stale price marked
    // 'synced' and nobody would know the portal was still selling the old one.
    const touchesPortalFacingFields =
      data.ExternalItemId !== undefined
      || data.ListedName !== undefined
      || data.ListedDescription !== undefined
      || data.PriceOverrideCostInfoId !== undefined
      || data.Available !== undefined;

    return [
      data.PortalId !== undefined ? data.PortalId : existing.PortalId,
      data.ItemMetaId !== undefined ? data.ItemMetaId : existing.ItemMetaId,
      data.ExternalItemId !== undefined ? data.ExternalItemId : existing.ExternalItemId,
      data.ListedName !== undefined ? data.ListedName : existing.ListedName,
      data.ListedDescription !== undefined
        ? data.ListedDescription
        : existing.ListedDescription,
      data.PriceOverrideCostInfoId !== undefined
        ? data.PriceOverrideCostInfoId
        : existing.PriceOverrideCostInfoId,
      data.Available !== undefined ? data.Available : existing.Available,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.LastSyncedOn !== undefined ? data.LastSyncedOn : existing.LastSyncedOn,
      data.SyncStatus !== undefined
        ? data.SyncStatus
        : (touchesPortalFacingFields ? 'pending' : existing.SyncStatus),
      data.SyncError !== undefined ? data.SyncError : existing.SyncError,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  /**
   * The coarse gate: an item may only be listed on a portal if it is sold on
   * that portal's channel.
   *
   * Enforced on write rather than left to the UI, because the UI is not the
   * only writer — the CSV import and the bulk endpoint reach the same table.
   *
   * A portal with no channel is not blocked: that tenant has not set channels
   * up, and refusing every listing would make the feature unusable for them
   * rather than safer.
   */
  async assertChannelGate(conn, portalId, itemMetaId, tenantId) {
    const [portalRows] = await conn.execute(
      QUERIES.POS_PORTAL.SELECT_BY_ID, [portalId, tenantId],
    );
    if (!portalRows.length) {
      throw new HttpError('Portal not found', MESSAGES.HTTP_STATUS.NOT_FOUND);
    }
    const channelId = portalRows[0].ChannelId;
    if (!channelId) return;

    const [rows] = await conn.execute(
      QUERIES.POS_PORTAL_LISTING.COUNT_CHANNEL_LINK,
      [itemMetaId, channelId, tenantId],
    );
    if (Number(rows[0]?.total || 0) === 0) {
      throw new HttpError(
        'This item is not sold on the online channel. Enable the Online channel on the menu item before listing it on a portal.',
        MESSAGES.HTTP_STATUS.CONFLICT,
      );
    }
  }

  async create(data, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      await this.assertChannelGate(connection, data.PortalId, data.ItemMetaId, tenantId);
      return this.createTx(connection, data, tenantId, userPhone);
    });
  }

  /**
   * Listings for one portal, priced.
   *
   * Always priced, because a listing screen that shows an override id instead
   * of a price is not a screen anybody can work with — and pricing here means
   * the number shown, the number pushed and the number billed come from one
   * resolution.
   */
  async listByPortal(portalId, tenantId) {
    const rows = await withConnection(async (connection) => {
      const [result] = await connection.execute(
        `${QUERIES.POS_PORTAL_LISTING.SELECT_ALL.replace(
          'WHERE l.TenantId = ?',
          'WHERE l.TenantId = ? AND l.PortalId = ?',
        )}`,
        [tenantId, portalId],
      );
      return result;
    });
    return priceListings(rows, tenantId);
  }

  /**
   * Bulk availability, which is the operation this screen exists for.
   *
   * 200 dishes across 3 portals is 600 decisions; a PUT per row is not a
   * workflow, it is a reason the feature goes unused. One transaction so a
   * half-applied "everything with prawns is off" cannot happen.
   *
   * @param {Object} data - { ListingIds: [], Available: boolean }
   */
  async setAvailabilityBulk(data, tenantId, userPhone) {
    const ids = Array.isArray(data.ListingIds) ? data.ListingIds.filter(Boolean) : [];
    if (ids.length === 0) {
      throw new HttpError('No listings selected', MESSAGES.HTTP_STATUS.BAD_REQUEST);
    }

    return withTransaction(async (connection) => {
      const available = data.Available ? 1 : 0;
      for (const id of ids) {
        await connection.execute(QUERIES.POS_PORTAL_LISTING.SET_AVAILABILITY, [
          available, userPhone, id, tenantId,
        ]);
      }
      logger.info('POS Portal listings availability set in bulk', {
        tenantId, count: ids.length, available,
      });
      return { updated: ids.length, Available: !!data.Available };
    });
  }

  /**
   * Record what a menu push actually achieved.
   *
   * Fire-and-RECORD, never fire-and-assume: "3 items out of sync with Zomato"
   * is only sayable if failure is written down rather than hoped away.
   */
  async recordSyncResult(result, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      for (const id of result.synced || []) {
        await connection.execute(QUERIES.POS_PORTAL_LISTING.MARK_SYNCED, [
          'synced', null, userPhone, id, tenantId,
        ]);
      }
      for (const failure of result.failed || []) {
        await connection.execute(QUERIES.POS_PORTAL_LISTING.MARK_SYNCED, [
          'failed', String(failure.error || '').slice(0, 500), userPhone, failure.id, tenantId,
        ]);
      }
      return {
        synced: (result.synced || []).length,
        failed: (result.failed || []).length,
      };
    });
  }

  /**
   * How an inbound order line finds our menu item.
   *
   * Returns null for an unrecognised item. The caller keeps the raw line and
   * flags the order — one unmapped line must never reject an order.
   */
  async findByExternalItem(conn, portalId, externalItemId, tenantId) {
    if (!externalItemId) return null;
    const [rows] = await conn.execute(
      QUERIES.POS_PORTAL_LISTING.SELECT_BY_EXTERNAL_ITEM,
      [portalId, externalItemId, tenantId],
    );
    return rows.length ? rows[0] : null;
  }
}

const service = new PosPortalListingService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
  listByPortal: (portalId, tenantId) => service.listByPortal(portalId, tenantId),
  setAvailabilityBulk: (data, tenantId, userPhone) =>
    service.setAvailabilityBulk(data, tenantId, userPhone),
  recordSyncResult: (result, tenantId, userPhone) =>
    service.recordSyncResult(result, tenantId, userPhone),
  findByExternalItem: (conn, portalId, externalItemId, tenantId) =>
    service.findByExternalItem(conn, portalId, externalItemId, tenantId),
};
