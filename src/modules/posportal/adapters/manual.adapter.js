// src/modules/posportal/adapters/manual.adapter.js
// The portal nobody integrated with: someone types the order in.
//
// This is not a stub. It ships permanently, and it does three jobs:
//   1. It is what a tenant without API access uses forever — plenty of
//      restaurants take District orders off a tablet and key them in.
//   2. It is the fallback when a real integration is down. The queue keeps
//      working; only the arrival mechanism changes.
//   3. It is the harness every other adapter is tested against — the canonical
//      envelope is easiest to assert on when nothing is translating it.
//
// Because of (1) and (2), everything downstream of `normalize()` is exercised
// in production from day one, long before a single portal API is connected.
// That is deliberate: the risky, un-testable part of this feature (a third
// party's payload format) is isolated behind the one seam, and the rest of the
// pipeline is proven without it.

const { BaseAdapter, emptyInboundOrder } = require('./baseAdapter');
const { POS_ONLINE_ORDER_STATUSES } = require('../../../config/constants');

// A hand-keyed order arrives as the canonical envelope already — the form on
// the queue screen collects exactly these fields. So normalize() is a
// validating pass-through rather than a translation.
class ManualAdapter extends BaseAdapter {
  constructor() {
    super('manual');
  }

  /**
   * A hand-keyed order comes through the authenticated API, not the webhook,
   * so it has already been authenticated by the tenant JWT. There is nothing
   * left to verify and nothing is being trusted that was not already trusted.
   */
  verify() {
    return true;
  }

  /**
   * @param {Object} payload - Already close to the canonical shape.
   * @returns {Object} InboundOrder
   */
  normalize(payload = {}) {
    const base = emptyInboundOrder();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    return {
      ...base,
      externalRef: payload.externalRef ?? null,
      externalStoreId: payload.externalStoreId ?? null,
      eventType: payload.eventType ?? 'order.created',
      placedOn: payload.placedOn ?? null,
      promisedOn: payload.promisedOn ?? null,
      prepaid: payload.prepaid !== undefined ? !!payload.prepaid : true,
      status: this.mapStatus(payload.status),
      customer: {
        name: payload.customer?.name ?? null,
        maskedPhone: payload.customer?.maskedPhone ?? payload.customer?.phone ?? null,
        externalCustomerRef: payload.customer?.externalCustomerRef ?? null,
      },
      lines: lines.map((l) => ({
        externalItemId: l.externalItemId ?? null,
        name: l.name ?? null,
        qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
        unitPrice: l.unitPrice !== undefined && l.unitPrice !== null
          ? Number(l.unitPrice)
          : null,
        addOns: Array.isArray(l.addOns) ? l.addOns : [],
        notes: l.notes ?? null,
      })),
      totals: { ...base.totals, ...(payload.totals || {}) },
      rider: {
        name: payload.rider?.name ?? null,
        phone: payload.rider?.phone ?? null,
      },
    };
  }

  /**
   * Hand-keyed statuses are already ours — but they are still validated rather
   * than trusted, so a typo becomes null (and the ingest service defaults it)
   * instead of a status nothing else in the system recognises.
   */
  mapStatus(externalStatus) {
    if (!externalStatus) return null;
    const s = String(externalStatus).trim().toLowerCase();
    return POS_ONLINE_ORDER_STATUSES.includes(s) ? s : null;
  }

  /** Nowhere to push to — the person who keyed it in tells the portal. */
  async pushStatus() {
    return { pushed: false, detail: 'Manual portal — update the order on the portal yourself' };
  }

  /** Nowhere to publish to; the listings are still ours to keep for pricing. */
  async pushMenu(listings = []) {
    return {
      pushed: false,
      synced: [],
      failed: [],
      detail: `Manual portal — ${listings.length} listing(s) kept locally, nothing published`,
    };
  }
}

module.exports = ManualAdapter;
