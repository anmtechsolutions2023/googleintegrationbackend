// src/modules/mastersetup/mastersetup.schemas.js
// Composite Joi schema for the first-time master-data bootstrap endpoint.
//
// The client sends a NESTED tree (no IDs). The orchestrator inserts bottom-up
// inside a single transaction and wires the foreign keys itself, so FK id
// fields are intentionally NOT part of this payload.
//
// Each node validates the fields the DB requires as NOT NULL and allows any
// other module-supported optional field to pass through (`.unknown(true)`),
// because each module's prepareInsertParams remains the source of truth for
// what actually gets persisted.

const Joi = require('joi');

// ── Leaf nodes ────────────────────────────────────────────────────────────────
const organizationSchema = Joi.object({
  Name: Joi.string().max(200).trim().required(),
}).unknown(true);

const contactAddressTypeSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
}).unknown(true);

const mapProviderSchema = Joi.object({
  ProviderName: Joi.string().max(100).trim().required(),
}).unknown(true);

const locationDetailSchema = Joi.object({
  Lat: Joi.number().required(),
  Lng: Joi.number().required(),
}).unknown(true);

const contactSchema = Joi.object({
  FirstName: Joi.string().max(100).trim().required(),
  LastName: Joi.string().max(100).trim().required(),
}).unknown(true);

const transactionTypeConfigSchema = Joi.object({
  StartCounterNo: Joi.number().integer().min(0).required(),
  Format: Joi.string().max(100).trim().required(),
  TagName: Joi.string().max(100).trim().required(),
}).unknown(true);

// A tax group is a CONTAINER — the rates live in TaxTypes mapped into it, and a
// group with none prices at 0%. Naming one "GST 18%" and stopping there is what
// produced a starter item that billed no tax at all, so the rates are part of
// the payload rather than something the wizard hopes somebody adds later.
//
// Optional, not required: when absent the orchestrator applies the same
// standard split the bulk import applies, and the UI announces it before
// sending. Requiring it would break every caller that already posts a bare
// { Name }.
const taxTypeSchema = Joi.object({
  Name: Joi.string().max(50).trim().required(),
  // A string in the column, so a number and '9' both land the same way.
  Value: Joi.alternatives()
    .try(Joi.number().min(0).max(100), Joi.string().max(50).trim())
    .required(),
}).unknown(true);

const taxGroupSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
  taxTypes: Joi.array().items(taxTypeSchema).min(1).max(10).optional(),
}).unknown(true);

const categorySchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
}).unknown(true);

const uomSchema = Joi.object({
  UnitName: Joi.string().max(100).trim().required(),
}).unknown(true);

// ── Composed nodes ────────────────────────────────────────────────────────────
const locationMapperSchema = Joi.object({
  TagName: Joi.string().max(100).trim().required(),
  mapProvider: mapProviderSchema.required(),
  locationDetail: locationDetailSchema.required(),
}).unknown(true);

const addressSchema = Joi.object({
  AddressLine1: Joi.string().max(50).trim().required(),
  TagName: Joi.string().max(100).trim().required(),
  contactAddressType: contactAddressTypeSchema.required(),
  // Location Mapper is optional. When present it must be the full chain
  // (mapProvider + locationDetail + TagName); when absent the address is
  // created with a null MapProviderLocationMapperId.
  locationMapper: locationMapperSchema.optional(),
}).unknown(true);

const branchSchema = Joi.object({
  Name: Joi.string().max(200).trim().required(),
  address: addressSchema.required(),
  contact: contactSchema.required(),
  transactionTypeConfig: transactionTypeConfigSchema.required(),
}).unknown(true);

const costInfoSchema = Joi.object({
  Amount: Joi.number().required(),
  taxGroup: taxGroupSchema.required(),
}).unknown(true);

const itemSchema = Joi.object({
  Name: Joi.string().max(200).trim().required(),
  category: categorySchema.required(),
  uom: uomSchema.required(),
  costInfo: costInfoSchema.required(),
}).unknown(true);

// ── Root ──────────────────────────────────────────────────────────────────────
// organization + branch are mandatory (a branch needs all four NOT NULL FKs);
// item is optional.
const bootstrapSchema = Joi.object({
  organization: organizationSchema.required(),
  branch: branchSchema.required(),
  item: itemSchema.optional(),
});

module.exports = { bootstrapSchema };
