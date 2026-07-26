-- =============================================================================
-- 02-seed-data.sql
-- Essential baseline seed data for a fresh installation.
--
-- How to run:
--   mysql -u <user> -p <database_name> < 02-seed-data.sql
--
-- Prerequisites:
--   Run 01-schema-definition.sql first.
--
-- What this seeds:
--   PART 1 — Super admin user in user_tenants
--   PART 2 — System roles (SUPER_ADMIN, TENANT_ADMIN, VIEWER, EDITOR,
--             ACCOUNTS_MANAGER, INVENTORY_MANAGER, OPERATIONS_STAFF) [7 roles]
--   PART 3 — IAM features: 12 rows (6 categories × READ + WRITE)
--   PART 4 — Role permissions (which features each role gets)
--   PART 5 — Assign SUPER_ADMIN role to the super admin user
--   PART 6 — POS (Front Desk) features: 13 rows (6 categories × READ+WRITE,
--             + POS_REPORTS READ)
--   PART 7 — POS roles (POS_CASHIER, POS_WAITER, POS_KITCHEN_STAFF, POS_MANAGER)
--   PART 8 — POS role permissions (incl. extending SUPER_ADMIN / TENANT_ADMIN
--             with all POS features)
--
-- All INSERT statements use INSERT IGNORE + fixed UUIDs so this file is
-- safe to re-run on a database that already has seed data.
--
-- Tenant: ANM Tech Solutions
-- Tenant ID: e3845e08-dcc2-11f0-8e78-0242ac110002
-- Super Admin email: anmtechsolutions2023@gmail.com
-- =============================================================================

-- =============================================================================
-- PART 1 — Super Admin in user_tenants
-- =============================================================================

INSERT IGNORE INTO user_tenants (id, user_email, tenant_id, is_admin, is_super_admin, is_active, status)
VALUES (
    UUID(),
    'anmtechsolutions2023@gmail.com',
    'e3845e08-dcc2-11f0-8e78-0242ac110002',
    1,       -- is_admin
    1,       -- is_super_admin
    1,       -- is_active
    'ACTIVE'
);

-- Ensure existing row has full super-admin flags in case it was already inserted
-- without them (idempotent update).
UPDATE user_tenants
SET is_admin       = 1,
    is_super_admin = 1,
    is_active      = 1,
    status         = 'ACTIVE'
WHERE user_email = 'anmtechsolutions2023@gmail.com'
  AND tenant_id  = 'e3845e08-dcc2-11f0-8e78-0242ac110002';

-- =============================================================================
-- PART 2 — System Roles
-- Fixed UUIDs — INSERT IGNORE skips on re-run (PK uniqueness).
-- All roles are scoped to the ANM Tech tenant.
-- NOTE: roles.tenant_id is NOT NULL, so roles are per-tenant. For additional
-- tenants, re-run this block with the new tenant_id.
-- =============================================================================

INSERT IGNORE INTO roles (id, tenant_id, name, description, is_system_role, is_active) VALUES

    -- System roles (is_system_role=1: non-editable from admin UI)
    ('r0000001-iam0-0000-0000-000000000001',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'SUPER_ADMIN',
     'Full system access — cannot be modified or deleted.',
     1, 1),

    ('r0000001-iam0-0000-0000-000000000002',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'TENANT_ADMIN',
     'Full CRUD access to all modules plus user and role management.',
     1, 1),

    -- Standard roles (is_system_role=0: editable by admins)
    ('a0000001-iam0-0000-0000-000000000001',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'VIEWER',
     'Read-only access to all modules. Cannot create, update, or delete records.',
     0, 1),

    ('a0000001-iam0-0000-0000-000000000002',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'EDITOR',
     'Full CRUD access to all modules. Can create, update, and delete records.',
     0, 1),

    ('a0000001-iam0-0000-0000-000000000003',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'ACCOUNTS_MANAGER',
     'Read access to all modules plus full write access to Payments and Transactions.',
     0, 1),

    ('a0000001-iam0-0000-0000-000000000004',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'INVENTORY_MANAGER',
     'Read access to all modules plus full write access to Inventory and Master Data.',
     0, 1),

    ('a0000001-iam0-0000-0000-000000000006',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'OPERATIONS_STAFF',
     'Read access to all modules plus write access to Transactions, Contacts, and Organization.',
     0, 1);

-- =============================================================================
-- PART 3 — IAM Features
-- 13 rows: 6 business categories × READ + WRITE scopes, plus AUDIT:READ.
-- Fixed UUIDs — INSERT IGNORE skips on re-run.
-- NOTE: Column is 'name' (not 'feature_name') — matches the application INSERT
-- query in src/config/constants.js. See GAP #2 in 01-schema-definition.sql.
-- =============================================================================

INSERT IGNORE INTO features
    (feature_id, name, feature_short_name, scope, display_name, category, description, is_active)
VALUES

    -- Master Data
    ('f1000001-iam0-0000-0000-000000000001',
     'Master Data Read',  'MASTER_DATA', 'READ',
     'Master Data — View',
     'Master Data',
     'View lookup tables: tax types, UOM, categories, account types, transaction configs, contact address types, payment modes, map providers, tax groups.',
     1),

    ('f1000001-iam0-0000-0000-000000000002',
     'Master Data Write', 'MASTER_DATA', 'WRITE',
     'Master Data — Manage',
     'Master Data',
     'Create and update master data lookup records.',
     1),

    -- Organization
    ('f1000002-iam0-0000-0000-000000000001',
     'Organization Read',  'ORGANIZATION', 'READ',
     'Organization — View',
     'Organization',
     'View organizations, branches, and branch user groups.',
     1),

    ('f1000002-iam0-0000-0000-000000000002',
     'Organization Write', 'ORGANIZATION', 'WRITE',
     'Organization — Manage',
     'Organization',
     'Create and update organizations, branches, and branch user group mappings.',
     1),

    -- Transactions
    ('f1000003-iam0-0000-0000-000000000001',
     'Transactions Read',  'TRANSACTIONS', 'READ',
     'Transactions — View',
     'Transactions',
     'View transaction types, type conversions, conversion mappers, detail logs, and item details.',
     1),

    ('f1000003-iam0-0000-0000-000000000002',
     'Transactions Write', 'TRANSACTIONS', 'WRITE',
     'Transactions — Manage',
     'Transactions',
     'Create and update transaction records and conversion mappings.',
     1),

    -- Inventory
    ('f1000004-iam0-0000-0000-000000000001',
     'Inventory Read',  'INVENTORY', 'READ',
     'Inventory — View',
     'Inventory',
     'View batch details, item details, and cost information.',
     1),

    ('f1000004-iam0-0000-0000-000000000002',
     'Inventory Write', 'INVENTORY', 'WRITE',
     'Inventory — Manage',
     'Inventory',
     'Create and update batch details, item details, and cost information.',
     1),

    -- Contacts
    ('f1000005-iam0-0000-0000-000000000001',
     'Contacts Read',  'CONTACTS', 'READ',
     'Contacts & Addresses — View',
     'Contacts',
     'View contact details, address details, location details, and map provider location mappings.',
     1),

    ('f1000005-iam0-0000-0000-000000000002',
     'Contacts Write', 'CONTACTS', 'WRITE',
     'Contacts & Addresses — Manage',
     'Contacts',
     'Create and update contact records, addresses, and location mappings.',
     1),

    -- Payments
    ('f1000006-iam0-0000-0000-000000000001',
     'Payments Read',  'PAYMENTS', 'READ',
     'Payments — View',
     'Payments',
     'View payment mode transaction details, payment details, and payment breakups.',
     1),

    ('f1000006-iam0-0000-0000-000000000002',
     'Payments Write', 'PAYMENTS', 'WRITE',
     'Payments — Manage',
     'Payments',
     'Create and update payment records and payment breakup entries.',
     1),

    -- Audit (read-only; there is no AUDIT:WRITE — logs are system-generated)
    ('f1000007-iam0-0000-0000-000000000001',
     'Audit Logs Read',  'AUDIT', 'READ',
     'Audit Logs — View',
     'Audit',
     'View the tenant audit log trail (who did what, and when).',
     1);

-- =============================================================================
-- PART 4 — Role Permissions
-- Uses subqueries so role/feature UUIDs don't need to be repeated here.
-- Requires UNIQUE KEY (role_id, feature_id) on role_permissions.
-- =============================================================================

-- SUPER_ADMIN: all READ + WRITE (full access)
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'SUPER_ADMIN'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope IN ('READ','WRITE');

-- TENANT_ADMIN: all READ + WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'TENANT_ADMIN'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope IN ('READ','WRITE');

-- VIEWER: all READ only
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'VIEWER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope = 'READ';

-- EDITOR: all READ + WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'EDITOR'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope IN ('READ','WRITE');

-- ACCOUNTS_MANAGER: all READ + Payments WRITE + Transactions WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'ACCOUNTS_MANAGER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND (
      (f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
       AND f.scope = 'READ')
      OR
      (f.feature_short_name IN ('PAYMENTS','TRANSACTIONS') AND f.scope = 'WRITE')
  );

-- INVENTORY_MANAGER: all READ + Inventory WRITE + Master Data WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'INVENTORY_MANAGER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND (
      (f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
       AND f.scope = 'READ')
      OR
      (f.feature_short_name IN ('INVENTORY','MASTER_DATA') AND f.scope = 'WRITE')
  );

-- OPERATIONS_STAFF: all READ + Transactions WRITE + Contacts WRITE + Organization WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name      = 'OPERATIONS_STAFF'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND (
      (f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
       AND f.scope = 'READ')
      OR
      (f.feature_short_name IN ('TRANSACTIONS','CONTACTS','ORGANIZATION') AND f.scope = 'WRITE')
  );

-- =============================================================================
-- PART 5 — Assign SUPER_ADMIN role to the super admin user
-- Uses subquery so the role UUID doesn't need to be hardcoded.
-- =============================================================================

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

-- =============================================================================
-- PART 6 — POS (Front Desk) Features
-- 13 rows: 6 categories × READ+WRITE, plus POS_REPORTS READ-only.
-- Same pattern/columns as PART 3. category = 'POS'.
-- =============================================================================
INSERT IGNORE INTO features
    (feature_id, name, feature_short_name, scope, display_name, category, description, is_active)
VALUES
    -- POS Config (floors, tables, menu/channel setup)
    ('f10000a1-pos0-0000-0000-000000000001',
     'POS Config Read',  'POS_CONFIG', 'READ',
     'Front Desk — Config View', 'POS',
     'View POS setup: floors, tables, and menu/channel configuration.', 1),
    ('f10000a1-pos0-0000-0000-000000000002',
     'POS Config Write', 'POS_CONFIG', 'WRITE',
     'Front Desk — Config Manage', 'POS',
     'Create and update floors, tables, and menu/channel configuration.', 1),

    -- POS Order (order taking, table occupancy, KOT firing)
    ('f10000a2-pos0-0000-0000-000000000001',
     'POS Order Read',  'POS_ORDER', 'READ',
     'Front Desk — Orders View', 'POS',
     'View orders and table occupancy.', 1),
    ('f10000a2-pos0-0000-0000-000000000002',
     'POS Order Write', 'POS_ORDER', 'WRITE',
     'Front Desk — Orders Manage', 'POS',
     'Take orders, update tables, and fire KOTs.', 1),

    -- POS Kitchen (KDS)
    ('f10000a3-pos0-0000-0000-000000000001',
     'POS Kitchen Read',  'POS_KITCHEN', 'READ',
     'Front Desk — Kitchen View', 'POS',
     'View the Kitchen Display System (pending KOTs).', 1),
    ('f10000a3-pos0-0000-0000-000000000002',
     'POS Kitchen Write', 'POS_KITCHEN', 'WRITE',
     'Front Desk — Kitchen Manage', 'POS',
     'Mark KOTs ready / update kitchen status.', 1),

    -- POS Billing (bill settlement, payments)
    ('f10000a4-pos0-0000-0000-000000000001',
     'POS Billing Read',  'POS_BILLING', 'READ',
     'Front Desk — Billing View', 'POS',
     'View bills and settlements.', 1),
    ('f10000a4-pos0-0000-0000-000000000002',
     'POS Billing Write', 'POS_BILLING', 'WRITE',
     'Front Desk — Billing Manage', 'POS',
     'Settle bills and record payments.', 1),

    -- POS CRM (customers, loyalty, feedback)
    ('f10000a5-pos0-0000-0000-000000000001',
     'POS CRM Read',  'POS_CRM', 'READ',
     'Front Desk — CRM View', 'POS',
     'View customers, loyalty, and feedback.', 1),
    ('f10000a5-pos0-0000-0000-000000000002',
     'POS CRM Write', 'POS_CRM', 'WRITE',
     'Front Desk — CRM Manage', 'POS',
     'Create and update customers, loyalty, and feedback.', 1),

    -- POS Ops (inventory adj., expenses, tokens, online orders)
    ('f10000a6-pos0-0000-0000-000000000001',
     'POS Ops Read',  'POS_OPS', 'READ',
     'Front Desk — Ops View', 'POS',
     'View expenses, tokens, and online orders.', 1),
    ('f10000a6-pos0-0000-0000-000000000002',
     'POS Ops Write', 'POS_OPS', 'WRITE',
     'Front Desk — Ops Manage', 'POS',
     'Manage expenses, tokens, and online orders.', 1),

    -- POS Reports (dashboard & reports — read only)
    ('f10000a7-pos0-0000-0000-000000000001',
     'POS Reports Read', 'POS_REPORTS', 'READ',
     'Front Desk — Reports View', 'POS',
     'View POS dashboard and reports.', 1);

-- =============================================================================
-- PART 7 — POS Roles (per-tenant, editable)
-- =============================================================================
INSERT IGNORE INTO roles (id, tenant_id, name, description, is_system_role, is_active) VALUES
    ('a0000010-pos0-0000-0000-000000000001',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'POS_CASHIER',
     'Front-desk cashier: take orders, settle bills, view customers and setup.',
     0, 1),
    ('a0000010-pos0-0000-0000-000000000002',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'POS_WAITER',
     'Waiter: take orders and view kitchen status.',
     0, 1),
    ('a0000010-pos0-0000-0000-000000000003',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'POS_KITCHEN_STAFF',
     'Kitchen staff: manage KDS and view orders.',
     0, 1),
    ('a0000010-pos0-0000-0000-000000000004',
     'e3845e08-dcc2-11f0-8e78-0242ac110002',
     'POS_MANAGER',
     'Front-desk manager: full POS access plus reports.',
     0, 1);

-- =============================================================================
-- PART 8 — POS Role Permissions (idempotent subquery inserts)
-- =============================================================================

-- POS_CASHIER: ORDER R/W, BILLING R/W, CRM R, CONFIG R
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'POS_CASHIER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND (
        (f.feature_short_name IN ('POS_ORDER','POS_BILLING') AND f.scope IN ('READ','WRITE'))
     OR (f.feature_short_name IN ('POS_CRM','POS_CONFIG')     AND f.scope = 'READ')
  );

-- POS_WAITER: ORDER R/W, KITCHEN R
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'POS_WAITER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND (
        (f.feature_short_name = 'POS_ORDER'   AND f.scope IN ('READ','WRITE'))
     OR (f.feature_short_name = 'POS_KITCHEN' AND f.scope = 'READ')
  );

-- POS_KITCHEN_STAFF: KITCHEN R/W, ORDER R
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'POS_KITCHEN_STAFF'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND (
        (f.feature_short_name = 'POS_KITCHEN' AND f.scope IN ('READ','WRITE'))
     OR (f.feature_short_name = 'POS_ORDER'   AND f.scope = 'READ')
  );

-- POS_MANAGER: all POS features (READ + WRITE, incl. POS_REPORTS READ)
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'POS_MANAGER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN
      ('POS_CONFIG','POS_ORDER','POS_KITCHEN','POS_BILLING','POS_CRM','POS_OPS','POS_REPORTS');

-- Extend existing SUPER_ADMIN & TENANT_ADMIN roles with all POS features too
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name IN ('SUPER_ADMIN','TENANT_ADMIN')
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN
      ('POS_CONFIG','POS_ORDER','POS_KITCHEN','POS_BILLING','POS_CRM','POS_OPS','POS_REPORTS');

-- =============================================================================
-- PART 8b — Preserve pre-gating read access
-- =============================================================================
-- Read (GET) endpoints used to be open to any authenticated user. They are now
-- each gated by their category *_READ (or *_WRITE) scope. To preserve existing
-- access, grant every role the READ feature for each previously-open category so
-- current flows (e.g. POS Billing reading items/branches/menu) keep working.
-- POS_REPORTS is intentionally excluded — its read was already gated before.
-- Admins can revoke any of these per-role from the IAM dashboard afterwards.
-- NOTE: users must re-login to pick up the new scopes in their JWT.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.scope = 'READ'
  AND f.feature_short_name IN
      ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS',
       'POS_CONFIG','POS_ORDER','POS_KITCHEN','POS_BILLING','POS_CRM','POS_OPS');

-- =============================================================================
-- PART 8c — Grant AUDIT:READ to every role
-- =============================================================================
-- Audit log endpoints (/api/audit/*) accept AUDIT:READ or admin:access. Grant
-- AUDIT:READ to every role in the tenant so read-only business users can view
-- the audit trail out of the box. Admins can revoke it per-role from the IAM
-- dashboard afterwards.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name = 'AUDIT'
  AND f.scope = 'READ';

-- =============================================================================
-- PART 9 — Baseline master data for onboarding
-- =============================================================================
-- The master-data setup wizard uses fixed 'Onboarding' master rows. Seed them
-- up-front (idempotent, fixed UUIDs) so they exist before the first onboarding;
-- the bootstrap's get-or-create reuses these rows on subsequent runs instead of
-- hitting the UNIQUE constraints.

-- 9a) Default contact address type (UNIQUE(Name, TenantId))
INSERT IGNORE INTO contactaddresstype (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy)
VALUES (
    'c0000001-cat0-0000-0000-000000000001',
    'e3845e08-dcc2-11f0-8e78-0242ac110002',
    'Onboarding',
    1,
    NOW(),
    'system-seed',
    'system-seed'
);

-- 9b) Default transaction type config (UNIQUE TagName; reused via get-or-create).
-- Prefix is NOT NULL — seeded as '' to match the app's default insert behaviour.
INSERT IGNORE INTO transactiontypeconfig (Id, TenantId, StartCounterNo, Prefix, Format, TagName, Active, CreatedOn, CreatedBy, UpdatedBy)
VALUES (
    't0000001-ttc0-0000-0000-000000000001',
    'e3845e08-dcc2-11f0-8e78-0242ac110002',
    '1',
    '',
    'INV-{0000}',
    'Onboarding',
    1,
    NOW(),
    'system-seed',
    'system-seed'
);

-- =============================================================================
-- PART 10 — Application configuration defaults
-- =============================================================================
-- Onboarding auto-approval ships DISABLED. The super-admin turns it on from the
-- Application Configuration screen. Idempotent — INSERT IGNORE keeps any value
-- an admin has already set.
INSERT IGNORE INTO app_settings (setting_key, setting_value, updated_by)
VALUES ('onboarding.auto_approve.enabled', 'false', 'system-seed');

-- =============================================================================
-- TENANT SETUP STATE (first-time setup wizard gate)
-- =============================================================================
-- Marks a tenant COMPLETED when it ALREADY has both an organizationdetail and a
-- branchdetail row — the two things the setup wizard creates. Tenants with that
-- data are already operating and must not be sent back through the wizard; a
-- tenant with no row here resolves to PENDING and will be prompted on next login.
--
-- ON A FRESH INSTALL THIS MATCHES NOTHING, which is the intended outcome: this
-- seed creates no organizationdetail/branchdetail rows, so the seeded tenant
-- starts PENDING and its admin is taken straight to the setup wizard.
--
-- It earns its keep in two other cases:
--   a) re-running this seed against a database that already holds master data;
--   b) upgrading an existing deployment in place — run just this statement
--      (plus the tenant_setup CREATE TABLE from 01-schema-definition.sql §1.1b)
--      against the live database so current users are not locked out.
INSERT INTO tenant_setup (tenant_id, status, completed_at, completed_by)
SELECT DISTINCT ut.tenant_id, 'COMPLETED', NOW(), 'SYSTEM_SEED'
FROM   user_tenants ut
WHERE  EXISTS (SELECT 1 FROM organizationdetail o WHERE o.TenantId = ut.tenant_id)
  AND  EXISTS (SELECT 1 FROM branchdetail       b WHERE b.TenantId = ut.tenant_id)
ON DUPLICATE KEY UPDATE status = 'COMPLETED';

-- =============================================================================
-- VERIFICATION QUERIES — run these manually after seeding to confirm correctness
-- =============================================================================

-- Check super admin user:
-- SELECT id, user_email, tenant_id, is_admin, is_super_admin, status FROM user_tenants;

-- Check all 7 roles:
-- SELECT id, name, is_system_role, is_active FROM roles ORDER BY name;

-- Check all 12 features:
-- SELECT feature_short_name, scope, display_name FROM features ORDER BY category, scope;

-- Check role permission matrix:
-- SELECT r.name AS role, f.feature_short_name, f.scope
--   FROM role_permissions rp
--   JOIN roles r    ON r.id           = rp.role_id
--   JOIN features f ON f.feature_id   = rp.feature_id
--   WHERE r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
--   ORDER BY r.name, f.feature_short_name, f.scope;

-- Check tenancy setup state (expect ZERO rows on a fresh install — every tenant
-- is PENDING and will be prompted for the first-time setup wizard):
-- SELECT * FROM tenant_setup;

-- Which tenants will be prompted for setup (no row = PENDING):
-- SELECT DISTINCT ut.tenant_id
--   FROM user_tenants ut
--   LEFT JOIN tenant_setup ts ON ts.tenant_id = ut.tenant_id
--   WHERE ts.tenant_id IS NULL OR ts.status <> 'COMPLETED';

-- Check super admin role assignment:
-- SELECT ur.user_email, r.name AS role, ur.assigned_by
--   FROM user_roles ur
--   JOIN roles r ON r.id = ur.role_id
--   WHERE ur.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002';
