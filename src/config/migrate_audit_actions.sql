-- migrate_audit_actions.sql
-- One-time migration: replace raw HTTP method+path action values with
-- human-readable labels in the audit_logs table.
-- Run ONCE before deploying the updated middleware.

-- ── Auth ─────────────────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'User signed in'                     WHERE action = 'LOGIN_SUCCESS';
UPDATE audit_logs SET action = 'Sign-in attempted'                  WHERE action = 'LOGIN_ATTEMPT';
UPDATE audit_logs SET action = 'Sign-in failed (system error)'      WHERE action = 'LOGIN_CRASH';
UPDATE audit_logs SET action = 'Onboarding request submitted'       WHERE action = 'ONBOARDING_ATTEMPT';

-- ── Session ───────────────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'User signed out'                    WHERE action = 'POST /logout';
UPDATE audit_logs SET action = 'User signed out'                    WHERE action = 'GET /logout';
UPDATE audit_logs SET action = 'Switched tenant'                    WHERE action = 'POST /switch';
UPDATE audit_logs SET action = 'Switched tenant'                    WHERE action = 'POST /switch-tenant';

-- ── General / Dashboard ───────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'Viewed application'                 WHERE action = 'GET /';
UPDATE audit_logs SET action = 'Authenticated with application'     WHERE action = 'POST /';

-- ── Onboarding ────────────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'Checked onboarding status'          WHERE action = 'GET /status';
UPDATE audit_logs SET action = 'Viewed pending onboarding requests' WHERE action = 'GET /onboarding';

-- ── User management ───────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'Viewed user list'                   WHERE action = 'GET /users';
UPDATE audit_logs SET action = 'Updated user roles'                 WHERE action = 'UPDATE_USER_ROLES';
UPDATE audit_logs SET action = 'Suspended user account'             WHERE action = 'SUSPEND_USER';
UPDATE audit_logs SET action = 'Activated user account'             WHERE action = 'ACTIVATE_USER';
UPDATE audit_logs SET action = 'Viewed user roles'                  WHERE action LIKE 'GET /users/%/roles';
UPDATE audit_logs SET action = 'Updated user roles'                 WHERE action LIKE 'PUT /users/%/roles';
UPDATE audit_logs SET action = 'Updated user status'                WHERE action LIKE 'PUT /users/%/status';

-- ── Role management ───────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'Viewed roles list'                  WHERE action = 'GET /roles';

-- ── Audit logs ────────────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'Viewed audit logs'                  WHERE action = 'GET /audit/logs';

-- ── Data / Settings ───────────────────────────────────────────────────────────
UPDATE audit_logs SET action = 'Viewed admin settings'              WHERE action = 'GET /data/admin/settings';
UPDATE audit_logs SET action = 'Viewed admin settings'              WHERE action = 'GET /settings';
UPDATE audit_logs SET action = 'Viewed general data'                WHERE action = 'GET /data/general';
UPDATE audit_logs SET action = 'Viewed reports'                     WHERE action = 'GET /data/reports';
UPDATE audit_logs SET action = 'Viewed billing data'                WHERE action = 'GET /data/billing';

-- ── CRUD module records (UUID-parameterised paths) ────────────────────────────
-- These come from generic master-data module routes where req.path is the record UUID.
UPDATE audit_logs SET action = 'Updated record'
  WHERE action REGEXP '^PUT /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE audit_logs SET action = 'Deleted record'
  WHERE action REGEXP '^DELETE /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
