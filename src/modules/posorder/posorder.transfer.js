// src/modules/posorder/posorder.transfer.js
// Table-transfer domain logic — moves items or whole rounds between tables while
// PRESERVING each line's priced snapshot ("keep as served"). No re-pricing: the
// net/tax/gross a line was stamped with when the round was placed travels with
// it, so a guest who relocates keeps the price and GST they were served at.
//
// Every helper takes an open transaction connection so the whole move (source
// edit + destination write + both tables' occupancy) commits atomically or not
// at all. Each operation returns an `undo` payload that, POSTed back to the same
// endpoint, reverses it exactly — the source of the front-end Undo affordance.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { issuePosNumber } = require('./posNumbering');
const { writeKot, findLiveKotTx } = require('./posKotWriter');
const { resolveVenueTx } = require('./posVenue');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CLOSED = new Set(['closed', 'settled', 'cancelled']);
const lineQty = (l) => Number(l.qty ?? l.quantity ?? 1) || 0;

// Totals are a plain sum of the lines' snapshots — never a re-price.
const sumTotals = (lines) => {
  const t = lines.reduce((a, l) => {
    const qty = lineQty(l);
    const gross = l.grossAmount != null ? Number(l.grossAmount) : Number(l.price || 0) * qty;
    const tax = l.taxAmount != null ? Number(l.taxAmount) : 0;
    const net = l.netAmount != null ? Number(l.netAmount) : gross - tax;
    a.SubTotal += net; a.TaxAmount += tax; a.Total += gross;
    return a;
  }, { SubTotal: 0, TaxAmount: 0, Total: 0 });
  return { SubTotal: round2(t.SubTotal), TaxAmount: round2(t.TaxAmount), Total: round2(t.Total) };
};

// A moved fraction of a line: amounts scale by the qty ratio so a "2 of 3" split
// carries two-thirds of the recorded net/tax/gross with it.
const scaleLine = (line, newQty) => {
  const ratio = lineQty(line) > 0 ? newQty / lineQty(line) : 0;
  const s = (v) => (v == null ? v : round2(Number(v) * ratio));
  return {
    ...line,
    qty: newQty,
    netAmount: s(line.netAmount),
    taxAmount: s(line.taxAmount),
    grossAmount: s(line.grossAmount),
    taxComponents: Array.isArray(line.taxComponents)
      ? line.taxComponents.map((c) => ({ ...c, amount: round2(Number(c.amount || 0) * ratio) }))
      : line.taxComponents,
  };
};

// The part that stays behind, computed as (original − moved) so the two halves
// always sum back to the original to the paisa.
const remainderLine = (line, movedQty) => {
  const moved = scaleLine(line, movedQty);
  const sub = (a, b) => (a == null ? a : round2(Number(a) - Number(b || 0)));
  return {
    ...line,
    qty: lineQty(line) - movedQty,
    netAmount: sub(line.netAmount, moved.netAmount),
    taxAmount: sub(line.taxAmount, moved.taxAmount),
    grossAmount: sub(line.grossAmount, moved.grossAmount),
    taxComponents: Array.isArray(line.taxComponents)
      ? line.taxComponents.map((c, i) => ({ ...c, amount: sub(c.amount, moved.taxComponents?.[i]?.amount) }))
      : line.taxComponents,
  };
};

// ── DB helpers on the shared transaction connection ──────────────────────────
const loadOrder = async (conn, id, tenantId) => {
  const [rows] = await conn.execute(QUERIES.POS_ORDER.SELECT_BY_ID, [id, tenantId]);
  if (rows.length === 0) throw new HttpError(`Order ${id} not found`, 404);
  return rows[0];
};

const loadTable = async (conn, id, tenantId) => {
  const [rows] = await conn.execute(QUERIES.POS_TABLE.SELECT_BY_ID, [id, tenantId]);
  if (rows.length === 0) throw new HttpError('Destination table not found', 404);
  return rows[0];
};

const writeOrder = (conn, o, userPhone, tenantId) =>
  conn.execute(QUERIES.POS_ORDER.UPDATE, [
    o.OrderNo, o.TableId, o.CustomerId ?? null, o.OrderType ?? null, o.ChannelId ?? null,
    o.Status ?? null,
    toJson(o.Items), o.SubTotal, o.TaxAmount, o.Total, o.BranchDetailId ?? null,
    o.TableName ?? null, o.FloorId ?? null, o.FloorName ?? null, o.TableCapacity ?? null,
    o.Active != null ? o.Active : 1, userPhone, o.Id, tenantId,
  ]);

const insertOrder = (conn, o, userPhone, tenantId) =>
  conn.execute(QUERIES.POS_ORDER.INSERT, [
    o.Id, tenantId, o.OrderNo, o.TableId, o.CustomerId ?? null, o.OrderType ?? 'dinein',
    // A split round was sold the same way the round it came from was.
    o.ChannelId ?? null,
    o.Status ?? 'open', toJson(o.Items), o.SubTotal, o.TaxAmount, o.Total,
    o.BranchDetailId ?? null,
    o.TableName ?? null, o.FloorId ?? null, o.FloorName ?? null, o.TableCapacity ?? null,
    1, userPhone, userPhone,
  ]);

// A moved round was genuinely served at its NEW table, so its venue snapshot is
// re-taken rather than carried over — otherwise the revenue would keep reporting
// against the table the guests left.
const restampVenue = async (conn, o, tenantId) => {
  Object.assign(o, await resolveVenueTx(conn, o.TableId, tenantId));
  return o;
};

const deleteOrder = (conn, id, tenantId) =>
  conn.execute(QUERIES.POS_ORDER.DELETE, [id, tenantId]);

// Keep a round's kitchen ticket pointing at the right table. Without this a
// transfer left the KOT showing the table the guests walked away from, so the
// pass delivered to an empty seat.
const moveKotsToTable = (conn, orderId, tableId, tenantId, userPhone) =>
  conn.execute(
    'UPDATE pos_kot SET TableId = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE OrderId = ? AND TenantId = ?',
    [tableId ?? null, userPhone, orderId, tenantId],
  );

// Repoint a round's tickets at another round. Required before deleting an order
// that has any: pos_kot.OrderId is a FOREIGN KEY with no ON DELETE, so the
// delete would simply fail on any round that had been sent to the kitchen.
const reassignKots = (conn, fromOrderId, toOrderId, toTableId, tenantId, userPhone) =>
  conn.execute(
    'UPDATE pos_kot SET OrderId = ?, TableId = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE OrderId = ? AND TenantId = ?',
    [toOrderId, toTableId ?? null, userPhone, fromOrderId, tenantId],
  );

// Re-derive a table's occupancy from its remaining open orders — the source may
// have emptied and the destination may have just become occupied.
const refreshTable = async (conn, tableId, tenantId, userPhone) => {
  if (!tableId) return;
  const [trows] = await conn.execute(QUERIES.POS_TABLE.SELECT_BY_ID, [tableId, tenantId]);
  if (trows.length === 0) return;
  const t = trows[0];
  const [open] = await conn.execute(
    "SELECT Id FROM pos_order WHERE TenantId = ? AND TableId = ? AND (Active = 1 OR Active IS NULL) " +
    "AND LOWER(COALESCE(Status, '')) NOT IN ('closed', 'settled', 'cancelled') ORDER BY CreatedOn DESC",
    [tenantId, tableId],
  );
  const occupied = open.length > 0;
  await conn.execute(QUERIES.POS_TABLE.UPDATE, [
    t.Name, t.FloorId, t.Capacity, occupied ? 'occupied' : 'free',
    occupied ? open[0].Id : null, t.BranchDetailId, t.Active != null ? t.Active : 1,
    userPhone, tableId, tenantId,
  ]);
};

// ── Operations ───────────────────────────────────────────────────────────────

// Reassign whole orders (one round, or a table's every round) to another table.
const moveOrders = async (conn, { orderIds, toTableId }, tenantId, userPhone) => {
  const dest = await loadTable(conn, toTableId, tenantId);
  const fromTables = new Set();
  for (const id of orderIds) {
    const o = await loadOrder(conn, id, tenantId);
    if (!CLOSED.has(String(o.Status || '').toLowerCase())) {
      fromTables.add(o.TableId);
      o.TableId = toTableId;
      o.BranchDetailId = dest.BranchDetailId ?? o.BranchDetailId;
      await restampVenue(conn, o, tenantId);
      await writeOrder(conn, o, userPhone, tenantId);
      await moveKotsToTable(conn, o.Id, toTableId, tenantId, userPhone);
    }
  }
  for (const ft of fromTables) await refreshTable(conn, ft, tenantId, userPhone);
  await refreshTable(conn, toTableId, tenantId, userPhone);
  const origin = [...fromTables][0] || null;
  return {
    scope: 'orders',
    movedOrderIds: orderIds,
    createdOrderId: null,
    undo: origin ? { scope: 'orders', orderIds, toTableId: origin } : null,
  };
};

// Split specific lines (with per-line quantities) off a round into a new round on
// the destination table. Leaves the un-moved lines — and their totals — behind.
const moveItems = async (conn, { sourceOrderId, items, toTableId, destOrderNo }, tenantId, userPhone) => {
  const src = await loadOrder(conn, sourceOrderId, tenantId);
  const fromTableId = src.TableId;
  const dest = await loadTable(conn, toTableId, tenantId);
  const lines = asArray(src.Items);

  const moved = [];
  const remaining = lines.map((l) => ({ ...l }));
  const removed = new Set();
  for (const sel of items) {
    const line = lines[sel.index];
    if (!line) throw new HttpError(`Line ${sel.index} not on this order`, 400);
    const orig = lineQty(line);
    const q = Math.min(Number(sel.qty) || orig, orig);
    if (q <= 0) continue;
    if (q >= orig) { moved.push(line); removed.add(sel.index); }
    else { moved.push(scaleLine(line, q)); remaining[sel.index] = remainderLine(line, q); }
  }
  if (moved.length === 0) throw new HttpError('Nothing selected to move', 400);

  const newSource = remaining.filter((_, i) => !removed.has(i));

  // Whole order effectively moved → reassign it rather than create-and-empty.
  if (newSource.length === 0) {
    src.TableId = toTableId;
    src.BranchDetailId = dest.BranchDetailId ?? src.BranchDetailId;
    await restampVenue(conn, src, tenantId);
    await writeOrder(conn, src, userPhone, tenantId);
    await moveKotsToTable(conn, src.Id, toTableId, tenantId, userPhone);
    await refreshTable(conn, fromTableId, tenantId, userPhone);
    await refreshTable(conn, toTableId, tenantId, userPhone);
    return {
      scope: 'items', movedOrderIds: [sourceOrderId], createdOrderId: null,
      undo: { scope: 'orders', orderIds: [sourceOrderId], toTableId: fromTableId },
    };
  }

  // Trim the source to what remains.
  const srcTotals = sumTotals(newSource);
  Object.assign(src, { Items: newSource, ...srcTotals });
  await writeOrder(conn, src, userPhone, tenantId);

  // The moved lines arrive as a fresh round on the destination. Whether the
  // kitchen needs to hear about it depends entirely on whether it already has:
  // if the source round was sent, this food is already cooking and the split
  // round inherits a ticket so the pass knows where to deliver it. If the source
  // was never sent, the split must not conjure one — sending is the cashier's
  // deliberate act, and inventing a ticket here would put uncooked-but-unordered
  // food on the pass.
  const srcWasSent = !!(await findLiveKotTx(conn, sourceOrderId, tenantId));

  const destId = uuidv4();
  const destOrder = {
    Id: destId,
    OrderNo: destOrderNo
      || (await issuePosNumber(conn, 'POS_ORDER', 'ORD', tenantId, userPhone)),
    TableId: toTableId,
    CustomerId: src.CustomerId ?? null,
    OrderType: src.OrderType || 'dinein',
    ChannelId: src.ChannelId ?? null,
    Status: srcWasSent ? 'fired' : 'open',
    Items: moved,
    ...sumTotals(moved),
    BranchDetailId: dest.BranchDetailId ?? src.BranchDetailId,
    ...(await resolveVenueTx(conn, toTableId, tenantId)),
  };
  await insertOrder(conn, destOrder, userPhone, tenantId);
  if (srcWasSent) await writeKot(conn, destOrder, tenantId, userPhone);

  await refreshTable(conn, fromTableId, tenantId, userPhone);
  await refreshTable(conn, toTableId, tenantId, userPhone);
  return {
    scope: 'items',
    sourceOrderId,
    createdOrderId: destId,
    movedOrderIds: [destId],
    // Reverse = fold the created round back into the source round.
    undo: { scope: 'merge', sourceOrderId: destId, targetOrderId: sourceOrderId },
  };
};

// Fold every line of one order into another, then delete the emptied order. Used
// to reverse an item split (merge the new round back into its origin).
const mergeOrders = async (conn, { sourceOrderId, targetOrderId }, tenantId, userPhone) => {
  const src = await loadOrder(conn, sourceOrderId, tenantId);
  const tgt = await loadOrder(conn, targetOrderId, tenantId);
  const merged = [...asArray(tgt.Items), ...asArray(src.Items)];
  Object.assign(tgt, { Items: merged, ...sumTotals(merged) });
  await writeOrder(conn, tgt, userPhone, tenantId);
  // The source's tickets move to the target BEFORE the source row goes: the
  // food is already cooking, and pos_kot.OrderId is a FOREIGN KEY with no
  // ON DELETE, so leaving them behind would fail the delete outright.
  await reassignKots(conn, sourceOrderId, targetOrderId, tgt.TableId, tenantId, userPhone);
  await deleteOrder(conn, sourceOrderId, tenantId);
  await refreshTable(conn, src.TableId, tenantId, userPhone);
  await refreshTable(conn, tgt.TableId, tenantId, userPhone);
  return { scope: 'merge', movedOrderIds: [targetOrderId], deletedOrderId: sourceOrderId, undo: null };
};

// Entry point — dispatches on scope. Runs inside a caller-supplied transaction.
const transfer = (conn, payload, tenantId, userPhone) => {
  switch (payload.scope) {
    case 'orders': return moveOrders(conn, payload, tenantId, userPhone);
    case 'items':  return moveItems(conn, payload, tenantId, userPhone);
    case 'merge':  return mergeOrders(conn, payload, tenantId, userPhone);
    default: throw new HttpError(`Unknown transfer scope: ${payload.scope}`, 400);
  }
};

module.exports = { transfer, refreshTable, sumTotals, scaleLine, remainderLine };
