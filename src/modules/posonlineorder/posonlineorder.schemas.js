// src/modules/posonlineorder/posonlineorder.schemas.js
// Joi validation schemas for POS Online Order operations.

const Joi = require('joi');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');
const {
  POS_ONLINE_ORDER_STATUSES,
  POS_ONLINE_ORDER_REJECT_REASONS,
  KPT,
} = require('../../config/constants');

// Canonical lowercase enum, normalized on write. Status was free text, so
// 'Waiting' and 'waiting' could both be stored and every reader had to guess.
const statusField = Joi.string().lowercase().valid(...POS_ONLINE_ORDER_STATUSES);

const jsonCol = Joi.alternatives(Joi.object(), Joi.array()).allow(null);
const money = Joi.number().min(0).precision(2);

// One normalized line as ingest resolved it. Kept permissive on the unmapped
// branch: a line that matched nothing still has to be storable, complete with
// whatever the portal called it.
const lineSchema = Joi.object({
  unmapped: Joi.boolean().optional(),
  externalItemId: Joi.string().max(100).optional().allow(null, ''),
  ItemMetaId: optionalEntityId,
  ItemDetailId: optionalEntityId,
  CostInfoId: optionalEntityId,
  PriceSource: Joi.string().max(20).optional().allow(null, ''),
  name: Joi.string().max(255).optional().allow(null, ''),
  qty: Joi.number().min(0).optional(),
  unitPrice: money.optional(),
  netAmount: money.optional(),
  taxAmount: money.optional(),
  grossAmount: money.optional(),
  addOns: Joi.array().optional(),
  notes: Joi.string().max(500).optional().allow(null, ''),
}).unknown(true);

// Fields shared by create and update. Written once so the two cannot drift.
const commonFields = {
  PortalId: optionalEntityId,
  OrderId: optionalEntityId,
  PortalBranchId: optionalEntityId,
  ExternalRef: Joi.string().optional().max(100).allow(null, '').trim(),
  Payload: jsonCol.optional(),
  OrderLines: Joi.array().items(lineSchema).optional().allow(null),
  HasUnmappedLines: Joi.boolean().optional(),
  CustomerName: Joi.string().max(100).optional().allow(null, '').trim(),
  CustomerPhone: Joi.string().max(30).optional().allow(null, '').trim(),
  ExternalCustomerRef: Joi.string().max(100).optional().allow(null, '').trim(),
  ItemsTotal: money.optional(),
  PortalDiscount: money.optional(),
  PackingCharge: money.optional(),
  DeliveryCharge: money.optional(),
  TaxAmount: money.optional(),
  GrossAmount: money.optional(),
  CommissionAmount: money.optional(),
  NetPayout: money.optional(),
  IsPrepaid: Joi.boolean().optional(),
  PlacedOn: Joi.date().optional().allow(null),
  PromisedOn: Joi.date().optional().allow(null),
  AcceptedOn: Joi.date().optional().allow(null),
  ReadyOn: Joi.date().optional().allow(null),
  PickedUpOn: Joi.date().optional().allow(null),
  DeliveredOn: Joi.date().optional().allow(null),
  RiderName: Joi.string().max(100).optional().allow(null, '').trim(),
  RiderPhone: Joi.string().max(30).optional().allow(null, '').trim(),
  CancelReason: Joi.string().max(255).optional().allow(null, '').trim(),
  CancelledBy: Joi.string().max(50).optional().allow(null, '').trim(),
  BranchDetailId: optionalEntityId,
  // What the customer asked the KITCHEN for, as opposed to what they ordered.
  // Order-level; per-dish instructions ride on each line's `notes`.
  // 500 matches the column — a Joi rule looser than its column turns a clear
  // 400 into a 500 from MySQL.
  CookingInstructions: Joi.string().max(500).optional().allow(null, '').trim(),
  // A flag rather than a phrase to grep for inside the instructions: the person
  // bagging the order acts on it without reading the cooking notes.
  NoCutlery: Joi.boolean().optional(),
};

// Read-only columns the list and detail reads join in. An edit form is seeded
// from a GET response, so they ride straight back on the next PUT — accept them
// and drop them rather than rejecting the whole update.
const echoedReadOnly = {
  PortalName: Joi.any().optional().strip(),
  PortalCode: Joi.any().optional().strip(),
  ColorHex: Joi.any().optional().strip(),
  ShortCode: Joi.any().optional().strip(),
  CommissionPct: Joi.any().optional().strip(),
  SettlementPaymentModeId: Joi.any().optional().strip(),
  CommissionAccountTypeBaseId: Joi.any().optional().strip(),
  BranchName: Joi.any().optional().strip(),
  OrderNo: Joi.any().optional().strip(),
  OrderStatus: Joi.any().optional().strip(),
};

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ONLINE_ORDER),
  ...commonFields,
  ...echoedReadOnly,
  // Kept required and kept a string: it is the portal's name AS IT WAS, a
  // snapshot rather than a lookup, so an order still says where it came from
  // after the portal is renamed or retired.
  Platform: Joi.string().required().max(50).allow(null).trim(),
  Status: statusField.optional().allow(null, '').default('new'),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ONLINE_ORDER),
  ...commonFields,
  ...echoedReadOnly,
  Platform: Joi.string().optional().max(50).allow(null, '').trim(),
  Status: statusField.optional().allow(null, ''),
  Active: Joi.boolean().optional(),
}).min(1);

// ── Domain actions ──────────────────────────────────────────────────────────

// Accepting is the act that turns a portal order into a pos_order, a KOT and
// eventually a ledger document. FireKot defaults to true because an accepted
// order that nobody is cooking is the failure this feature exists to remove.
const acceptSchema = Joi.object({
  FireKot: Joi.boolean().optional().default(true),
  // Kitchen Preparation Time, in minutes — what we promise the portal.
  //
  // OPTIONAL, and omitting it is the normal case: the server then derives one
  // from the slowest dish on the order, falling back to the branch setting.
  // Sending a value overrides that, because the person at the pass can see the
  // kitchen and nothing on the server can.
  //
  // Bounds are advisory here — the service clamps rather than rejects, so a
  // mistyped 200 does not fail an accept when 120 is obviously meant.
  KptMinutes: Joi.number()
    .integer()
    .min(KPT.MIN_MINUTES)
    .max(KPT.MAX_MINUTES)
    .optional()
    .allow(null),
});

// Portals require a coded reason, so this takes one rather than free text.
const rejectSchema = Joi.object({
  Reason: Joi.string().valid(...POS_ONLINE_ORDER_REJECT_REASONS).required(),
  Note: Joi.string().max(255).optional().allow(null, ''),
});

// The single writer for every stage change after accept. Which moves are legal
// is decided by POS_ONLINE_ORDER_TRANSITIONS in the service, not here — a
// schema can say the word exists, not that the move is allowed from where the
// order currently is.
const statusSchema = Joi.object({
  Status: statusField.required(),
  Reason: Joi.string().valid(...POS_ONLINE_ORDER_REJECT_REASONS).optional().allow(null, ''),
});

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

// The expo queue's filters. Statuses arrive as a comma-separated list because
// this is a GET and a screen toggles them.
const queueQuerySchema = Joi.object({
  branchId: entityId.optional().allow(null, ''),
  statuses: Joi.string().max(200).optional().allow(null, ''),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  acceptSchema,
  rejectSchema,
  statusSchema,
  paginationSchema,
  queueQuerySchema,
  uuidParamSchema,
};
