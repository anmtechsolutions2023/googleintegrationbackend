// src/modules/mastersetup/mastersetup.schemas.js
// Composite Joi schema for the first-time master-data bootstrap endpoint.
//
// The client sends a NESTED tree (no IDs). The orchestrator inserts bottom-up
// inside a single transaction and wires the foreign keys itself, so FK id
// fields are intentionally NOT part of this payload.
//
// EVERY LENGTH COMES FROM utils/fieldLimits.js, not from a literal.
// This file used to accept 200 characters for branchdetail.BranchName, which is
// VARCHAR(50). On the MySQL 8 default sql_mode that is a 500 with the whole
// bootstrap rolled back and a user told "Nothing was saved." with no reason; on a
// non-strict server it is a silent truncation that then prints on every bill.
//
// OPTIONAL FIELDS ARE DECLARED, NOT LEFT TO `.unknown(true)`.
// City, State, Pincode and item.Code used to reach prepareInsertParams through
// `.unknown(true)` with no validation of any kind. That is the same mechanism
// that swallowed the Contact Email box for as long as it existed: a value the
// form collects, the schema waves through, and nothing persists. Every field the
// wizard offers is now named here.

const Joi = require('joi');
const { gstinField } = require('../../utils/gstinSchema');
const { requiredStr, optionalStr } = require('../../utils/fieldLimits');

// ── Leaf nodes ────────────────────────────────────────────────────────────────
const organizationSchema = Joi.object({
  // The legal / group name. Printed on a bill only when the branch switches
  // `legalName` on at Receipt Format → Bill → Header; otherwise it is the label
  // this tenancy carries in the super-admin directory.
  Name: requiredStr('organizationdetail', 'Name'),
}).unknown(true);

const contactAddressTypeSchema = Joi.object({
  Name: requiredStr('contactaddresstype', 'Name'),
}).unknown(true);

const mapProviderSchema = Joi.object({
  ProviderName: Joi.string().max(100).trim().required(),
}).unknown(true);

const locationDetailSchema = Joi.object({
  Lat: Joi.number().required(),
  Lng: Joi.number().required(),
}).unknown(true);

const contactSchema = Joi.object({
  FirstName: requiredStr('contactdetail', 'FirstName'),
  LastName: requiredStr('contactdetail', 'LastName'),
  // All three optional, all three new to the wizard, all three already columns
  // that nothing ever asked about.
  //
  // Email is the one with history: the box has existed since this wizard was
  // written and there was no column behind it until migration 001.
  Email: Joi.string().trim().email({ tlds: { allow: false } })
    .max(100).allow('', null).optional()
    .messages({ 'string.email': 'That does not look like an email address' }),
  // The column is VARCHAR(50); 20 is the tighter rule the rest of the codebase
  // already applies, because a 50-character mobile number is not one.
  MobileNo: Joi.string().trim().max(20).allow('', null).optional(),
  Landline1: Joi.string().trim().max(20).allow('', null).optional(),
}).unknown(true);

// Invoice numbering, decided by the API rather than asked for during signup.
//
// The wizard no longer collects any of this: "where should your invoice numbers
// start" is a question a new tenant cannot answer and does not care about, and
// the two boxes were the last thing standing between them and a working branch.
//
// The ROW is still mandatory and cannot be dropped —
// branchdetail.TransactionTypeConfigId and transactiontype.TransactionTypeConfigId
// are both NOT NULL foreign keys onto transactiontypeconfig, so a branch cannot
// exist without a numbering series behind it. Only who chooses the values moved.
//
// INV-{0000} is the format the numbering service already parses: it reads the
// {0000} placeholder as the zero-padding width, so the first document issued is
// INV-0001. Starting at 1 matches `Number(StartCounterNo) || 1`, the fallback
// transactionNumber.service applies when the column is unreadable.
const NUMBERING_DEFAULTS = {
  START_COUNTER_NO: 1,
  FORMAT: 'INV-{0000}',
  // getOrCreateByTagNameTx finds an existing series BY this tag, which is what
  // makes a repeated run of the wizard reuse the series instead of colliding
  // with UNIQUE(TagName, TenantId). Changing it silently creates a second one.
  TAG_NAME: 'Onboarding',
};

// Every key defaulted, so a caller may send all of it, some of it, or none.
const transactionTypeConfigSchema = Joi.object({
  StartCounterNo: Joi.number()
    .integer()
    .min(0)
    .default(NUMBERING_DEFAULTS.START_COUNTER_NO),
  Format: optionalStr('transactiontypeconfig', 'Format')
    .default(NUMBERING_DEFAULTS.FORMAT),
  TagName: optionalStr('transactiontypeconfig', 'TagName')
    .default(NUMBERING_DEFAULTS.TAG_NAME),
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
  Name: requiredStr('TaxTypes', 'Name'),
  // A string in the column, so a number and '9' both land the same way.
  Value: Joi.alternatives()
    .try(Joi.number().min(0).max(100), Joi.string().max(50).trim())
    .required(),
}).unknown(true);

// Optional as a whole. Absent, blank, or the tenant's own "Exempt (0%)" means the
// starter item is sold tax-free under the Exempt group provisioned earlier in
// the same transaction. A group with any other name still carries rates.
const taxGroupSchema = Joi.object({
  Name: optionalStr('taxgroup', 'Name'),
  taxTypes: Joi.array().items(taxTypeSchema).max(10).optional(),
}).unknown(true);

const categorySchema = Joi.object({
  Name: requiredStr('categorydetail', 'Name'),
}).unknown(true);

const uomSchema = Joi.object({
  UnitName: requiredStr('UOM', 'UnitName'),
}).unknown(true);

// ── Branding ──────────────────────────────────────────────────────────────────
// The two images a bill can carry, offered during signup and editable afterwards
// at Business Profile → Branding.
//
// A data URI rather than a multipart upload: JSON_LIMIT is already 10mb, the
// whole payload is one transactional call, and adding a multipart parser to this
// endpoint would mean the tenancy tree and its pictures arrive by two different
// routes. The bytes are validated and re-measured by posmedia.service BEFORE the
// transaction opens, so a rejected image is a 400 with nothing attempted rather
// than a rolled-back signup.
const dataUriSchema = Joi.string()
  // Length, not bytes: the service decodes and enforces the real byte ceiling.
  // This is only the outer guard that stops a megabyte-long string being parsed.
  .max(1_400_000)
  .pattern(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/)
  .messages({
    'string.pattern.base': 'The image must be a PNG or JPEG data URI',
    'string.max': 'That image is too large. Please use one under 512KB.',
  });

const mediaSchema = Joi.object({
  logo: dataUriSchema.optional(),
  paymentQr: dataUriSchema.optional(),
}).optional();

// ── The GST question ──────────────────────────────────────────────────────────
// Optional, and "not answered" is a real answer with its own meaning.
//
// An ABSENT taxSetting writes NO pos_tax_setting row, which leaves the tenant on
// the table's deliberate "no row means charging" default. Writing GstCharging = 1
// on every signup would look identical today and diverge the moment that default
// is reconsidered — see the note on the table in 01-schema-definition.sql.
const taxSettingSchema = Joi.object({
  gstCharging: Joi.boolean().required(),
  // Required when off, forbidden when on: "not charging" is not a complete
  // answer, because which KIND of off decides what the paper must say.
  offReason: Joi.when('gstCharging', {
    is: false,
    then: Joi.string().valid('composition', 'unregistered').required(),
    otherwise: Joi.valid(null, '').optional(),
  }),
}).optional();

// ── Composed nodes ────────────────────────────────────────────────────────────
const locationMapperSchema = Joi.object({
  TagName: Joi.string().max(100).trim().required(),
  mapProvider: mapProviderSchema.required(),
  locationDetail: locationDetailSchema.required(),
}).unknown(true);

const addressSchema = Joi.object({
  AddressLine1: requiredStr('addressdetail', 'AddressLine1'),
  TagName: requiredStr('addressdetail', 'TagName'),
  // Declared rather than waved through. These four reached the INSERT via
  // `.unknown(true)` with no length check at all.
  AddressLine2: optionalStr('addressdetail', 'AddressLine2'),
  City: optionalStr('addressdetail', 'City'),
  State: optionalStr('addressdetail', 'State'),
  Pincode: optionalStr('addressdetail', 'Pincode'),
  Landmark: optionalStr('addressdetail', 'Landmark'),
  contactAddressType: contactAddressTypeSchema.required(),
  // Location Mapper is optional. When present it must be the full chain
  // (mapProvider + locationDetail + TagName); when absent the address is
  // created with a null MapProviderLocationMapperId.
  locationMapper: locationMapperSchema.optional(),
}).unknown(true);

const branchSchema = Joi.object({
  Name: requiredStr('branchdetail', 'BranchName'),
  // Optional. A new restaurant may not be registered yet, and it can be added
  // later from Business Profile → Tax & Compliance.
  GSTIN: gstinField.optional(),
  // The rest of the branch's tax identity. All optional, all editable later at
  // Business Profile → Tax & Compliance, none of them printed unless the branch
  // switches the matching Receipt Format field on.
  PAN: optionalStr('branchdetail', 'PAN'),
  TINNo: optionalStr('branchdetail', 'TINNo'),
  FSSAI: optionalStr('branchdetail', 'FSSAI'),
  address: addressSchema.required(),
  contact: contactSchema.required(),
  media: mediaSchema,
  // Absent from the wizard's payload entirely now. Spelled out rather than
  // `.default({})` because Joi applies a key's own defaults only to an object
  // that is PRESENT — an empty default would reach the orchestrator with no
  // TagName and fail getOrCreateByTagNameTx's reuse lookup.
  transactionTypeConfig: transactionTypeConfigSchema.default({
    StartCounterNo: NUMBERING_DEFAULTS.START_COUNTER_NO,
    Format: NUMBERING_DEFAULTS.FORMAT,
    TagName: NUMBERING_DEFAULTS.TAG_NAME,
  }),
}).unknown(true);

const costInfoSchema = Joi.object({
  Amount: Joi.number().required(),
  taxGroup: taxGroupSchema.optional(),
}).unknown(true);

const itemSchema = Joi.object({
  Name: requiredStr('itemdetail', 'Name'),
  Code: optionalStr('itemdetail', 'Code'),
  category: categorySchema.required(),
  uom: uomSchema.required(),
  costInfo: costInfoSchema.required(),
}).unknown(true);

// ── Root ──────────────────────────────────────────────────────────────────────
// organization + branch are mandatory (a branch needs all four NOT NULL FKs);
// item and taxSetting are optional.
const bootstrapSchema = Joi.object({
  organization: organizationSchema.required(),
  branch: branchSchema.required(),
  item: itemSchema.optional(),
  taxSetting: taxSettingSchema,
});

module.exports = { bootstrapSchema, NUMBERING_DEFAULTS };
