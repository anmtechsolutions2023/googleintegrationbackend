// src/modules/posportal/adapters/baseAdapter.js
// The contract every portal implements, and the one shape the rest of the
// system is allowed to see.
//
// ── Why this boundary exists ────────────────────────────────────────────────
// District ships next quarter. It must not appear in a single `if` in the
// ingest service, the order queue, the reports or the ledger. That is only
// achievable if exactly one layer knows a portal's dialect and everything above
// it speaks one canonical language.
//
// So: an adapter converts a portal's payload into an InboundOrder and back.
// Nothing above `normalize()` knows a portal exists by name.
//
// Adding a portal is therefore ONE FILE plus ONE ROW in pos_portal — the row
// names the adapter slug, and the registry resolves it. No switch statement
// anywhere gains a case.
//
// ── The canonical envelope ──────────────────────────────────────────────────
// InboundOrder {
//   externalRef, externalStoreId, eventType, placedOn, promisedOn, prepaid,
//   customer : { name, maskedPhone, externalCustomerRef },
//   lines    : [{ externalItemId, name, qty, unitPrice, addOns[], notes }],
//   totals   : { items, portalDiscount, packing, delivery, tax, gross,
//                commission, netPayout },
//   rider    : { name, phone },
//   status   : one of POS_ONLINE_ORDER_STATUSES (for an update event)
// }

const { HttpError } = require('../../../middleware/errorHandler');
const MESSAGES = require('../../../config/messages');

/**
 * Base class. Subclasses override what their portal actually does; anything
 * left unimplemented throws rather than silently doing nothing, because a
 * status push that quietly no-ops leaves an order accepted with us and pending
 * with the portal — the worst of both.
 *
 * Liskov applies literally here: every subclass must accept the same arguments
 * and return the same shapes, or the ingest service has to know which adapter
 * it is talking to, which is exactly what this class exists to prevent.
 */
class BaseAdapter {
  /**
   * @param {string} slug - The adapter's registry key, e.g. 'zomato.v1'.
   */
  constructor(slug) {
    this.slug = slug;
  }

  /**
   * Does this request really come from the portal?
   *
   * The webhook has no tenant JWT — this IS its authentication. It must be a
   * constant-time comparison against the stored secret, and it must never trust
   * anything in the body: the tenant is resolved from the credential row that
   * verified, not from a field an attacker controls.
   *
   * @param {Object} _req - Express request (headers + rawBody).
   * @param {Object} _credential - pos_portal_credential row.
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  verify(_req, _credential) {
    throw new HttpError(
      `Adapter ${this.slug} cannot verify inbound requests`,
      MESSAGES.HTTP_STATUS.NOT_IMPLEMENTED || 501,
    );
  }

  /**
   * The portal's payload, as an InboundOrder.
   * @param {Object} _payload
   * @returns {Object} InboundOrder
   */
  // eslint-disable-next-line no-unused-vars
  normalize(_payload) {
    throw new HttpError(
      `Adapter ${this.slug} cannot normalize payloads`,
      MESSAGES.HTTP_STATUS.NOT_IMPLEMENTED || 501,
    );
  }

  /**
   * The portal's status word, as one of ours.
   *
   * Unknown values return null rather than guessing: an unrecognised status is
   * a portal that changed its vocabulary, and silently mapping it to 'delivered'
   * would close an order that is still cooking.
   *
   * @param {string} _externalStatus
   * @returns {string|null}
   */
  // eslint-disable-next-line no-unused-vars
  mapStatus(_externalStatus) {
    return null;
  }

  /**
   * Tell the portal what we did — accept, reject, ready.
   *
   * Returns a result rather than throwing on a portal-side failure: an order we
   * have already accepted and sent to the kitchen must not be rolled back
   * because the portal's API was briefly down. The caller records the failure
   * and retries.
   *
   * @param {Object} _order - The pos_online_order row.
   * @param {string} _status - Our canonical status.
   * @param {Object} _credential
   * @returns {Promise<{ pushed: boolean, detail?: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async pushStatus(_order, _status, _credential) {
    return { pushed: false, detail: `${this.slug} does not push status` };
  }

  /**
   * Publish the catalogue to the portal.
   *
   * Same contract as pushStatus: report, never throw the caller's transaction
   * away. The listing rows record whether it worked so a screen can say
   * "3 items out of sync".
   *
   * @param {Array<Object>} _listings
   * @param {Object} _credential
   * @returns {Promise<{ pushed: boolean, synced: Array<string>, failed: Array<{id:string, error:string}> }>}
   */
  // eslint-disable-next-line no-unused-vars
  async pushMenu(_listings, _credential) {
    return { pushed: false, synced: [], failed: [] };
  }
}

/**
 * An empty canonical envelope, so every adapter starts from the same shape and
 * a field nobody sets is absent rather than undefined-shaped differently per
 * portal.
 * @returns {Object} InboundOrder
 */
const emptyInboundOrder = () => ({
  externalRef: null,
  externalStoreId: null,
  eventType: 'order.created',
  placedOn: null,
  promisedOn: null,
  prepaid: true,
  status: null,
  customer: { name: null, maskedPhone: null, externalCustomerRef: null },
  lines: [],
  totals: {
    items: 0, portalDiscount: 0, packing: 0, delivery: 0,
    tax: 0, gross: 0, commission: 0, netPayout: 0,
  },
  rider: { name: null, phone: null },
});

module.exports = { BaseAdapter, emptyInboundOrder };
