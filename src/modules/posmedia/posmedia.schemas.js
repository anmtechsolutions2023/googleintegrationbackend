// src/modules/posmedia/posmedia.schemas.js
// Joi validation for the branch-media endpoints.
//
// Deliberately THIN, for the same reason as receipt.format.schemas: Joi checks the
// envelope — is there a branch, is the kind one that exists, is the body a string
// that looks like an image data URI — and stops. Whether the bytes are really a
// PNG is a question only the bytes can answer, and answering it in two places is
// how the two answers drift apart. See posmedia.service.validateImage().

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { MEDIA } = require('../../config/constants');

const branchQuerySchema = Joi.object({
  branchId: entityId.required(),
});

const kindParamSchema = Joi.object({
  kind: Joi.string().valid(...MEDIA.KINDS).required()
    .messages({ 'any.only': `Image kind must be one of: ${MEDIA.KINDS.join(', ')}` }),
});

// The outer guard only. base64 inflates by about 4/3, so the string ceiling is the
// byte ceiling plus headroom for the prefix and padding; the service decodes and
// enforces MEDIA.MAX_BYTES on the real length.
//
// Refusing an oversized string HERE matters: it stops a multi-megabyte body being
// base64-decoded into memory just to be rejected a moment later.
const MAX_DATA_URI_CHARS = Math.ceil((MEDIA.MAX_BYTES * 4) / 3) + 128;

const putSchema = Joi.object({
  kind: Joi.string().valid(...MEDIA.KINDS).required(),
  dataUri: Joi.string()
    .max(MAX_DATA_URI_CHARS)
    .pattern(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/)
    .required()
    .messages({
      'string.pattern.base': 'The image must be a PNG or JPEG data URI',
      'string.max':
        `That image is too large. Please use one under ${MEDIA.MAX_BYTES / 1024}KB.`,
    }),
});

module.exports = { branchQuerySchema, kindParamSchema, putSchema, MAX_DATA_URI_CHARS };
