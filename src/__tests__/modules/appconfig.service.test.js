// src/__tests__/modules/appconfig.service.test.js
// Unit tests for the global Application Configuration service. DB fully mocked.

const mockConn = { execute: jest.fn() };

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn((fn) => fn(mockConn)),
}));
jest.mock('../../config/constants', () => ({
  QUERIES: {
    APP_SETTINGS: {
      SELECT_BY_KEY: 'SELECT ... WHERE setting_key = ?',
      UPSERT: 'INSERT ... ON DUPLICATE KEY UPDATE ...',
    },
  },
  ONBOARDING: { SETTING_AUTO_APPROVE: 'onboarding.auto_approve.enabled' },
}));

const service = require('../../modules/appconfig/appconfig.service');

beforeEach(() => jest.clearAllMocks());

describe('appconfig.service — isAutoApproveEnabled', () => {
  it('returns true when the stored value is "true"', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ setting_value: 'true' }]]);
    await expect(service.isAutoApproveEnabled()).resolves.toBe(true);
  });

  it('returns false when the stored value is "false"', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ setting_value: 'false' }]]);
    await expect(service.isAutoApproveEnabled()).resolves.toBe(false);
  });

  it('defaults to false when the setting is absent', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]);
    await expect(service.isAutoApproveEnabled()).resolves.toBe(false);
  });
});

describe('appconfig.service — getConfig', () => {
  it('maps the flag into the public shape', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ setting_value: 'true' }]]);
    await expect(service.getConfig()).resolves.toEqual({ autoApproveOnboarding: true });
  });
});

describe('appconfig.service — updateConfig', () => {
  it('persists true as the string "true" and returns the new config', async () => {
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])       // UPSERT
      .mockResolvedValueOnce([[{ setting_value: 'true' }]]); // getConfig re-read
    const result = await service.updateConfig({ autoApproveOnboarding: true }, 'super@admin.com');

    const upsertCall = mockConn.execute.mock.calls[0];
    expect(upsertCall[1]).toEqual(['onboarding.auto_approve.enabled', 'true', 'super@admin.com']);
    expect(result).toEqual({ autoApproveOnboarding: true });
  });

  it('persists false as the string "false"', async () => {
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ setting_value: 'false' }]]);
    await service.updateConfig({ autoApproveOnboarding: false }, 'super@admin.com');
    expect(mockConn.execute.mock.calls[0][1]).toEqual([
      'onboarding.auto_approve.enabled', 'false', 'super@admin.com',
    ]);
  });

  it('is a no-op write when the patch has no known keys', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ setting_value: 'false' }]]); // only getConfig
    await service.updateConfig({}, 'super@admin.com');
    // no UPSERT executed — only the getConfig read
    expect(mockConn.execute).toHaveBeenCalledTimes(1);
  });
});
