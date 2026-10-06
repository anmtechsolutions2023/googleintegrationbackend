// src/__tests__/modules/menu.photo.test.js
// Dish photos as images: caching follows the version, the guest menu honours
// the branch's switch, and a photo is only served for the guest's branch.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { sendPhoto } = require('../../modules/menu/menu.photoResponse');
const dineMenu = require('../../modules/posdine/dine.menu.service');

const fakeRes = () => {
  const headers = {};
  const res = {
    set: (k, v) => { headers[k] = v; return res; },
    status: jest.fn(() => res),
    send: jest.fn(() => res),
  };
  return { res, headers };
};
const PHOTO = { MimeType: 'image/jpeg', Bytes: Buffer.from([1, 2, 3]), Version: 1791311669 };

beforeEach(() => mockConn.execute.mockReset());

describe('sending a photo', () => {
  it('a versioned guest photo is cached publicly for a year', () => {
    const { res, headers } = fakeRes();
    sendPhoto(res, PHOTO, { versioned: true, shared: true });
    expect(headers['Content-Type']).toBe('image/jpeg');
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });

  it('a staff photo is private, and briefly cached without a version', () => {
    const { res, headers } = fakeRes();
    sendPhoto(res, PHOTO, { versioned: false, shared: false });
    expect(headers['Cache-Control']).toBe('private, max-age=300');
  });
});

describe('guest menu photos', () => {
  const ctx = { tenantId: 't1', branchId: 'b1', settings: { showPhotos: true } };

  it('looks the photo up by menu entry within the guest\'s branch; thumbnail by default', async () => {
    mockConn.execute.mockResolvedValue([[PHOTO]]);
    await expect(dineMenu.getPhoto(ctx, 'meta-1', 'thumb')).resolves.toBe(PHOTO);
    const [sql, params] = mockConn.execute.mock.calls[0];
    expect(sql).toContain('COALESCE(ph.ThumbBytes, ph.Bytes)');
    expect(params).toEqual(['t1', 'b1', 'meta-1']);
  });

  it('is 404 when the branch turned photos off — without asking the database', async () => {
    await expect(dineMenu.getPhoto({ ...ctx, settings: { showPhotos: false } }, 'meta-1', 'thumb'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('is 404 when the dish has no photo here', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await expect(dineMenu.getPhoto(ctx, 'meta-1', 'full')).rejects.toMatchObject({ statusCode: 404 });
  });
});
