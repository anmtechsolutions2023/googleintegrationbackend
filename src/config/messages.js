// src/config/messages.js
// Centralized messages for success, error, and info responses

module.exports = {
  SUCCESS: {
    AUTH: 'Authentication successful. Use this token for API access.',
    TENANT_SWITCH: 'Successfully switched to tenant: ',
    AUDIT_LOGS_RETRIEVED: 'Audit logs retrieved successfully.',
    LOGOUT: 'User logged out successfully.',
    GENERAL_ACCESS: 'General Access: Welcome!',
    REPORTS_ACCESS: 'Read Access: Report generation started.',
    BILLING_ACCESS: 'Read Access: Displaying billing data.',
    ADMIN_ACCESS: 'ADMIN ACCESS: Configuration settings.',
  },
  ERROR: {
    MISSING_GOOGLE_TOKEN: 'Google ID token is required.',
    INVALID_TOKEN: 'Invalid or expired application token.',
    MISSING_TENANT_ID: 'Target Tenant ID is required.',
    TENANT_ACCESS_DENIED: 'Access denied to target tenant.',
    USER_NOT_ASSOCIATED: 'User is not associated with any active tenant.',
    INVALID_PAYLOAD: 'Invalid token payload or missing email.',
    GOOGLE_VALIDATION_FAILED: 'Google token validation failed: ',
    AUDIT_LOGS_FAILED: 'Failed to retrieve audit logs.',
    TENANT_SWITCH_FAILED: 'Tenant switch failed',
    FORBIDDEN_NO_SCOPES: 'Forbidden. No active permissions found for tenant ',
    FORBIDDEN_MISSING_SCOPE: 'Forbidden. Access requires one of these scopes: ',
  },
  INFO: {
    SERVER_RUNNING: 'Server is running on port ',
    AUTH_SERVER_RUNNING: 'Authorization Server Running.',
    INTERNAL_ERROR: 'Internal Server Error',
  },
}
