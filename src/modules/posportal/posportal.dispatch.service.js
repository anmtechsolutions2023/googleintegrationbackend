// src/modules/posportal/posportal.dispatch.service.js
// The ONE outbound path: everything this system says TO a portal goes here.
//
// The mirror of posportal.ingest.service.js, and split from it for the same
// reason the read and write halves of anything are split — they fail
// differently. An inbound failure means an order we have not got; an outbound
// failure means an order the portal does not know we have got. The second is
// recoverable by retrying and must never undo local state.
//
// Nothing here throws on a portal-side failure. By the time a status push runs
// the food is on the pass; by the time a menu push runs the prices are already
// ours. Rolling either back because a third party returned 503 would be
// strictly worse than recording it and trying again.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const { resolveAdapter } = require('./adapters');
const listingService = require('./posportal.listing.service');
const { priceListings } = require('./posportal.pricing');

/** The portal and its credentials, or a 404. */
const loadPortal = async (portalId, tenantId) => withConnection(async (conn) => {
  const [portals] = await conn.execute(QUERIES.POS_PORTAL.SELECT_BY_ID, [portalId, tenantId]);
  if (!portals.length) {
    throw new HttpError('POS Portal not found', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  const [creds] = await conn.execute(
    QUERIES.POS_PORTAL_CREDENTIAL.SELECT_BY_PORTAL, [portalId, tenantId],
  );
  return { portal: portals[0], credential: creds.length ? creds[0] : null };
});

/**
 * Publish a portal's catalogue and write down what it accepted.
 *
 * Priced first, through the same resolution the listings screen previews and
 * the ingest pipeline uses — so the price the portal is told is the price the
 * counter sees and the price the bill is raised at. Three numbers that must
 * agree, from one function.
 *
 * @returns {Promise<{ pushed:boolean, synced:number, failed:number, detail?:string }>}
 */
const publishMenu = async (portalId, tenantId, userPhone) => {
  const { portal, credential } = await loadPortal(portalId, tenantId);
  const adapter = resolveAdapter(portal.Adapter);

  const listings = await listingService.listByPortal(portalId, tenantId);
  const publishable = listings.filter((l) => l.Active);

  if (publishable.length === 0) {
    return { pushed: false, synced: 0, failed: 0, detail: 'Nothing to publish' };
  }

  const result = await adapter.pushMenu(publishable, credential || {});
  const recorded = await listingService.recordSyncResult(result, tenantId, userPhone);

  logger.info('Portal menu publish finished', {
    portal: portal.Code, tenantId, ...recorded, pushed: result.pushed,
  });

  return {
    pushed: !!result.pushed,
    ...recorded,
    detail: result.detail,
  };
};

/**
 * Tell a portal an order's status changed.
 *
 * Exposed so a retry can be driven from outside the lifecycle — a push that
 * failed while the portal was down is worth trying again, and the order state
 * it describes has not changed in the meantime.
 */
const pushOrderStatus = async (portalId, order, status, tenantId) => {
  const { portal, credential } = await loadPortal(portalId, tenantId);
  const adapter = resolveAdapter(portal.Adapter);
  try {
    return await adapter.pushStatus(order, status, credential || {});
  } catch (err) {
    logger.warn('Portal status push failed', {
      portal: portal.Code, status, tenantId, error: err.message,
    });
    return { pushed: false, detail: err.message };
  }
};

module.exports = { publishMenu, pushOrderStatus, loadPortal, priceListings };
