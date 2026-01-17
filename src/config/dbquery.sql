-- drop table user_tenants;
-- drop table features;
-- drop table tenant_features;
-- drop table audit_logs;

-- 1. Table to manage tenant memberships
CREATE TABLE user_tenants (
    id CHAR(36) PRIMARY KEY NOT NULL COMMENT 'GUID for this specific membership',
    tenant_id CHAR(36) NOT NULL COMMENT 'GUID for the tenant',
    user_email VARCHAR(100) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Ensures a user isn't added to the same tenant twice
    UNIQUE KEY uk_tenant_user (tenant_id, user_email),
    INDEX idx_user_lookup (user_email)
);

-- 2. Table defining available features
CREATE TABLE features (
    feature_id CHAR(36) PRIMARY KEY NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    feature_short_name VARCHAR(50) NOT NULL,
    scope ENUM('READ', 'WRITE', 'UPDATE') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE KEY uk_feature_scope (feature_short_name, scope)
);

-- 3. Table mapping features to specific User-Tenant memberships
CREATE TABLE tenant_features (
    tenant_feature_id CHAR(36) PRIMARY KEY NOT NULL,
    user_tenants_id CHAR(36) NOT NULL COMMENT 'FK to user_tenants.id',
    feature_id CHAR(36) NOT NULL COMMENT 'FK to features.feature_id',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Constraint: One user can only have a specific feature once per membership
    UNIQUE KEY uk_user_feature (user_tenants_id, feature_id),

    -- Foreign Keys
    CONSTRAINT fk_membership FOREIGN KEY (user_tenants_id) 
        REFERENCES user_tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_feature FOREIGN KEY (feature_id) 
        REFERENCES features(feature_id) ON DELETE CASCADE
);

-- 4. Table to log audit events
CREATE TABLE audit_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id CHAR(36),
    user_email VARCHAR(100),
    action VARCHAR(100), -- e.g., 'ACCESS_REPORTS'
    status VARCHAR(20), -- 'SUCCESS' or 'DENIED'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
--------------------


-- Table update schema after more feature and tenants have been added

ALTER TABLE user_tenants 
ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE 
AFTER is_admin;