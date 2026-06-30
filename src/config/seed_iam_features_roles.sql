-- =============================================================================
-- IAM Seed: Features, Roles, and Role Permissions
-- =============================================================================
-- Run once against your database after the initial schema migration.
-- Safe to re-run: all inserts use INSERT IGNORE + fixed primary keys.
--
-- Prerequisites:
--   features     table: UNIQUE KEY on (feature_short_name, scope) OR use fixed
--                       feature_id UUIDs below (PRIMARY KEY prevents duplicates)
--   roles        table: UNIQUE KEY on (name) within tenant context (or global)
--   role_permissions: UNIQUE KEY on (role_id, feature_id)
--
-- Category → Master Data module mapping:
--   MASTER_DATA   → taxtypes, uom, uomfactors, categories, accounttypes,
--                   accounttypebases, transactiontypestatuses, transactiontypeconfigs,
--                   transactiontypes, contactaddresstypes, taxgroups,
--                   taxgrouptaxtypemappers, mapproviders, paymentmodes,
--                   paymentreceivedtypes
--   ORGANIZATION  → organizations, branchdetails, branchusergroupmappers
--   TRANSACTIONS  → transactiontypes, transactiontypebaseconversions,
--                   transactiontypeconversionmappers, transactiondetaillogs,
--                   transactionitemdetails
--   INVENTORY     → batchdetails, itemdetails, costinfos
--   CONTACTS      → contactdetails, addressdetails, locationdetails,
--                   mapproviderlocationmappers
--   PAYMENTS      → paymentmodetransactiondetails, paymentdetails, paymentbreakups
-- =============================================================================

-- =============================================================================
-- PART 1 — Features (12 rows: 6 categories × READ + WRITE)
-- Fixed UUIDs ensure INSERT IGNORE skips on re-run (PK uniqueness).
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
   1);


-- =============================================================================
-- PART 2 — Roles (6 standard roles)
-- Fixed UUIDs; adjust is_system_role=1 for roles that should be non-editable.
-- =============================================================================

INSERT IGNORE INTO roles
  (id, name, description, is_active, is_system_role)
VALUES
  ('a0000001-iam0-0000-0000-000000000001',
   'VIEWER',
   'Read-only access to all modules. Cannot create, update, or delete records.',
   1, 0),

  ('a0000001-iam0-0000-0000-000000000002',
   'EDITOR',
   'Full CRUD access to all modules. Can create, update, and delete records.',
   1, 0),

  ('a0000001-iam0-0000-0000-000000000003',
   'ACCOUNTS_MANAGER',
   'Read access to all modules plus full write access to Payments and Transactions.',
   1, 0),

  ('a0000001-iam0-0000-0000-000000000004',
   'INVENTORY_MANAGER',
   'Read access to all modules plus full write access to Inventory and Master Data.',
   1, 0),

  ('a0000001-iam0-0000-0000-000000000005',
   'TENANT_ADMIN',
   'Full CRUD access to all modules plus admin:access for user/role management.',
   1, 1),

  ('a0000001-iam0-0000-0000-000000000006',
   'OPERATIONS_STAFF',
   'Read access to all modules plus write access to Transactions, Contacts, and Organization.',
   1, 0);


-- =============================================================================
-- PART 3 — Role Permissions
-- Uses subqueries so we don't need to hardcode feature UUIDs here.
-- Requires UNIQUE KEY (role_id, feature_id) on role_permissions table.
-- =============================================================================

-- VIEWER: all READ scopes
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'VIEWER'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope = 'READ';

-- EDITOR: all READ + WRITE scopes
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'EDITOR'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope IN ('READ','WRITE');

-- ACCOUNTS_MANAGER: all READ + Payments WRITE + Transactions WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'ACCOUNTS_MANAGER'
  AND (
    (f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS') AND f.scope = 'READ')
    OR
    (f.feature_short_name IN ('PAYMENTS','TRANSACTIONS') AND f.scope = 'WRITE')
  );

-- INVENTORY_MANAGER: all READ + Inventory WRITE + Master Data WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'INVENTORY_MANAGER'
  AND (
    (f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS') AND f.scope = 'READ')
    OR
    (f.feature_short_name IN ('INVENTORY','MASTER_DATA') AND f.scope = 'WRITE')
  );

-- TENANT_ADMIN: all READ + WRITE (admin:access is handled via backend flag, not a feature)
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'TENANT_ADMIN'
  AND f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS')
  AND f.scope IN ('READ','WRITE');

-- OPERATIONS_STAFF: all READ + Transactions WRITE + Contacts WRITE + Organization WRITE
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'OPERATIONS_STAFF'
  AND (
    (f.feature_short_name IN ('MASTER_DATA','ORGANIZATION','TRANSACTIONS','INVENTORY','CONTACTS','PAYMENTS') AND f.scope = 'READ')
    OR
    (f.feature_short_name IN ('TRANSACTIONS','CONTACTS','ORGANIZATION') AND f.scope = 'WRITE')
  );


-- =============================================================================
-- VERIFICATION QUERIES (run manually to confirm seed)
-- =============================================================================
-- SELECT feature_short_name, scope, display_name FROM features ORDER BY category, scope;
-- SELECT name, description, is_system_role FROM roles ORDER BY name;
-- SELECT r.name AS role, f.feature_short_name, f.scope
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN features f ON f.feature_id = rp.feature_id
--   ORDER BY r.name, f.feature_short_name, f.scope;
