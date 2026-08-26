// src/modules/posportal/adapters/index.js
// The registry. Portals are resolved from DATA — pos_portal.Adapter holds a
// slug and this maps it to an instance.
//
// There is no `switch (platform)` anywhere in this codebase and there must not
// become one: that is the difference between adding District being one row and
// one file, and being a hunt through the ingest service, the queue, the reports
// and the ledger for places that name a portal.
//
// ── The three concrete portals ──────────────────────────────────────────────
// Each is a DECLARATION over HttpAggregatorAdapter: a signature config, a
// field map and a status map. The maps below are written against each portal's
// published webhook shape and are the one part of this feature that must be
// checked against a real captured payload before the portal is moved off
// 'manual'. Until then a portal runs on ManualAdapter and the entire pipeline
// downstream still works — see manual.adapter.js.

const ManualAdapter = require('./manual.adapter');
const { HttpAggregatorAdapter } = require('./httpAggregator.adapter');
const { POS_PORTAL_DEFAULT_ADAPTER } = require('../../../config/constants');

// Our five live stages, as the aggregators tend to word them. Unmapped words
// resolve to null and the ingest service leaves the order where it is, which is
// the safe direction: a status we do not understand must not close an order.
const COMMON_STATUS_MAP = {
  NEW: 'new',
  PLACED: 'new',
  CREATED: 'new',
  ACKNOWLEDGED: 'accepted',
  ACCEPTED: 'accepted',
  CONFIRMED: 'accepted',
  PREPARING: 'processing',
  IN_KITCHEN: 'processing',
  FOOD_READY: 'processing',
  READY: 'processing',
  PICKED_UP: 'out for delivery',
  DISPATCHED: 'out for delivery',
  OUT_FOR_DELIVERY: 'out for delivery',
  DELIVERED: 'delivered',
  COMPLETED: 'delivered',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  REJECTED: 'cancelled',
};

// Field paths shared by all three, overridden per portal where they differ.
const COMMON_FIELDS = {
  externalRef: 'order.id',
  externalStoreId: 'order.outlet_id',
  eventType: 'event',
  placedOn: 'order.placed_at',
  promisedOn: 'order.promised_at',
  prepaid: 'order.is_prepaid',
  status: 'order.status',
  customerName: 'order.customer.name',
  customerPhone: 'order.customer.phone',
  customerRef: 'order.customer.id',
  lines: 'order.items',
  lineItemId: 'id',
  lineName: 'name',
  lineQty: 'quantity',
  lineUnitPrice: 'unit_price',
  lineAddOns: 'addons',
  lineNotes: 'instructions',
  totalItems: 'order.totals.subtotal',
  totalDiscount: 'order.totals.discount',
  totalPacking: 'order.totals.packing_charge',
  totalDelivery: 'order.totals.delivery_charge',
  totalTax: 'order.totals.tax',
  totalGross: 'order.totals.total',
  totalCommission: 'order.totals.commission',
  totalNetPayout: 'order.totals.net_payout',
  riderName: 'order.rider.name',
  riderPhone: 'order.rider.phone',
};

const zomato = new HttpAggregatorAdapter('zomato.v1', {
  signature: { header: 'x-zomato-signature', algorithm: 'sha256', encoding: 'hex' },
  fields: { ...COMMON_FIELDS, externalStoreId: 'order.res_id' },
  statusMap: COMMON_STATUS_MAP,
  endpoints: { status: 'orders/:ref/status', menu: 'menu/publish' },
});

const swiggy = new HttpAggregatorAdapter('swiggy.v1', {
  signature: { header: 'x-swiggy-signature', algorithm: 'sha256', encoding: 'hex' },
  fields: { ...COMMON_FIELDS, externalStoreId: 'order.restaurant_id' },
  statusMap: COMMON_STATUS_MAP,
  endpoints: { status: 'orders/:ref/status', menu: 'catalog/publish' },
});

const district = new HttpAggregatorAdapter('district.v1', {
  signature: { header: 'x-district-signature', algorithm: 'sha256', encoding: 'base64' },
  fields: { ...COMMON_FIELDS, externalStoreId: 'order.store_id' },
  statusMap: COMMON_STATUS_MAP,
  endpoints: { status: 'orders/:ref/status', menu: 'menu/sync' },
});

const manual = new ManualAdapter();

const REGISTRY = {
  manual,
  'zomato.v1': zomato,
  'swiggy.v1': swiggy,
  'district.v1': district,
};

/**
 * The adapter for a portal.
 *
 * Falls back to `manual` rather than throwing: a portal row naming an adapter
 * that has been removed is a configuration problem, and the right failure mode
 * is "orders have to be keyed in" rather than "the queue 500s".
 *
 * @param {string} slug - pos_portal.Adapter
 * @returns {BaseAdapter}
 */
const resolveAdapter = (slug) => REGISTRY[slug] || REGISTRY[POS_PORTAL_DEFAULT_ADAPTER];

/** @returns {Array<string>} every registered slug — used to validate a portal write. */
const listAdapters = () => Object.keys(REGISTRY);

module.exports = { resolveAdapter, listAdapters, REGISTRY, COMMON_STATUS_MAP, COMMON_FIELDS };
