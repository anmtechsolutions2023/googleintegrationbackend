// src/modules/posmedia/posmedia.service.js
//
// A branch's logo and its payment QR: store one, read one, remove one.
//
// WHAT THIS OWNS
// The bytes and the rules about them. It does NOT decide whether either image
// prints — that is the receipt catalogue's job, exactly as the FSSAI number is
// stored here-ish and its visibility lives there. The seam matters: a branch can
// hold a logo and print no logo, and both states are legitimate.
//
// EVERY NUMBER IS RE-MEASURED SERVER-SIDE
// The client downscales before uploading, which is a courtesy to the network, not
// a guarantee. Width, height, byte size and the MIME type are all read from the
// bytes that actually arrived (see posmedia.imagemeta) and the client's claims are
// used only to detect a mismatch worth refusing.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, MEDIA } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const imagemeta = require('./posmedia.imagemeta');

/**
 * Validates an incoming data URI and reduces it to a row ready to store.
 *
 * Runs OUTSIDE any transaction on purpose. The onboarding wizard sends its logo
 * inside the same call that creates the whole tenancy; validating after the
 * transaction opened would turn "your logo is too big" into a rolled-back signup.
 *
 * @param {string} dataUri
 * @returns {{mimeType:string, width:number, height:number, byteSize:number, bytes:Buffer}}
 * @throws {HttpError} 400 with a message naming what to do about it.
 */
const validateImage = (dataUri) => {
  const parsed = imagemeta.parseDataUri(dataUri);
  if (!parsed) {
    throw new HttpError(
      'That image could not be read. Please choose a PNG or JPEG file.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  const { declaredMime, bytes } = parsed;

  if (bytes.length > MEDIA.MAX_BYTES) {
    const kb = Math.round(bytes.length / 1024);
    throw new HttpError(
      `That image is ${kb}KB. Please use one under ${MEDIA.MAX_BYTES / 1024}KB — `
      + 'a receipt printer cannot use the extra detail.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  // The bytes decide, not the prefix. See the note at the top of imagemeta.
  const real = imagemeta.describe(bytes);
  if (!real) {
    throw new HttpError(
      'That file is not a PNG or JPEG image, whatever its name says.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  // A mismatch means the client is confused or lying. Refusing beats silently
  // correcting: silently correcting stores a file nobody meant to send.
  if (declaredMime !== real.mimeType) {
    logger.warn('Media upload MIME mismatch', { declaredMime, actual: real.mimeType });
    throw new HttpError(
      `That file says it is ${declaredMime} but it is ${real.mimeType}. `
      + 'Please re-save it and try again.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (real.width > MEDIA.MAX_WIDTH_PX || real.height > MEDIA.MAX_HEIGHT_PX) {
    throw new HttpError(
      `That image is ${real.width}×${real.height}. Please use one no larger than `
      + `${MEDIA.MAX_WIDTH_PX}×${MEDIA.MAX_HEIGHT_PX} pixels.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  return { ...real, byteSize: bytes.length, bytes };
};

/** The permitted kinds, checked here as well as at the schema. */
const assertKind = (kind) => {
  if (!MEDIA.KINDS.includes(kind)) {
    throw new HttpError(
      `Unknown image kind “${kind}”. Expected one of: ${MEDIA.KINDS.join(', ')}.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
};

/**
 * Stores one image for a branch, replacing whatever it held.
 *
 * Takes an optional connection so the onboarding wizard can write the logo inside
 * the same transaction as the branch it belongs to — an image that survived a
 * rolled-back signup would belong to a branch that does not exist.
 *
 * @param {Object} p
 * @param {string} p.kind
 * @param {string} p.dataUri
 * @param {string} p.branchId
 * @param {string} tenantId
 * @param {string} userPhone
 * @param {Object} [existingConn]
 * @returns {Promise<Object>} The stored image's metadata.
 */
const put = async ({ kind, dataUri, branchId }, tenantId, userPhone, existingConn) => {
  assertKind(kind);
  const image = validateImage(dataUri);

  await withConnection((conn) => conn.execute(QUERIES.POS_BRANCH_MEDIA.UPSERT, [
    uuidv4(), tenantId, branchId, kind,
    image.mimeType, image.width, image.height, image.byteSize, image.bytes,
    userPhone, userPhone,
  ]), existingConn);

  logger.info('Branch media stored', {
    tenantId, branchId, kind, mimeType: image.mimeType,
    width: image.width, height: image.height, byteSize: image.byteSize, userPhone,
  });

  return {
    kind,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    byteSize: image.byteSize,
  };
};

/**
 * Both kinds' metadata for a branch — never the bytes.
 *
 * Shaped as a map keyed by kind rather than a list, because every caller asks
 * "is there a logo" and not "what images exist".
 *
 * @returns {Promise<Object>} { logo: {...}|null, paymentQr: {...}|null }
 */
const list = (branchId, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(
    QUERIES.POS_BRANCH_MEDIA.SELECT_META_BY_BRANCH, [tenantId, branchId],
  );
  const out = Object.fromEntries(MEDIA.KINDS.map((k) => [k, null]));
  (rows || []).forEach((r) => {
    out[r.Kind] = {
      kind: r.Kind,
      mimeType: r.MimeType,
      width: r.Width,
      height: r.Height,
      byteSize: r.ByteSize,
      updatedOn: r.UpdatedOn || r.CreatedOn,
      updatedBy: r.UpdatedBy || r.CreatedBy,
    };
  });
  return out;
});

/**
 * One image, bytes included, as a data URI.
 *
 * @throws {HttpError} 404 when the branch holds nothing of this kind.
 */
const get = async (kind, branchId, tenantId) => {
  assertKind(kind);
  return withConnection(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.POS_BRANCH_MEDIA.SELECT_ONE, [tenantId, branchId, kind],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError(
        `This branch has no ${kind === 'logo' ? 'logo' : 'payment QR'}.`,
        MESSAGES.HTTP_STATUS.NOT_FOUND,
      );
    }
    return {
      kind: row.Kind,
      mimeType: row.MimeType,
      width: row.Width,
      height: row.Height,
      byteSize: row.ByteSize,
      dataUri: imagemeta.toDataUri(row.Bytes, row.MimeType),
      updatedOn: row.UpdatedOn || row.CreatedOn,
      updatedBy: row.UpdatedBy || row.CreatedBy,
    };
  });
};

/**
 * Which kinds a branch holds, and when each last changed.
 *
 * Used by the receipt resolver, which needs to know whether to reference an image
 * and must not read several kilobytes of blob to decide.
 *
 * The VERSION is not decoration. A client caches the fetched image against the
 * reference it came from; if that reference stays identical when the image is
 * replaced, every till goes on printing the old logo until it is reloaded. The
 * timestamp changes when the row does, so the reference does too.
 *
 * @returns {Promise<Map<string, string>>} kind → version stamp
 */
const kindsOf = (branchId, tenantId, existingConn) => withConnection(async (conn) => {
  const [rows] = await conn.execute(
    QUERIES.POS_BRANCH_MEDIA.SELECT_KINDS, [tenantId, branchId],
  );
  return new Map((rows || []).map((r) => {
    const when = r.UpdatedOn || r.CreatedOn;
    const stamp = when ? new Date(when).getTime() : 0;
    return [r.Kind, String(Number.isNaN(stamp) ? 0 : stamp)];
  }));
}, existingConn);

/**
 * Removes one image.
 *
 * Idempotent: removing what is not there is a success, because the caller's
 * intent — "this branch has no logo" — is satisfied either way.
 */
const remove = async (kind, branchId, tenantId, userPhone) => {
  assertKind(kind);
  await withConnection((conn) => conn.execute(
    QUERIES.POS_BRANCH_MEDIA.DELETE_ONE, [tenantId, branchId, kind],
  ));
  logger.info('Branch media removed', { tenantId, branchId, kind, userPhone });
};

module.exports = { put, list, get, remove, kindsOf, validateImage, assertKind };
