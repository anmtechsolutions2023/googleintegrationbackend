// src/config/constants.js
// Centralized constants for queries, statuses, and other reusable strings
// Organized by domain/module for better maintainability and scalability

module.exports = {
  QUERIES: {
    // User & Tenant Queries
    USER_TENANTS: {
      SELECT:
        'SELECT tenant_id, is_admin, is_super_admin FROM user_tenants WHERE user_email = ? AND is_active = TRUE',
    },

    // Permissions Queries
    PERMISSIONS: {
      SELECT: `
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

    // Audit Logs Queries
    AUDIT_LOGS: {
      SELECT:
        'SELECT log_id, tenant_id, user_email, action, status, timestamp FROM audit_logs WHERE 1=1',
      INSERT:
        'INSERT INTO audit_logs (tenant_id, user_email, action, status, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, NOW())',
      INSERT_MIDDLEWARE:
        'INSERT INTO audit_logs (tenant_id, user_email, action, status) VALUES (?, ?, ?, ?)',
    },

    // Tax Type Queries
    TAX_TYPES: {
      SELECT_ALL:
        'SELECT * FROM TaxTypes WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM TaxTypes WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM TaxTypes WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO TaxTypes (Id, TenantId, Name, Value, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE TaxTypes SET Name = ?, Value = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM TaxTypes WHERE Id = ? AND TenantId = ?',
    },
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
  SCOPES: {
    TENANT_ADMIN: 'TENANT:ADMIN',
    TENANT_SUPER_ADMIN: 'TENANT:SUPER_ADMIN',
    REPORTS_READ: 'REPORTS:READ',
    REPORTS_WRITE: 'REPORTS:WRITE',
    BILLING_READ: 'billing:READ',
    BILLING_WRITE: 'billing:WRITE',
  },
};
