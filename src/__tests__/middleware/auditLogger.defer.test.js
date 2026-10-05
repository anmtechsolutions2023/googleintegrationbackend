// src/__tests__/middleware/auditLogger.defer.test.js
// One audit row per change.
//
// Admin routes wrote two rows for every change: the route middleware's (no
// target, a generic label) and the controller's captureAudit. With
// deferToCapture the route row is skipped on success when the controller has
// written its detailed one, and still written when the request fails.

jest.mock('../../config/db', () => ({ execute: jest.fn().mockResolvedValue([{}]) }));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { EventEmitter } = require('events');
const db = require('../../config/db');
const { auditLog } = require('../../middleware/auditLogger');

const finishWith = async (middleware, { status, captured }) => {
  const req = { headers: {}, socket: {}, user: { phone: '+919800000003', tid: 'tenant-a' }, method: 'PUT', path: '/x' };
  const res = new EventEmitter();
  res.statusCode = status;
  middleware(req, res, () => {});
  if (captured) req.auditCaptured = true;
  res.emit('finish');
  await new Promise((r) => setImmediate(r));
};

beforeEach(() => jest.clearAllMocks());

describe('auditLog({ deferToCapture })', () => {
  const deferred = auditLog('USER_MGMT', 'INFO', 'Updated user roles', { deferToCapture: true });

  it('writes nothing more when the controller already wrote the detailed row', async () => {
    await finishWith(deferred, { status: 200, captured: true });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('still writes the row when the request failed before the controller captured', async () => {
    await finishWith(deferred, { status: 400, captured: false });
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['Updated user roles', 'FAILED']));
  });

  it('still writes on success when nothing was captured', async () => {
    await finishWith(deferred, { status: 200, captured: false });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('is off by default — other routes keep their row', async () => {
    await finishWith(auditLog('POS', 'INFO', 'Something'), { status: 200, captured: true });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
