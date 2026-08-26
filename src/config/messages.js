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
    ONBOARDING_REQUEST_SUBMITTED: 'Your access request has been submitted.',
    ONBOARDING_APPROVED: 'User approved and provisioned successfully.',
    ONBOARDING_REJECTED: 'Access request rejected.',
    ONBOARDING_REOPENED: 'Rejected request reopened for review.',
    APP_CONFIG_RETRIEVED: 'Application configuration retrieved.',
    APP_CONFIG_UPDATED: 'Application configuration updated.',
    ROLE_CREATED: 'Role created successfully.',
    ROLE_UPDATED: 'Role updated successfully.',
    ROLE_DELETED: 'Role deleted successfully.',
    USER_ROLES_UPDATED: 'User roles updated successfully.',
    USER_STATUS_UPDATED: 'User status updated successfully.',
    USER_REMOVED: 'User removed from tenant successfully.',
    FEATURE_CREATED: 'Feature created successfully.',
    FEATURE_UPDATED: 'Feature updated successfully.',
    FEATURE_DELETED: 'Feature deleted successfully.',
    AUDIT_CATEGORIES_RETRIEVED: 'Audit categories retrieved successfully.',
  },
  ERROR: {
    // Authentication & Authorization
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
    // Accounting ledger
    LEDGER_MASTER_MISSING:
      'Ledger master data is missing. Run the seed script. Missing: ',
    LEDGER_CONFIG_MISSING:
      'No transaction numbering config found for this document type.',
    LEDGER_TRANSITION_NOT_ALLOWED:
      'That status change is not permitted for this document type.',
    LEDGER_ALREADY_POSTED:
      'This bill has already been posted to the ledger.',
    LEDGER_PAYMENT_MODE_UNKNOWN:
      'Unknown or inactive payment mode.',
    LEDGER_IMMUTABLE:
      'This document is settled and cannot be modified. Raise a refund instead.',
    LEDGER_REF_REQUIRED:
      'A reference number is required for card, UPI and wallet payments.',
    LEDGER_BILL_NOT_POSTABLE:
      'This bill has no priced lines and cannot be settled. Add the rounds it covers first.',
    LEDGER_LINE_UNPOSTABLE:
      'A line on this bill cannot be posted because its menu item is no longer linked to a catalogue item: ',
    LEDGER_TOTALS_MISMATCH:
      'Line totals do not reconcile with the document total. The bill was not posted.',
    LEDGER_ACCOUNT_UNMAPPED:
      'This payment mode has no account mapped. Set its default account before taking payments this way: ',
    // Expenses
    EXPENSE_NOT_APPROVED:
      'Only an approved expense can be settled.',
    EXPENSE_NOT_DRAFT:
      'Only a draft expense can be approved or edited.',
    EXPENSE_ALREADY_POSTED:
      'This expense has already been posted to the ledger.',
    EXPENSE_MODE_REQUIRED:
      'A payment mode is required to settle an expense — it decides which account the money left.',
    // Cash sessions
    CASH_SESSION_ALREADY_OPEN:
      'This cashier already has an open till at this branch. Close it before opening another.',
    CASH_SESSION_NOT_OPEN:
      'This till session is not open, so it cannot be closed again.',
    // First-time tenancy setup gate
    TENANT_SETUP_REQUIRED:
      'Tenancy setup is not complete. Finish the first-time setup wizard before using this feature.',
    TENANT_SETUP_ALREADY_DONE:
      'Tenancy setup has already been completed for this tenant.',
    // Validation
    VALIDATION_ERROR: 'Validation error: ',
    INVALID_TOKEN_PAYLOAD: 'Token payload missing tenant ID or scopes.',
    MISSING_AUTHORIZATION_HEADER: 'Missing authorization header.',
    // Database
    DATABASE_ERROR: 'Database operation failed.',
    NOT_FOUND: 'Resource not found.',
    // Rate Limiting
    RATE_LIMIT_EXCEEDED:
      'Too many authentication attempts, please try again later.',
    // Duplicate Entry
    DUPLICATE_ENTRY: 'A record with this value already exists.',
    // IAM errors
    ONBOARDING_REQUEST_NOT_FOUND: 'No onboarding request found for this account.',
    ROLE_IN_USE: 'Cannot delete role: it is currently assigned to one or more users.',
    FEATURE_IN_USE: 'Cannot delete feature: it is assigned to one or more roles.',
    SYSTEM_ROLE_PROTECTED: 'System roles cannot be modified or deleted.',
    USER_ALREADY_EXISTS: 'User is already provisioned in this tenant.',
    INVITE_ALREADY_MEMBER: 'That person is already in this tenancy. Change their roles from the users list instead.',
    INVITE_ALREADY_PENDING: 'There is already a pending invitation for that email. Revoke it first to change the roles.',
    INVITE_ROLE_NOT_IN_TENANT: 'One or more roles do not belong to this tenancy.',
    INVITE_NOT_PENDING: 'No pending invitation found.',
    SELF_ROLE_CHANGE_FORBIDDEN: 'You cannot change your own roles. Ask another administrator in this tenancy.',
    SELF_DEMOTE_FORBIDDEN: 'You cannot remove your own administrator access — you would lose the ability to restore it.',
    SUPER_ADMIN_IMMUTABLE: 'A super admin\'s access cannot be changed from here.',
    CROSS_TENANT_FORBIDDEN: 'Forbidden. You may only act on your own tenancy.',
    SELF_SUSPEND_FORBIDDEN: 'You cannot suspend or deactivate your own account.',
    SELF_REMOVE_FORBIDDEN: 'You cannot remove your own account.',
  },
  INFO: {
    SERVER_RUNNING: 'Server is running on port ',
    AUTH_SERVER_RUNNING: 'Authorization Server Running.',
    INTERNAL_ERROR: 'Internal Server Error',
  },
  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    // Too many requests. The portal webhook is the one route without a tenant
    // JWT in front of it, so it carries its own rate limit and needs a code to
    // refuse with.
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    // A portal adapter that has not implemented a leg of the contract. Distinct
    // from 500: nothing failed, the capability simply is not built for that
    // portal yet.
    NOT_IMPLEMENTED: 501,
  },
  // JWT Configuration
  JWT: {
    ISSUER: 'MyAppServer',
    BEARER_PREFIX: 'Bearer ',
  },
  // HTTP Headers
  HTTP_HEADER: {
    AUTHORIZATION: 'authorization',
    BEARER_SPLIT_INDEX: 1,
  },
};
