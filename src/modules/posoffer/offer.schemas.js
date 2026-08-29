// src/modules/posoffer/offer.schemas.js
//
// Joi checks the ENVELOPE — types, lengths, whether a uuid is a uuid. Whether a
// rule makes sense as a rule (a trigger with no item, a reward that gives the
// whole cart away) is offer.service.assertCoherent, because that judgement
// needs the whole object at once and belongs beside the rule engine it protects.

const Joi = require('joi');
const { TRIGGER, REWARD, APPLY_TO } = require('./offer.evaluator');

const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });

const campaignSchema = Joi.object({
  Name: Joi.string().max(150).trim().required(),
  Code: Joi.string().max(50).trim().uppercase().required(),
  Description: Joi.string().max(500).allow('', null),
  StartsOn: Joi.date().iso().required(),
  EndsOn: Joi.date().iso().min(Joi.ref('StartsOn')).allow(null),
  // ISO weekday numbers, 1=Mon..7=Sun. "Weekends only" is data, not a second
  // kind of campaign.
  DaysOfWeek: Joi.string().pattern(/^[1-7](,[1-7])*$/).allow('', null),
  StartTime: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).allow('', null),
  EndTime: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).allow('', null),
  // Allowed to be null — an uncapped campaign is an open tab with a marketing
  // name on it, but it is the operator's call to make.
  BudgetAmount: Joi.number().min(0).allow(null),
  Status: Joi.string().valid('DRAFT', 'ACTIVE', 'PAUSED'),
  // Empty means EVERY branch.
  branchIds: Joi.array().items(Joi.string().uuid()).max(200),
});

const campaignUpdateSchema = campaignSchema.fork(
  ['Name', 'Code', 'StartsOn'], (f) => f.optional(),
).min(1);

const statusSchema = Joi.object({
  Status: Joi.string().valid('DRAFT', 'ACTIVE', 'PAUSED').required(),
});

const offerSchema = Joi.object({
  Name: Joi.string().max(150).trim().required(),
  SortOrder: Joi.number().integer().min(0).max(9999),

  TriggerKind: Joi.string().valid(...Object.values(TRIGGER)).required(),
  TriggerItemId: Joi.string().uuid().allow(null),
  TriggerCategoryId: Joi.string().uuid().allow(null),
  TriggerMinQty: Joi.number().min(0).max(9999).allow(null),
  TriggerMinAmount: Joi.number().min(0).allow(null),

  RewardKind: Joi.string().valid(...Object.values(REWARD)).required(),
  RewardItemId: Joi.string().uuid().allow(null),
  RewardQuantity: Joi.number().min(0).max(9999),
  RewardPercent: Joi.number().min(0).max(100),
  ApplyTo: Joi.string().valid(...Object.values(APPLY_TO)),

  MaxPerBill: Joi.number().integer().min(1).max(999),
  MaxPerCustomerPerDay: Joi.number().integer().min(1).max(999).allow(null),
  MaxTotalRedemptions: Joi.number().integer().min(1).allow(null),
});

const offerUpdateSchema = offerSchema.fork(
  ['Name', 'TriggerKind', 'RewardKind'], (f) => f.optional(),
).min(1);

// The till's preview. Lines are sent as the cart stands, so the answer is about
// THIS bill rather than a saved one.
const previewSchema = Joi.object({
  branchId: Joi.string().uuid().allow(null),
  // Whose bill it is. A per-customer daily cap cannot apply to a walk-in, so
  // this being absent is a valid answer rather than a missing field.
  posCustomerId: Joi.string().uuid().allow(null),
  lines: Joi.array().items(Joi.object({
    ref: Joi.string().max(120).required(),
    itemId: Joi.string().uuid().allow(null),
    categoryId: Joi.string().uuid().allow(null),
    name: Joi.string().max(200).allow('', null),
    unitAmount: Joi.number().min(0).required(),
    quantity: Joi.number().min(0).required(),
    hasManualDiscount: Joi.boolean(),
  })).max(500).required(),
});

module.exports = {
  idParamSchema, campaignSchema, campaignUpdateSchema, statusSchema,
  offerSchema, offerUpdateSchema, previewSchema,
};
