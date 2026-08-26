// src/modules/posportal/adapters/httpAggregator.adapter.js
// What every signed-webhook aggregator has in common, in one place.
//
// Zomato, Swiggy and District differ in three ways and three only: the header
// their signature arrives in, the JSON paths their fields live at, and the
// words they use for a status. Everything else — verifying an HMAC in constant
// time, walking a payload into the canonical envelope, POSTing a status back —
// is identical, and writing it three times would mean fixing a signature bug
// three times.
//
// So a concrete portal adapter is a DECLARATION, not an implementation: it
// supplies a signature config, a field map and a status map, and inherits the
// behaviour. That is the Open/Closed principle doing real work here — adding
// District extends the set of adapters without editing any code that runs for
// Zomato.
//
// ── What still needs the portal's real API documentation ────────────────────
// The field maps in the concrete adapters are the ONLY part of this feature
// that cannot be written without a portal's live contract. They are declared
// against each portal's published webhook shape and MUST be checked against a
// real captured payload before that portal is switched off `manual`. The
// mechanism around them is complete and tested.

const crypto = require('crypto');
const { BaseAdapter, emptyInboundOrder } = require('./baseAdapter');
const { logger } = require('../../../utils/logger');

/**
 * Reads a dotted path out of a payload. Returns undefined for any missing
 * link rather than throwing, because a portal omitting an optional field is
 * normal and must not fail the whole order.
 * @param {Object} obj
 * @param {string} path - e.g. 'order.customer.name' or 'items[].id'
 */
const at = (obj, path) => {
  if (!path) return undefined;
  return String(path).split('.').reduce(
    (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
    obj,
  );
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

class HttpAggregatorAdapter extends BaseAdapter {
  /**
   * @param {string} slug
   * @param {Object} spec
   * @param {Object} spec.signature - { header, algorithm, encoding, prefix }
   * @param {Object} spec.fields    - dotted paths into the portal's payload
   * @param {Object} spec.statusMap - portal's status word → ours
   * @param {Object} spec.endpoints - { status, menu } paths appended to ApiBaseUrl
   */
  constructor(slug, spec) {
    super(slug);
    this.signature = spec.signature || {};
    this.fields = spec.fields || {};
    this.statusMap = spec.statusMap || {};
    this.endpoints = spec.endpoints || {};
  }

  /**
   * Constant-time HMAC check against the stored webhook secret.
   *
   * Three things matter and all three have bitten real integrations:
   *   - It reads the RAW body, not the parsed one. Re-serializing JSON changes
   *     key order and whitespace, and the digest no longer matches.
   *   - It compares with timingSafeEqual. A `===` on a digest leaks the secret
   *     one byte at a time to anyone willing to measure.
   *   - A missing secret is a REFUSAL, never a pass. An unconfigured portal
   *     must not be an open endpoint.
   */
  verify(req, credential) {
    const secret = credential?.WebhookSecret;
    if (!secret) {
      logger.warn('Portal webhook rejected — no secret configured', { adapter: this.slug });
      return false;
    }

    const headerName = (this.signature.header || 'x-signature').toLowerCase();
    const provided = req?.headers?.[headerName];
    if (!provided) return false;

    // req.rawBody is captured by the webhook router's body parser. Falling back
    // to a re-serialize would silently mismatch, so an absent raw body refuses.
    const raw = req?.rawBody;
    if (!raw) {
      logger.warn('Portal webhook rejected — raw body unavailable', { adapter: this.slug });
      return false;
    }

    const digest = crypto
      .createHmac(this.signature.algorithm || 'sha256', secret)
      .update(raw)
      .digest(this.signature.encoding || 'hex');
    const expected = `${this.signature.prefix || ''}${digest}`;

    const a = Buffer.from(String(provided));
    const b = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, which is itself an answer.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** @param {Object} payload @returns {Object} InboundOrder */
  normalize(payload = {}) {
    const f = this.fields;
    const base = emptyInboundOrder();

    const rawLines = at(payload, f.lines);
    const lines = Array.isArray(rawLines) ? rawLines : [];

    return {
      ...base,
      externalRef: at(payload, f.externalRef) ?? null,
      externalStoreId: at(payload, f.externalStoreId) ?? null,
      eventType: at(payload, f.eventType) ?? 'order.created',
      placedOn: at(payload, f.placedOn) ?? null,
      promisedOn: at(payload, f.promisedOn) ?? null,
      prepaid: f.prepaid ? !!at(payload, f.prepaid) : true,
      status: this.mapStatus(at(payload, f.status)),
      customer: {
        name: at(payload, f.customerName) ?? null,
        maskedPhone: at(payload, f.customerPhone) ?? null,
        externalCustomerRef: at(payload, f.customerRef) ?? null,
      },
      lines: lines.map((l) => ({
        externalItemId: at(l, f.lineItemId) ?? null,
        name: at(l, f.lineName) ?? null,
        qty: num(at(l, f.lineQty)) || 1,
        unitPrice: f.lineUnitPrice !== undefined ? num(at(l, f.lineUnitPrice)) : null,
        addOns: (() => {
          const a = at(l, f.lineAddOns);
          return Array.isArray(a) ? a : [];
        })(),
        notes: at(l, f.lineNotes) ?? null,
      })),
      totals: {
        items: num(at(payload, f.totalItems)),
        portalDiscount: num(at(payload, f.totalDiscount)),
        packing: num(at(payload, f.totalPacking)),
        delivery: num(at(payload, f.totalDelivery)),
        tax: num(at(payload, f.totalTax)),
        gross: num(at(payload, f.totalGross)),
        commission: num(at(payload, f.totalCommission)),
        netPayout: num(at(payload, f.totalNetPayout)),
      },
      rider: {
        name: at(payload, f.riderName) ?? null,
        phone: at(payload, f.riderPhone) ?? null,
      },
    };
  }

  /** Unknown words map to null — see the base class for why that is not a guess. */
  mapStatus(externalStatus) {
    if (!externalStatus) return null;
    return this.statusMap[String(externalStatus).trim().toUpperCase()] ?? null;
  }

  /**
   * Tell the portal what we did.
   *
   * Never throws on a portal-side failure: by the time this runs the order is
   * accepted and the food is on the pass. Rolling that back because a third
   * party's API returned 503 would be strictly worse than reporting it and
   * retrying.
   */
  async pushStatus(order, status, credential) {
    const url = this.buildUrl(credential, this.endpoints.status, order);
    if (!url) return { pushed: false, detail: 'No API base URL configured' };

    try {
      const res = await this.request(url, credential, {
        externalRef: order.ExternalRef,
        status,
      });
      return { pushed: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      logger.warn('Portal status push failed', { adapter: this.slug, error: err.message });
      return { pushed: false, detail: err.message };
    }
  }

  /**
   * Publish the catalogue. Reports per-listing outcomes so the listing rows can
   * record which ones the portal actually accepted — "3 items out of sync" is
   * only sayable if failure is recorded rather than assumed away.
   */
  async pushMenu(listings = [], credential) {
    const url = this.buildUrl(credential, this.endpoints.menu);
    if (!url) {
      return {
        pushed: false,
        synced: [],
        failed: listings.map((l) => ({ id: l.Id, error: 'No API base URL configured' })),
      };
    }

    try {
      const res = await this.request(url, credential, {
        items: listings.map((l) => ({
          externalItemId: l.ExternalItemId,
          name: l.ListedName || l.ItemName,
          description: l.ListedDescription,
          price: l.TaxBreakdown?.grossAmount ?? null,
          available: !!l.Available,
        })),
      });
      if (!res.ok) {
        return {
          pushed: false,
          synced: [],
          failed: listings.map((l) => ({ id: l.Id, error: `HTTP ${res.status}` })),
        };
      }
      return { pushed: true, synced: listings.map((l) => l.Id), failed: [] };
    } catch (err) {
      logger.warn('Portal menu push failed', { adapter: this.slug, error: err.message });
      return {
        pushed: false,
        synced: [],
        failed: listings.map((l) => ({ id: l.Id, error: err.message })),
      };
    }
  }

  /** @private */
  buildUrl(credential, path, order) {
    const base = credential?.ApiBaseUrl;
    if (!base || !path) return null;
    const resolved = String(path).replace(':ref', encodeURIComponent(order?.ExternalRef ?? ''));
    return `${String(base).replace(/\/+$/, '')}/${resolved.replace(/^\/+/, '')}`;
  }

  /** @private — one place that talks to a portal, so one place to instrument. */
  async request(url, credential, body) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credential?.ApiKey ? { Authorization: `Bearer ${credential.ApiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }
}

module.exports = { HttpAggregatorAdapter, at };
