// src/__tests__/modules/onboarding.service.test.js

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn((fn) => fn(mockConn)),
}));
jest.mock('../../config/constants', () => ({
  QUERIES: {
    ONBOARDING_REQUESTS: {
      SELECT_BY_EMAIL: 'SELECT * FROM onboarding_requests WHERE email = ?',
      UPDATE_NOTE: 'UPDATE onboarding_requests SET request_note = ? WHERE email = ?',
    },
  },
}));
jest.mock('../../config/messages', () => ({
  ERROR: { ONBOARDING_REQUEST_NOT_FOUND: 'Onboarding request not found.' },
  HTTP_STATUS: { NOT_FOUND: 404 },
}));

const mockConn = { execute: jest.fn() };

const { getStatus, updateNote } = require('../../modules/onboarding/onboarding.service');
const { HttpError } = require('../../middleware/errorHandler');

beforeEach(() => jest.clearAllMocks());

describe('onboarding.service — getStatus', () => {
  it('returns formatted status when request exists', async () => {
    mockConn.execute.mockResolvedValueOnce([[{
      id: 'req-1',
      status: 'PENDING',
      request_note: 'Please let me in',
      rejection_reason: null,
      requested_at: '2026-01-01T00:00:00Z',
    }]]);

    const result = await getStatus('user@example.com');
    expect(result).toEqual({
      id: 'req-1',
      status: 'PENDING',
      requestNote: 'Please let me in',
      rejectionReason: null,
      requestedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('throws HttpError 404 when no request found', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]);

    await expect(getStatus('nobody@example.com')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('onboarding.service — updateNote', () => {
  it('executes the UPDATE_NOTE query', async () => {
    mockConn.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await updateNote('user@example.com', 'my note');
    expect(mockConn.execute).toHaveBeenCalledWith(
      expect.any(String),
      ['my note', 'user@example.com']
    );
  });
});
