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

const writeOrder = (conn, o, userEmail, tenantId) =>
  conn.execute(QUERIES.POS_ORDER.UPDATE, [
    o.OrderNo, o.TableId, o.CustomerId ?? null, o.OrderType ?? null, o.Status ?? null,
    toJson(o.Items), o.SubTotal, o.TaxAmount, o.Total, o.BranchDetailId ?? null,
    o.Active != null ? o.Active : 1, userEmail, o.Id, tenantId,
  ]);

const insertOrder = (conn, o, userEmail, tenantId) =>
  conn.execute(QUERIES.POS_ORDER.INSERT, [
    o.Id, tenantId, o.OrderNo, o.TableId, o.CustomerId ?? null, o.OrderType ?? 'Dine-in',
    o.Status ?? 'Active', toJson(o.Items), o.SubTotal, o.TaxAmount, o.Total,
    o.BranchDetailId ?? null, 1, userEmail, userEmail,
  ]);

const deleteOrder = (conn, id, tenantId) =>
  conn.execute(QUERIES.POS_ORDER.DELETE, [id, tenantId]);

// Re-derive a table's occupancy from its remaining open orders — the source may
// have emptied and the destination may have just become occupied.
const refreshTable = async (conn, tableId, tenantId, userEmail) => {
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
    t.Name, t.FloorId, t.Capacity, occupied ? 'Occupied' : 'Available',
    occupied ? open[0].Id : null, t.BranchDetailId, t.Active != null ? t.Active : 1,
    userEmail, tableId, tenantId,
  ]);
};

// ── Operations ───────────────────────────────────────────────────────────────

// Reassign whole orders (one round, or a table's every round) to another table.
const moveOrders = async (conn, { orderIds, toTableId }, tenantId, userEmail) => {
  const dest = await loadTable(conn, toTableId, tenantId);
  const fromTables = new Set();
  for (const id of orderIds) {
    const o = await loadOrder(conn, id, tenantId);
    if (!CLOSED.has(String(o.Status || '').toLowerCase())) {
      fromTables.add(o.TableId);
      o.TableId = toTableId;
      o.BranchDetailId = dest.BranchDetailId ?? o.BranchDetailId;
      await writeOrder(conn, o, userEmail, tenantId);
    }
  }
  for (const ft of fromTables) await refreshTable(conn, ft, tenantId, userEmail);
  await refreshTable(conn, toTableId, tenantId, userEmail);
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
const moveItems = async (conn, { sourceOrderId, items, toTableId, destOrderNo }, tenantId, userEmail) => {
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
    await writeOrder(conn, src, userEmail, tenantId);
    await refreshTable(conn, fromTableId, tenantId, userEmail);
    await refreshTable(conn, toTableId, tenantId, userEmail);
    return {
      scope: 'items', movedOrderIds: [sourceOrderId], createdOrderId: null,
      undo: { scope: 'orders', orderIds: [sourceOrderId], toTableId: fromTableId },
    };
  }

  // Trim the source to what remains.
  const srcTotals = sumTotals(newSource);
  Object.assign(src, { Items: newSource, ...srcTotals });
  await writeOrder(conn, src, userEmail, tenantId);

  // The moved lines arrive as a fresh round on the destination.
  const destId = uuidv4();
  const destOrder = {
    Id: destId,
    OrderNo: destOrderNo || `ORD-${Date.now().toString().slice(-6)}`,
    TableId: toTableId,
    CustomerId: src.CustomerId ?? null,
    OrderType: src.OrderType || 'Dine-in',
    Status: 'Active',
    Items: moved,
    ...sumTotals(moved),
    BranchDetailId: dest.BranchDetailId ?? src.BranchDetailId,
  };
  await insertOrder(conn, destOrder, userEmail, tenantId);

  await refreshTable(conn, fromTableId, tenantId, userEmail);
  await refreshTable(conn, toTableId, tenantId, userEmail);
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
const mergeOrders = async (conn, { sourceOrderId, targetOrderId }, tenantId, userEmail) => {
  const src = await loadOrder(conn, sourceOrderId, tenantId);
  const tgt = await loadOrder(conn, targetOrderId, tenantId);
  const merged = [...asArray(tgt.Items), ...asArray(src.Items)];
  Object.assign(tgt, { Items: merged, ...sumTotals(merged) });
  await writeOrder(conn, tgt, userEmail, tenantId);
  await deleteOrder(conn, sourceOrderId, tenantId);
  await refreshTable(conn, src.TableId, tenantId, userEmail);
  await refreshTable(conn, tgt.TableId, tenantId, userEmail);
  return { scope: 'merge', movedOrderIds: [targetOrderId], deletedOrderId: sourceOrderId, undo: null };
};

// Entry point — dispatches on scope. Runs inside a caller-supplied transaction.
const transfer = (conn, payload, tenantId, userEmail) => {
  switch (payload.scope) {
    case 'orders': return moveOrders(conn, payload, tenantId, userEmail);
    case 'items':  return moveItems(conn, payload, tenantId, userEmail);
    case 'merge':  return mergeOrders(conn, payload, tenantId, userEmail);
    default: throw new HttpError(`Unknown transfer scope: ${payload.scope}`, 400);
  }
};

module.exports = { transfer, refreshTable, sumTotals, scaleLine, remainderLine };
