// src/modules/businessprofile/businessprofile.schemas.js
//
// Every length comes from utils/fieldLimits, so this screen cannot accept a value
// the column will not hold — the whole point of that module.
//
// EVERY FIELD IS OPTIONAL, AND THAT IS DELIBERATE. The screen has five tabs and
// saves the one in front of the user. A schema that required a section would force
// the Address tab to post the contact back unchanged, which is how a stale form
// overwrites a change someone else made a minute ago. Absent means "not mine to
// touch"; '' means the user cleared the box. See `pick()` in the service.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { gstinField } = require('../../utils/gstinSchema');
const { optionalStr, maxOf } = require('../../utils/fieldLimits');

const branchQuerySchema = Joi.object({
  branchId: entityId.required(),
});

const businessSchema = Joi.object({
  legalName: optionalStr('organizationdetail', 'Name'),
  // The outlet name. Not allowed to be blank: it is what a bill's masthead prints
  // and `shopName` is locked ALWAYS in the catalogue, so an empty one would print
  // a bill with no name on it.
  branchName: Joi.string().trim().min(1).max(maxOf('branchdetail', 'BranchName')),
});

const addressSchema = Joi.object({
  addressLine1: Joi.string().trim().min(1).max(maxOf('addressdetail', 'AddressLine1')),
  addressLine2: optionalStr('addressdetail', 'AddressLine2'),
  city: optionalStr('addressdetail', 'City'),
  state: optionalStr('addressdetail', 'State'),
  pincode: optionalStr('addressdetail', 'Pincode'),
  landmark: optionalStr('addressdetail', 'Landmark'),
});

const contactSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(maxOf('contactdetail', 'FirstName')),
  lastName: Joi.string().trim().min(1).max(maxOf('contactdetail', 'LastName')),
  // `tlds: false` because a valid address on a domain Joi's list does not know is
  // still a valid address, and refusing it would be wrong in a way the user cannot
  // fix.
  email: Joi.string().trim().email({ tlds: { allow: false } })
    .max(maxOf('contactdetail', 'Email')).allow('', null)
    .messages({ 'string.email': 'That does not look like an email address' }),
  mobileNo: Joi.string().trim().max(20).allow('', null),
  landline1: Joi.string().trim().max(20).allow('', null),
});

const taxSchema = Joi.object({
  // The same rule as every other door onto this column — 15 characters, a real
  // state code, normalised and upper-cased. Blank clears it.
  gstin: gstinField,
  pan: optionalStr('branchdetail', 'PAN'),
  tin: optionalStr('branchdetail', 'TINNo'),
  fssai: optionalStr('branchdetail', 'FSSAI'),
  // gstCharging / offReason are deliberately NOT here. The switch re-prices every
  // future bill and is refused while a round is open; it goes through
  // PUT /api/pos/tax-settings so that guard cannot be bypassed by saving a form.
});

const updateSchema = Joi.object({
  business: businessSchema,
  address: addressSchema,
  contact: contactSchema,
  tax: taxSchema,
}).min(1).messages({
  'object.min': 'Nothing to save.',
});

module.exports = { branchQuerySchema, updateSchema };
