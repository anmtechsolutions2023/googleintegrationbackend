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
--   PART 1  — Super admin user in user_tenants
--   PART 2  — System roles (SUPER_ADMIN, TENANT_ADMIN, VIEWER, EDITOR,
--             ACCOUNTS_MANAGER, INVENTORY_MANAGER, OPERATIONS_STAFF) [7 roles]
--   PART 3  — IAM features: 13 rows (6 categories × READ + WRITE, + AUDIT:READ)
--   PART 4  — Role permissions (which features each role gets)
--   PART 5  — Assign SUPER_ADMIN role to the super admin user
--   PART 6  — POS (Front Desk) features: 13 rows (6 categories × READ+WRITE,
--             + POS_REPORTS READ)
--   PART 7  — POS roles (POS_CASHIER, POS_WAITER, POS_KITCHEN_STAFF, POS_MANAGER)
--   PART 8  — POS role permissions (incl. extending SUPER_ADMIN / TENANT_ADMIN
--             with all POS features)
--   PART 8b — Preserve pre-gating read access
--   PART 8c — Grant AUDIT:READ to every role
--   PART 8d — Asset register + expense approval (ASSET:READ/WRITE,
--             EXPENSE:APPROVE) — required by /api/assets and the expense
--             approve/reject routes
--   PART 9  — Baseline master data for onboarding
--   PART 10 — Application configuration defaults
--   PART 11 — Accounting ledger masters + document numbering series
--             (POS_SALE, EXPENSE, POS_ORDER, POS_KOT, POS_BILL, POS_TOKEN)
--   PART 12 — POS food types (Veg / Vegan / Non-Veg)
--
-- Verified against an empty database: 39 statements, 29 features, 11 roles,
-- 133 role permissions, 7 numbering series.
--
-- 133, down from 210: PARTs 8b/8c/8d used to grant every role in the tenancy
-- READ on all twelve categories plus AUDIT and ASSET, which left a POS_CASHIER
-- holding 16 scopes where its own definition grants 6, and a VIEWER 14. Each
-- role now carries what its own job needs; the handful of cross-category reads
-- a till genuinely makes are admitted on those endpoints instead.
--
-- All INSERT statements use INSERT IGNORE + fixed UUIDs so this file is
-- safe to re-run on a database that already has seed data.
--
-- These two files are the ONLY source of truth for the database. There is no
-- migration directory: schema changes are made here, in place, and a rebuild is
-- a drop-and-recreate.
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
-- PART 8b — Cross-category reads, granted per role
-- =============================================================================
-- This block used to grant EVERY role in the tenancy READ on all twelve
-- categories, to preserve access from when GET endpoints were ungated. On a
-- database built from this script there is nothing to preserve: it only made
-- every role a near-universal reader. A POS_CASHIER came out with 16 scopes
-- where its own definition grants 6, a VIEWER with 14 — the role names stopped
-- meaning anything for reads, and a cashier was shown the whole Master Data
-- section because they genuinely held MASTER_DATA:READ.
--
-- What the blanket grant was really covering is that a few POS screens must
-- read reference data owned by another category — the till resolves dish names
-- from itemdetail and tender types from paymentmode. That is now handled where
-- it belongs, on those endpoints, which admit the POS scope that needs them
-- (see paymentmode/itemdetail/accounttypebase routes, and /api/pos/branches).
-- Granting a whole category to reach one lookup is what put Master Data in a
-- cashier's menu.
--
-- So this part now grants only what a role's own job needs beyond its category:
--
--   POS_MANAGER  — TRANSACTIONS:READ. They own the day's takings, so the
--                  ledger and finance screens are part of the job. Read only:
--                  posting and refunding stay with TRANSACTIONS:WRITE.
--
-- Everything else a role can read comes from its own PART 8 / PART 8a grants.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND r.name = 'POS_MANAGER'
  AND f.feature_short_name = 'TRANSACTIONS'
  AND f.scope = 'READ';

-- =============================================================================
-- PART 8c — AUDIT:READ
-- =============================================================================
-- The audit trail records who did what across the whole tenancy, so it is an
-- oversight function rather than a general read. This used to be granted to
-- every role, which handed a cashier the movements of everybody else.
--
-- /api/audit/* admits AUDIT:READ, admin:access, TENANT:ADMIN or a super admin,
-- and the controller narrows a tenant admin to their own tenancy — so the two
-- admin roles reach it without a grant. The explicit grant here is for the
-- roles whose job is oversight without administration.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND r.name IN ('SUPER_ADMIN','TENANT_ADMIN','ACCOUNTS_MANAGER')
  AND f.feature_short_name = 'AUDIT'
  AND f.scope = 'READ';

-- =============================================================================
-- PART 8d — Asset register + expense approval features
-- =============================================================================
-- These two were REFERENCED BY ROUTES but never defined, so no role could hold
-- them and no JWT ever carried them:
--   /api/assets/*                     requires ASSET:READ / ASSET:WRITE
--   /api/pos/expenses/:id/approve|reject requires EXPENSE:APPROVE
-- The Asset Register answered 403 for everyone, including tenant admins, and an
-- expense could be raised but never approved — the lifecycle had no exit.
--
-- Features are GLOBAL (see admin.service.provisionTenantIam); only roles and
-- role_permissions are per-tenant, so a new tenant picks these up by cloning
-- the template tenant's grants below.
INSERT IGNORE INTO features
    (feature_id, name, feature_short_name, scope, display_name, category, description, is_active)
VALUES
    ('f1000008-iam0-0000-0000-000000000001',
     'Asset Read',  'ASSET', 'READ',
     'Asset Register — View', 'Assets',
     'View the equipment register: what the outlet owns, what it cost, and where it is.',
     1),
    ('f1000008-iam0-0000-0000-000000000002',
     'Asset Write', 'ASSET', 'WRITE',
     'Asset Register — Manage', 'Assets',
     'Register assets, move them between branches, and change their status.',
     1),
    -- Approval is deliberately its OWN scope rather than POS_OPS:WRITE. Raising
    -- a claim and approving one are different authorities: the cashier who
    -- spends should not be the person who signs it off.
    ('f1000009-iam0-0000-0000-000000000001',
     'Expense Approve', 'EXPENSE', 'APPROVE',
     'Expenses — Approve / Reject', 'Expenses',
     'Approve or reject a draft expense claim before it can be settled.',
     1);

-- Admins get all three. Both roles are cloned into every new tenant, so this
-- also fixes provisioning going forward.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name IN ('SUPER_ADMIN','TENANT_ADMIN')
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN ('ASSET','EXPENSE');

-- The manager runs the outlet's money, so they approve spend and keep the
-- register. A cashier does neither.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'POS_MANAGER'
  AND r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND f.feature_short_name IN ('ASSET','EXPENSE');

-- Read-only visibility of the register for the roles that account for the
-- outlet's property. This used to be granted to every role on the reasoning
-- that seeing what the outlet owns is harmless; it was still one more entry in
-- a cashier's menu that their job never sends them to. EXPENSE:APPROVE is NOT
-- granted here — it is an authority, not a view.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.tenant_id = 'e3845e08-dcc2-11f0-8e78-0242ac110002'
  AND r.name IN ('ACCOUNTS_MANAGER','INVENTORY_MANAGER')
  AND f.feature_short_name = 'ASSET'
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
-- PART 11 — Accounting ledger masters
-- =============================================================================
-- Without these the ledger cannot function: accounttypebase is NOT NULL on both
-- payment tables, and no status transition is legal until the whitelist below
-- exists. Idempotent (INSERT IGNORE + fixed UUIDs).
--
-- Model: settling a POS bill posts a Sale document
--   transactiondetaillog  →  transactionitemdetail (lines)
--                         →  paymentdetail → paymentbreakup (one per tender)
-- and every status change is recorded against a permitted transition.

-- 11a) Document statuses
INSERT IGNORE INTO transactiontypestatus (Id, Name, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('s0000001-ldgr-0000-0000-000000000001', 'DRAFT',          1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('s0000001-ldgr-0000-0000-000000000002', 'PARTIALLY_PAID', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('s0000001-ldgr-0000-0000-000000000003', 'SETTLED',        1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('s0000001-ldgr-0000-0000-000000000004', 'CANCELLED',      1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('s0000001-ldgr-0000-0000-000000000005', 'REFUNDED',       1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed');

-- 11b) Numbering series — one PER DOCUMENT TYPE.
-- Sales and expenses must not share a counter: an accountant reading INV-0007
-- and EXP-0003 needs each series to be gap-free in its own right, which a
-- shared counter cannot give. Prefix differs from the PART 9b 'Onboarding' row
-- so UNIQUE(StartCounterNo, Prefix, Format, TenantId) is satisfied; the rendered
-- number comes from Format, so these read as INV-0001 / EXP-0001.
-- Orders, KOTs, bills and counter tokens have series too. Their numbers used to be minted in the
-- browser from Date.now(): ORD-<last 6 digits of epoch ms> wrapped every ~16m40s
-- and collided with UNIQUE (OrderNo, TenantId), failing the sale, and KotNo was
-- the raw 13-digit epoch the kitchen display then showed as the ticket number.
-- These are operational counters, so a gap is harmless — uniqueness is not.
INSERT IGNORE INTO transactiontypeconfig (Id, TenantId, StartCounterNo, Prefix, Format, TagName, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('t0000001-ttc0-0000-0000-000000000002', 'e3845e08-dcc2-11f0-8e78-0242ac110002', '1', 'INV',  'INV-{0000}',  'POS_SALE',  1, NOW(), 'system-seed', 'system-seed'),
    ('t0000001-ttc0-0000-0000-000000000003', 'e3845e08-dcc2-11f0-8e78-0242ac110002', '1', 'EXP',  'EXP-{0000}',  'EXPENSE',   1, NOW(), 'system-seed', 'system-seed'),
    ('t0000001-ttc0-0000-0000-000000000004', 'e3845e08-dcc2-11f0-8e78-0242ac110002', '1', 'ORD',  'ORD-{0000}',  'POS_ORDER', 1, NOW(), 'system-seed', 'system-seed'),
    ('t0000001-ttc0-0000-0000-000000000005', 'e3845e08-dcc2-11f0-8e78-0242ac110002', '1', 'KOT',  'KOT-{0000}',  'POS_KOT',   1, NOW(), 'system-seed', 'system-seed'),
    ('t0000001-ttc0-0000-0000-000000000006', 'e3845e08-dcc2-11f0-8e78-0242ac110002', '1', 'BILL', 'BILL-{0000}', 'POS_BILL',  1, NOW(), 'system-seed', 'system-seed'),
    -- Counter tokens, for branches configured with 'series' numbering (see
    -- pos_setting.token.numbering). Branches on the default 'daily' setting
    -- never touch this row — they count in pos_token_counter instead.
    ('t0000001-ttc0-0000-0000-000000000007', 'e3845e08-dcc2-11f0-8e78-0242ac110002', '1', 'TOK',  'TOK-{0000}',  'POS_TOKEN', 1, NOW(), 'system-seed', 'system-seed');

-- 11c) Document types, each bound to its own series.
INSERT IGNORE INTO transactiontype (Id, Name, TransactionTypeConfigId, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('y0000001-ldgr-0000-0000-000000000001', 'POS Sale', 't0000001-ttc0-0000-0000-000000000002', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('y0000001-ldgr-0000-0000-000000000002', 'Expense',  't0000001-ttc0-0000-0000-000000000003', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed');

-- 11d) Permitted status transitions, PER SERIES.
-- NOTE: SETTLED → CANCELLED is deliberately ABSENT. A settled document is
-- reversed by REFUNDED, never voided — that distinction is the whole point of
-- the whitelist. Tags are unique per tenant, so each series names its own.
INSERT IGNORE INTO transactiontypebaseconversion
    (Id, TenantId, TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, Tag, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES
    -- POS Sale: draft → settled / part-paid → settled, void while draft, refund once settled
    ('v0000001-ldgr-0000-0000-000000000001', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000002',
     's0000001-ldgr-0000-0000-000000000001', 's0000001-ldgr-0000-0000-000000000003', 'POS_SALE_SETTLE', 1, NOW(), 'system-seed', 'system-seed'),
    ('v0000001-ldgr-0000-0000-000000000002', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000002',
     's0000001-ldgr-0000-0000-000000000001', 's0000001-ldgr-0000-0000-000000000002', 'POS_SALE_PART_PAY', 1, NOW(), 'system-seed', 'system-seed'),
    ('v0000001-ldgr-0000-0000-000000000003', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000002',
     's0000001-ldgr-0000-0000-000000000002', 's0000001-ldgr-0000-0000-000000000003', 'POS_SALE_SETTLE_REMAINDER', 1, NOW(), 'system-seed', 'system-seed'),
    ('v0000001-ldgr-0000-0000-000000000004', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000002',
     's0000001-ldgr-0000-0000-000000000001', 's0000001-ldgr-0000-0000-000000000004', 'POS_SALE_VOID', 1, NOW(), 'system-seed', 'system-seed'),
    ('v0000001-ldgr-0000-0000-000000000005', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000002',
     's0000001-ldgr-0000-0000-000000000003', 's0000001-ldgr-0000-0000-000000000005', 'POS_SALE_REFUND', 1, NOW(), 'system-seed', 'system-seed'),
    -- Expense: the DRAFT → APPROVED step lives on pos_expense, not here. An
    -- unapproved claim is not yet a financial event, so no document exists for
    -- it; settling is what posts, and reversal is the only way back out.
    ('v0000001-ldgr-0000-0000-000000000006', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000003',
     's0000001-ldgr-0000-0000-000000000001', 's0000001-ldgr-0000-0000-000000000003', 'EXPENSE_SETTLE', 1, NOW(), 'system-seed', 'system-seed'),
    ('v0000001-ldgr-0000-0000-000000000007', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000003',
     's0000001-ldgr-0000-0000-000000000001', 's0000001-ldgr-0000-0000-000000000004', 'EXPENSE_VOID', 1, NOW(), 'system-seed', 'system-seed'),
    ('v0000001-ldgr-0000-0000-000000000008', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 't0000001-ttc0-0000-0000-000000000003',
     's0000001-ldgr-0000-0000-000000000003', 's0000001-ldgr-0000-0000-000000000005', 'EXPENSE_REVERSE', 1, NOW(), 'system-seed', 'system-seed');

-- 11e) Ledger accounts, each with its KIND.
-- Kind is what lets cash flow classify a movement without matching on a name a
-- tenant is free to change.
INSERT IGNORE INTO accounttypebase (Id, Name, Kind, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('b0000001-ldgr-0000-0000-000000000001', 'Sales',    'INCOME',  1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('b0000001-ldgr-0000-0000-000000000002', 'Cash',     'ASSET',   1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('b0000001-ldgr-0000-0000-000000000003', 'Bank',     'ASSET',   1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('b0000001-ldgr-0000-0000-000000000004', 'Wallet',   'ASSET',   1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('b0000001-ldgr-0000-0000-000000000005', 'Expenses', 'EXPENSE', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed');

-- 11f) Tender types, each mapped to the account the money LANDS IN.
-- Without this mapping every tender books to 'Sales' and no account means
-- anything: cash sales and card sales become indistinguishable.
INSERT IGNORE INTO paymentmode (Id, Type, DefaultAccountTypeBaseId, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('m0000001-ldgr-0000-0000-000000000001', 'Cash',   'b0000001-ldgr-0000-0000-000000000002', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('m0000001-ldgr-0000-0000-000000000002', 'Card',   'b0000001-ldgr-0000-0000-000000000003', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('m0000001-ldgr-0000-0000-000000000003', 'UPI',    'b0000001-ldgr-0000-0000-000000000003', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('m0000001-ldgr-0000-0000-000000000004', 'Wallet', 'b0000001-ldgr-0000-0000-000000000004', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed');

-- 11g) How a receipt is classified
INSERT IGNORE INTO paymentreceivedtype (Id, Type, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('r0000001-ldgr-0000-0000-000000000001', 'Full',    'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('r0000001-ldgr-0000-0000-000000000002', 'Partial', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('r0000001-ldgr-0000-0000-000000000003', 'Advance', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('r0000001-ldgr-0000-0000-000000000004', 'Refund',  'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    -- Money OUT. paymentbreakup.PaymentReceivedTypeId is NOT NULL, so an
    -- expense payment needs a classification of its own rather than borrowing
    -- 'Full', which would make expenses look like receipts in every report.
    ('r0000001-ldgr-0000-0000-000000000005', 'Payment', 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed');

-- 11h) Expense categories — the analysis axis for spend.
INSERT IGNORE INTO expense_category (Id, Name, AccountTypeBaseId, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('e0000001-ldgr-0000-0000-000000000001', 'Raw Material', 'b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('e0000001-ldgr-0000-0000-000000000002', 'Gas',          'b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('e0000001-ldgr-0000-0000-000000000003', 'Utilities',    'b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('e0000001-ldgr-0000-0000-000000000004', 'Rent',         'b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('e0000001-ldgr-0000-0000-000000000005', 'Salary',       'b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('e0000001-ldgr-0000-0000-000000000006', 'Maintenance',  'b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('e0000001-ldgr-0000-0000-000000000007', 'Miscellaneous','b0000001-ldgr-0000-0000-000000000005', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed');

-- 11i) Asset categories — the analysis axis for the equipment register.
INSERT IGNORE INTO asset_category (Id, Name, Active, TenantId, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('a0000001-ldgr-0000-0000-000000000001', 'Kitchen Equipment', 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('a0000001-ldgr-0000-0000-000000000002', 'Furniture',         1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('a0000001-ldgr-0000-0000-000000000003', 'IT Equipment',      1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('a0000001-ldgr-0000-0000-000000000004', 'Fixtures',          1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed'),
    ('a0000001-ldgr-0000-0000-000000000005', 'Vehicle',           1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', NOW(), 'system-seed', 'system-seed');

-- =============================================================================
-- PART 12 — POS food types
-- =============================================================================
-- pos_item_meta.FoodTypeId is NOT NULL, so without these rows the Menu Items
-- form cannot be submitted at all — a tenant with no food types cannot create a
-- single menu item. IsVeg drives the veg/non-veg badge on the Billing menu grid.
-- Keyed on Code to match UNIQUE (Code, TenantId).
--
-- Mirrored per-tenant by FOOD_TYPES in modules/mastersetup/posMasters.provision.js,
-- which seeds these for every tenant created through first-time setup.
INSERT IGNORE INTO pos_food_type (Id, Name, Code, Description, SortOrder, IsVeg, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES
    ('f0000001-ftyp-0000-0000-000000000001', 'Veg',     'VEG',    'Vegetarian',                        1, 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('f0000001-ftyp-0000-0000-000000000002', 'Vegan',   'VEGAN',  'No animal produce of any kind',     2, 1, 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed'),
    ('f0000001-ftyp-0000-0000-000000000003', 'Non-Veg', 'NONVEG', 'Contains meat, fish or egg',        3, 0, 'e3845e08-dcc2-11f0-8e78-0242ac110002', 1, NOW(), 'system-seed', 'system-seed');

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
