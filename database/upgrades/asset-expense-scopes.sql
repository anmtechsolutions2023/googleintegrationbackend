-- =============================================================================
-- asset-expense-scopes.sql — UPGRADE AN EXISTING DATABASE IN PLACE
--
-- Defines two IAM features that routes have always required but that no
-- database ever contained:
--   ASSET:READ / ASSET:WRITE   — /api/assets/*
--   EXPENSE:APPROVE            — /api/pos/expenses/:id/approve | /reject
--
-- The effect of the gap: /api/assets answered
--   403 "Access requires one of these scopes: [TENANT:ADMIN, TENANT:SUPER_ADMIN,
--        ASSET:READ, ASSET:WRITE]"
-- for EVERY user including tenant admins, because a scope with no feature row
-- can never reach a JWT. An expense could be raised and then never approved,
-- so the lifecycle had no exit.
--
-- NOT part of the install sequence — 01/02 are the source of truth and already
-- carry this (see 02-seed-data.sql PART 8d). This file exists to bring an
-- ALREADY-DEPLOYED database up to it without a re-seed.
--
-- How to run:
--   mysql -u <user> -p <database_name> < database/upgrades/asset-expense-scopes.sql
--
-- Idempotent: INSERT IGNORE with fixed feature UUIDs, and grants keyed on
-- UNIQUE (role_id, feature_id). Safe to re-run.
--
-- Scope of the change: features are GLOBAL, roles and role_permissions are
-- per-tenant (see admin.service.provisionTenantIam), so this grants across
-- EVERY existing tenant rather than only the seeded one. New tenants clone the
-- template tenant's grants and need nothing further.
-- =============================================================================


-- =============================================================================
-- PART 0 — Before (read only). Expect 0 rows.
-- =============================================================================
SELECT 'features defined' AS check_name, COUNT(*) AS n
  FROM features WHERE feature_short_name IN ('ASSET', 'EXPENSE')
UNION ALL
SELECT 'roles holding them', COUNT(*)
  FROM role_permissions rp
  JOIN features f ON f.feature_id = rp.feature_id
 WHERE f.feature_short_name IN ('ASSET', 'EXPENSE');


-- =============================================================================
-- PART 1 — The features themselves (global)
-- =============================================================================
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
    -- Approval is its OWN scope, not POS_OPS:WRITE. Raising a claim and signing
    -- it off are different authorities: the cashier who spends should not be
    -- the person who approves it.
    ('f1000009-iam0-0000-0000-000000000001',
     'Expense Approve', 'EXPENSE', 'APPROVE',
     'Expenses — Approve / Reject', 'Expenses',
     'Approve or reject a draft expense claim before it can be settled.',
     1);


-- =============================================================================
-- PART 2 — Grants, for every tenant that already exists
-- =============================================================================

-- Admins, in every tenant. This is what unblocks the Asset Register today.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name IN ('SUPER_ADMIN', 'TENANT_ADMIN')
  AND f.feature_short_name IN ('ASSET', 'EXPENSE');

-- The outlet manager runs the money: they approve spend and keep the register.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE r.name = 'POS_MANAGER'
  AND f.feature_short_name IN ('ASSET', 'EXPENSE');

-- Read-only visibility of the register for every other role, matching the
-- reasoning in 02-seed-data PART 8b. EXPENSE:APPROVE is deliberately NOT
-- granted here: it is an authority, not a view.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
FROM roles r
CROSS JOIN features f
WHERE f.feature_short_name = 'ASSET'
  AND f.scope = 'READ';


-- =============================================================================
-- PART 3 — VERIFICATION
-- =============================================================================
-- Expect 3 features, and one row per role per feature.
-- SELECT feature_short_name, scope, display_name
--   FROM features WHERE feature_short_name IN ('ASSET','EXPENSE');

-- Who can now do what:
-- SELECT r.tenant_id, r.name AS role,
--        GROUP_CONCAT(CONCAT(f.feature_short_name, ':', f.scope) ORDER BY f.feature_short_name) AS scopes
--   FROM role_permissions rp
--   JOIN roles r    ON r.id = rp.role_id
--   JOIN features f ON f.feature_id = rp.feature_id
--  WHERE f.feature_short_name IN ('ASSET','EXPENSE')
--  GROUP BY r.tenant_id, r.name ORDER BY r.tenant_id, r.name;

-- IMPORTANT: scopes are baked into the JWT at login. Every signed-in user must
-- LOG OUT AND BACK IN before the Asset Register opens for them — the grant is
-- in the database, but their current token was minted before it existed.


-- =============================================================================
-- PART 4 — ROLLBACK
-- =============================================================================
-- DELETE rp FROM role_permissions rp
--   JOIN features f ON f.feature_id = rp.feature_id
--  WHERE f.feature_short_name IN ('ASSET','EXPENSE');
-- DELETE FROM features WHERE feature_short_name IN ('ASSET','EXPENSE');
