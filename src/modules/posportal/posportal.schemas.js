// src/modules/posportal/posportal.schemas.js
// Joi validation for the portal master, its store mappings and its listings.

const Joi = require('joi');
const {
  POS_PORTAL_ADAPTERS,
  POS_PORTAL_SYNC_STATUSES,
} = require('../../config/constants');

// The adapter is resolved from a registry, so only a slug the registry knows is
// accepted. A typo would otherwise silently fall back to 'manual' and a portal
// would stop taking webhooks with no visible reason.
const adapterField = Joi.string().valid(...POS_PORTAL_ADAPTERS);

// A hex colour, because the queue paints a portal's rail from it. Validated
// rather than trusted: this value is interpolated into a style, so anything
// that is not a colour has no business being stored.
const colorField = Joi.string().pattern(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  .message('ColorHex must be a hex colour such as #E23744');

// Two characters. The monogram is what makes the queue readable without relying
// on colour alone, which matters for a colour-blind cashier and for a counter
// tablet under kitchen lights.
const shortCodeField = Joi.string().max(4).trim();

const createSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().uppercase().required(),
  // Defaulted to the tenant's ONLINE channel by the service when omitted.
  ChannelId: Joi.string().uuid().optional().allow(null),
  Adapter: adapterField.optional().default('manual'),
  ColorHex: colorField.optional().allow(null, ''),
  ShortCode: shortCodeField.optional().allow(null, ''),
  CommissionPct: Joi.number().min(0).max(100).precision(3).optional().default(0),
  CommissionAccountTypeBaseId: Joi.string().uuid().optional().allow(null),
  SettlementPaymentModeId: Joi.string().uuid().optional().allow(null),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().uppercase().optional(),
  ChannelId: Joi.string().uuid().optional().allow(null),
  Adapter: adapterField.optional(),
  ColorHex: colorField.optional().allow(null, ''),
  ShortCode: shortCodeField.optional().allow(null, ''),
  CommissionPct: Joi.number().min(0).max(100).precision(3).optional(),
  CommissionAccountTypeBaseId: Joi.string().uuid().optional().allow(null),
  SettlementPaymentModeId: Joi.string().uuid().optional().allow(null),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
  // Read-only columns the list view joins in. An edit form is seeded from a GET,
  // so these come straight back on the next PUT — accept and drop them rather
  // than rejecting the whole update. Same treatment as CostInfoAmount on menu
  // items and TaxBreakdown on anything the pricing enricher touches.
  ChannelName: Joi.any().optional().strip(),
  ChannelCode: Joi.any().optional().strip(),
  ListingCount: Joi.any().optional().strip(),
  UnsyncedCount: Joi.any().optional().strip(),
  OpenOrderCount: Joi.any().optional().strip(),
}).min(1);

// Secrets are write-only. No GET anywhere returns them, and this schema exists
// so a form can send only the fields it is changing without blanking the rest.
const credentialSchema = Joi.object({
  WebhookSecret: Joi.string().max(255).optional().allow(null, ''),
  ApiKey: Joi.string().max(255).optional().allow(null, ''),
  ApiSecret: Joi.string().max(255).optional().allow(null, ''),
  ApiBaseUrl: Joi.string().uri().max(255).optional().allow(null, ''),
  TokenExpiresOn: Joi.date().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

// ── Store mappings ──────────────────────────────────────────────────────────

const branchCreateSchema = Joi.object({
  PortalId: Joi.string().uuid().required(),
  BranchDetailId: Joi.string().uuid().required(),
  ExternalStoreId: Joi.string().max(100).trim().optional().allow(null, ''),
  IsOnline: Joi.boolean().optional().default(true),
  PausedUntil: Joi.date().optional().allow(null),
  PauseReason: Joi.string().max(255).optional().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const branchUpdateSchema = Joi.object({
  PortalId: Joi.string().uuid().optional(),
  BranchDetailId: Joi.string().uuid().optional(),
  ExternalStoreId: Joi.string().max(100).trim().optional().allow(null, ''),
  IsOnline: Joi.boolean().optional(),
  PausedUntil: Joi.date().optional().allow(null),
  PauseReason: Joi.string().max(255).optional().allow(null, ''),
  Active: Joi.boolean().optional(),
  BranchName: Joi.any().optional().strip(),
  PortalName: Joi.any().optional().strip(),
  PortalCode: Joi.any().optional().strip(),
  ColorHex: Joi.any().optional().strip(),
  ShortCode: Joi.any().optional().strip(),
}).min(1);

// The kill switch. PauseMinutes is advisory — it records when somebody meant to
// reopen so the queue can count down; nothing auto-resumes.
const setOnlineSchema = Joi.object({
  IsOnline: Joi.boolean().required(),
  PauseMinutes: Joi.number().integer().min(1).max(1440).optional().allow(null),
  PauseReason: Joi.string().max(255).optional().allow(null, ''),
});

// ── Listings ────────────────────────────────────────────────────────────────

const listingCreateSchema = Joi.object({
  PortalId: Joi.string().uuid().required(),
  ItemMetaId: Joi.string().uuid().required(),
  ExternalItemId: Joi.string().max(100).trim().optional().allow(null, ''),
  ListedName: Joi.string().max(255).trim().optional().allow(null, ''),
  ListedDescription: Joi.string().max(1000).trim().optional().allow(null, ''),
  // A costinfo row, never a bare price — see posportal.pricing.js.
  PriceOverrideCostInfoId: Joi.string().uuid().optional().allow(null),
  Available: Joi.boolean().optional().default(true),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const listingUpdateSchema = Joi.object({
  ExternalItemId: Joi.string().max(100).trim().optional().allow(null, ''),
  ListedName: Joi.string().max(255).trim().optional().allow(null, ''),
  ListedDescription: Joi.string().max(1000).trim().optional().allow(null, ''),
  PriceOverrideCostInfoId: Joi.string().uuid().optional().allow(null),
  Available: Joi.boolean().optional(),
  SortOrder: Joi.number().integer().optional(),
  SyncStatus: Joi.string().valid(...POS_PORTAL_SYNC_STATUSES).optional(),
  SyncError: Joi.string().max(500).optional().allow(null, ''),
  LastSyncedOn: Joi.date().optional().allow(null),
  Active: Joi.boolean().optional(),
  // PortalId/ItemMetaId are the listing's identity: changing either would make
  // it a different listing and silently bypass the channel gate checked at
  // create. Re-list instead.
  PortalId: Joi.any().optional().strip(),
  ItemMetaId: Joi.any().optional().strip(),
  // Joined read-only columns echoed back by an edit form.
  ItemName: Joi.any().optional().strip(),
  ItemCode: Joi.any().optional().strip(),
  ItemDetailId: Joi.any().optional().strip(),
  BranchDetailId: Joi.any().optional().strip(),
  BaseCostInfoId: Joi.any().optional().strip(),
  BaseAmount: Joi.any().optional().strip(),
  OverrideAmount: Joi.any().optional().strip(),
  PortalName: Joi.any().optional().strip(),
  PortalCode: Joi.any().optional().strip(),
  EffectiveCostInfoId: Joi.any().optional().strip(),
  PriceSource: Joi.any().optional().strip(),
  TaxBreakdown: Joi.any().optional().strip(),
}).min(1);

// The operation the listings screen exists for: 200 dishes across 3 portals is
// 600 decisions, and a PUT per row is not a workflow.
const bulkAvailabilitySchema = Joi.object({
  ListingIds: Joi.array().items(Joi.string().uuid()).min(1).max(500).required(),
  Available: Joi.boolean().required(),
});

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createSchema,
  updateSchema,
  credentialSchema,
  branchCreateSchema,
  branchUpdateSchema,
  setOnlineSchema,
  listingCreateSchema,
  listingUpdateSchema,
  bulkAvailabilitySchema,
  paginationSchema,
  uuidParamSchema,
};
