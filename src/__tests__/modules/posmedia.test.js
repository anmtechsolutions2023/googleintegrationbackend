// src/__tests__/modules/posmedia.test.js
//
// A branch's logo and payment QR.
//
// THE POINT OF MOST OF THIS FILE IS THE SECURITY BOUNDARY.
// These bytes are served back with an image content type and rendered in an <img>
// on a receipt. If the stored MimeType came from the caller's `data:image/png;`
// prefix, anyone who can upload could store an HTML document with a script in it
// and have the application serve it as an image — a stored XSS. So the type is
// decided by the MAGIC BYTES and the prefix is treated as a claim to be checked.
// The tests that matter here are the ones that try to get past that.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockUuid = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuid}`) }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const zlib = require('zlib');
const service = require('../../modules/posmedia/posmedia.service');
const imagemeta = require('../../modules/posmedia/posmedia.imagemeta');
const { MEDIA } = require('../../config/constants');

const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const USER = '+919876543210';

// ── A real PNG, built here ───────────────────────────────────────────────────
// Not a hand-faked header: the parser reads the IHDR chunk, and a fixture that only
// looks right from the outside would pass tests a real file would fail.
const crc32 = (buf) => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let x = 0xffffffff;
  for (const b of buf) x = table[(x ^ b) & 0xff] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A valid RGB PNG of the given size. */
const makePng = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  // One filter byte plus w*3 colour bytes per row.
  const raw = Buffer.concat(
    Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)])),
  );
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/** A baseline JPEG carrying a SOF0 of the given size. */
const makeJpeg = (w, h) => {
  const sof = Buffer.alloc(10);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(0x11, 2);   // segment length
  sof[4] = 8;                    // precision
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = 3;                    // components
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0'),
    Buffer.alloc(9),
    sof,
    Buffer.alloc(32),
  ]);
};

const uri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

beforeEach(() => { jest.clearAllMocks(); mockUuid = 0; });

describe('reading what a file really is', () => {
  it('reads a PNG and its dimensions from the IHDR chunk', () => {
    expect(imagemeta.describe(makePng(320, 96)))
      .toEqual({ mimeType: 'image/png', width: 320, height: 96 });
  });

  // The size lives in whichever SOF marker the encoder used, so the segments are
  // walked rather than read from a fixed offset.
  it('reads a JPEG by walking to its start-of-frame', () => {
    expect(imagemeta.describe(makeJpeg(600, 400)))
      .toEqual({ mimeType: 'image/jpeg', width: 600, height: 400 });
  });

  it('refuses anything that is not one of the two', () => {
    const html = Buffer.from(`<html><script>alert(1)</script></html>${'x'.repeat(64)}`);
    expect(imagemeta.describe(html)).toBeNull();
    // A GIF is a real image and still not one we accept.
    expect(imagemeta.describe(Buffer.concat([
      Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64),
    ]))).toBeNull();
    expect(imagemeta.describe(Buffer.alloc(8))).toBeNull();
    expect(imagemeta.describe(null)).toBeNull();
  });

  // Truncated at the signature: the bytes start like a PNG and carry no IHDR. A
  // parser that trusted the signature alone would read dimensions off the end.
  it('refuses a PNG that is only a signature', () => {
    expect(imagemeta.describe(PNG_SIG)).toBeNull();
    expect(imagemeta.describe(Buffer.concat([PNG_SIG, Buffer.alloc(40)]))).toBeNull();
  });

  it('rejects a data URI that is not one', () => {
    expect(imagemeta.parseDataUri('notadatauri')).toBeNull();
    expect(imagemeta.parseDataUri('')).toBeNull();
    expect(imagemeta.parseDataUri('data:image/png;base64,')).toBeNull();
  });
});

describe('validating an upload', () => {
  it('accepts a PNG within the limits and reports what it measured', () => {
    const png = makePng(384, 120);
    const out = service.validateImage(uri(png));
    expect(out).toMatchObject({ mimeType: 'image/png', width: 384, height: 120 });
    expect(out.byteSize).toBe(png.length);
    expect(Buffer.isBuffer(out.bytes)).toBe(true);
  });

  // THE ONE THAT MATTERS. An HTML document announced as a PNG.
  it('refuses a file whose bytes disagree with its declared type', () => {
    const html = Buffer.from(`<html><script>alert(1)</script></html>${'x'.repeat(64)}`);
    expect(() => service.validateImage(uri(html)))
      .toThrow(/not a PNG or JPEG image/i);
  });

  // The prefix says PNG, the bytes are a real JPEG. Refused rather than silently
  // corrected: a caller that confused is a caller whose intent is unclear.
  it('refuses a genuine image mislabelled as the other kind', () => {
    expect(() => service.validateImage(uri(makeJpeg(100, 100), 'image/png')))
      .toThrow(/says it is image\/png but it is image\/jpeg/i);
  });

  it('refuses an image past the byte ceiling, and says how big it was', () => {
    // Incompressible noise, so deflate cannot bring it under the limit.
    const noise = Buffer.alloc(MEDIA.MAX_BYTES + 4096);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) & 0xff;
    const oversized = Buffer.concat([PNG_SIG, noise]);
    expect(() => service.validateImage(uri(oversized))).toThrow(/KB/);
  });

  it('refuses an image past the dimension ceiling', () => {
    const wide = makePng(MEDIA.MAX_WIDTH_PX + 1, 10);
    expect(() => service.validateImage(uri(wide))).toThrow(/no larger than/i);
  });

  it('refuses an unreadable data URI', () => {
    expect(() => service.validateImage('not-a-data-uri')).toThrow(/could not be read/i);
  });

  it('refuses a kind it does not know', () => {
    expect(() => service.assertKind('banner')).toThrow(/Unknown image kind/i);
    MEDIA.KINDS.forEach((k) => expect(() => service.assertKind(k)).not.toThrow());
  });
});

describe('storing and removing', () => {
  it('upserts, and re-measures rather than trusting the caller', async () => {
    mockConn.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const out = await service.put(
      { kind: 'logo', dataUri: uri(makePng(200, 50)), branchId: BRANCH }, TENANT, USER,
    );

    expect(out).toEqual({
      kind: 'logo', mimeType: 'image/png', width: 200, height: 50,
      byteSize: expect.any(Number),
    });

    const [sql, params] = mockConn.execute.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO pos_branch_media/i);
    // ON DUPLICATE KEY on UNIQUE (TenantId, BranchDetailId, Kind) is what makes an
    // upload a replacement. Without it a branch accumulates logos and the renderer
    // gets whichever the query returned first.
    expect(String(sql)).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(params.slice(1, 4)).toEqual([TENANT, BRANCH, 'logo']);
    expect(params[4]).toBe('image/png');
    expect(params[5]).toBe(200);
    expect(params[6]).toBe(50);
  });

  it('nothing is written when validation fails', async () => {
    await expect(service.put(
      { kind: 'logo', dataUri: 'rubbish', branchId: BRANCH }, TENANT, USER,
    )).rejects.toThrow();
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('lists both kinds, with null for what is absent, and never the bytes', async () => {
    mockConn.execute.mockResolvedValue([[{
      Id: 'm1', Kind: 'logo', MimeType: 'image/png', Width: 200, Height: 50,
      ByteSize: 812, UpdatedOn: null, UpdatedBy: null,
      CreatedOn: '2026-09-22T10:00:00Z', CreatedBy: USER,
    }]]);

    const out = await service.list(BRANCH, TENANT);
    expect(out.logo).toMatchObject({ kind: 'logo', width: 200, byteSize: 812 });
    expect(out.paymentQr).toBeNull();
    // Falls back to CreatedOn/By, which is what the provenance badge shows for
    // something set at onboarding and never touched since.
    expect(out.logo.updatedBy).toBe(USER);
    expect(out.logo).not.toHaveProperty('bytes');
    expect(String(mockConn.execute.mock.calls[0][0])).not.toMatch(/\bBytes\b/);
  });

  it('gives one image back as a data URI', async () => {
    const png = makePng(64, 64);
    mockConn.execute.mockResolvedValue([[{
      Id: 'm1', Kind: 'logo', MimeType: 'image/png', Width: 64, Height: 64,
      ByteSize: png.length, Bytes: png, CreatedOn: null, CreatedBy: null,
    }]]);
    const out = await service.get('logo', BRANCH, TENANT);
    expect(out.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    // Round-trips: what comes back out is what went in.
    expect(imagemeta.parseDataUri(out.dataUri).bytes.equals(png)).toBe(true);
  });

  it('404s rather than returning an empty image', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await expect(service.get('logo', BRANCH, TENANT))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('reports which kinds exist without reading a blob', async () => {
    mockConn.execute.mockResolvedValue([[{ Kind: 'logo' }, { Kind: 'paymentQr' }]]);
    const kinds = await service.kindsOf(BRANCH, TENANT);
    expect(kinds.has('logo')).toBe(true);
    expect(kinds.has('paymentQr')).toBe(true);
    expect(String(mockConn.execute.mock.calls[0][0])).not.toMatch(/\bBytes\b/);
  });

  // Removing what is not there is a success: the caller's intent — "this branch has
  // no logo" — is satisfied either way.
  it('removes idempotently', async () => {
    mockConn.execute.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(service.remove('logo', BRANCH, TENANT, USER)).resolves.toBeUndefined();
    expect(String(mockConn.execute.mock.calls[0][0])).toMatch(/DELETE FROM pos_branch_media/i);
  });
});
