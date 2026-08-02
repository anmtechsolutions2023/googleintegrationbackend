-- =============================================================================
-- 01-schema-definition.sql
-- Complete, fresh-install DDL for the full application database.
-- This is the SINGLE schema file — core auth, IAM, business domain, and POS
-- ("Front Desk") tables. All historical migrations are collapsed in.
--
-- How to run:
--   mysql -u <user> -p <database_name> < 01-schema-definition.sql
--
-- This script:
--   - Drops and recreates every application table in dependency order
--     (Section 1 core auth, 2 IAM, 3 business domain, 4 POS)
--   - Collapses all historical ALTER TABLE migrations into final column definitions
--   - Is idempotent for a fresh database (DROP TABLE IF EXISTS + CREATE TABLE)
--
-- WARNING: Drops all tables before recreating. Do NOT run against a database
--          that has live data.
--
-- Tested against: MySQL 5.7+ and MySQL 8.x
-- Run before: 02-seed-data.sql
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- SECTION 1: Core Auth & Tenant Tables
-- Source: src/config/dbquery.sql + src/config/db-queries-iam.sql (collapsed)
-- =============================================================================

DROP TABLE IF EXISTS tenant_features;
DROP TABLE IF EXISTS tenant_setup;
DROP TABLE IF EXISTS user_tenants;
DROP TABLE IF EXISTS features;
DROP TABLE IF EXISTS audit_logs;

-- 1.1 user_tenants
-- Manages tenant membership for each authenticated user.
-- Final schema includes: is_super_admin (dbquery.sql ALTER), status + updated_at (IAM migration).
CREATE TABLE user_tenants (
    id              CHAR(36)                       NOT NULL COMMENT 'GUID for this specific membership',
    tenant_id       CHAR(36)                       NOT NULL COMMENT 'GUID for the tenant',
    user_email      VARCHAR(100)                   NOT NULL,
    is_admin        BOOLEAN                        NOT NULL DEFAULT FALSE,
    is_super_admin  BOOLEAN                        NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN                        NOT NULL DEFAULT TRUE,
    status          ENUM('ACTIVE','SUSPENDED')     NOT NULL DEFAULT 'ACTIVE',
    updated_at      TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                   ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_tenant_user (tenant_id, user_email),
    INDEX idx_user_lookup (user_email)
);

-- 1.1b tenant_setup
-- One row per tenant recording whether the first-time master-data setup wizard
-- (POST /api/master-data/bootstrap) has been completed. Until it is, the tenant's
-- users are gated to Home / Audit Logs / Logout by the requireTenantSetup
-- middleware.
--
-- The ABSENCE of a row is equivalent to status = 'PENDING' — a brand-new tenant
-- has no row and is therefore gated. There is no FK: user_tenants.tenant_id is
-- not unique (one row per membership) and no standalone tenants table exists.
CREATE TABLE tenant_setup (
    tenant_id     CHAR(36)                       NOT NULL,
    status        ENUM('PENDING','COMPLETED')    NOT NULL DEFAULT 'PENDING',
    completed_at  TIMESTAMP                      NULL,
    completed_by  VARCHAR(255)                   NULL,
    created_at    TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                 ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id)
);

-- 1.2 features
-- Defines available system features / scopes.
-- Final schema includes: display_name, category, description (IAM migration).
-- NOTE: The column is named 'name', NOT 'feature_name'. The original dbquery.sql
-- CREATE TABLE used 'feature_name' but the application INSERT (constants.js)
-- uses 'name'. The correct column name for a fresh install is 'name'.
CREATE TABLE features (
    feature_id          CHAR(36)                        NOT NULL,
    name                VARCHAR(100)                    NOT NULL,
    feature_short_name  VARCHAR(50)                     NOT NULL,
    scope               ENUM('READ', 'WRITE', 'UPDATE') NOT NULL,
    display_name        VARCHAR(100)                    NULL,
    category            VARCHAR(50)                     NULL,
    description         TEXT                            NULL,
    is_active           BOOLEAN                         NOT NULL DEFAULT TRUE,
    PRIMARY KEY (feature_id),
    UNIQUE KEY uk_feature_scope (feature_short_name, scope)
);

-- 1.3 tenant_features
-- Maps specific features to individual user-tenant memberships.
-- This is the legacy per-user grant model; the IAM layer (Section 2) adds
-- role-based permissions on top of this.
CREATE TABLE tenant_features (
    tenant_feature_id  CHAR(36)  NOT NULL,
    user_tenants_id    CHAR(36)  NOT NULL COMMENT 'FK to user_tenants.id',
    feature_id         CHAR(36)  NOT NULL COMMENT 'FK to features.feature_id',
    is_active          BOOLEAN   NOT NULL DEFAULT TRUE,
    PRIMARY KEY (tenant_feature_id),
    UNIQUE KEY uk_user_feature (user_tenants_id, feature_id),
    CONSTRAINT fk_tf_membership FOREIGN KEY (user_tenants_id) REFERENCES user_tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_tf_feature    FOREIGN KEY (feature_id)      REFERENCES features(feature_id) ON DELETE CASCADE
);

-- 1.4 audit_logs
-- Records all auditable user actions across the application.
-- Final schema: tenant_id is nullable (guest logins); includes log_level,
-- category, resource_id (migration 001); 4 performance indexes baked in.
CREATE TABLE audit_logs (
    log_id       INT AUTO_INCREMENT                          NOT NULL,
    tenant_id    VARCHAR(50)                                 NULL,
    user_email   VARCHAR(100)                                NULL,
    action       VARCHAR(100)                                NULL COMMENT 'Human-readable action label',
    status       VARCHAR(20)                                 NULL COMMENT 'SUCCESS, DENIED, ERROR, etc.',
    ip_address   VARCHAR(45)                                 NULL,
    log_level    ENUM('DEBUG','INFO','WARN','ERROR')         NOT NULL DEFAULT 'INFO',
    category     VARCHAR(50)                                 NULL,
    resource_id  VARCHAR(255)                                NULL,
    timestamp    DATETIME                                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    INDEX idx_audit_level     (log_level),
    INDEX idx_audit_category  (category),
    INDEX idx_audit_tenant_ts (tenant_id, timestamp DESC),
    INDEX idx_audit_email_ts  (user_email, timestamp DESC)
);

-- =============================================================================
-- SECTION 2: IAM Tables
-- Source: src/config/db-queries-iam.sql
-- =============================================================================

DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS onboarding_requests;

-- 2.1 onboarding_requests
-- One row per Gmail address that has signed in but is not yet provisioned into
-- a tenant. Admin approves/rejects from the admin panel.
CREATE TABLE onboarding_requests (
    id                VARCHAR(50)                                         NOT NULL,
    email             VARCHAR(255)                                        NOT NULL,
    name              VARCHAR(255)                                        NOT NULL,
    google_sub        VARCHAR(255)                                        NULL,
    tenant_id         VARCHAR(50)                                         NULL,
    status            ENUM('PENDING','APPROVED','REJECTED','CANCELLED')   NOT NULL DEFAULT 'PENDING',
    request_note      TEXT                                                NULL,
    rejection_reason  TEXT                                                NULL,
    requested_at      TIMESTAMP                                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at       TIMESTAMP                                           NULL,
    reviewed_by       VARCHAR(255)                                        NULL,
    created_at        TIMESTAMP                                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP                                           NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                         ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_onboarding_email (email)
);

-- 2.1b app_settings
-- Global (system-wide) application configuration as key/value pairs. Owned by
-- the super-admin. Currently holds the onboarding auto-approval flag; extend
-- with new keys as needed without schema changes.
CREATE TABLE app_settings (
    setting_key    VARCHAR(100)  NOT NULL,
    setting_value  TEXT          NULL,
    updated_by     VARCHAR(255)  NULL,
    updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
);

-- 2.2 roles
-- Named permission groups per tenant. is_system_role=1 makes a role non-editable.
-- NOTE: tenant_id is NOT NULL — roles are scoped per tenant, not global.
--       The seed data associates all standard roles with the default tenant.
--       If you need cross-tenant roles, consider a NULL tenant_id approach.
CREATE TABLE roles (
    id              VARCHAR(50)   NOT NULL,
    tenant_id       VARCHAR(50)   NOT NULL,
    name            VARCHAR(100)  NOT NULL,
    description     TEXT          NULL,
    is_system_role  TINYINT(1)    NOT NULL DEFAULT 0,
    is_active       TINYINT(1)    NOT NULL DEFAULT 1,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_role_name_tenant (tenant_id, name)
);

-- 2.3 role_permissions
-- Features (scopes) assigned to a role.
CREATE TABLE role_permissions (
    id          VARCHAR(50)  NOT NULL,
    role_id     VARCHAR(50)  NOT NULL,
    feature_id  VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_role_feature (role_id, feature_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- 2.4 user_roles
-- Roles assigned to a user within a specific tenant.
CREATE TABLE user_roles (
    id           VARCHAR(50)   NOT NULL,
    user_email   VARCHAR(255)  NOT NULL,
    tenant_id    VARCHAR(50)   NOT NULL,
    role_id      VARCHAR(50)   NOT NULL,
    assigned_by  VARCHAR(255)  NULL,
    assigned_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_role_tenant (user_email, tenant_id, role_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- =============================================================================
-- SECTION 3: Business Domain Tables
-- Source: src/config/db-queries-accountstable.sql (all migrations collapsed)
-- Tables are ordered to satisfy foreign key dependencies.
-- =============================================================================

-- Drop in reverse dependency order before recreating
DROP TABLE IF EXISTS paymentbreakup;
DROP TABLE IF EXISTS paymentdetail;
DROP TABLE IF EXISTS paymentmodetransactiondetail;
DROP TABLE IF EXISTS paymentmode;
DROP TABLE IF EXISTS paymentreceivedtype;
DROP TABLE IF EXISTS transactiontypeconversionmapper;
DROP TABLE IF EXISTS transactionitemdetail;
DROP TABLE IF EXISTS transactiondetaillog;
DROP TABLE IF EXISTS transactiontypebaseconversion;
DROP TABLE IF EXISTS itemdetail;
DROP TABLE IF EXISTS batchdetail;
DROP TABLE IF EXISTS branchusergroupmapper;
DROP TABLE IF EXISTS branchdetail;
DROP TABLE IF EXISTS costinfo;
DROP TABLE IF EXISTS addressdetail;
DROP TABLE IF EXISTS contactdetail;
DROP TABLE IF EXISTS mapproviderlocationmapper;
DROP TABLE IF EXISTS locationdetail;
DROP TABLE IF EXISTS mapprovider;
DROP TABLE IF EXISTS taxgrouptaxtypemapper;
DROP TABLE IF EXISTS taxgroup;
DROP TABLE IF EXISTS contactaddresstype;
DROP TABLE IF EXISTS transactiontype;
DROP TABLE IF EXISTS accounttypebase;
DROP TABLE IF EXISTS transactiontypestatus;
DROP TABLE IF EXISTS uomfactor;
DROP TABLE IF EXISTS organizationdetail;
DROP TABLE IF EXISTS transactiontypeconfig;
DROP TABLE IF EXISTS categorydetail;
DROP TABLE IF EXISTS UOM;
DROP TABLE IF EXISTS TaxTypes;

-- 3.1 TaxTypes
CREATE TABLE TaxTypes (
    Id         VARCHAR(50)  NOT NULL,
    Name       VARCHAR(50)  NOT NULL,
    Value      VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.2 UOM (Unit of Measure)
CREATE TABLE UOM (
    Id         VARCHAR(50)  NOT NULL,
    UnitName   VARCHAR(50)  NOT NULL,
    IsPrimary  TINYINT(1),
    Active     TINYINT(1),
    TenantId   VARCHAR(50)  NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (UnitName, TenantId)
);

-- 3.3 categorydetail
CREATE TABLE categorydetail (
    Id         VARCHAR(50)  NOT NULL,
    Name       VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.4 transactiontypeconfig
-- TagName column included (was added via migration on existing DBs).
CREATE TABLE transactiontypeconfig (
    Id              VARCHAR(50)   NOT NULL,
    StartCounterNo  VARCHAR(50)   NOT NULL,
    -- Last number ISSUED for this config. StartCounterNo is where the sequence
    -- begins; this is where it has got to. Incremented under SELECT ... FOR
    -- UPDATE inside the issuing transaction so two tills cannot take the same
    -- number, with UNIQUE(TransactionNo, TenantId) on the log as the backstop.
    CurrentCounterNo BIGINT       NOT NULL DEFAULT 0,
    Prefix          VARCHAR(50)   NOT NULL,
    Format          VARCHAR(100)  NOT NULL,
    TagName         VARCHAR(100)  NULL,
    Active          TINYINT(1)    NOT NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (StartCounterNo, Prefix, Format, TenantId),
    -- Scoped by TenantId, like every other UNIQUE in this file. Without the
    -- TenantId column this is a GLOBAL namespace: once any tenant owns the tag
    -- 'Onboarding' or 'Invoice', no other tenant can ever create it, and the
    -- first-time setup wizard fails for every tenant after the first.
    UNIQUE KEY uk_ttc_tagname (TagName, TenantId)
);

-- 3.5 organizationdetail
CREATE TABLE organizationdetail (
    Id         VARCHAR(50)   NOT NULL,
    Name       VARCHAR(100)  NOT NULL,
    Active     TINYINT(1)    NOT NULL,
    TenantId   VARCHAR(50)   NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.6 uomfactor
CREATE TABLE uomfactor (
    Id              VARCHAR(50)  NOT NULL,
    PrimaryUOMId    VARCHAR(50)  NOT NULL,
    SecondaryUOMId  VARCHAR(50)  NOT NULL,
    Factor          VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL,
    TenantId        VARCHAR(50)  NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (PrimaryUOMId)   REFERENCES UOM(Id),
    FOREIGN KEY (SecondaryUOMId) REFERENCES UOM(Id),
    UNIQUE (PrimaryUOMId, SecondaryUOMId, Factor, TenantId)
);

-- 3.7 accounttypebase
-- NOTE: Both the /api/account-types and /api/account-type-bases API routes
-- query this same table. There is no separate 'accounttype' table.
-- See GAP #1 in the analysis section at the bottom of this file.
CREATE TABLE accounttypebase (
    Id         VARCHAR(50)  NOT NULL,
    Name       VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.8 transactiontypestatus
CREATE TABLE transactiontypestatus (
    Id         VARCHAR(50)  NOT NULL,
    Name       VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.9 transactiontype
CREATE TABLE transactiontype (
    Id                       VARCHAR(50)  NOT NULL,
    Name                     VARCHAR(50)  NOT NULL,
    TransactionTypeConfigId  VARCHAR(50)  NOT NULL,
    Active                   TINYINT(1)   NOT NULL,
    TenantId                 VARCHAR(50)  NOT NULL,
    CreatedOn                DATETIME,
    CreatedBy                VARCHAR(50),
    UpdatedOn                DATETIME,
    UpdatedBy                VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
);

-- 3.10 contactaddresstype
CREATE TABLE contactaddresstype (
    Id         VARCHAR(50)  NOT NULL,
    Name       VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.11 taxgroup
CREATE TABLE taxgroup (
    Id         VARCHAR(50)  NOT NULL,
    Name       VARCHAR(50)  NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- 3.12 taxgrouptaxtypemapper
CREATE TABLE taxgrouptaxtypemapper (
    Id          VARCHAR(50)  NOT NULL,
    TaxGroupId  VARCHAR(50)  NOT NULL,
    TaxTypeId   VARCHAR(50)  NOT NULL,
    TenantId    VARCHAR(50)  NOT NULL,
    Active      TINYINT(1)   NOT NULL,
    CreatedOn   DATETIME,
    CreatedBy   VARCHAR(50),
    UpdatedOn   DATETIME,
    UpdatedBy   VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (TaxGroupId, TaxTypeId, TenantId),
    FOREIGN KEY (TaxGroupId) REFERENCES taxgroup(Id),
    FOREIGN KEY (TaxTypeId)  REFERENCES TaxTypes(Id)
);

-- 3.13 mapprovider
CREATE TABLE mapprovider (
    Id            VARCHAR(50)  NOT NULL,
    ProviderName  VARCHAR(50)  NOT NULL,
    TenantId      VARCHAR(50)  NOT NULL,
    Active        TINYINT(1)   NOT NULL,
    CreatedOn     DATETIME,
    CreatedBy     VARCHAR(50),
    UpdatedOn     DATETIME,
    UpdatedBy     VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ProviderName, TenantId)
);

-- 3.14 locationdetail
CREATE TABLE locationdetail (
    Id         VARCHAR(50)  NOT NULL,
    Lat        VARCHAR(50)  NOT NULL,
    Lng        VARCHAR(50)  NOT NULL,
    CF1        VARCHAR(50),
    CF2        VARCHAR(50),
    CF3        VARCHAR(50),
    CF4        VARCHAR(50),
    TenantId   VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Lat, Lng, TenantId)
);

-- 3.15 mapproviderlocationmapper
-- TagName column included (was added via migration on existing DBs).
CREATE TABLE mapproviderlocationmapper (
    Id                VARCHAR(50)   NOT NULL,
    MapProviderId     VARCHAR(50)   NOT NULL,
    LocationDetailId  VARCHAR(50)   NOT NULL,
    TagName           VARCHAR(100)  NULL,
    TenantId          VARCHAR(50)   NOT NULL,
    Active            TINYINT(1)    NOT NULL,
    CreatedOn         DATETIME,
    CreatedBy         VARCHAR(50),
    UpdatedOn         DATETIME,
    UpdatedBy         VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (MapProviderId, LocationDetailId, TenantId),
    -- Tenant-scoped — see the note on transactiontypeconfig.uk_ttc_tagname.
    UNIQUE KEY uk_mplm_tagname (TagName, TenantId),
    FOREIGN KEY (MapProviderId)    REFERENCES mapprovider(Id),
    FOREIGN KEY (LocationDetailId) REFERENCES locationdetail(Id)
);

-- 3.16 contactdetail
-- Migrations collapsed: LandLine2 spelling corrected; composite unique on
-- (FirstName, LastName, MobileNo, TenantId); ContactAddressTypeId nullable.
CREATE TABLE contactdetail (
    Id                    VARCHAR(50)  NOT NULL,
    FirstName             VARCHAR(50)  NOT NULL,
    LastName              VARCHAR(50)  NOT NULL,
    MobileNo              VARCHAR(50),
    AltMobileNo           VARCHAR(50),
    Landline1             VARCHAR(50),
    LandLine2             VARCHAR(50),
    Ext1                  VARCHAR(50),
    Ext2                  VARCHAR(50),
    ContactAddressTypeId  VARCHAR(50)  NULL,
    TenantId              VARCHAR(50)  NOT NULL,
    Active                TINYINT(1)   NOT NULL,
    CreatedOn             DATETIME,
    CreatedBy             VARCHAR(50),
    UpdatedOn             DATETIME,
    UpdatedBy             VARCHAR(50),
    PRIMARY KEY (Id),
    CONSTRAINT uk_contact_name_mobile UNIQUE (FirstName, LastName, MobileNo, TenantId),
    FOREIGN KEY (ContactAddressTypeId) REFERENCES contactaddresstype(Id)
);

-- 3.17 addressdetail
-- TagName column included (was added via migration on existing DBs).
CREATE TABLE addressdetail (
    Id                           VARCHAR(50)   NOT NULL,
    AddressLine1                 VARCHAR(50),
    AddressLine2                 VARCHAR(50),
    City                         VARCHAR(50),
    State                        VARCHAR(50),
    Pincode                      VARCHAR(50),
    MapProviderLocationMapperId  VARCHAR(50)   NULL,
    Landmark                     VARCHAR(50),
    ContactAddressTypeId         VARCHAR(50)   NOT NULL,
    TagName                      VARCHAR(100)  NULL,
    TenantId                     VARCHAR(50)   NOT NULL,
    Active                       TINYINT(1)    NOT NULL,
    CreatedOn                    DATETIME,
    CreatedBy                    VARCHAR(50),
    UpdatedOn                    DATETIME,
    UpdatedBy                    VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (AddressLine1, City, ContactAddressTypeId, TenantId),
    -- Tenant-scoped — see the note on transactiontypeconfig.uk_ttc_tagname.
    UNIQUE KEY uk_ad_tagname (TagName, TenantId),
    FOREIGN KEY (ContactAddressTypeId)        REFERENCES contactaddresstype(Id),
    FOREIGN KEY (MapProviderLocationMapperId) REFERENCES mapproviderlocationmapper(Id)
);

-- 3.18 costinfo
CREATE TABLE costinfo (
    Id             VARCHAR(50)  NOT NULL,
    Amount         VARCHAR(50)  NOT NULL,
    TaxGroupId     VARCHAR(50)  NOT NULL,
    IsTaxIncluded  TINYINT(1)   NOT NULL,
    TenantId       VARCHAR(50)  NOT NULL,
    Active         TINYINT(1)   NOT NULL,
    CreatedOn      DATETIME,
    CreatedBy      VARCHAR(50),
    UpdatedOn      DATETIME,
    UpdatedBy      VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Id, TenantId),
    FOREIGN KEY (TaxGroupId) REFERENCES taxgroup(Id)
);

-- 3.19 branchdetail
CREATE TABLE branchdetail (
    Id                       VARCHAR(50)  NOT NULL,
    OrganizationDetailId     VARCHAR(50)  NOT NULL,
    ContactDetailId          VARCHAR(50)  NOT NULL,
    AddressDetailId          VARCHAR(50)  NOT NULL,
    TransactionTypeConfigId  VARCHAR(50)  NOT NULL,
    BranchName               VARCHAR(50)  NOT NULL,
    TINNo                    VARCHAR(50),
    GSTIN                    VARCHAR(50),
    PAN                      VARCHAR(50),
    CF1                      VARCHAR(50),
    CF2                      VARCHAR(50),
    CF3                      VARCHAR(50),
    CF4                      VARCHAR(50),
    TenantId                 VARCHAR(50)  NOT NULL,
    Active                   TINYINT(1)   NOT NULL,
    CreatedOn                DATETIME,
    CreatedBy                VARCHAR(50),
    UpdatedOn                DATETIME,
    UpdatedBy                VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (OrganizationDetailId, BranchName, TenantId),
    FOREIGN KEY (OrganizationDetailId)   REFERENCES organizationdetail(Id),
    FOREIGN KEY (ContactDetailId)        REFERENCES contactdetail(Id),
    FOREIGN KEY (AddressDetailId)        REFERENCES addressdetail(Id),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
);

-- 3.20 branchusergroupmapper
CREATE TABLE branchusergroupmapper (
    Id              VARCHAR(50)  NOT NULL,
    BranchDetailId  VARCHAR(50)  NOT NULL,
    UserGroupId     VARCHAR(50)  NOT NULL,
    TenantId        VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (BranchDetailId, UserGroupId, TenantId),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- 3.21 batchdetail
-- All optional columns are nullable (migration collapsed).
CREATE TABLE batchdetail (
    Id                           VARCHAR(50)  NOT NULL,
    BatchNo                      VARCHAR(50)  NOT NULL,
    Barcode                      VARCHAR(50)  NULL,
    MfgDate                      DATETIME     NULL,
    Expdate                      DATETIME     NULL,
    PurchaseDate                 DATETIME     NULL,
    IsNonReturnable              TINYINT(1)   NOT NULL,
    CostInfoId                   VARCHAR(50)  NULL,
    UOMId                        VARCHAR(50)  NULL,
    Quantity                     VARCHAR(50)  NULL,
    MapProviderLocationMapperId  VARCHAR(50)  NULL,
    BranchDetailId               VARCHAR(50)  NULL,
    TenantId                     VARCHAR(50)  NOT NULL,
    Active                       TINYINT(1)   NOT NULL,
    CreatedOn                    DATETIME,
    CreatedBy                    VARCHAR(50),
    UpdatedOn                    DATETIME,
    UpdatedBy                    VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (BatchNo, BranchDetailId, TenantId),
    FOREIGN KEY (CostInfoId)                  REFERENCES costinfo(Id),
    FOREIGN KEY (UOMId)                       REFERENCES UOM(Id),
    FOREIGN KEY (MapProviderLocationMapperId) REFERENCES mapproviderlocationmapper(Id),
    FOREIGN KEY (BranchDetailId)              REFERENCES branchdetail(Id)
);

-- 3.22 itemdetail
-- Migrations collapsed: Type column renamed to Name; Code, UOMId, CostInfoId,
-- Barcode added; BatchDetailId removed; Description widened to VARCHAR(1000).
CREATE TABLE itemdetail (
    Id           VARCHAR(50)    NOT NULL,
    Name         VARCHAR(255)   NOT NULL,
    Code         VARCHAR(50)    NULL,
    Description  VARCHAR(1000)  NULL,
    CategoryId   VARCHAR(50)    NULL,
    UOMId        VARCHAR(50)    NULL,
    CostInfoId   VARCHAR(50)    NULL,
    SKU          VARCHAR(50)    NULL,
    Barcode      VARCHAR(50)    NULL,
    HSNCode      VARCHAR(50)    NULL,
    TenantId     VARCHAR(50)    NOT NULL,
    Active       TINYINT(1)     NOT NULL,
    CreatedOn    DATETIME,
    CreatedBy    VARCHAR(50),
    UpdatedOn    DATETIME,
    UpdatedBy    VARCHAR(50),
    PRIMARY KEY (Id),
    CONSTRAINT uk_itemdetail_name_tenant UNIQUE (Name, TenantId),
    FOREIGN KEY (CategoryId) REFERENCES categorydetail(Id),
    FOREIGN KEY (UOMId)      REFERENCES UOM(Id),
    FOREIGN KEY (CostInfoId) REFERENCES costinfo(Id)
);

-- 3.23 transactiontypebaseconversion
-- Fully redesigned: original FromTransactionTypeId/ToTransactionTypeId FK
-- columns replaced with TransactionTypeConfigId + status-based FKs. Tag added.
CREATE TABLE transactiontypebaseconversion (
    Id                           VARCHAR(50)   NOT NULL,
    TenantId                     VARCHAR(50)   NOT NULL,
    TransactionTypeConfigId      VARCHAR(50)   NOT NULL,
    FromTransactionTypeStatusId  VARCHAR(50)   NOT NULL,
    ToTransactionTypeStatusId    VARCHAR(50)   NOT NULL,
    Tag                          VARCHAR(100)  NULL,
    Active                       TINYINT(1)    NOT NULL,
    CreatedOn                    DATETIME,
    CreatedBy                    VARCHAR(50),
    UpdatedOn                    DATETIME,
    UpdatedBy                    VARCHAR(50),
    PRIMARY KEY (Id),
    CONSTRAINT uk_ttbc_config_from_to_tenant
        UNIQUE (TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, TenantId),
    UNIQUE KEY uk_ttbc_tag_tenant (Tag, TenantId),
    FOREIGN KEY (TransactionTypeConfigId)     REFERENCES transactiontypeconfig(Id),
    FOREIGN KEY (FromTransactionTypeStatusId) REFERENCES transactiontypestatus(Id),
    FOREIGN KEY (ToTransactionTypeStatusId)   REFERENCES transactiontypestatus(Id)
);

-- 3.24 transactiondetaillog
-- Fully redesigned: AccountTypeBaseId, BranchDetailId, UserId,
-- TransactionDateTime, Description, CF1-CF4 removed; TransactionNo,
-- TransactionTypeConfigId, TransactionTypeStatusId, BranchId,
-- TransactionDate, Remarks added.
CREATE TABLE transactiondetaillog (
    Id                       VARCHAR(50)   NOT NULL,
    TenantId                 VARCHAR(50)   NOT NULL,
    TransactionNo            VARCHAR(50)   NOT NULL,
    TransactionTypeConfigId  VARCHAR(50)   NOT NULL,
    -- Which KIND of document this is (Sale / Purchase / Return). Previously only
    -- the numbering config was linked, so the header could not say what it was.
    TransactionTypeId        VARCHAR(50)   NULL,
    TransactionTypeStatusId  VARCHAR(50)   NULL,
    BranchId                 VARCHAR(50)   NULL,
    TransactionDate          DATE          NOT NULL,
    -- Document totals: what was INVOICED. Deliberately separate from what was
    -- collected (paymentdetail), which is what makes partial payment
    -- expressible — an unpaid invoice still has a value.
    NetAmount                DECIMAL(18,4) NOT NULL DEFAULT 0,
    TaxAmount                DECIMAL(18,4) NOT NULL DEFAULT 0,
    DiscountAmount           DECIMAL(18,4) NOT NULL DEFAULT 0,
    RoundOff                 DECIMAL(18,4) NOT NULL DEFAULT 0,
    GrossAmount              DECIMAL(18,4) NOT NULL DEFAULT 0,
    TaxByComponent           JSON          NULL COMMENT 'Invoice footer, e.g. [{name:CGST,amount:75.00}]',
    -- Customer: FK for analytics ("everything this person bought"), snapshot for
    -- faithful reprints ("what this invoice said when issued").
    ContactDetailId          VARCHAR(50)   NULL,
    CustomerName             VARCHAR(150)  NULL,
    CustomerMobile           VARCHAR(50)   NULL,
    SettledAt                DATETIME      NULL,
    Remarks                  VARCHAR(500)  NULL,
    Active                   TINYINT(1)    NOT NULL,
    CreatedOn                DATETIME,
    CreatedBy                VARCHAR(50),
    UpdatedOn                DATETIME,
    UpdatedBy                VARCHAR(50),
    PRIMARY KEY (Id),
    -- A ledger must not be able to issue the same document number twice.
    UNIQUE KEY uk_tdl_txnno_tenant (TransactionNo, TenantId),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id),
    FOREIGN KEY (TransactionTypeId)       REFERENCES transactiontype(Id),
    FOREIGN KEY (TransactionTypeStatusId) REFERENCES transactiontypestatus(Id),
    FOREIGN KEY (ContactDetailId)         REFERENCES contactdetail(Id),
    FOREIGN KEY (BranchId)                REFERENCES branchdetail(Id)
);

-- 3.25 transactionitemdetail
-- Quantity + priced snapshot columns make the transaction ledger priceable.
-- Before these, the table was only a link (log ↔ item) with no way to express
-- "2 × item at price X", so tax could not be computed for it at all.
--
-- UnitPrice and the three amount columns are a SNAPSHOT taken when the line is
-- written. They are never recomputed on read: an invoice raised at 12% GST must
-- still read 12% after the rate changes.
CREATE TABLE transactionitemdetail (
    Id                     VARCHAR(50)    NOT NULL,
    TransactionDetailLogId VARCHAR(50)    NOT NULL,
    -- A document is an ORDERED LIST OF LINES, not a set of items: the same item
    -- may legitimately appear twice with different variants (Dosa Large, Dosa
    -- plain). LineNo is what makes those distinct, and gives print order.
    LineNo                 INT            NOT NULL DEFAULT 1,
    ItemId                 VARCHAR(50)    NOT NULL,
    Quantity               DECIMAL(18,4)  NOT NULL DEFAULT 1,
    CostInfoId             VARCHAR(50)    NULL COMMENT 'Cost record this line was priced from',
    UnitPrice              DECIMAL(18,4)  NULL COMMENT 'Effective unit price charged (BasePrice + VariantAmount)',
    BasePrice              DECIMAL(18,4)  NULL COMMENT 'Item price before variant surcharge',
    VariantAmount          DECIMAL(18,4)  NOT NULL DEFAULT 0 COMMENT 'Per-unit variant surcharge',
    NetAmount              DECIMAL(18,4)  NULL COMMENT 'Taxable base after discount',
    TaxAmount              DECIMAL(18,4)  NULL,
    GrossAmount            DECIMAL(18,4)  NULL COMMENT 'NetAmount + TaxAmount',
    TaxComponents          JSON           NULL COMMENT 'Per-component split, e.g. [{name:CGST,rate:9,amount:...}]',
    -- Options as sold: [{id,name,price}]. Names are snapshotted, so renaming a
    -- variant later cannot rewrite an invoice already issued.
    Variants               JSON           NULL,
    Comment                VARCHAR(100),
    TenantId               VARCHAR(50)    NOT NULL,
    Active                 TINYINT(1)     NOT NULL,
    CreatedOn              DATETIME,
    CreatedBy              VARCHAR(50),
    UpdatedOn              DATETIME,
    UpdatedBy              VARCHAR(50),
    PRIMARY KEY (Id),
    -- Line numbers are unique within a document. This REPLACES a former
    -- UNIQUE(LogId, ItemId, TenantId), which allowed an item only once per
    -- document and so could not represent the same dish with different options.
    UNIQUE KEY uk_tid_log_line (TransactionDetailLogId, LineNo, TenantId),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id),
    FOREIGN KEY (ItemId)                 REFERENCES itemdetail(Id),
    FOREIGN KEY (CostInfoId)             REFERENCES costinfo(Id)
);

-- 3.26 transactiontypeconversionmapper
-- NOTE: Column name has a typo inherited from original schema: 'BaseCoversionId'
-- (missing 'n'). Preserved as-is to match existing application queries.
CREATE TABLE transactiontypeconversionmapper (
    Id                              VARCHAR(50)  NOT NULL,
    TransactionTypeBaseCoversionId  VARCHAR(50)  NOT NULL,
    TransactionDetailLogId          VARCHAR(50)  NOT NULL,
    TransactionTypeStatusId         VARCHAR(50)  NOT NULL,
    TenantId                        VARCHAR(50)  NOT NULL,
    Active                          TINYINT(1)   NOT NULL,
    CreatedOn                       DATETIME,
    CreatedBy                       VARCHAR(50),
    UpdatedOn                       DATETIME,
    UpdatedBy                       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (TransactionTypeBaseCoversionId, TransactionDetailLogId, TransactionTypeStatusId, TenantId),
    FOREIGN KEY (TransactionTypeBaseCoversionId) REFERENCES transactiontypebaseconversion(Id),
    FOREIGN KEY (TransactionDetailLogId)         REFERENCES transactiondetaillog(Id),
    FOREIGN KEY (TransactionTypeStatusId)        REFERENCES transactiontypestatus(Id)
);

-- 3.27 paymentreceivedtype
CREATE TABLE paymentreceivedtype (
    Id         VARCHAR(50)  NOT NULL,
    Type       VARCHAR(50)  NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Type, TenantId)
);

-- 3.28 paymentmode
CREATE TABLE paymentmode (
    Id         VARCHAR(50)  NOT NULL,
    Type       VARCHAR(50)  NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    UpdatedOn  DATETIME,
    UpdatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Type, TenantId)
);

-- 3.29 paymentmodetransactiondetail
CREATE TABLE paymentmodetransactiondetail (
    Id             VARCHAR(50)   NOT NULL,
    PaymentModeId  VARCHAR(50)   NOT NULL,
    RefNo          VARCHAR(50),
    Comment        VARCHAR(100),
    CF1            VARCHAR(50),
    CF2            VARCHAR(50),
    CF3            VARCHAR(50),
    CF4            VARCHAR(50),
    TenantId       VARCHAR(50)   NOT NULL,
    Active         TINYINT(1)    NOT NULL,
    CreatedOn      DATETIME,
    CreatedBy      VARCHAR(50),
    UpdatedOn      DATETIME,
    UpdatedBy      VARCHAR(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (PaymentModeId) REFERENCES paymentmode(Id)
);

-- 3.30 paymentdetail
-- UserId nullable (migration collapsed).
CREATE TABLE paymentdetail (
    Id                      VARCHAR(50)   NOT NULL,
    AccountTypeBaseId       VARCHAR(50)   NOT NULL,
    TransactionDetailLogId  VARCHAR(50)   NOT NULL,
    -- Money as money. These were VARCHAR, which is indefensible in a ledger.
    DiscountAmount          DECIMAL(18,4) NULL,
    RoundOff                DECIMAL(18,4) NULL,
    TotalAmount             DECIMAL(18,4) NOT NULL COMMENT 'Payable settled by this payment',
    TaxesAmount             DECIMAL(18,4) NULL,
    GrossAmount             DECIMAL(18,4) NOT NULL COMMENT 'Taxable base after discount',
    UserId                  VARCHAR(50)   NULL,
    TenantId                VARCHAR(50)   NOT NULL,
    Active                  TINYINT(1)    NOT NULL,
    CreatedOn               DATETIME,
    CreatedBy               VARCHAR(50),
    UpdatedOn               DATETIME,
    UpdatedBy               VARCHAR(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (AccountTypeBaseId)      REFERENCES accounttypebase(Id),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id)
);

-- 3.31 paymentbreakup
-- UserId nullable (migration collapsed).
CREATE TABLE paymentbreakup (
    Id                             VARCHAR(50)   NOT NULL,
    AccountTypeBaseId              VARCHAR(50)   NOT NULL,
    PaymentDetailId                VARCHAR(50)   NOT NULL,
    PaymentModeTransactionDetailId VARCHAR(100)  NOT NULL,
    PaymentReceivedTypeId          VARCHAR(50)   NOT NULL,
    -- Without this a split settlement could not be recorded at all: the table
    -- linked payment modes but had nowhere to store how much went to each, so
    -- "₹500 cash + ₹300 card" was inexpressible.
    Amount                         DECIMAL(18,4) NOT NULL DEFAULT 0,
    UserId                         VARCHAR(50)   NULL,
    Timestamp                      DATETIME      NOT NULL,
    TenantId                       VARCHAR(50)   NOT NULL,
    Active                         TINYINT(1)    NOT NULL,
    CreatedOn                      DATETIME,
    CreatedBy                      VARCHAR(50),
    UpdatedOn                      DATETIME,
    UpdatedBy                      VARCHAR(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (AccountTypeBaseId)              REFERENCES accounttypebase(Id),
    FOREIGN KEY (PaymentDetailId)                REFERENCES paymentdetail(Id),
    FOREIGN KEY (PaymentModeTransactionDetailId) REFERENCES paymentmodetransactiondetail(Id),
    FOREIGN KEY (PaymentReceivedTypeId)          REFERENCES paymentreceivedtype(Id)
);

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- SECTION 4: POS ("Front Desk" / RestroOS) Tables
-- Source: 03-pos-schema.sql (collapsed; migration 002 baked in).
-- Conventions match Section 3: Id VARCHAR(50) PK, TenantId NOT NULL,
-- BranchDetailId FK to branchdetail, standard audit columns.
-- Depends on Section 3 tables: branchdetail, itemdetail, costinfo.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS pos_bill_order;
DROP TABLE IF EXISTS pos_bill;
DROP TABLE IF EXISTS pos_kot;
DROP TABLE IF EXISTS pos_order;
DROP TABLE IF EXISTS pos_item_meta_channel;
DROP TABLE IF EXISTS pos_item_meta_variant;
DROP TABLE IF EXISTS pos_item_meta;
DROP TABLE IF EXISTS pos_channel;
DROP TABLE IF EXISTS pos_variant;
DROP TABLE IF EXISTS pos_food_type;
DROP TABLE IF EXISTS pos_table;
DROP TABLE IF EXISTS pos_floor;
DROP TABLE IF EXISTS pos_customer;
DROP TABLE IF EXISTS pos_online_order;
DROP TABLE IF EXISTS pos_feedback;
DROP TABLE IF EXISTS pos_token;
DROP TABLE IF EXISTS pos_expense;
DROP TABLE IF EXISTS pos_staff;

-- 4.1 pos_floor — dining floors/sections within a branch
CREATE TABLE pos_floor (
    Id              VARCHAR(50)  NOT NULL,
    Name            VARCHAR(100) NOT NULL,
    BranchDetailId  VARCHAR(50)  NULL,
    TenantId        VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, BranchDetailId, TenantId),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- 4.2 pos_table — physical tables belonging to a floor
CREATE TABLE pos_table (
    Id              VARCHAR(50)  NOT NULL,
    Name            VARCHAR(50)  NOT NULL,
    FloorId         VARCHAR(50)  NULL,
    Capacity        INT          NULL,
    Status          VARCHAR(20)  NOT NULL DEFAULT 'free',
    CurrentOrderId  VARCHAR(50)  NULL,
    BranchDetailId  VARCHAR(50)  NULL,
    TenantId        VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, FloorId, TenantId),
    FOREIGN KEY (FloorId)        REFERENCES pos_floor(Id),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- 4.3 pos_channel — sales channels (dinein / online / takeaway) master
CREATE TABLE pos_channel (
    Id              VARCHAR(50)   NOT NULL,
    Name            VARCHAR(100)  NOT NULL,
    Code            VARCHAR(50)   NOT NULL,
    Description     VARCHAR(255)  NULL,
    SortOrder       INT           NOT NULL DEFAULT 0,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId)
);

-- 4.4 pos_variant — item variants (Small/Medium/Large, Half/Full, …) master
CREATE TABLE pos_variant (
    Id              VARCHAR(50)   NOT NULL,
    Name            VARCHAR(100)  NOT NULL,
    Code            VARCHAR(50)   NOT NULL,
    Description     VARCHAR(255)  NULL,
    SortOrder       INT           NOT NULL DEFAULT 0,
    Price           DECIMAL(18,4) NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId)
);

-- 4.4b pos_food_type — CRUD-managed food type master (Veg / Non-Veg / Vegan / …).
-- Replaces the previously hardcoded veg/nonveg/vegan enum. IsVeg drives the
-- veg/non-veg badge rendered on the Billing menu grid.
CREATE TABLE pos_food_type (
    Id              VARCHAR(50)   NOT NULL,
    Name            VARCHAR(100)  NOT NULL,
    Code            VARCHAR(50)   NOT NULL,
    Description     VARCHAR(255)  NULL,
    SortOrder       INT           NOT NULL DEFAULT 0,
    IsVeg           TINYINT(1)    NOT NULL DEFAULT 0,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId)
);

-- 4.5 pos_item_meta — POS-only extensions for a master itemdetail record.
-- Channels/Variants live in normalized join tables; price references a costinfo
-- master row via CostInfoId; FoodType references the pos_food_type master.
-- Legacy JSON columns kept (NULLable) for backward compat with Billing's price fallback.
CREATE TABLE pos_item_meta (
    Id              VARCHAR(50)   NOT NULL,
    ItemDetailId    VARCHAR(50)   NOT NULL,
    FoodTypeId      VARCHAR(50)   NOT NULL,
    CostInfoId      VARCHAR(50)   NULL,
    Channels        JSON          NULL,
    Prices          JSON          NULL,
    Variants        JSON          NULL,
    BranchDetailId  VARCHAR(50)   NOT NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ItemDetailId, BranchDetailId, TenantId),
    FOREIGN KEY (ItemDetailId)   REFERENCES itemdetail(Id),
    FOREIGN KEY (FoodTypeId)     REFERENCES pos_food_type(Id),
    FOREIGN KEY (CostInfoId)     REFERENCES costinfo(Id)
);

-- 4.6 pos_item_meta_channel — join: which channels a menu item is available on
CREATE TABLE pos_item_meta_channel (
    Id              VARCHAR(50)   NOT NULL,
    ItemMetaId      VARCHAR(50)   NOT NULL,
    ChannelId       VARCHAR(50)   NOT NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ItemMetaId, ChannelId, TenantId),
    FOREIGN KEY (ItemMetaId) REFERENCES pos_item_meta(Id) ON DELETE CASCADE,
    FOREIGN KEY (ChannelId)  REFERENCES pos_channel(Id)
);

-- 4.7 pos_item_meta_variant — join: which variants a menu item offers
CREATE TABLE pos_item_meta_variant (
    Id              VARCHAR(50)   NOT NULL,
    ItemMetaId      VARCHAR(50)   NOT NULL,
    VariantId       VARCHAR(50)   NOT NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ItemMetaId, VariantId, TenantId),
    FOREIGN KEY (ItemMetaId) REFERENCES pos_item_meta(Id) ON DELETE CASCADE,
    FOREIGN KEY (VariantId)  REFERENCES pos_variant(Id)
);

-- 4.8 pos_customer — walk-in / loyalty customers
CREATE TABLE pos_customer (
    Id              VARCHAR(50)     NOT NULL,
    Name            VARCHAR(100)    NOT NULL,
    Phone           VARCHAR(20)     NULL,
    Email           VARCHAR(100)    NULL,
    Visits          INT             NOT NULL DEFAULT 0,
    TotalSpent      DECIMAL(12,2)   NOT NULL DEFAULT 0,
    LoyaltyPoints   INT             NOT NULL DEFAULT 0,
    -- The same human as a master contactdetail. pos_customer is the POS-facing
    -- CRM projection (visits, loyalty, spend); contactdetail is the identity the
    -- ledger records. NULL for walk-ins, and only ever set when a phone number
    -- exists — see contactResolver.
    ContactDetailId VARCHAR(50)     NULL,
    BranchDetailId  VARCHAR(50)     NULL,
    TenantId        VARCHAR(50)     NOT NULL,
    Active          TINYINT(1)      NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Phone, TenantId),
    FOREIGN KEY (ContactDetailId) REFERENCES contactdetail(Id)
);

-- 4.9 pos_feedback — customer feedback / ratings
CREATE TABLE pos_feedback (
    Id              VARCHAR(50)    NOT NULL,
    CustomerId      VARCHAR(50)    NULL,
    CustomerName    VARCHAR(100)   NULL,
    Rating          INT            NULL,
    Comments        VARCHAR(1000)  NULL,
    BranchDetailId  VARCHAR(50)    NULL,
    TenantId        VARCHAR(50)    NOT NULL,
    Active          TINYINT(1)     NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (CustomerId) REFERENCES pos_customer(Id)
);

-- 4.10 pos_order — a dine-in / takeaway / online order
CREATE TABLE pos_order (
    Id              VARCHAR(50)    NOT NULL,
    OrderNo         VARCHAR(50)    NOT NULL,
    TableId         VARCHAR(50)    NULL,
    CustomerId      VARCHAR(50)    NULL,
    OrderType       VARCHAR(20)    NOT NULL DEFAULT 'dinein',
    Status          VARCHAR(20)    NOT NULL DEFAULT 'open',
    Items           JSON           NULL,
    SubTotal        DECIMAL(12,2)  NOT NULL DEFAULT 0,
    TaxAmount       DECIMAL(12,2)  NOT NULL DEFAULT 0,
    Total           DECIMAL(12,2)  NOT NULL DEFAULT 0,
    BranchDetailId  VARCHAR(50)    NULL,
    TenantId        VARCHAR(50)    NOT NULL,
    Active          TINYINT(1)     NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (OrderNo, TenantId),
    FOREIGN KEY (TableId)    REFERENCES pos_table(Id),
    FOREIGN KEY (CustomerId) REFERENCES pos_customer(Id)
);

-- 4.11 pos_kot — Kitchen Order Ticket fired for an order
CREATE TABLE pos_kot (
    Id              VARCHAR(50)   NOT NULL,
    KotNo           VARCHAR(50)   NOT NULL,
    OrderId         VARCHAR(50)   NULL,
    TableId         VARCHAR(50)   NULL,
    Items           JSON          NULL,
    Status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
    FiredAt         DATETIME      NULL,
    BranchDetailId  VARCHAR(50)   NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (KotNo, TenantId),
    FOREIGN KEY (OrderId) REFERENCES pos_order(Id)
);

-- 4.12 pos_bill — settled/settling bill for an order (payments embedded as JSON)
CREATE TABLE pos_bill (
    Id              VARCHAR(50)    NOT NULL,
    BillNo          VARCHAR(50)    NOT NULL,
    OrderId         VARCHAR(50)    NULL,
    SubTotal        DECIMAL(12,2)  NOT NULL DEFAULT 0,
    TaxAmount       DECIMAL(12,2)  NOT NULL DEFAULT 0,
    Discount        DECIMAL(12,2)  NOT NULL DEFAULT 0,
    Total           DECIMAL(12,2)  NOT NULL DEFAULT 0,
    Payments        JSON           NULL,
    Status          VARCHAR(20)    NOT NULL DEFAULT 'unpaid',
    SettledAt       DATETIME       NULL,
    -- The accounting document this bill was posted as. NULL means "not yet in
    -- the ledger", which also serves as the idempotency guard: a second settle
    -- on a posted bill is rejected rather than issuing a second invoice.
    TransactionDetailLogId VARCHAR(50) NULL,
    BranchDetailId  VARCHAR(50)    NULL,
    TenantId        VARCHAR(50)    NOT NULL,
    Active          TINYINT(1)     NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (BillNo, TenantId),
    FOREIGN KEY (OrderId) REFERENCES pos_order(Id),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id)
);

-- 4.12b pos_bill_order — which orders (rounds) a bill covers
-- A dine-in session is billed as ONE bill spanning several rounds, each round
-- being its own pos_order. pos_bill.OrderId only ever held the FIRST round, so
-- a bill could not be recomputed from its own key. This join table is the truth;
-- pos_bill.OrderId is kept as the primary/first order for backward compatibility.
CREATE TABLE pos_bill_order (
    Id         VARCHAR(50)  NOT NULL,
    BillId     VARCHAR(50)  NOT NULL,
    OrderId    VARCHAR(50)  NOT NULL,
    TenantId   VARCHAR(50)  NOT NULL,
    Active     TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn  DATETIME,
    CreatedBy  VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (BillId, OrderId, TenantId),
    FOREIGN KEY (BillId)  REFERENCES pos_bill(Id) ON DELETE CASCADE,
    FOREIGN KEY (OrderId) REFERENCES pos_order(Id)
);

-- 4.13 pos_online_order — aggregator/online channel order
CREATE TABLE pos_online_order (
    Id              VARCHAR(50)   NOT NULL,
    Platform        VARCHAR(50)   NOT NULL,
    ExternalRef     VARCHAR(100)  NULL,
    Status          VARCHAR(20)   NOT NULL DEFAULT 'new',
    Payload         JSON          NULL,
    BranchDetailId  VARCHAR(50)   NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Platform, ExternalRef, TenantId)
);

-- 4.14 pos_token — token/queue number system
CREATE TABLE pos_token (
    Id              VARCHAR(50)  NOT NULL,
    TokenNumber     INT          NOT NULL,
    OrderId         VARCHAR(50)  NULL,
    Status          VARCHAR(20)  NOT NULL DEFAULT 'waiting',
    BranchDetailId  VARCHAR(50)  NULL,
    TenantId        VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (TokenNumber, BranchDetailId, TenantId),
    FOREIGN KEY (OrderId) REFERENCES pos_order(Id)
);

-- 4.15 pos_expense — petty-cash / operational expenses
CREATE TABLE pos_expense (
    Id              VARCHAR(50)    NOT NULL,
    Category        VARCHAR(100)   NOT NULL,
    Description     VARCHAR(500)   NULL,
    Amount          DECIMAL(12,2)  NOT NULL DEFAULT 0,
    ExpenseDate     DATETIME       NULL,
    BranchDetailId  VARCHAR(50)    NULL,
    TenantId        VARCHAR(50)    NOT NULL,
    Active          TINYINT(1)     NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id)
);

-- 4.16 pos_staff — front-desk / kitchen staff roster
CREATE TABLE pos_staff (
    Id              VARCHAR(50)   NOT NULL,
    Name            VARCHAR(100)  NOT NULL,
    Role            VARCHAR(50)   NULL,
    Phone           VARCHAR(20)   NULL,
    Email           VARCHAR(100)  NULL,
    BranchDetailId  VARCHAR(50)   NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    Active          TINYINT(1)    NOT NULL,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Email, TenantId)
);

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- GAP ANALYSIS — Issues found during cross-reference of SQL vs. application code
-- =============================================================================
--
-- GAP #1: Dual API modules, single table (accounttype + accounttypebase)
--   Both /api/account-types and /api/account-type-bases route to accounttypebase.
--   The QUERIES.ACCOUNT_TYPE and QUERIES.ACCOUNT_TYPE_BASE constants in
--   src/config/constants.js both run identical SQL against accounttypebase.
--   If accounttype was intended to be a distinct lookup table, it is missing.
--   ACTION: Confirm whether the two modules are intentionally identical (alias)
--           or if a separate 'accounttype' table is required.
--
-- GAP #2: features.name vs feature_name column discrepancy
--   The original dbquery.sql CREATE TABLE defined the column as 'feature_name'.
--   The application INSERT (constants.js:856) and seed file use 'name'.
--   This schema uses 'name' to match the application code.
--   ACTION: If you have an existing DB with 'feature_name', run:
--           ALTER TABLE features CHANGE feature_name name VARCHAR(100) NOT NULL;
--
-- GAP #3: roles.tenant_id is NOT NULL — roles are per-tenant
--   The schema scopes roles to a single tenant. There is no concept of
--   system-global roles that apply across all tenants.
--   The seed data assigns all standard roles to the ANM Tech tenant
--   (e3845e08-dcc2-11f0-8e78-0242ac110002).
--   ACTION: For multi-tenant deployments, roles must be seeded per tenant,
--           or the schema needs a NULL-allowed tenant_id for global roles.
--
-- GAP #4: No TenantId indexes on business domain tables
--   All 31 business tables use TenantId in WHERE clauses for every query but
--   have no index on TenantId. As data grows this will cause full-table scans.
--   ACTION: Add composite indexes e.g.:
--           CREATE INDEX idx_taxtypes_tenant ON TaxTypes (TenantId, Active);
--           (Repeat for all business tables.)
--
-- GAP #5: tenant_features table usage unclear
--   The legacy tenant_features table (per-user feature grants) coexists with
--   the new IAM model (roles → role_permissions → user_roles).
--   It is unclear if tenant_features is still actively written/read by the app.
--   ACTION: Grep src/ for tenant_features usage and remove if superseded.
-- =============================================================================
