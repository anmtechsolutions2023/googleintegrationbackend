// src/config/constants.js
// Centralized constants for queries, statuses, and other reusable strings

module.exports = {
  QUERIES: {
    USER_TENANTS_SELECT:
      'SELECT tenant_id, is_admin FROM user_tenants WHERE user_email = ? AND is_active = TRUE',
    AUDIT_LOGS_SELECT:
      'SELECT log_id, tenant_id, user_email, action, status, timestamp FROM audit_logs WHERE 1=1',
    AUDIT_LOGS_INSERT:
      'INSERT INTO audit_logs (tenant_id, user_email, action, status, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, NOW())',
    AUDIT_LOGS_MIDDLEWARE:
      'INSERT INTO audit_logs (tenant_id, user_email, action, status) VALUES (?, ?, ?, ?)',
    PERMISSIONS_SELECT: `
      SELECT
          f.scope,
          f.feature_short_name
      FROM user_tenants ut
      JOIN tenant_features tf ON ut.id = tf.user_tenants_id
      JOIN features f ON tf.feature_id = f.feature_id
      WHERE f.is_active = TRUE
        AND tf.is_active = TRUE
        AND ut.is_active = TRUE
        AND ut.tenant_id = ?
        AND ut.user_email = ?
    `,
  },
  STATUSES: {
    SUCCESS: 'SUCCESS',
    DENIED: 'DENIED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_ATTEMPT: 'LOGIN_ATTEMPT',
    LOGIN_CRASH: 'LOGIN_CRASH',
    SWITCH_TENANT_DENIED: 'SWITCH_TENANT_DENIED',
    NOT_FOUND: '403_NOT_FOUND',
    FORBIDDEN: '403_FORBIDDEN',
    UNAUTHORIZED: '401_UNAUTHORIZED',
  },
  DEFAULTS: {
    AUDIT_LIMIT: 100,
    AUDIT_OFFSET: 0,
  },
}
