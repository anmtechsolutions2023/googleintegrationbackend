-- =============================================================================
-- OWNER_OPERATOR — the role that was missing
-- =============================================================================
-- The four back-office roles grant no POS scope and the four POS roles grant no
-- master-data scope: two sets built at different times. Somebody who works the
-- floor AND keeps the books had no role but tenant admin, which also hands them
-- user and role management they did not need.
--
-- This is everything a working owner does, and nothing about administering
-- people. Tenant admin remains the only way to grant that, because it is a
-- membership flag rather than a role.
--
-- Idempotent, and applies to EVERY tenancy — the template one new tenants are
-- cloned from, and each that already exists.
-- =============================================================================

INSERT INTO roles (id, tenant_id, name, description, is_system_role, is_active)
SELECT UUID(), t.tenant_id, 'OWNER_OPERATOR',
       'Owner-operator: runs the floor and keeps the books. No user or role management.',
       0, 1
  FROM (SELECT DISTINCT tenant_id FROM roles) t
 WHERE NOT EXISTS (
       SELECT 1 FROM roles r
        WHERE r.tenant_id = t.tenant_id AND r.name = 'OWNER_OPERATOR');

-- Front desk, the books, and the catalogue. Read-only on Organization and Audit
-- so branch structure and the trail stay a tenant-admin concern.
INSERT IGNORE INTO role_permissions (id, role_id, feature_id)
SELECT UUID(), r.id, f.feature_id
  FROM roles r
 CROSS JOIN features f
 WHERE r.name = 'OWNER_OPERATOR'
   AND f.is_active = 1
   AND (
        (f.feature_short_name IN (
           'POS_ORDER','POS_BILLING','POS_KITCHEN','POS_OPS','POS_CRM','POS_CONFIG',
           'TRANSACTIONS','PAYMENTS','ASSET','MASTER_DATA','INVENTORY','CONTACTS'
         ) AND f.scope IN ('READ','WRITE'))
     OR (f.feature_short_name IN ('POS_REPORTS','ORGANIZATION','AUDIT') AND f.scope = 'READ')
     OR (f.feature_short_name = 'EXPENSE' AND f.scope = 'APPROVE')
   );
