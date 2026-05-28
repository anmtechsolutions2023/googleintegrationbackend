-- Table Creation 

-- TaxTypes table
create table if not exists TaxTypes
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Value varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- UOM table
create table if not exists UOM
(
    Id VARCHAR(50) not null,
    UnitName VARCHAR(50) not null,
    IsPrimary tinyint(1),
    Active TINYINT(1),
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (UnitName, TenantId)
);

-- CategoryDetail table

create table if not exists categorydetail
(
    Id VARCHAR(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- TransactionTypeConfig table

create table if not exists transactiontypeconfig
(
    Id VARCHAR(50) not null,
    StartCounterNo varchar(50) not null,
    Prefix varchar(50) not null,
    Format varchar(100) not null,
    TagName varchar(100) null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (StartCounterNo, Prefix, Format, TenantId),
    UNIQUE KEY uk_ttc_tagname (TagName)
);

-- Migration: add TagName to existing transactiontypeconfig tables
-- Run these statements once on existing databases:
-- ALTER TABLE transactiontypeconfig ADD COLUMN TagName varchar(100) NULL AFTER Format;
-- ALTER TABLE transactiontypeconfig ADD UNIQUE KEY uk_ttc_tagname (TagName);

-- Organization Detail table
create table if not exists organizationdetail
(
    Id varchar(50) not null,
    Name varchar(100) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- UOMFactor table

create table if not exists uomfactor
(
    Id varchar(50) not null,
    PrimaryUOMId VARCHAR(50) not null,
    SecondaryUOMId VARCHAR(50) not null,
    Factor VARCHAR(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (PrimaryUOMId) REFERENCES UOM(Id),
    FOREIGN KEY (SecondaryUOMId) REFERENCES UOM(Id),
    UNIQUE (PrimaryUOMId, SecondaryUOMId, Factor, TenantId)
);

-- TransactionType table

create table if not exists transactiontype
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    TransactionTypeConfigId varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
);


-- AccountTypeBase table

create table if not exists accounttypebase
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- TransactionTypeStatus table

create table if not exists transactiontypestatus
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- ContactAddressType table

create table if not exists contactaddresstype
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- TaxGroup table

create table if not exists taxgroup
(
	Id varchar(50) not null,
    Name varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

 -- Tax Group Tax Type Mapper table
create table if not exists taxgrouptaxtypemapper
(
	Id varchar(50) not null,
    TaxGroupId varchar(50) not null,
    TaxTypeId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (TaxGroupId, TaxTypeId, TenantId),
    FOREIGN KEY (TaxGroupId) REFERENCES taxgroup(Id),
    FOREIGN KEY (TaxTypeId) REFERENCES TaxTypes(Id)
);

-- Map Provider table

create table if not exists mapprovider
(
    Id varchar(50) not null,
    ProviderName varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (ProviderName, TenantId)
);

-- Location Detail table

create table if not exists locationdetail
(
    Id varchar(50) not null,
    Lat varchar(50) not null,
    Lng varchar(50) not null,
    CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Lat, Lng, TenantId)
);

-- Map Provider Location Mapper table
create table if not exists mapproviderlocationmapper
(
	Id varchar(50) not null,
    MapProviderId varchar(50) not null,
    LocationDetailId varchar(50) not null,
    TagName varchar(100) null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (MapProviderId, LocationDetailId, TenantId),
    UNIQUE KEY uk_mplm_tagname (TagName),
    FOREIGN KEY (MapProviderId) REFERENCES mapprovider(Id),
    FOREIGN KEY (LocationDetailId) REFERENCES locationdetail(Id)
);

-- Migration: add TagName to existing mapproviderlocationmapper tables
-- Run these statements once on existing databases:
-- ALTER TABLE mapproviderlocationmapper ADD COLUMN TagName varchar(100) NULL AFTER LocationDetailId;
-- ALTER TABLE mapproviderlocationmapper ADD UNIQUE KEY uk_mplm_tagname (TagName);

-- Contact Detail table
create table if not exists contactdetail
(
	Id varchar(50) not null,
    FirstName varchar(50) not null,
    LastName varchar(50) not null,
    MobileNo varchar(50),
    AltMobileNo varchar(50),
    Landline1 varchar(50),
    LandLine2 varchar(50),
    Ext1 varchar(50),
    Ext2 varchar(50),
    ContactAddressTypeId varchar(50),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    CONSTRAINT uk_contact_name_mobile UNIQUE (FirstName, LastName, MobileNo, TenantId),
    FOREIGN KEY (ContactAddressTypeId) REFERENCES contactaddresstype(Id)
);

-- ============================================================
-- Migration: contactdetail table — run once on existing DB
-- Safe to re-run (checks before each step)
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_contactdetail;

DELIMITER //

CREATE PROCEDURE migrate_contactdetail()
BEGIN

    -- Step 1: Rename Landline2 -> LandLine2 (only if old name still exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'contactdetail'
          AND COLUMN_NAME  = 'Landline2'
    ) THEN
        ALTER TABLE contactdetail CHANGE Landline2 LandLine2 VARCHAR(50);
    END IF;

    -- Step 2: Drop every unique index except PRIMARY and uk_contact_name_mobile
    BEGIN
        DECLARE v_done  INT DEFAULT 0;
        DECLARE v_idx   VARCHAR(255);
        DECLARE cur CURSOR FOR
            SELECT DISTINCT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'contactdetail'
              AND INDEX_NAME  NOT IN ('PRIMARY', 'uk_contact_name_mobile')
              AND NON_UNIQUE   = 0;
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

        OPEN cur;
        drop_loop: LOOP
            FETCH cur INTO v_idx;
            IF v_done THEN LEAVE drop_loop; END IF;
            SET @drop_sql = CONCAT('ALTER TABLE contactdetail DROP INDEX `', v_idx, '`');
            PREPARE stmt FROM @drop_sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END LOOP;
        CLOSE cur;
    END;

    -- Step 3: Add new composite unique constraint (if not already present)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'contactdetail'
          AND INDEX_NAME   = 'uk_contact_name_mobile'
    ) THEN
        ALTER TABLE contactdetail
            ADD CONSTRAINT uk_contact_name_mobile
            UNIQUE (FirstName, LastName, MobileNo, TenantId);
    END IF;

    -- Step 4: Make ContactAddressTypeId nullable (if still defined as NOT NULL)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'contactdetail'
          AND COLUMN_NAME  = 'ContactAddressTypeId'
          AND IS_NULLABLE  = 'NO'
    ) THEN
        ALTER TABLE contactdetail
            MODIFY ContactAddressTypeId VARCHAR(50) NULL;
    END IF;

END //

DELIMITER ;

CALL migrate_contactdetail();
DROP PROCEDURE IF EXISTS migrate_contactdetail;

-- ============================================================

-- Address Detail table
create table if not exists addressdetail
(
	Id varchar(50) not null,
    AddressLine1 varchar(50),
    AddressLine2 varchar(50),
    City varchar(50),
    State varchar(50),
    Pincode varchar(50),
    MapProviderLocationMapperId varchar(50) not null,
    Landmark varchar(50),
    ContactAddressTypeId varchar(50) not null,
    TagName varchar(100) null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (AddressLine1, City, ContactAddressTypeId, TenantId),
    UNIQUE KEY uk_ad_tagname (TagName),
    FOREIGN KEY (ContactAddressTypeId) REFERENCES contactaddresstype(Id),
    FOREIGN KEY (MapProviderLocationMapperId) REFERENCES mapproviderlocationmapper(Id)
);

-- Migration: add TagName to existing addressdetail tables
-- Run these statements once on existing databases:
-- ALTER TABLE addressdetail ADD COLUMN TagName varchar(100) NULL AFTER ContactAddressTypeId;
-- ALTER TABLE addressdetail ADD UNIQUE KEY uk_ad_tagname (TagName);

-- Cost Info table
create table if not exists costinfo
(
	Id varchar(50) not null,
    Amount varchar(50) not null,
    TaxGroupId varchar(50) not null,
    IsTaxIncluded tinyint(1) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Id, TenantId),
    FOREIGN KEY (TaxGroupId) REFERENCES taxgroup(Id)
);


-- Branch Detail table
create table if not exists branchdetail
(
	Id varchar(50) not null,
    OrganizationDetailId varchar(50) not null,
    ContactDetailId varchar(50) not null,
    AddressDetailId varchar(50) not null,
    TransactionTypeConfigId varchar(50) not null,
    BranchName varchar(50) not null,
	TINNo varchar(50),
    GSTIN varchar(50),
    PAN varchar(50),
    CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (OrganizationDetailId, BranchName, TenantId),
    FOREIGN KEY (OrganizationDetailId) REFERENCES organizationdetail(Id),
    FOREIGN KEY (ContactDetailId) REFERENCES contactdetail(Id),
    FOREIGN KEY (AddressDetailId) REFERENCES addressdetail(Id),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
);

 -- Branch  Group Mapper table
create table if not exists branchusergroupmapper
(
	Id varchar(50) not null,
    BranchDetailId varchar(50) not null,
    UserGroupId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (BranchDetailId, UserGroupId, TenantId),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- Batch Detail table
create table if not exists batchdetail
(
	Id varchar(50) not null,
    BatchNo varchar(50) not null,
    Barcode varchar(50) null,
    MfgDate datetime null,
    Expdate datetime null,
    PurchaseDate datetime null,
    IsNonReturnable tinyint(1) not null,
    CostInfoId varchar(50) null,
    UOMId varchar(50) null,
    Quantity varchar(50) null,
    MapProviderLocationMapperId varchar(50) null,
    BranchDetailId varchar(50) null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (BatchNo, BranchDetailId, TenantId),
    FOREIGN KEY (CostInfoId) REFERENCES costinfo(Id),
    FOREIGN KEY (UOMId) REFERENCES UOM(Id),
    FOREIGN KEY (MapProviderLocationMapperId) REFERENCES mapproviderlocationmapper(Id),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- Migration: make optional batchdetail columns nullable on existing databases
-- Run these statements once on existing databases:
-- ALTER TABLE batchdetail MODIFY Barcode varchar(50) NULL;
-- ALTER TABLE batchdetail MODIFY MfgDate datetime NULL;
-- ALTER TABLE batchdetail MODIFY Expdate datetime NULL;
-- ALTER TABLE batchdetail MODIFY PurchaseDate datetime NULL;
-- ALTER TABLE batchdetail MODIFY CostInfoId varchar(50) NULL;
-- ALTER TABLE batchdetail MODIFY UOMId varchar(50) NULL;
-- ALTER TABLE batchdetail MODIFY Quantity varchar(50) NULL;
-- ALTER TABLE batchdetail MODIFY MapProviderLocationMapperId varchar(50) NULL;
-- ALTER TABLE batchdetail MODIFY BranchDetailId varchar(50) NULL;

-- Item Detail table
create table if not exists itemdetail (
    Id varchar(50) not null,
    Name varchar(255) not null,
    Code varchar(50) null,
    Description varchar(1000) null,
    CategoryId varchar(50) null,
    UOMId varchar(50) null,
    CostInfoId varchar(50) null,
    SKU varchar(50) null,
    Barcode varchar(50) null,
    HSNCode varchar(50) null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId),
    FOREIGN KEY (CategoryId) REFERENCES categorydetail(Id),
    FOREIGN KEY (UOMId) REFERENCES UOM(Id),
    FOREIGN KEY (CostInfoId) REFERENCES costinfo(Id)
);

-- Migration: align itemdetail with updated schema on existing databases

DROP PROCEDURE IF EXISTS migrate_itemdetail;

DELIMITER //

CREATE PROCEDURE migrate_itemdetail()
BEGIN

    -- Step 1: Rename Type -> Name (only if Type column still exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND COLUMN_NAME  = 'Type'
    ) THEN
        ALTER TABLE itemdetail CHANGE Type Name varchar(255) NOT NULL;
    END IF;

    -- Step 2: Add Code column (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND COLUMN_NAME  = 'Code'
    ) THEN
        ALTER TABLE itemdetail ADD COLUMN Code varchar(50) NULL AFTER Name;
    END IF;

    -- Step 3: Widen Description and make nullable
    ALTER TABLE itemdetail MODIFY Description varchar(1000) NULL;

    -- Step 4: Make CategoryId nullable
    ALTER TABLE itemdetail MODIFY CategoryId varchar(50) NULL;

    -- Step 5: Add UOMId column (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND COLUMN_NAME  = 'UOMId'
    ) THEN
        ALTER TABLE itemdetail ADD COLUMN UOMId varchar(50) NULL AFTER CategoryId;
        ALTER TABLE itemdetail ADD FOREIGN KEY (UOMId) REFERENCES UOM(Id);
    END IF;

    -- Step 6: Add CostInfoId column (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND COLUMN_NAME  = 'CostInfoId'
    ) THEN
        ALTER TABLE itemdetail ADD COLUMN CostInfoId varchar(50) NULL AFTER UOMId;
        ALTER TABLE itemdetail ADD FOREIGN KEY (CostInfoId) REFERENCES costinfo(Id);
    END IF;

    -- Step 7: Add Barcode column (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND COLUMN_NAME  = 'Barcode'
    ) THEN
        ALTER TABLE itemdetail ADD COLUMN Barcode varchar(50) NULL AFTER SKU;
    END IF;

    -- Step 8: Drop FK on BatchDetailId, then drop the column (if it still exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND COLUMN_NAME  = 'BatchDetailId'
    ) THEN
        BEGIN
            DECLARE v_fk VARCHAR(255) DEFAULT NULL;
            SELECT CONSTRAINT_NAME INTO v_fk
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA  = DATABASE()
              AND TABLE_NAME    = 'itemdetail'
              AND COLUMN_NAME   = 'BatchDetailId'
              AND REFERENCED_TABLE_NAME IS NOT NULL
            LIMIT 1;

            IF v_fk IS NOT NULL THEN
                SET @drop_fk = CONCAT('ALTER TABLE itemdetail DROP FOREIGN KEY `', v_fk, '`');
                PREPARE stmt FROM @drop_fk;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
            END IF;
        END;
        ALTER TABLE itemdetail DROP COLUMN BatchDetailId;
    END IF;

    -- Step 9: Replace old unique index (Type, TenantId) with (Name, TenantId)
    BEGIN
        DECLARE v_done INT DEFAULT 0;
        DECLARE v_idx  VARCHAR(255);
        DECLARE cur CURSOR FOR
            SELECT DISTINCT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'itemdetail'
              AND INDEX_NAME  NOT IN ('PRIMARY', 'uk_itemdetail_name_tenant')
              AND NON_UNIQUE   = 0;
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

        OPEN cur;
        drop_loop: LOOP
            FETCH cur INTO v_idx;
            IF v_done THEN LEAVE drop_loop; END IF;
            SET @drop_sql = CONCAT('ALTER TABLE itemdetail DROP INDEX `', v_idx, '`');
            PREPARE stmt FROM @drop_sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END LOOP;
        CLOSE cur;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'itemdetail'
          AND INDEX_NAME   = 'uk_itemdetail_name_tenant'
    ) THEN
        ALTER TABLE itemdetail ADD CONSTRAINT uk_itemdetail_name_tenant UNIQUE (Name, TenantId);
    END IF;

END //

DELIMITER ;

CALL migrate_itemdetail();
DROP PROCEDURE IF EXISTS migrate_itemdetail;

-- Transaction Type Base Conversion  table
create table if not exists transactiontypebaseconversion (
	Id varchar(50) not null,
    TenantId varchar(50) not null,
    TransactionTypeConfigId varchar(50) not null,
    FromTransactionTypeStatusId varchar(50) not null,
    ToTransactionTypeStatusId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, TenantId),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id),
    FOREIGN KEY (FromTransactionTypeStatusId) REFERENCES transactiontypestatus(Id),
    FOREIGN KEY (ToTransactionTypeStatusId) REFERENCES transactiontypestatus(Id)
);

-- Migration: redesign transactiontypebaseconversion for existing databases
-- Old schema had FromTransactionTypeId/ToTransactionTypeId (FK to transactiontype)
-- New schema uses TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId

DROP PROCEDURE IF EXISTS migrate_transactiontypebaseconversion;

DELIMITER //

CREATE PROCEDURE migrate_transactiontypebaseconversion()
BEGIN

    -- Step 1: Drop FK on FromTransactionTypeId (must happen before dropping its index/column)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'FromTransactionTypeId'
    ) THEN
        BEGIN
            DECLARE v_fk VARCHAR(255) DEFAULT NULL;
            SELECT CONSTRAINT_NAME INTO v_fk
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'transactiontypebaseconversion'
              AND COLUMN_NAME  = 'FromTransactionTypeId'
              AND REFERENCED_TABLE_NAME IS NOT NULL
            LIMIT 1;
            IF v_fk IS NOT NULL THEN
                SET @drop_fk = CONCAT('ALTER TABLE transactiontypebaseconversion DROP FOREIGN KEY `', v_fk, '`');
                PREPARE stmt FROM @drop_fk; EXECUTE stmt; DEALLOCATE PREPARE stmt;
            END IF;
        END;
    END IF;

    -- Step 2: Drop FK on ToTransactionTypeId (must happen before dropping its index/column)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'ToTransactionTypeId'
    ) THEN
        BEGIN
            DECLARE v_fk2 VARCHAR(255) DEFAULT NULL;
            SELECT CONSTRAINT_NAME INTO v_fk2
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'transactiontypebaseconversion'
              AND COLUMN_NAME  = 'ToTransactionTypeId'
              AND REFERENCED_TABLE_NAME IS NOT NULL
            LIMIT 1;
            IF v_fk2 IS NOT NULL THEN
                SET @drop_fk2 = CONCAT('ALTER TABLE transactiontypebaseconversion DROP FOREIGN KEY `', v_fk2, '`');
                PREPARE stmt FROM @drop_fk2; EXECUTE stmt; DEALLOCATE PREPARE stmt;
            END IF;
        END;
    END IF;

    -- Step 3: Drop old unique indexes (FKs already removed so this is now safe)
    BEGIN
        DECLARE v_done INT DEFAULT 0;
        DECLARE v_idx  VARCHAR(255);
        DECLARE cur CURSOR FOR
            SELECT DISTINCT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'transactiontypebaseconversion'
              AND INDEX_NAME  NOT IN ('PRIMARY', 'uk_ttbc_config_from_to_tenant')
              AND NON_UNIQUE   = 0;
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

        OPEN cur;
        drop_loop: LOOP
            FETCH cur INTO v_idx;
            IF v_done THEN LEAVE drop_loop; END IF;
            SET @drop_sql = CONCAT('ALTER TABLE transactiontypebaseconversion DROP INDEX `', v_idx, '`');
            PREPARE stmt FROM @drop_sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END LOOP;
        CLOSE cur;
    END;

    -- Step 4: Drop old columns (indexes on them were already removed above)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'FromTransactionTypeId'
    ) THEN
        ALTER TABLE transactiontypebaseconversion DROP COLUMN FromTransactionTypeId;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'ToTransactionTypeId'
    ) THEN
        ALTER TABLE transactiontypebaseconversion DROP COLUMN ToTransactionTypeId;
    END IF;

    -- Step 5: Truncate stale rows (old schema data is incompatible with new structure)
    -- Disable FK checks so child table (transactiontypeconversionmapper) doesn't block truncate
    SET FOREIGN_KEY_CHECKS = 0;
    TRUNCATE TABLE transactiontypebaseconversion;
    TRUNCATE TABLE transactiontypeconversionmapper;
    SET FOREIGN_KEY_CHECKS = 1;

    -- Step 6: Add TransactionTypeConfigId (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'TransactionTypeConfigId'
    ) THEN
        ALTER TABLE transactiontypebaseconversion ADD COLUMN TransactionTypeConfigId varchar(50) NOT NULL AFTER TenantId;
        ALTER TABLE transactiontypebaseconversion ADD FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id);
    END IF;

    -- Step 7: Add FromTransactionTypeStatusId (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'FromTransactionTypeStatusId'
    ) THEN
        ALTER TABLE transactiontypebaseconversion ADD COLUMN FromTransactionTypeStatusId varchar(50) NOT NULL AFTER TransactionTypeConfigId;
        ALTER TABLE transactiontypebaseconversion ADD FOREIGN KEY (FromTransactionTypeStatusId) REFERENCES transactiontypestatus(Id);
    END IF;

    -- Step 8: Add ToTransactionTypeStatusId (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND COLUMN_NAME  = 'ToTransactionTypeStatusId'
    ) THEN
        ALTER TABLE transactiontypebaseconversion ADD COLUMN ToTransactionTypeStatusId varchar(50) NOT NULL AFTER FromTransactionTypeStatusId;
        ALTER TABLE transactiontypebaseconversion ADD FOREIGN KEY (ToTransactionTypeStatusId) REFERENCES transactiontypestatus(Id);
    END IF;

    -- Step 9: Add new unique constraint (if missing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'transactiontypebaseconversion'
          AND INDEX_NAME   = 'uk_ttbc_config_from_to_tenant'
    ) THEN
        ALTER TABLE transactiontypebaseconversion
            ADD CONSTRAINT uk_ttbc_config_from_to_tenant
            UNIQUE (TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, TenantId);
    END IF;

END //

DELIMITER ;

CALL migrate_transactiontypebaseconversion();
DROP PROCEDURE IF EXISTS migrate_transactiontypebaseconversion;

-- Transaction Detail log table
create table if not exists transactiondetaillog
(
	Id varchar(50) not null,
    TenantId varchar(50) not null,
    TransactionNo varchar(50) not null,
    TransactionTypeConfigId varchar(50) not null,
    TransactionTypeStatusId varchar(50) null,
    BranchId varchar(50) null,
    TransactionDate date not null,
    Remarks varchar(500) null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id),
    FOREIGN KEY (TransactionTypeStatusId) REFERENCES transactiontypestatus(Id),
    FOREIGN KEY (BranchId) REFERENCES branchdetail(Id)
);

-- Migration: redesign transactiondetaillog for existing databases

DROP PROCEDURE IF EXISTS migrate_transactiondetaillog;

DELIMITER //

CREATE PROCEDURE migrate_transactiondetaillog()
BEGIN

    -- Step 1: Disable FK checks and truncate all dependent tables
    SET FOREIGN_KEY_CHECKS = 0;
    TRUNCATE TABLE transactionitemdetail;
    TRUNCATE TABLE transactiontypeconversionmapper;
    TRUNCATE TABLE paymentbreakup;
    TRUNCATE TABLE paymentdetail;
    TRUNCATE TABLE transactiondetaillog;
    SET FOREIGN_KEY_CHECKS = 1;

    -- Step 2: Drop FK on AccountTypeBaseId (if exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'AccountTypeBaseId'
    ) THEN
        BEGIN
            DECLARE v_fk1 VARCHAR(255) DEFAULT NULL;
            SELECT CONSTRAINT_NAME INTO v_fk1 FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog'
              AND COLUMN_NAME = 'AccountTypeBaseId' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1;
            IF v_fk1 IS NOT NULL THEN
                SET @sql1 = CONCAT('ALTER TABLE transactiondetaillog DROP FOREIGN KEY `', v_fk1, '`');
                PREPARE stmt FROM @sql1; EXECUTE stmt; DEALLOCATE PREPARE stmt;
            END IF;
        END;
        ALTER TABLE transactiondetaillog DROP COLUMN AccountTypeBaseId;
    END IF;

    -- Step 3: Drop FK on BranchDetailId (if exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'BranchDetailId'
    ) THEN
        BEGIN
            DECLARE v_fk2 VARCHAR(255) DEFAULT NULL;
            SELECT CONSTRAINT_NAME INTO v_fk2 FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog'
              AND COLUMN_NAME = 'BranchDetailId' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1;
            IF v_fk2 IS NOT NULL THEN
                SET @sql2 = CONCAT('ALTER TABLE transactiondetaillog DROP FOREIGN KEY `', v_fk2, '`');
                PREPARE stmt FROM @sql2; EXECUTE stmt; DEALLOCATE PREPARE stmt;
            END IF;
        END;
        ALTER TABLE transactiondetaillog DROP COLUMN BranchDetailId;
    END IF;

    -- Step 4: Drop remaining old columns (no FKs)
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'UserId') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN UserId;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'TransactionDateTime') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN TransactionDateTime;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'Description') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN Description;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'CF1') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN CF1;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'CF2') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN CF2;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'CF3') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN CF3;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'CF4') THEN
        ALTER TABLE transactiondetaillog DROP COLUMN CF4;
    END IF;

    -- Step 5: Add new columns (table is empty so NOT NULL is safe)
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'TransactionNo') THEN
        ALTER TABLE transactiondetaillog ADD COLUMN TransactionNo varchar(50) NOT NULL AFTER TenantId;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'TransactionTypeConfigId') THEN
        ALTER TABLE transactiondetaillog ADD COLUMN TransactionTypeConfigId varchar(50) NOT NULL AFTER TransactionNo;
        ALTER TABLE transactiondetaillog ADD FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'TransactionTypeStatusId') THEN
        ALTER TABLE transactiondetaillog ADD COLUMN TransactionTypeStatusId varchar(50) NULL AFTER TransactionTypeConfigId;
        ALTER TABLE transactiondetaillog ADD FOREIGN KEY (TransactionTypeStatusId) REFERENCES transactiontypestatus(Id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'BranchId') THEN
        ALTER TABLE transactiondetaillog ADD COLUMN BranchId varchar(50) NULL AFTER TransactionTypeStatusId;
        ALTER TABLE transactiondetaillog ADD FOREIGN KEY (BranchId) REFERENCES branchdetail(Id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'TransactionDate') THEN
        ALTER TABLE transactiondetaillog ADD COLUMN TransactionDate date NOT NULL AFTER BranchId;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactiondetaillog' AND COLUMN_NAME = 'Remarks') THEN
        ALTER TABLE transactiondetaillog ADD COLUMN Remarks varchar(500) NULL AFTER TransactionDate;
    END IF;

END //

DELIMITER ;

CALL migrate_transactiondetaillog();
DROP PROCEDURE IF EXISTS migrate_transactiondetaillog;

-- Transaction Item Detail table
create table if not exists transactionitemdetail
  (
	Id varchar(50) not null,    
    TransactionDetailLogId varchar(50) not null,
    ItemId varchar(50) not null,
    Comment varchar(100),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (TransactionDetailLogId, ItemId, TenantId),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id),
    FOREIGN KEY (ItemId) REFERENCES itemdetail(Id)
  );

-- Transaction Type Conversion Mapper table
create table if not exists transactiontypeconversionmapper 
(
	Id varchar(50) not null,    
    TransactionTypeBaseCoversionId varchar(50) not null,
    TransactionDetailLogId varchar(50) not null,
    TransactionTypeStatusId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (TransactionTypeBaseCoversionId, TransactionDetailLogId, TransactionTypeStatusId, TenantId),
    FOREIGN KEY (TransactionTypeBaseCoversionId) REFERENCES transactiontypebaseconversion(Id),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id),
    FOREIGN KEY (TransactionTypeStatusId) REFERENCES transactiontypestatus(Id)
);

-- Payment Received Type table
create table if not exists paymentreceivedtype 
(
	Id varchar(50) not null,    
    Type varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (Type, TenantId)
);

-- Payment mode table
create table if not exists paymentmode 
(
	Id varchar(50) not null,    
    Type varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (Type, TenantId)
);

-- Payment Mode Transaction Detail table
create table if not exists paymentmodetransactiondetail
(
	Id varchar(50) not null,    
    PaymentModeId varchar(50) not null,
    RefNo varchar(50),
    Comment varchar(100),
	CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),      
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (PaymentModeId) REFERENCES paymentmode(Id)
);

-- Payment Detail table
create table if not exists paymentdetail 
(
	Id varchar(50) not null,    
    AccountTypeBaseId varchar(50) not null,
    TransactionDetailLogId varchar(50) not null,
    DiscountAmount varchar(100),
	RoundOff varchar(50),
    TotalAmount varchar(50) not null,
    TaxesAmount varchar(50),
    GrossAmount varchar(50) not null,    
    UserId varchar(50) not null,    
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (AccountTypeBaseId) REFERENCES accounttypebase(Id),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id)
);

-- Payment Breakup table
create table if not exists paymentbreakup
(
	Id varchar(50) not null,    
    AccountTypeBaseId varchar(50) not null,
    PaymentDetailId varchar(50) not null,
    PaymentModeTransactionDetailId varchar(100) not null,
	PaymentReceivedTypeId varchar(50) not null,
    UserId varchar(50) not null,    
    Timestamp datetime not null,    
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (AccountTypeBaseId) REFERENCES accounttypebase(Id),
    FOREIGN KEY (PaymentDetailId) REFERENCES paymentdetail(Id),
    FOREIGN KEY (PaymentModeTransactionDetailId) REFERENCES paymentmodetransactiondetail(Id),
    FOREIGN KEY (PaymentReceivedTypeId) REFERENCES paymentreceivedtype(Id)
);