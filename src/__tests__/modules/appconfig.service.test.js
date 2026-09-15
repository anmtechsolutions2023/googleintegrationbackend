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
  CLOCK: { SETTING_TIMEZONE: 'pos.timezone', DEFAULT_TIMEZONE: 'Asia/Kolkata' },
}));
// Writing the zone drops the schedule service's memo; that module reaches the
// database, and this suite has none.
jest.mock('../../modules/poscategoryschedule/poscategoryschedule.service', () => ({
  forgetTimeZone: jest.fn(),
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
    // Two reads now: the flag, then the trading-day zone. The zone is unset
    // here, so the reported value is the default actually in use.
    mockConn.execute.mockResolvedValue([[]]);
    mockConn.execute.mockResolvedValueOnce([[{ setting_value: 'true' }]]);
    await expect(service.getConfig()).resolves.toEqual({
      autoApproveOnboarding: true,
      timezone: 'Asia/Kolkata',
    });
  });
});

describe('appconfig.service — updateConfig', () => {
  it('persists true as the string "true" and returns the new config', async () => {
    mockConn.execute.mockResolvedValue([[]]);              // the zone re-read
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])        // UPSERT
      .mockResolvedValueOnce([[{ setting_value: 'true' }]]); // getConfig re-read
    const result = await service.updateConfig({ autoApproveOnboarding: true }, 'super@admin.com');

    const upsertCall = mockConn.execute.mock.calls[0];
    expect(upsertCall[1]).toEqual(['onboarding.auto_approve.enabled', 'true', 'super@admin.com']);
    expect(result).toEqual({ autoApproveOnboarding: true, timezone: 'Asia/Kolkata' });
  });

  it('persists false as the string "false"', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ setting_value: 'false' }]]);
    await service.updateConfig({ autoApproveOnboarding: false }, 'super@admin.com');
    expect(mockConn.execute.mock.calls[0][1]).toEqual([
      'onboarding.auto_approve.enabled', 'false', 'super@admin.com',
    ]);
  });

  it('is a no-op write when the patch has no known keys', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await service.updateConfig({}, 'super@admin.com');
    // No UPSERT — only getConfig's two reads. A write carries three params
    // (key, value, actor); a read carries one.
    const writes = mockConn.execute.mock.calls.filter((c) => c[1] && c[1].length === 3);
    expect(writes).toHaveLength(0);
    expect(mockConn.execute).toHaveBeenCalledTimes(2);
  });
});

// A schedule is written in the outlet's local time and read on a server that is
// UTC in production, so this value is what stands between "breakfast 07:00" and
// a menu that opens at 12:30 IST.
describe('appconfig.service — the trading-day timezone', () => {
  const schedule = require('../../modules/poscategoryschedule/poscategoryschedule.service');

  it('reports the seeded default when nothing has been written', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await expect(service.getConfig()).resolves.toMatchObject({ timezone: 'Asia/Kolkata' });
  });

  it('reports what was stored', async () => {
    mockConn.execute.mockResolvedValue([[{ setting_value: 'Europe/London' }]]);
    await expect(service.getConfig()).resolves.toMatchObject({ timezone: 'Europe/London' });
  });

  it('writes it under the timezone key', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await service.updateConfig({ timezone: 'UTC' }, 'admin@x.com');
    const wrote = mockConn.execute.mock.calls
      .find((c) => c[1] && c[1].length === 3 && c[1][0] === 'pos.timezone');
    expect(wrote[1]).toEqual(['pos.timezone', 'UTC', 'admin@x.com']);
  });

  // Without this the change saves and then does not take effect for five
  // minutes, which reads as the setting being ignored.
  it('drops the memo so the change takes effect now', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await service.updateConfig({ timezone: 'UTC' }, 'admin@x.com');
    expect(schedule.forgetTimeZone).toHaveBeenCalled();
  });

  it('leaves the zone alone when the patch does not mention it', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await service.updateConfig({ autoApproveOnboarding: true }, 'admin@x.com');
    expect(schedule.forgetTimeZone).not.toHaveBeenCalled();
    // getConfig READS the zone on the way out, so match the WRITE specifically:
    // an upsert carries three params, a read one.
    const wrote = mockConn.execute.mock.calls
      .find((c) => c[1] && c[1].length === 3 && c[1][0] === 'pos.timezone');
    expect(wrote).toBeUndefined();
  });
});
