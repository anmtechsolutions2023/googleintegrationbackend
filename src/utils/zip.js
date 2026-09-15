// src/utils/zip.js
// A minimal ZIP writer: STORED entries only, no compression.
//
// Written here rather than pulled in as a dependency because the one caller —
// the GST export pack — produces a handful of small CSV files. Compression would
// save a few kilobytes on a download a CA fetches once a month; a dependency is
// a supply-chain surface kept for the life of the project. Every unzip tool,
// Windows Explorer and macOS Archive Utility read stored entries.
//
// Format: APPNOTE.TXT (PKWARE). Local header + data per entry, then the central
// directory, then the end-of-central-directory record. No ZIP64: the pack is
// nowhere near 4 GB, and `build` refuses rather than writing a corrupt archive.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer, as the unsigned 32-bit value ZIP stores. */
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

/** MS-DOS date and time fields — the only timestamp the base format carries. */
const dosDateTime = (date) => {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
};

// General purpose bit 11: file names are UTF-8.
const UTF8_FLAG = 0x0800;
const LIMIT = 0xFFFFFFFF;

/**
 * Builds a ZIP archive in memory.
 *
 * @param {Array<{name:string, data:(Buffer|string)}>} entries - Strings are
 *        written as UTF-8. Names are used as given; keep them flat and unique.
 * @param {Date} [modified] - Timestamp stamped on every entry.
 * @returns {Buffer}
 */
const build = (entries, modified = new Date()) => {
  const { time, date } = dosDateTime(modified);
  const locals = [];
  const centrals = [];
  let offset = 0;
  const seen = new Set();

  (entries || []).forEach(({ name, data }) => {
    const fileName = String(name || '');
    if (!fileName || seen.has(fileName)) {
      throw new Error(`zip: entry name must be non-empty and unique ("${fileName}")`);
    }
    seen.add(fileName);

    const nameBuf = Buffer.from(fileName, 'utf8');
    const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
    if (body.length >= LIMIT || offset >= LIMIT) throw new Error('zip: archive too large for ZIP32');
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);             // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);  // compressed size
    local.writeUInt32LE(body.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk number
    central.writeUInt16LE(0, 36);          // internal attributes
    central.writeUInt32LE(0, 38);          // external attributes
    central.writeUInt32LE(offset, 42);     // local header offset

    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  });

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(seen.size, 8);
  end.writeUInt16LE(seen.size, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDir, end]);
};

module.exports = { build, crc32 };
