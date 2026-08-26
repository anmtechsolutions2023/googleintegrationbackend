// src/modules/posonlineorder/posonlineorder.lifecycle.js
// What happens to a portal order between arriving and being delivered.
//
// Kept out of posonlineorder.service.js on purpose. That file's job is CRUD
// over one table; this file's job is a workflow that spans four modules
// (orders, KOTs, bills, the ledger). Mixing them would give one class two
// reasons to change — and it is the workflow that will change, as portals are
// added and the accounting is refined.
//
// ── The whole point of this file ────────────────────────────────────────────
// An online order used to be a status string and nothing more: no pos_order, so
// no KOT, so no bill, so nothing in the ledger. Accepting one now puts it on
// the SAME road every other sale travels, rather than building a second one.
// Nothing in posorder, poskot, posbill or ledger is modified to make that work.

const { withTransaction } = require('../../utils/dbHelper');
const {
  QUERIES,
  POS_ONLINE_ORDER_TRANSITIONS,
  POS_ONLINE_ORDER_STATUSES,
} = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const posOrderService = require('../posorder/posorder.service');
const { writeKot, findLiveKotTx } = require('../posorder/posKotWriter');
const { resolveAdapter } = require('../posportal/adapters');
const { settleForOrder } = require('./posonlineorder.settle');

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
};

/**
 * Is this move legal from where the order is now?
 *
 * One table, consulted by every caller. The two screens over this data used to
 * disagree — the queue wrote 'processing' on Accept while the tracking board
 * drew 'accepted' as stage one — so the status a manager read never matched the
 * button a cashier pressed. Neither screen decides any more.
 *
 * @param {string} from
 * @param {string} to
 */
const assertTransition = (from, to) => {
  const current = String(from || 'new').toLowerCase();
  const next = String(to || '').toLowerCase();

  if (!POS_ONLINE_ORDER_STATUSES.includes(next)) {
    throw new HttpError(`Unknown order status "${to}"`, MESSAGES.HTTP_STATUS.BAD_REQUEST);
  }
  const allowed = POS_ONLINE_ORDER_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new HttpError(
      `Cannot move an order from "${current}" to "${next}".`
      + (allowed.length ? ` Allowed from here: ${allowed.join(', ')}.` : ' This order is finished.'),
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }
};

/** The raw row, without the read-path joins — writes must not echo joined columns. */
const loadRawTx = async (conn, id, tenantId) => {
  const [rows] = await conn.execute(QUERIES.POS_ONLINE_ORDER.SELECT_RAW_BY_ID, [id, tenantId]);
  if (!rows.length) {
    throw new HttpError('POS Online Order not found', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  return rows[0];
};

/** The portal row for an order, or null for a legacy row with no portal link. */
const loadPortalTx = async (conn, portalId, tenantId) => {
  if (!portalId) return null;
  const [rows] = await conn.execute(QUERIES.POS_PORTAL.SELECT_BY_ID, [portalId, tenantId]);
  return rows.length ? rows[0] : null;
};

/**
 * Tell the portal what we did — and never let that failure undo what we did.
 *
 * By the time this runs the order is accepted and the food is on the pass.
 * Rolling that back because a third party's API returned 503 would be strictly
 * worse than recording the failure and retrying. So this is called AFTER the
 * transaction commits, and it swallows.
 */
const pushStatusSafely = async (portal, order, status, credential) => {
  if (!portal) return { pushed: false };
  try {
    const adapter = resolveAdapter(portal.Adapter);
    return await adapter.pushStatus(order, status, credential || {});
  } catch (err) {
    logger.warn('Portal status push threw — order state is unaffected', {
      portal: portal.Code, status, error: err.message,
    });
    return { pushed: false, detail: err.message };
  }
};

/**
 * Domain action: accept a portal order into the POS.
 *
 * One transaction covering three writes that are one decision:
 *   - the pos_order this becomes,
 *   - the link back from pos_online_order,
 *   - the kitchen ticket.
 *
 * Half of that committing would leave an aggregator order accepted with nothing
 * cooking, or food cooking for an order nothing points at.
 *
 * @param {string} id
 * @param {Object} data - { FireKot?: boolean } — defaults to firing.
 * @returns {Promise<Object>} { OnlineOrderId, OrderId, OrderNo, Kot, PortalPush }
 */
const accept = async (id, data, tenantId, userEmail) => {
  // Priced BEFORE the transaction opens: pricing takes its own connection, and
  // holding a transaction across it would be a needless lock on the hot path.
  const prepared = await withTransaction(async (conn) => {
    const order = await loadRawTx(conn, id, tenantId);
    assertTransition(order.Status, 'accepted');
    return order;
  });

  const lines = asArray(prepared.OrderLines);
  if (lines.length === 0) {
    throw new HttpError(
      'This order has no items, so there is nothing to send to the kitchen.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  // Portal lines carry the costinfo the portal sells under — resolved at ingest
  // through the same chain the listings screen previews. Handing that id to the
  // order pricer means the bill is raised at the price the customer paid, not a
  // dine-in price the portal never showed.
  const priceable = lines
    .filter((l) => !l.unmapped && l.CostInfoId)
    .map((l) => ({
      id: l.ItemMetaId,
      name: l.name,
      costInfoId: l.CostInfoId,
      qty: l.qty,
      notes: l.notes ?? null,
    }));

  const priced = priceable.length
    ? await posOrderService.priceItems(priceable, tenantId)
    : null;

  return withTransaction(async (conn) => {
    // Re-read inside the transaction: two cashiers can press Accept at once,
    // and the guard above ran on a connection that has since been released.
    const order = await loadRawTx(conn, id, tenantId);
    assertTransition(order.Status, 'accepted');

    const portal = await loadPortalTx(conn, order.PortalId, tenantId);

    const created = await posOrderService.createRoundTx(
      conn,
      {
        // 'delivery' is the existing POS_ORDER_TYPES value for food that leaves
        // the building. ChannelId is what makes the channel master load-bearing
        // and lets reports slice online revenue without matching on text.
        OrderType: 'delivery',
        ChannelId: portal?.ChannelId ?? null,
        Status: 'open',
        TableId: null,
        // Deliberately no CustomerId: aggregators mask the number and rotate
        // it, so resolving one per order would fill the CRM with one-visit
        // ghosts and poison the loyalty ledger. The name rides on the online
        // order instead.
        CustomerId: null,
        Items: priced ? priced.items : priceable,
        SubTotal: priced ? priced.totals.netAmount : 0,
        TaxAmount: priced ? priced.totals.taxAmount : 0,
        Total: priced ? priced.totals.grossAmount : 0,
        BranchDetailId: order.BranchDetailId,
      },
      tenantId,
      userEmail,
    );

    await conn.execute(QUERIES.POS_ONLINE_ORDER.SET_ACCEPTED, [
      created.id, userEmail, id, tenantId,
    ]);

    // Send-once, by the same guard the till uses: a double-tap, a retry or a
    // second device must not put the same food on the pass twice.
    let kot = null;
    if (data?.FireKot !== false) {
      const live = await findLiveKotTx(conn, created.id, tenantId);
      kot = live
        ? { KotId: live.Id, KotNo: live.KotNo, OrderId: created.id, Status: live.Status, AlreadySent: true }
        : await writeKot(
          conn,
          { Id: created.id, TableId: null, Items: priced ? priced.items : priceable, BranchDetailId: order.BranchDetailId },
          tenantId,
          userEmail,
        );
    }

    logger.info('Portal order accepted into the POS', {
      onlineOrderId: id, orderId: created.id, tenantId, portal: portal?.Code,
    });

    return {
      OnlineOrderId: id,
      OrderId: created.id,
      OrderNo: created.OrderNo,
      Status: 'accepted',
      Kot: kot,
      // Carried out of the transaction so the caller can push to the portal
      // after the commit — see pushStatusSafely.
      _portal: portal,
    };
  }).then(async (result) => {
    const push = await pushStatusSafely(result._portal, { ExternalRef: prepared.ExternalRef }, 'accepted');
    const { _portal, ...clean } = result;
    return { ...clean, PortalPush: push };
  });
};

/**
 * Domain action: refuse an order.
 *
 * Portals require a coded reason, so this takes one rather than free text — and
 * it is recorded, because "why did we reject 40 orders last week" is a question
 * an owner asks and a rating depends on.
 */
const reject = async (id, data, tenantId, userEmail) => {
  const result = await withTransaction(async (conn) => {
    const order = await loadRawTx(conn, id, tenantId);
    assertTransition(order.Status, 'cancelled');
    const portal = await loadPortalTx(conn, order.PortalId, tenantId);

    await conn.execute(QUERIES.POS_ONLINE_ORDER.SET_CANCELLED, [
      data.Reason ?? null, userEmail, userEmail, id, tenantId,
    ]);

    logger.info('Portal order rejected', {
      onlineOrderId: id, reason: data.Reason, tenantId, portal: portal?.Code,
    });
    return { OnlineOrderId: id, Status: 'cancelled', Reason: data.Reason ?? null, _portal: portal, _ref: order.ExternalRef };
  });

  const push = await pushStatusSafely(result._portal, { ExternalRef: result._ref }, 'cancelled');
  const { _portal, _ref, ...clean } = result;
  return { ...clean, PortalPush: push };
};

/**
 * Move an order along its lifecycle.
 *
 * The single writer for every stage change after accept. `ready` and
 * `delivered` are the same operation with different targets, so they are one
 * function with a validated target rather than three near-identical ones.
 */
const setStatus = async (id, data, tenantId, userEmail) => {
  const next = String(data.Status || '').toLowerCase();

  const result = await withTransaction(async (conn) => {
    const order = await loadRawTx(conn, id, tenantId);
    assertTransition(order.Status, next);
    const portal = await loadPortalTx(conn, order.PortalId, tenantId);

    if (next === 'processing') {
      await conn.execute(QUERIES.POS_ONLINE_ORDER.SET_READY, [userEmail, id, tenantId]);
    } else if (next === 'delivered') {
      await conn.execute(QUERIES.POS_ONLINE_ORDER.SET_DELIVERED, [userEmail, id, tenantId]);
    } else if (next === 'cancelled') {
      await conn.execute(QUERIES.POS_ONLINE_ORDER.SET_CANCELLED, [
        data.Reason ?? null, userEmail, userEmail, id, tenantId,
      ]);
    } else {
      await conn.execute(QUERIES.POS_ONLINE_ORDER.SET_STATUS, [next, userEmail, id, tenantId]);
    }

    return {
      OnlineOrderId: id,
      Status: next,
      _portal: portal,
      _ref: order.ExternalRef,
      _order: order,
    };
  });

  const push = await pushStatusSafely(result._portal, { ExternalRef: result._ref }, next);

  // ── Delivered is where the money is recognised ──────────────────────────
  //
  // After the commit and outside this transaction on purpose — posbill.settle
  // owns its own, and it posts a ledger document, records the visit and earns
  // loyalty. It is idempotent, so a retry converges rather than double-posting.
  //
  // A settle failure does NOT undo the delivery: the food arrived, and saying
  // otherwise because a payment mode is unconfigured would be a lie about the
  // physical world. It is reported instead, and the order can be settled again
  // once the portal is configured.
  let settlement = null;
  if (next === 'delivered') {
    try {
      settlement = await settleForOrder(
        {
          ...result._order,
          SettlementPaymentModeId: result._portal?.SettlementPaymentModeId ?? null,
          PortalCode: result._portal?.Code ?? null,
          Name: result._portal?.Name ?? null,
        },
        tenantId,
        userEmail,
      );
    } catch (err) {
      logger.warn('Portal order delivered but not settled', {
        onlineOrderId: id, tenantId, error: err.message,
      });
      settlement = { settled: false, error: err.message };
    }
  }

  const { _portal, _ref, _order, ...clean } = result;
  return { ...clean, PortalPush: push, Settlement: settlement };
};

module.exports = { accept, reject, setStatus, assertTransition, asArray };
