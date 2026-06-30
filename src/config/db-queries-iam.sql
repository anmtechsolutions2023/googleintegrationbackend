-- src/config/db-queries-iam.sql
-- IAM (Identity & Access Management) migration.
-- Run this file once against the target database after db-queries-accountstable.sql.
-- All statements are idempotent — safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1A. Make audit_logs.tenant_id nullable so guest logins can be recorded
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS migrate_audit_logs_nullable_tenant;
DELIMITER //
CREATE PROCEDURE migrate_audit_logs_nullable_tenant()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'tenant_id'
      AND IS_NULLABLE  = 'NO'
  ) THEN
    ALTER TABLE audit_logs MODIFY tenant_id VARCHAR(50) NULL;
  END IF;
END //
DELIMITER ;
CALL migrate_audit_logs_nullable_tenant();
DROP PROCEDURE IF EXISTS migrate_audit_logs_nullable_tenant;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1B. Add status + updated_at to user_tenants
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS migrate_user_tenants_status;
DELIMITER //
CREATE PROCEDURE migrate_user_tenants_status()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'user_tenants'
      AND COLUMN_NAME  = 'status'
  ) THEN
    ALTER TABLE user_tenants
      ADD COLUMN status     ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE'
          AFTER is_super_admin,
      ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP
          AFTER status;
  END IF;
END //
DELIMITER ;
CALL migrate_user_tenants_status();
DROP PROCEDURE IF EXISTS migrate_user_tenants_status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1C. Add display metadata columns to features
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS migrate_features_meta;
DELIMITER //
CREATE PROCEDURE migrate_features_meta()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'features'
      AND COLUMN_NAME  = 'display_name'
  ) THEN
    ALTER TABLE features
      ADD COLUMN display_name VARCHAR(100) NULL AFTER feature_short_name,
      ADD COLUMN category     VARCHAR(50)  NULL AFTER display_name,
      ADD COLUMN description  TEXT         NULL AFTER category;
  END IF;
END //
DELIMITER ;
CALL migrate_features_meta();
DROP PROCEDURE IF EXISTS migrate_features_meta;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1D. New IAM tables
-- ─────────────────────────────────────────────────────────────────────────────

-- onboarding_requests: one row per Gmail not yet provisioned
CREATE TABLE IF NOT EXISTS onboarding_requests (
  id               VARCHAR(50)  NOT NULL,
  email            VARCHAR(255) NOT NULL,
  name             VARCHAR(255) NOT NULL,
  google_sub       VARCHAR(255) NULL,
  tenant_id        VARCHAR(50)  NULL,
  status           ENUM('PENDING','APPROVED','REJECTED','CANCELLED')
                               NOT NULL DEFAULT 'PENDING',
  request_note     TEXT         NULL,
  rejection_reason TEXT         NULL,
  requested_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at      TIMESTAMP    NULL,
  reviewed_by      VARCHAR(255) NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_onboarding_email (email)
);

-- roles: named permission groups per tenant
CREATE TABLE IF NOT EXISTS roles (
  id             VARCHAR(50)  NOT NULL,
  tenant_id      VARCHAR(50)  NOT NULL,
  name           VARCHAR(100) NOT NULL,
  description    TEXT         NULL,
  is_system_role TINYINT(1)   NOT NULL DEFAULT 0,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_name_tenant (tenant_id, name)
);

-- role_permissions: features assigned to a role
CREATE TABLE IF NOT EXISTS role_permissions (
  id         VARCHAR(50) NOT NULL,
  role_id    VARCHAR(50) NOT NULL,
  feature_id VARCHAR(50) NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_feature (role_id, feature_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- user_roles: roles held by a user within a tenant
CREATE TABLE IF NOT EXISTS user_roles (
  id          VARCHAR(50)  NOT NULL,
  user_email  VARCHAR(255) NOT NULL,
  tenant_id   VARCHAR(50)  NOT NULL,
  role_id     VARCHAR(50)  NOT NULL,
  assigned_by VARCHAR(255) NULL,
  assigned_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_role_tenant (user_email, tenant_id, role_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1E. Seed system roles — ANM Tech Solutions tenant
--     Tenant  : e3845e08-dcc2-11f0-8e78-0242ac110002
--     Super Admin email: anmtechsolutions2023@gmail.com
--     All statements are idempotent (INSERT IGNORE / UPDATE ... WHERE EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Create the four system/default roles for this tenant
INSERT IGNORE INTO roles (id, tenant_id, name, description, is_system_role, is_active) VALUES
  (UUID(), 'e3845e08-dcc2-11f0-8e78-0242ac110002', 'SUPER_ADMIN',  'Full system access — cannot be modified or deleted', 1, 1),
  (UUID(), 'e3845e08-dcc2-11f0-8e78-0242ac110002', 'TENANT_ADMIN', 'User and settings management',                       1, 1),
  (UUID(), 'e3845e08-dcc2-11f0-8e78-0242ac110002', 'VIEWER',       'Read-only access across all modules',                0, 1),
  (UUID(), 'e3845e08-dcc2-11f0-8e78-0242ac110002', 'EDITOR',       'Read and write access across all modules',           0, 1);

-- Step 2: Ensure the super admin exists in user_tenants with full privileges
INSERT IGNORE INTO user_tenants (id, user_email, tenant_id, is_admin, is_super_admin, is_active, status)
VALUES (
  UUID(),
  'anmtechsolutions2023@gmail.com',
  'e3845e08-dcc2-11f0-8e78-0242ac110002',
  1,   -- is_admin
  1,   -- is_super_admin
  1,   -- is_active
  'ACTIVE'
);

-- If the row already existed, make sure it has super admin flags set
UPDATE user_tenants
SET is_admin       = 1,
    is_super_admin = 1,
    is_active      = 1,
    status         = 'ACTIVE'
WHERE user_email = 'anmtechsolutions2023@gmail.com'
  AND tenant_id  = 'e3845e08-dcc2-11f0-8e78-0242ac110002';

-- Step 3: Assign the SUPER_ADMIN role to the super admin user
--         Uses a SELECT subquery so the role UUID doesn't need to be hardcoded.
INSERT IGNORE INTO user_roles (id, user_email, tenant_id, role_id, assigned_by)
SELECT
  UUID(),
  'anmtechsolutions2023@gmail.com',
  'e3845e08-dcc2-11f0-8e78-0242ac110002',
  r.id,
  'system-seed'
FROM roles r
WHERE r.tenant_id      = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND r.name           = 'SUPER_ADMIN'
  AND r.is_system_role = 1
LIMIT 1;
