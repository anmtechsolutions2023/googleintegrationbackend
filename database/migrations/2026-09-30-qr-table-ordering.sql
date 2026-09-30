-- =============================================================================
-- QR table ordering — upgrade an EXISTING database in place.
-- =============================================================================
-- A fresh database gets all of this from 01-schema-definition.sql and
-- 02-seed-data.sql (PART 14). This file is for a database that already holds
-- data and cannot be recreated:
--
--   npm run db:migrate -- database/migrations/2026-09-30-qr-table-ordering.sql
--   npm run db:migrate -- database/migrations/2026-09-30-qr-table-ordering.sql --yes
--
-- RE-RUNNABLE. MySQL DDL is not transactional, so every step checks whether it
-- has already happened (information_schema) before doing it. If a step fails,
-- fix the cause and run the whole file again.
-- See QR_TABLE_ORDERING_DESIGN.md.
-- =============================================================================

-- ── 1. auth_otp_challenge: DINER purpose, table binding, restaurant ───────────
ALTER TABLE auth_otp_challenge
  MODIFY purpose ENUM('LOGIN','SIGNUP','DINER') NOT NULL;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE auth_otp_challenge ADD COLUMN context_ref VARCHAR(50) NULL AFTER request_ip',
  'SELECT ''context_ref already present'' AS skipped')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_otp_challenge' AND COLUMN_NAME = 'context_ref');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE auth_otp_challenge ADD COLUMN tenant_id VARCHAR(50) NULL AFTER context_ref',
  'SELECT ''tenant_id already present'' AS skipped')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_otp_challenge' AND COLUMN_NAME = 'tenant_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE auth_otp_challenge ADD INDEX idx_otp_context (context_ref, created_at)',
  'SELECT ''idx_otp_context already present'' AS skipped')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_otp_challenge' AND INDEX_NAME = 'idx_otp_context');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE auth_otp_challenge ADD INDEX idx_otp_tenant_day (tenant_id, purpose, created_at)',
  'SELECT ''idx_otp_tenant_day already present'' AS skipped')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_otp_challenge' AND INDEX_NAME = 'idx_otp_tenant_day');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 2. pos_table_qr ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_table_qr (
    Id              VARCHAR(50)  NOT NULL,
    Token           CHAR(32)     NOT NULL,
    TableId         VARCHAR(50)  NOT NULL,
    BranchDetailId  VARCHAR(50)  NOT NULL,
    TenantId        VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE KEY uk_tableqr_token (Token),
    UNIQUE KEY uk_tableqr_table (TableId, TenantId),
    INDEX idx_tableqr_branch (TenantId, BranchDetailId),
    FOREIGN KEY (TableId) REFERENCES pos_table(Id)
);

-- ── 3. pos_order: why staff refused a guest's round ──────────────────────────
SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE pos_order ADD COLUMN RejectionReasonId VARCHAR(50) NULL AFTER NoCutlery',
  'SELECT ''RejectionReasonId already present'' AS skipped')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_order' AND COLUMN_NAME = 'RejectionReasonId');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE pos_order ADD COLUMN RejectionNote VARCHAR(200) NULL AFTER RejectionReasonId',
  'SELECT ''RejectionNote already present'' AS skipped')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_order' AND COLUMN_NAME = 'RejectionNote');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 4. POS_QR feature and role grants (same as 02-seed-data.sql PART 14) ────
INSERT IGNORE INTO features
    (feature_id, name, feature_short_name, scope, display_name, category, description, is_active)
VALUES
    ('f10000a8-pos0-0000-0000-000000000001',
     'POS QR Read',  'POS_QR', 'READ',
     'Front Desk — QR Ordering View', 'POS',
     'See and print table QR codes, and the queue of orders guests placed from their phones.', 1),
    ('f10000a8-pos0-0000-0000-000000000002',
     'POS QR Write', 'POS_QR', 'WRITE',
     'Front Desk — QR Ordering Manage', 'POS',
     'Issue and rotate table QR codes, switch QR ordering per branch, and accept or reject guests\' orders.', 1);

INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
  FROM roles r
 CROSS JOIN features f
 WHERE r.name IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'POS_MANAGER', 'OWNER_OPERATOR')
   AND f.feature_short_name = 'POS_QR'
   AND f.scope IN ('READ', 'WRITE');

INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
  FROM roles r
 CROSS JOIN features f
 WHERE r.name IN ('POS_CASHIER', 'POS_WAITER')
   AND f.feature_short_name = 'POS_QR'
   AND f.scope = 'READ';

-- ── Verification ─────────────────────────────────────────────────────────────
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_otp_challenge'
   AND COLUMN_NAME IN ('context_ref', 'tenant_id');
SELECT COUNT(*) AS pos_table_qr_exists FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_table_qr';
SELECT r.name AS role, f.scope
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN features f ON f.feature_id = rp.feature_id
 WHERE f.feature_short_name = 'POS_QR'
 ORDER BY r.name, f.scope;
-- Existing sessions carry their scopes from sign-in: staff sign out and back in
-- to pick up POS_QR.
