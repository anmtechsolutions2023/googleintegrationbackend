// src/modules/posportal/posportal.ingest.service.js
// The ONE inbound path. Everything that arrives from a portal comes through
// here, whether it was signed by Zomato or typed in by a cashier.
//
// ── The ordering, and why it is that ordering ───────────────────────────────
//   1  dedupe     write the event row first, keyed so a replay is recognised
//   2  normalize  adapter turns the portal's dialect into an InboundOrder
//   3  resolve    external store → our branch; external items → our menu
//   4  price      through the same tax engine every other sale uses
//   5  persist    pos_online_order, status 'new'
//
// Deduplication comes FIRST because every aggregator retries, and some fan out
// to several endpoints. Doing the work and then noticing the duplicate is how
// a restaurant ends up cooking one order twice and posting it to the ledger
// twice.
//
// ── The failure lane IS the design ──────────────────────────────────────────
// An unknown store parks the order as `needs_mapping` and shows it on the
// dashboard. An unrecognised line keeps its raw name and flags the order. NONE
// of it rejects: a rejected order is a customer whose food never arrives, and
// the portal does not send it again. Recoverable-by-a-human beats lost.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { resolveAdapter } = require('./adapters');
const branchService = require('./posportal.branch.service');
const listingService = require('./posportal.listing.service');
const { priceListings, lineMoney, round2 } = require('./posportal.pricing');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * The idempotency key's payload half.
 *
 * Hashing the body — rather than keying on the order ref alone — means a portal
 * legitimately re-sending a CHANGED order for the same ref is processed, while
 * a byte-identical replay is not. Keying on the ref alone would drop real
 * updates; keying on nothing would double-cook.
 */
const hashPayload = (raw) =>
  crypto.createHash('sha256')
    .update(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}))
    .digest('hex');

/** A portal date string, as something MySQL will accept, or null. */
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Turn the portal's lines into priced lines against OUR menu.
 *
 * A line that matches a listing is priced by the tax engine through the same
 * resolution chain the listings screen previews — override, else branch price,
 * else master. A line that matches nothing keeps the portal's own name and
 * price and is marked `unmapped`, so the expo screen can show it in red and a
 * human can map it later.
 *
 * @returns {Promise<{ lines: Array, hasUnmapped: boolean, itemsTotal: number, taxTotal: number }>}
 */
const resolveLines = async (conn, portalId, inbound, tenantId) => {
  const raw = Array.isArray(inbound.lines) ? inbound.lines : [];

  const matched = await Promise.all(raw.map(async (line) => ({
    line,
    listing: await listingService.findByExternalItem(
      conn, portalId, line.externalItemId, tenantId,
    ),
  })));

  const priced = await priceListings(
    matched.filter((m) => m.listing).map((m) => m.listing),
    tenantId,
  );
  const byId = new Map(priced.map((p) => [p.Id, p]));

  let itemsTotal = 0;
  let taxTotal = 0;

  const lines = matched.map(({ line, listing }) => {
    if (!listing) {
      // Unmapped: trust the portal's own numbers for display and for the
      // order total, so the figure on the card matches what the customer paid.
      const gross = round2((Number(line.unitPrice) || 0) * (Number(line.qty) || 1));
      itemsTotal += gross;
      return {
        unmapped: true,
        externalItemId: line.externalItemId,
        name: line.name || 'Unrecognised item',
        qty: Number(line.qty) || 1,
        unitPrice: Number(line.unitPrice) || 0,
        netAmount: gross,
        taxAmount: 0,
        grossAmount: gross,
        addOns: line.addOns || [],
        notes: line.notes || null,
      };
    }

    const pricedRow = byId.get(listing.Id);
    const money = lineMoney(pricedRow, line.qty);
    itemsTotal += money.grossAmount;
    taxTotal += money.taxAmount;

    return {
      unmapped: false,
      externalItemId: line.externalItemId,
      ItemMetaId: listing.ItemMetaId,
      ItemDetailId: listing.ItemDetailId,
      CostInfoId: pricedRow?.EffectiveCostInfoId ?? null,
      PriceSource: pricedRow?.PriceSource ?? 'none',
      name: listing.ListedName || line.name || 'Item',
      qty: Number(line.qty) || 1,
      unitPrice: money.unitAmount,
      netAmount: money.netAmount,
      taxAmount: money.taxAmount,
      grossAmount: money.grossAmount,
      addOns: line.addOns || [],
      notes: line.notes || null,
    };
  });

  return {
    lines,
    hasUnmapped: lines.some((l) => l.unmapped),
    itemsTotal: round2(itemsTotal),
    taxTotal: round2(taxTotal),
  };
};

/**
 * What the portal keeps.
 *
 * Preferred from the payload when the portal states it — they are the authority
 * on their own commission — and computed from the portal's configured rate only
 * as a fallback, so a queue can still show a net payout for a portal whose
 * webhook does not carry one.
 */
const resolveCommission = (inbound, portal, gross) => {
  const stated = Number(inbound.totals?.commission) || 0;
  if (stated > 0) {
    const net = Number(inbound.totals?.netPayout) || round2(gross - stated);
    return { commission: round2(stated), netPayout: round2(net) };
  }
  const pct = Number(portal?.CommissionPct) || 0;
  const commission = round2((gross * pct) / 100);
  return { commission, netPayout: round2(gross - commission) };
};

/**
 * Ingest one inbound event.
 *
 * Runs in ONE transaction so an event that is recorded is an order that exists:
 * writing the dedupe row and then failing to write the order would make the
 * retry a no-op and lose the order permanently — the exact failure the dedupe
 * row is there to prevent.
 *
 * @param {Object} input
 * @param {Object} input.portal       - pos_portal row (already resolved + verified)
 * @param {Object} input.payload      - the portal's raw body (parsed)
 * @param {string} [input.rawBody]    - the exact bytes, for the payload hash
 * @param {string} input.tenantId
 * @param {string} [input.userPhone]
 * @returns {Promise<{ status:string, onlineOrderId:string|null, eventId:string, duplicate:boolean }>}
 */
const ingest = async ({ portal, payload, rawBody, tenantId, userPhone }) => {
  const by = userPhone || 'portal-webhook';
  const adapter = resolveAdapter(portal.Adapter);
  const payloadHash = hashPayload(rawBody ?? payload);

  return withTransaction(async (conn) => {
    // ── 1. Dedupe, before any work ──────────────────────────────────────
    const inbound = adapter.normalize(payload);
    const eventType = inbound.eventType || 'order.created';

    const [dupes] = await conn.execute(QUERIES.POS_PORTAL_EVENT.SELECT_DUPLICATE, [
      portal.Id, inbound.externalRef ?? null, eventType, payloadHash, tenantId,
    ]);
    if (dupes.length) {
      logger.info('Portal event ignored as duplicate', {
        portal: portal.Code, externalRef: inbound.externalRef, tenantId,
      });
      return {
        status: 'duplicate',
        onlineOrderId: dupes[0].OnlineOrderId ?? null,
        eventId: dupes[0].Id,
        duplicate: true,
      };
    }

    const eventId = uuidv4();
    await conn.execute(QUERIES.POS_PORTAL_EVENT.INSERT, [
      eventId, tenantId, portal.Id, inbound.externalRef ?? null, eventType, payloadHash,
      toJson(payload), 'received', null, null, null, 1, by, by,
    ]);

    // ── 3. Resolve the branch ───────────────────────────────────────────
    const mapping = await branchService.findByExternalStore(
      conn, portal.Id, inbound.externalStoreId, tenantId,
    );
    if (!mapping) {
      // Parked, not dropped. The Portals screen shows it as an unmapped store
      // and a human maps it; the order is still in the event log to replay.
      logger.warn('Portal order from an unmapped store — parked', {
        portal: portal.Code, externalStoreId: inbound.externalStoreId, tenantId,
      });
      await conn.execute(QUERIES.POS_PORTAL_EVENT.MARK_PROCESSED, [
        'needs_mapping',
        `Unknown store "${inbound.externalStoreId}" — map it to a branch to accept this order`,
        null, by, eventId, tenantId,
      ]);
      return { status: 'needs_mapping', onlineOrderId: null, eventId, duplicate: false };
    }

    // ── 4. Resolve + price the lines ────────────────────────────────────
    const resolved = await resolveLines(conn, portal.Id, inbound, tenantId);

    const gross = Number(inbound.totals?.gross) || resolved.itemsTotal;
    const { commission, netPayout } = resolveCommission(inbound, portal, gross);

    // ── 5. Persist ──────────────────────────────────────────────────────
    const orderId = uuidv4();
    await conn.execute(QUERIES.POS_ONLINE_ORDER.INSERT, [
      orderId, tenantId, portal.Id,
      // Snapshot, not a lookup — see the column comment in the schema.
      portal.Name, null, mapping.Id,
      inbound.externalRef ?? null,
      inbound.status || 'new',
      toJson(payload),
      toJson(resolved.lines),
      resolved.hasUnmapped ? 1 : 0,
      inbound.customer?.name ?? null,
      inbound.customer?.maskedPhone ?? null,
      inbound.customer?.externalCustomerRef ?? null,
      resolved.itemsTotal,
      Number(inbound.totals?.portalDiscount) || 0,
      Number(inbound.totals?.packing) || 0,
      Number(inbound.totals?.delivery) || 0,
      Number(inbound.totals?.tax) || resolved.taxTotal,
      gross,
      commission,
      netPayout,
      inbound.prepaid ? 1 : 0,
      toDate(inbound.placedOn) || new Date(),
      toDate(inbound.promisedOn),
      null, null, null, null,
      inbound.rider?.name ?? null,
      inbound.rider?.phone ?? null,
      null, null,
      mapping.BranchDetailId,
      1, by, by,
    ]);

    await conn.execute(QUERIES.POS_PORTAL_EVENT.MARK_PROCESSED, [
      'processed', null, orderId, by, eventId, tenantId,
    ]);

    logger.info('Portal order ingested', {
      portal: portal.Code, externalRef: inbound.externalRef, orderId, tenantId,
      hasUnmapped: resolved.hasUnmapped,
    });

    return { status: 'processed', onlineOrderId: orderId, eventId, duplicate: false };
  });
};

module.exports = { ingest, hashPayload, resolveLines, resolveCommission };
