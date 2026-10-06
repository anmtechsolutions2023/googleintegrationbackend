// src/__tests__/modules/posorder.waiters.test.js
// Who the till offers as a table's waiter.
//
// The rule: active members who can TAKE ORDERS — admins, or a role granting
// POS_ORDER:WRITE — named by their name, and by their mobile only when no name
// was ever entered. The same rule guards assignment, so a waiter the picker
// would not offer cannot be sent by hand either.

const { QUERIES } = require('../../config/constants');

const { SELECT_WAITERS, SELECT_WAITER_BY_ID } = QUERIES.POS_ORDER;
const squash = (sql) => sql.replace(/\s+/g, ' ');

describe('waiter picker query', () => {
  it.each([['list', SELECT_WAITERS], ['assignment check', SELECT_WAITER_BY_ID]])(
    'the %s admits only active members who can take orders',
    (name, sql) => {
      const q = squash(sql);
      expect(q).toContain("ut.is_active = 1 AND ut.status = 'ACTIVE'");
      expect(q).toContain('ut.is_admin = 1 OR ut.is_super_admin = 1');
      expect(q).toContain("f.feature_short_name = 'POS_ORDER' AND f.scope = 'WRITE'");
    },
  );

  it('reads the grant the way sign-in does: a role of this tenancy, active, with an active feature', () => {
    const q = squash(SELECT_WAITERS);
    expect(q).toContain('r.tenant_id = ur.tenant_id AND r.is_active = TRUE');
    expect(q).toContain('f.is_active = TRUE');
    expect(q).toContain('ur.tenant_id = ut.tenant_id AND ur.user_phone = ut.user_phone');
  });

  it('names a member, falling back to their mobile only when the name is blank', () => {
    for (const sql of [SELECT_WAITERS, SELECT_WAITER_BY_ID]) {
      expect(squash(sql)).toContain("COALESCE(NULLIF(TRIM(ut.full_name), ''), ut.user_phone) AS Name");
    }
  });

  it('does not filter on a role NAME, so a renamed or custom role still counts', () => {
    expect(SELECT_WAITERS).not.toMatch(/POS_WAITER|r\.name/);
  });
});
