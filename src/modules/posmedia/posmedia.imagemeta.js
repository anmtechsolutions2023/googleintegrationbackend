// src/modules/posmedia/posmedia.imagemeta.js
//
// What an uploaded image actually IS, read from its own bytes.
//
// WHY NOT A LIBRARY
// sharp, jimp and image-size all do this and more. This module needs two facts —
// "is it really a PNG or a JPEG" and "how big is it" — for two small images per
// branch, on a path called twice in a branch's lifetime. A native dependency with
// a build step, or a 40-file package, to answer that is a poor trade.
//
// WHY THE DECLARED MIME TYPE IS NOT TRUSTED
// The browser receipt renders these in an <img> and the thermal path feeds them
// to a canvas. A caller can put any `data:image/png;base64,` prefix on any bytes
// at all. If the stored MimeType came from that prefix, an attacker could store
// an HTML document with a script in it and have the application serve it back
// with an image content type — which is exactly the shape of a stored-XSS. So the
// type is decided by the MAGIC BYTES and the prefix is only a hint.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MIME = Object.freeze({ PNG: 'image/png', JPEG: 'image/jpeg' });

/**
 * PNG dimensions.
 *
 * The IHDR chunk is mandatory and must be first: bytes 0–7 are the signature,
 * 8–11 the chunk length, 12–15 the type 'IHDR', then width and height as
 * big-endian uint32. So the numbers are always at 16 and 20.
 *
 * @param {Buffer} buf
 * @returns {{width:number, height:number}|null}
 */
const pngSize = (buf) => {
  if (buf.length < 24) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

/**
 * JPEG dimensions.
 *
 * JPEG is a chain of segments, each 0xFF followed by a marker. The size lives in
 * whichever Start-Of-Frame marker the encoder used — SOF0 for baseline, SOF2 for
 * progressive, and several others — so the segments are walked until one is
 * found rather than assuming a fixed offset.
 *
 * @param {Buffer} buf
 * @returns {{width:number, height:number}|null}
 */
const jpegSize = (buf) => {
  // Every SOFn except SOF4 (0xC4, a Huffman table), 0xC8 and 0xCC, which are not
  // frame headers despite sitting in the same range.
  const isSof = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

  let i = 2; // past SOI (0xFFD8)
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    // Padding between segments, and the standalone markers that carry no length.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null; // malformed; stop rather than loop forever
    if (isSof(marker)) {
      // Inside a SOF: precision at +4, then height, then width.
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
};

/**
 * The real type and size of an image, or null when the bytes are neither a PNG
 * nor a JPEG.
 *
 * @param {Buffer} buf - Decoded image bytes.
 * @returns {{mimeType:string, width:number, height:number}|null}
 */
const describe = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;

  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const size = pngSize(buf);
    return size ? { mimeType: MIME.PNG, ...size } : null;
  }

  // SOI. Every JPEG starts 0xFF 0xD8 0xFF.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    return size ? { mimeType: MIME.JPEG, ...size } : null;
  }

  return null;
};

/**
 * Splits a data URI into its declared type and its bytes.
 *
 * The declared type is returned for comparison only — `describe` decides what
 * the file really is. A mismatch is worth refusing rather than silently
 * correcting: it means the client is confused or lying, and neither should
 * quietly end up in the database.
 *
 * @param {string} dataUri
 * @returns {{declaredMime:string, bytes:Buffer}|null}
 */
const parseDataUri = (dataUri) => {
  const match = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(String(dataUri || ''));
  if (!match) return null;
  try {
    // 'base64' is lenient about padding and rejects nothing, so the length is
    // checked by the caller against the decoded byte count rather than trusted.
    const bytes = Buffer.from(match[2], 'base64');
    return bytes.length > 0 ? { declaredMime: match[1].toLowerCase(), bytes } : null;
  } catch {
    return null;
  }
};

/**
 * A data URI for bytes on their way back out.
 * @param {Buffer} bytes
 * @param {string} mimeType
 * @returns {string}
 */
const toDataUri = (bytes, mimeType) =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;

module.exports = { MIME, describe, parseDataUri, toDataUri, pngSize, jpegSize };
