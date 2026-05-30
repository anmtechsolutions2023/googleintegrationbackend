// src/config/constants.js
// Centralized constants for queries, statuses, and other reusable strings
// Organized by domain/module for better maintainability and scalability

module.exports = {
  QUERIES: {
    // User & Tenant Queries
    USER_TENANTS: {
      SELECT:
        'SELECT tenant_id, is_admin, is_super_admin FROM user_tenants WHERE user_email = ? AND is_active = TRUE',
    },

    // Permissions Queries
    PERMISSIONS: {
      SELECT: `
        SELECT
            f.scope,
            f.feature_short_name
        FROM user_tenants ut
        JOIN tenant_features tf ON ut.id = tf.user_tenants_id
        JOIN features f ON tf.feature_id = f.feature_id
        WHERE f.is_active = TRUE
          AND tf.is_active = TRUE
          AND ut.is_active = TRUE
          AND ut.tenant_id = ?
          AND ut.user_email = ?
      `,
    },

    // Audit Logs Queries
    AUDIT_LOGS: {
      SELECT:
        'SELECT log_id, tenant_id, user_email, action, status, timestamp FROM audit_logs WHERE 1=1',
      INSERT:
        'INSERT INTO audit_logs (tenant_id, user_email, action, status, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, NOW())',
      INSERT_MIDDLEWARE:
        'INSERT INTO audit_logs (tenant_id, user_email, action, status) VALUES (?, ?, ?, ?)',
    },

    // Tax Type Queries
    TAX_TYPES: {
      SELECT_ALL:
        'SELECT * FROM TaxTypes WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM TaxTypes WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM TaxTypes WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO TaxTypes (Id, TenantId, Name, Value, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE TaxTypes SET Name = ?, Value = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM TaxTypes WHERE Id = ? AND TenantId = ?',
    },

    // UOM (Unit of Measure) Queries
    UOM: {
      SELECT_ALL:
        'SELECT * FROM UOM WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM UOM WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM UOM WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO UOM (Id, TenantId, UnitName, IsPrimary, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE UOM SET UnitName = ?, IsPrimary = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM UOM WHERE Id = ? AND TenantId = ?',
    },

    // Category Queries
    CATEGORY: {
      SELECT_ALL:
        'SELECT * FROM categorydetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM categorydetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM categorydetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO categorydetail (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE categorydetail SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM categorydetail WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Config Queries
    TRANSACTION_TYPE_CONFIG: {
      SELECT_ALL:
        'SELECT * FROM transactiontypeconfig WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypeconfig WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypeconfig WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactiontypeconfig (Id, TenantId, StartCounterNo, Prefix, Format, TagName, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontypeconfig SET StartCounterNo = ?, Prefix = ?, Format = ?, TagName = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactiontypeconfig WHERE Id = ? AND TenantId = ?',
    },

    // Organization Queries
    ORGANIZATION: {
      SELECT_ALL:
        'SELECT * FROM organizationdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM organizationdetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM organizationdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO organizationdetail (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE organizationdetail SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM organizationdetail WHERE Id = ? AND TenantId = ?',
    },

    // UOM Factor Queries
    UOM_FACTOR: {
      SELECT_ALL:
        'SELECT * FROM uomfactor WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `SELECT t.*, ref0.UnitName AS PrimaryUnitName, ref1.UnitName AS SecondaryUnitName FROM uomfactor t LEFT JOIN UOM ref0 ON t.PrimaryUOMId = ref0.Id LEFT JOIN UOM ref1 ON t.SecondaryUOMId = ref1.Id WHERE t.TenantId = ? ORDER BY t.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM uomfactor WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM uomfactor WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `SELECT t.*, ref0.UnitName AS PrimaryUnitName, ref1.UnitName AS SecondaryUnitName FROM uomfactor t LEFT JOIN UOM ref0 ON t.PrimaryUOMId = ref0.Id LEFT JOIN UOM ref1 ON t.SecondaryUOMId = ref1.Id WHERE t.Id = ? AND t.TenantId = ?`,
      INSERT:
        'INSERT INTO uomfactor (Id, TenantId, PrimaryUOMId, SecondaryUOMId, Factor, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE uomfactor SET PrimaryUOMId = ?, SecondaryUOMId = ?, Factor = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM uomfactor WHERE Id = ? AND TenantId = ?',
    },

    // Account Type Queries
    ACCOUNT_TYPE: {
      SELECT_ALL:
        'SELECT * FROM accounttypebase WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM accounttypebase WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM accounttypebase WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO accounttypebase (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE accounttypebase SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM accounttypebase WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Status Queries
    TRANSACTION_TYPE_STATUS: {
      SELECT_ALL:
        'SELECT * FROM transactiontypestatus WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypestatus WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypestatus WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactiontypestatus (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontypestatus SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactiontypestatus WHERE Id = ? AND TenantId = ?',
    },

    // Contact Address Type Queries
    CONTACT_ADDRESS_TYPE: {
      SELECT_ALL:
        'SELECT * FROM contactaddresstype WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM contactaddresstype WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM contactaddresstype WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO contactaddresstype (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE contactaddresstype SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM contactaddresstype WHERE Id = ? AND TenantId = ?',
    },

    // Tax Group Queries
    TAX_GROUP: {
      SELECT_ALL:
        'SELECT * FROM taxgroup WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM taxgroup WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM taxgroup WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO taxgroup (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE taxgroup SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM taxgroup WHERE Id = ? AND TenantId = ?',
    },

    // Tax Group Tax Type Mapper Queries
    TAX_GROUP_TAX_TYPE_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM taxgrouptaxtypemapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT tgm.*, 
          tg.Name AS TaxGroupName, 
          tt.Name AS TaxTypeName, 
          tt.Value AS TaxTypeValue
        FROM taxgrouptaxtypemapper tgm
        LEFT JOIN taxgroup tg ON tgm.TaxGroupId = tg.Id AND tg.TenantId = tgm.TenantId
        LEFT JOIN TaxTypes tt ON tgm.TaxTypeId = tt.Id AND tt.TenantId = tgm.TenantId
        WHERE tgm.TenantId = ? ORDER BY tgm.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM taxgrouptaxtypemapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM taxgrouptaxtypemapper WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT tgm.*, 
          tg.Name AS TaxGroupName, 
          tt.Name AS TaxTypeName, 
          tt.Value AS TaxTypeValue
        FROM taxgrouptaxtypemapper tgm
        LEFT JOIN taxgroup tg ON tgm.TaxGroupId = tg.Id AND tg.TenantId = tgm.TenantId
        LEFT JOIN TaxTypes tt ON tgm.TaxTypeId = tt.Id AND tt.TenantId = tgm.TenantId
        WHERE tgm.Id = ? AND tgm.TenantId = ?`,
      INSERT:
        'INSERT INTO taxgrouptaxtypemapper (Id, TenantId, TaxGroupId, TaxTypeId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE taxgrouptaxtypemapper SET TaxGroupId = ?, TaxTypeId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM taxgrouptaxtypemapper WHERE Id = ? AND TenantId = ?',
    },

    // Map Provider Queries
    MAP_PROVIDER: {
      SELECT_ALL:
        'SELECT * FROM mapprovider WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM mapprovider WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM mapprovider WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO mapprovider (Id, TenantId, ProviderName, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE mapprovider SET ProviderName = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM mapprovider WHERE Id = ? AND TenantId = ?',
    },

    // Location Detail Queries
    LOCATION_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM locationdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM locationdetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM locationdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO locationdetail (Id, TenantId, Lat, Lng, CF1, CF2, CF3, CF4, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE locationdetail SET Lat = ?, Lng = ?, CF1 = ?, CF2 = ?, CF3 = ?, CF4 = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM locationdetail WHERE Id = ? AND TenantId = ?',
    },

    // Map Provider Location Mapper Queries
    MAP_PROVIDER_LOCATION_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM mapproviderlocationmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT mplm.*, 
          mp.ProviderName AS MapProviderName, 
          ld.Lat, ld.Lng, ld.CF1, ld.CF2, ld.CF3, ld.CF4
        FROM mapproviderlocationmapper mplm
        LEFT JOIN mapprovider mp ON mplm.MapProviderId = mp.Id AND mp.TenantId = mplm.TenantId
        LEFT JOIN locationdetail ld ON mplm.LocationDetailId = ld.Id AND ld.TenantId = mplm.TenantId
        WHERE mplm.TenantId = ? ORDER BY mplm.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM mapproviderlocationmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM mapproviderlocationmapper WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT mplm.*, 
          mp.ProviderName AS MapProviderName, 
          ld.Lat, ld.Lng, ld.CF1, ld.CF2, ld.CF3, ld.CF4
        FROM mapproviderlocationmapper mplm
        LEFT JOIN mapprovider mp ON mplm.MapProviderId = mp.Id AND mp.TenantId = mplm.TenantId
        LEFT JOIN locationdetail ld ON mplm.LocationDetailId = ld.Id AND ld.TenantId = mplm.TenantId
        WHERE mplm.Id = ? AND mplm.TenantId = ?`,
      INSERT:
        'INSERT INTO mapproviderlocationmapper (Id, TenantId, MapProviderId, LocationDetailId, TagName, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE mapproviderlocationmapper SET MapProviderId = ?, LocationDetailId = ?, TagName = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM mapproviderlocationmapper WHERE Id = ? AND TenantId = ?',
    },

    // Contact Detail Queries
    CONTACT_DETAIL: {
      SELECT_ALL: `
        SELECT cd.*, cat.Name AS ContactAddressTypeName
        FROM contactdetail cd
        LEFT JOIN contactaddresstype cat ON cd.ContactAddressTypeId = cat.Id AND cat.TenantId = cd.TenantId
        WHERE cd.TenantId = ? ORDER BY cd.CreatedOn DESC`,
      SELECT_ALL_WITH_DETAILS: `
        SELECT cd.*, cat.Name AS ContactAddressTypeName
        FROM contactdetail cd
        LEFT JOIN contactaddresstype cat ON cd.ContactAddressTypeId = cat.Id AND cat.TenantId = cd.TenantId
        WHERE cd.TenantId = ? ORDER BY cd.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM contactdetail WHERE TenantId = ?',
      SELECT_BY_ID: `
        SELECT cd.*, cat.Name AS ContactAddressTypeName
        FROM contactdetail cd
        LEFT JOIN contactaddresstype cat ON cd.ContactAddressTypeId = cat.Id AND cat.TenantId = cd.TenantId
        WHERE cd.Id = ? AND cd.TenantId = ?`,
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT cd.*, cat.Name AS ContactAddressTypeName
        FROM contactdetail cd
        LEFT JOIN contactaddresstype cat ON cd.ContactAddressTypeId = cat.Id AND cat.TenantId = cd.TenantId
        WHERE cd.Id = ? AND cd.TenantId = ?`,
      INSERT:
        'INSERT INTO contactdetail (Id, TenantId, FirstName, LastName, MobileNo, AltMobileNo, Landline1, LandLine2, Ext1, Ext2, ContactAddressTypeId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE contactdetail SET FirstName = ?, LastName = ?, MobileNo = ?, AltMobileNo = ?, Landline1 = ?, LandLine2 = ?, Ext1 = ?, Ext2 = ?, ContactAddressTypeId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM contactdetail WHERE Id = ? AND TenantId = ?',
    },

    // Address Detail Queries
    ADDRESS_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM addressdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT ad.*, 
          cat.Name AS ContactAddressTypeName,
          mplm.MapProviderId, mplm.LocationDetailId,
          mp.ProviderName AS MapProviderName,
          ld.Lat, ld.Lng
        FROM addressdetail ad
        LEFT JOIN contactaddresstype cat ON ad.ContactAddressTypeId = cat.Id AND cat.TenantId = ad.TenantId
        LEFT JOIN mapproviderlocationmapper mplm ON ad.MapProviderLocationMapperId = mplm.Id AND mplm.TenantId = ad.TenantId
        LEFT JOIN mapprovider mp ON mplm.MapProviderId = mp.Id AND mp.TenantId = ad.TenantId
        LEFT JOIN locationdetail ld ON mplm.LocationDetailId = ld.Id AND ld.TenantId = ad.TenantId
        WHERE ad.TenantId = ? ORDER BY ad.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM addressdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM addressdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT ad.*, 
          cat.Name AS ContactAddressTypeName,
          mplm.MapProviderId, mplm.LocationDetailId,
          mp.ProviderName AS MapProviderName,
          ld.Lat, ld.Lng
        FROM addressdetail ad
        LEFT JOIN contactaddresstype cat ON ad.ContactAddressTypeId = cat.Id AND cat.TenantId = ad.TenantId
        LEFT JOIN mapproviderlocationmapper mplm ON ad.MapProviderLocationMapperId = mplm.Id AND mplm.TenantId = ad.TenantId
        LEFT JOIN mapprovider mp ON mplm.MapProviderId = mp.Id AND mp.TenantId = ad.TenantId
        LEFT JOIN locationdetail ld ON mplm.LocationDetailId = ld.Id AND ld.TenantId = ad.TenantId
        WHERE ad.Id = ? AND ad.TenantId = ?`,
      INSERT:
        'INSERT INTO addressdetail (Id, TenantId, AddressLine1, AddressLine2, City, State, Pincode, MapProviderLocationMapperId, Landmark, ContactAddressTypeId, TagName, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE addressdetail SET AddressLine1 = ?, AddressLine2 = ?, City = ?, State = ?, Pincode = ?, MapProviderLocationMapperId = ?, Landmark = ?, ContactAddressTypeId = ?, TagName = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM addressdetail WHERE Id = ? AND TenantId = ?',
    },

    // Cost Info Queries
    COST_INFO: {
      SELECT_ALL:
        'SELECT * FROM costinfo WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT ci.*, 
          tg.Name AS TaxGroupName
        FROM costinfo ci
        LEFT JOIN taxgroup tg ON ci.TaxGroupId = tg.Id AND tg.TenantId = ci.TenantId
        WHERE ci.TenantId = ? ORDER BY ci.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM costinfo WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM costinfo WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT ci.*, 
          tg.Name AS TaxGroupName
        FROM costinfo ci
        LEFT JOIN taxgroup tg ON ci.TaxGroupId = tg.Id AND tg.TenantId = ci.TenantId
        WHERE ci.Id = ? AND ci.TenantId = ?`,
      INSERT:
        'INSERT INTO costinfo (Id, TenantId, Amount, TaxGroupId, IsTaxIncluded, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE costinfo SET Amount = ?, TaxGroupId = ?, IsTaxIncluded = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM costinfo WHERE Id = ? AND TenantId = ?',
    },

    // Branch Detail Queries
    BRANCH_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM branchdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT t.*, o.Name AS OrgName, CONCAT(c.FirstName, ' ', c.LastName) AS ContactName, a.City, a.AddressLine1, conf.Prefix 
        FROM branchdetail t 
        LEFT JOIN organizationdetail o ON t.OrganizationDetailId = o.Id 
        LEFT JOIN contactdetail c ON t.ContactDetailId = c.Id 
        LEFT JOIN addressdetail a ON t.AddressDetailId = a.Id 
        LEFT JOIN transactiontypeconfig conf ON t.TransactionTypeConfigId = conf.Id 
        WHERE t.TenantId = ?`,
      COUNT: 'SELECT COUNT(*) as total FROM branchdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM branchdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT bd.*, 
          o.Name AS OrganizationName,
          cd.FirstName AS ContactFirstName, cd.LastName AS ContactLastName, cd.MobileNo AS ContactMobile,
          ad.AddressLine1, ad.AddressLine2, ad.City, ad.State, ad.Pincode
        FROM branchdetail bd
        LEFT JOIN organizationdetail o ON bd.OrganizationDetailId = o.Id AND o.TenantId = bd.TenantId
        LEFT JOIN contactdetail cd ON bd.ContactDetailId = cd.Id AND cd.TenantId = bd.TenantId
        LEFT JOIN addressdetail ad ON bd.AddressDetailId = ad.Id AND ad.TenantId = bd.TenantId
        WHERE bd.Id = ? AND bd.TenantId = ?`,
      INSERT:
        'INSERT INTO branchdetail (Id, TenantId, OrganizationDetailId, ContactDetailId, AddressDetailId, TransactionTypeConfigId, BranchName, TINNo, GSTIN, PAN, CF1, CF2, CF3, CF4, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE branchdetail SET OrganizationDetailId = ?, ContactDetailId = ?, AddressDetailId = ?, TransactionTypeConfigId = ?, BranchName = ?, TINNo = ?, GSTIN = ?, PAN = ?, CF1 = ?, CF2 = ?, CF3 = ?, CF4 = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM branchdetail WHERE Id = ? AND TenantId = ?',
    },

    // Branch User Group Mapper Queries
    BRANCH_USER_GROUP_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM branchusergroupmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT bugm.*, 
          bd.BranchName AS BranchName
        FROM branchusergroupmapper bugm
        LEFT JOIN branchdetail bd ON bugm.BranchId = bd.Id AND bd.TenantId = bugm.TenantId
        WHERE bugm.TenantId = ? ORDER BY bugm.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM branchusergroupmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM branchusergroupmapper WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT bugm.*, 
          bd.BranchName AS BranchName
        FROM branchusergroupmapper bugm
        LEFT JOIN branchdetail bd ON bugm.BranchId = bd.Id AND bd.TenantId = bugm.TenantId
        WHERE bugm.Id = ? AND bugm.TenantId = ?`,
      INSERT:
        'INSERT INTO branchusergroupmapper (Id, TenantId, BranchId, UserGroupId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE branchusergroupmapper SET BranchId = ?, UserGroupId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM branchusergroupmapper WHERE Id = ? AND TenantId = ?',
    },

    // Batch Detail Queries
    BATCH_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM batchdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `SELECT t.*, cost.Amount, u.UnitName, b.BranchName FROM batchdetail t LEFT JOIN costinfo cost ON t.CostInfoId = cost.Id LEFT JOIN UOM u ON t.UOMId = u.Id LEFT JOIN branchdetail b ON t.BranchDetailId = b.Id WHERE t.TenantId = ?`,
      COUNT: 'SELECT COUNT(*) as total FROM batchdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM batchdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO batchdetail (Id, TenantId, BatchNo, Barcode, MfgDate, Expdate, PurchaseDate, IsNonReturnable, CostInfoId, UOMId, Quantity, MapProviderLocationMapperId, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE batchdetail SET BatchNo = ?, Barcode = ?, MfgDate = ?, Expdate = ?, PurchaseDate = ?, IsNonReturnable = ?, CostInfoId = ?, UOMId = ?, Quantity = ?, MapProviderLocationMapperId = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM batchdetail WHERE Id = ? AND TenantId = ?',
    },

    // Item Detail Queries
    ITEM_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM itemdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `SELECT t.*, cat.Name AS CategoryName, u.UnitName AS UOMName, ci.Amount AS CostAmount FROM itemdetail t LEFT JOIN categorydetail cat ON t.CategoryId = cat.Id AND cat.TenantId = t.TenantId LEFT JOIN UOM u ON t.UOMId = u.Id AND u.TenantId = t.TenantId LEFT JOIN costinfo ci ON t.CostInfoId = ci.Id AND ci.TenantId = t.TenantId WHERE t.TenantId = ?`,
      COUNT: 'SELECT COUNT(*) as total FROM itemdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM itemdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT i.*, 
          c.Name AS CategoryName,
          u.UnitName AS UOMName,
          ci.Amount AS CostAmount, ci.IsTaxIncluded,
          tg.Name AS TaxGroupName
        FROM itemdetail i
        LEFT JOIN categorydetail c ON i.CategoryId = c.Id AND c.TenantId = i.TenantId
        LEFT JOIN UOM u ON i.UOMId = u.Id AND u.TenantId = i.TenantId
        LEFT JOIN costinfo ci ON i.CostInfoId = ci.Id AND ci.TenantId = i.TenantId
        LEFT JOIN taxgroup tg ON ci.TaxGroupId = tg.Id AND tg.TenantId = i.TenantId
        WHERE i.Id = ? AND i.TenantId = ?`,
      INSERT:
        'INSERT INTO itemdetail (Id, TenantId, Name, Code, Description, CategoryId, UOMId, CostInfoId, SKU, Barcode, HSNCode, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE itemdetail SET Name = ?, Code = ?, Description = ?, CategoryId = ?, UOMId = ?, CostInfoId = ?, SKU = ?, Barcode = ?, HSNCode = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM itemdetail WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Base Conversion Queries
    TRANSACTION_TYPE_BASE_CONVERSION: {
      SELECT_ALL:
        'SELECT * FROM transactiontypebaseconversion WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT ttbc.*, 
          ttc.Prefix AS TransactionTypeConfigPrefix, ttc.Format AS TransactionTypeConfigFormat,
          fts.Name AS FromStatusName,
          tts.Name AS ToStatusName
        FROM transactiontypebaseconversion ttbc
        LEFT JOIN transactiontypeconfig ttc ON ttbc.TransactionTypeConfigId = ttc.Id AND ttc.TenantId = ttbc.TenantId
        LEFT JOIN transactiontypestatus fts ON ttbc.FromTransactionTypeStatusId = fts.Id AND fts.TenantId = ttbc.TenantId
        LEFT JOIN transactiontypestatus tts ON ttbc.ToTransactionTypeStatusId = tts.Id AND tts.TenantId = ttbc.TenantId
        WHERE ttbc.TenantId = ? ORDER BY ttbc.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypebaseconversion WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypebaseconversion WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT ttbc.*, 
          ttc.Prefix AS TransactionTypeConfigPrefix, ttc.Format AS TransactionTypeConfigFormat,
          fts.Name AS FromStatusName,
          tts.Name AS ToStatusName
        FROM transactiontypebaseconversion ttbc
        LEFT JOIN transactiontypeconfig ttc ON ttbc.TransactionTypeConfigId = ttc.Id AND ttc.TenantId = ttbc.TenantId
        LEFT JOIN transactiontypestatus fts ON ttbc.FromTransactionTypeStatusId = fts.Id AND fts.TenantId = ttbc.TenantId
        LEFT JOIN transactiontypestatus tts ON ttbc.ToTransactionTypeStatusId = tts.Id AND tts.TenantId = ttbc.TenantId
        WHERE ttbc.Id = ? AND ttbc.TenantId = ?`,
      INSERT:
        'INSERT INTO transactiontypebaseconversion (Id, TenantId, TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontypebaseconversion SET TransactionTypeConfigId = ?, FromTransactionTypeStatusId = ?, ToTransactionTypeStatusId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM transactiontypebaseconversion WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Detail Log Queries
    TRANSACTION_DETAIL_LOG: {
      SELECT_ALL:
        'SELECT * FROM transactiondetaillog WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT tdl.*, 
          ttc.Prefix AS TransactionTypeConfigPrefix, ttc.Format AS TransactionTypeConfigFormat,
          tts.Name AS TransactionStatusName,
          bd.Name AS BranchName
        FROM transactiondetaillog tdl
        LEFT JOIN transactiontypeconfig ttc ON tdl.TransactionTypeConfigId = ttc.Id AND ttc.TenantId = tdl.TenantId
        LEFT JOIN transactiontypestatus tts ON tdl.TransactionTypeStatusId = tts.Id AND tts.TenantId = tdl.TenantId
        LEFT JOIN branchdetail bd ON tdl.BranchId = bd.Id AND bd.TenantId = tdl.TenantId
        WHERE tdl.TenantId = ? ORDER BY tdl.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM transactiondetaillog WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiondetaillog WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT tdl.*, 
          ttc.Prefix AS TransactionTypeConfigPrefix, ttc.Format AS TransactionTypeConfigFormat,
          tts.Name AS TransactionStatusName,
          bd.Name AS BranchName
        FROM transactiondetaillog tdl
        LEFT JOIN transactiontypeconfig ttc ON tdl.TransactionTypeConfigId = ttc.Id AND ttc.TenantId = tdl.TenantId
        LEFT JOIN transactiontypestatus tts ON tdl.TransactionTypeStatusId = tts.Id AND tts.TenantId = tdl.TenantId
        LEFT JOIN branchdetail bd ON tdl.BranchId = bd.Id AND bd.TenantId = tdl.TenantId
        WHERE tdl.Id = ? AND tdl.TenantId = ?`,
      INSERT:
        'INSERT INTO transactiondetaillog (Id, TenantId, TransactionNo, TransactionTypeConfigId, TransactionTypeStatusId, BranchId, TransactionDate, Remarks, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiondetaillog SET TransactionNo = ?, TransactionTypeConfigId = ?, TransactionTypeStatusId = ?, BranchId = ?, TransactionDate = ?, Remarks = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactiondetaillog WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Item Detail Queries
    TRANSACTION_ITEM_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM transactionitemdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `SELECT t.*, log.TransactionDateTime, item.SKU, item.Type AS ItemType FROM transactionitemdetail t LEFT JOIN transactiondetaillog log ON t.TransactionDetailLogId = log.Id LEFT JOIN itemdetail item ON t.ItemId = item.Id WHERE t.TenantId = ?`,
      COUNT:
        'SELECT COUNT(*) as total FROM transactionitemdetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactionitemdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT tid.*, 
          tdl.TransactionNo,
          i.Name AS ItemName, i.Code AS ItemCode,
          bd.BatchNumber,
          u.UnitName AS UOMName,
          tg.Name AS TaxGroupName
        FROM transactionitemdetail tid
        LEFT JOIN transactiondetaillog tdl ON tid.TransactionDetailLogId = tdl.Id AND tdl.TenantId = tid.TenantId
        LEFT JOIN itemdetail i ON tid.ItemDetailId = i.Id AND i.TenantId = tid.TenantId
        LEFT JOIN batchdetail bd ON tid.BatchDetailId = bd.Id AND bd.TenantId = tid.TenantId
        LEFT JOIN UOM u ON tid.UOMId = u.Id AND u.TenantId = tid.TenantId
        LEFT JOIN taxgroup tg ON tid.TaxGroupId = tg.Id AND tg.TenantId = tid.TenantId
        WHERE tid.Id = ? AND tid.TenantId = ?`,
      INSERT:
        'INSERT INTO transactionitemdetail (Id, TenantId, TransactionDetailLogId, ItemDetailId, BatchDetailId, Quantity, UOMId, Rate, Amount, TaxGroupId, TaxAmount, DiscountAmount, NetAmount, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactionitemdetail SET TransactionDetailLogId = ?, ItemDetailId = ?, BatchDetailId = ?, Quantity = ?, UOMId = ?, Rate = ?, Amount = ?, TaxGroupId = ?, TaxAmount = ?, DiscountAmount = ?, NetAmount = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactionitemdetail WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Conversion Mapper Queries
    TRANSACTION_TYPE_CONVERSION_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM transactiontypeconversionmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT ttcm.*, 
          ftdl.TransactionNo AS FromTransactionNo,
          ttdl.TransactionNo AS ToTransactionNo
        FROM transactiontypeconversionmapper ttcm
        LEFT JOIN transactiondetaillog ftdl ON ttcm.FromTransactionDetailLogId = ftdl.Id AND ftdl.TenantId = ttcm.TenantId
        LEFT JOIN transactiondetaillog ttdl ON ttcm.ToTransactionDetailLogId = ttdl.Id AND ttdl.TenantId = ttcm.TenantId
        WHERE ttcm.TenantId = ? ORDER BY ttcm.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypeconversionmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypeconversionmapper WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT ttcm.*, 
          ftdl.TransactionNo AS FromTransactionNo,
          ttdl.TransactionNo AS ToTransactionNo
        FROM transactiontypeconversionmapper ttcm
        LEFT JOIN transactiondetaillog ftdl ON ttcm.FromTransactionDetailLogId = ftdl.Id AND ftdl.TenantId = ttcm.TenantId
        LEFT JOIN transactiondetaillog ttdl ON ttcm.ToTransactionDetailLogId = ttdl.Id AND ttdl.TenantId = ttcm.TenantId
        WHERE ttcm.Id = ? AND ttcm.TenantId = ?`,
      INSERT:
        'INSERT INTO transactiontypeconversionmapper (Id, TenantId, TransactionTypeBaseConversionId, FromTransactionDetailLogId, ToTransactionDetailLogId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontypeconversionmapper SET TransactionTypeBaseConversionId = ?, FromTransactionDetailLogId = ?, ToTransactionDetailLogId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM transactiontypeconversionmapper WHERE Id = ? AND TenantId = ?',
    },

    // Payment Received Type Queries
    PAYMENT_RECEIVED_TYPE: {
      SELECT_ALL:
        'SELECT * FROM paymentreceivedtype WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM paymentreceivedtype WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentreceivedtype WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO paymentreceivedtype (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentreceivedtype SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentreceivedtype WHERE Id = ? AND TenantId = ?',
    },

    // Payment Mode Queries
    PAYMENT_MODE: {
      SELECT_ALL:
        'SELECT * FROM paymentmode WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM paymentmode WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM paymentmode WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO paymentmode (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentmode SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentmode WHERE Id = ? AND TenantId = ?',
    },

    // Payment Mode Transaction Detail Queries
    PAYMENT_MODE_TRANSACTION_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM paymentmodetransactiondetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT pmtd.*, 
          pm.Name AS PaymentModeName,
          tdl.TransactionNo
        FROM paymentmodetransactiondetail pmtd
        LEFT JOIN paymentmode pm ON pmtd.PaymentModeId = pm.Id AND pm.TenantId = pmtd.TenantId
        LEFT JOIN transactiondetaillog tdl ON pmtd.TransactionDetailLogId = tdl.Id AND tdl.TenantId = pmtd.TenantId
        WHERE pmtd.TenantId = ? ORDER BY pmtd.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM paymentmodetransactiondetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentmodetransactiondetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT pmtd.*, 
          pm.Name AS PaymentModeName,
          tdl.TransactionNo
        FROM paymentmodetransactiondetail pmtd
        LEFT JOIN paymentmode pm ON pmtd.PaymentModeId = pm.Id AND pm.TenantId = pmtd.TenantId
        LEFT JOIN transactiondetaillog tdl ON pmtd.TransactionDetailLogId = tdl.Id AND tdl.TenantId = pmtd.TenantId
        WHERE pmtd.Id = ? AND pmtd.TenantId = ?`,
      INSERT:
        'INSERT INTO paymentmodetransactiondetail (Id, TenantId, PaymentModeId, TransactionDetailLogId, Amount, ReferenceNo, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentmodetransactiondetail SET PaymentModeId = ?, TransactionDetailLogId = ?, Amount = ?, ReferenceNo = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM paymentmodetransactiondetail WHERE Id = ? AND TenantId = ?',
    },

    // Payment Detail Queries
    PAYMENT_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM paymentdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT pd.*, 
          prt.Name AS PaymentReceivedTypeName,
          tdl.TransactionNo
        FROM paymentdetail pd
        LEFT JOIN paymentreceivedtype prt ON pd.PaymentReceivedTypeId = prt.Id AND prt.TenantId = pd.TenantId
        LEFT JOIN transactiondetaillog tdl ON pd.TransactionDetailLogId = tdl.Id AND tdl.TenantId = pd.TenantId
        WHERE pd.TenantId = ? ORDER BY pd.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM paymentdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM paymentdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT pd.*, 
          prt.Name AS PaymentReceivedTypeName,
          tdl.TransactionNo
        FROM paymentdetail pd
        LEFT JOIN paymentreceivedtype prt ON pd.PaymentReceivedTypeId = prt.Id AND prt.TenantId = pd.TenantId
        LEFT JOIN transactiondetaillog tdl ON pd.TransactionDetailLogId = tdl.Id AND tdl.TenantId = pd.TenantId
        WHERE pd.Id = ? AND pd.TenantId = ?`,
      INSERT:
        'INSERT INTO paymentdetail (Id, TenantId, PaymentReceivedTypeId, TransactionDetailLogId, Amount, PaymentDate, ReferenceNo, Remarks, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentdetail SET PaymentReceivedTypeId = ?, TransactionDetailLogId = ?, Amount = ?, PaymentDate = ?, ReferenceNo = ?, Remarks = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentdetail WHERE Id = ? AND TenantId = ?',
    },

    // Payment Breakup Queries
    PAYMENT_BREAKUP: {
      SELECT_ALL:
        'SELECT * FROM paymentbreakup WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT t.*, acc.Name AS AccountName, pay.TotalAmount, pmt.RefNo, prt.Type AS ReceivedTypeName 
        FROM paymentbreakup t 
        LEFT JOIN accounttypebase acc ON t.AccountTypeBaseId = acc.Id 
        LEFT JOIN paymentdetail pay ON t.PaymentDetailId = pay.Id 
        LEFT JOIN paymentmodetransactiondetail pmt ON t.PaymentModeTransactionDetailId = pmt.Id 
        LEFT JOIN paymentreceivedtype prt ON t.PaymentReceivedTypeId = prt.Id 
        WHERE t.TenantId = ?`,
      COUNT: 'SELECT COUNT(*) as total FROM paymentbreakup WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentbreakup WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT pb.*, 
          pm.Name AS PaymentModeName,
          pd.Amount AS PaymentDetailAmount, pd.PaymentDate, pd.ReferenceNo AS PaymentDetailReferenceNo
        FROM paymentbreakup pb
        LEFT JOIN paymentmode pm ON pb.PaymentModeId = pm.Id AND pm.TenantId = pb.TenantId
        LEFT JOIN paymentdetail pd ON pb.PaymentDetailId = pd.Id AND pd.TenantId = pb.TenantId
        WHERE pb.Id = ? AND pb.TenantId = ?`,
      INSERT:
        'INSERT INTO paymentbreakup (Id, TenantId, PaymentDetailId, PaymentModeId, Amount, ReferenceNo, Remarks, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentbreakup SET PaymentDetailId = ?, PaymentModeId = ?, Amount = ?, ReferenceNo = ?, Remarks = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentbreakup WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Queries
    TRANSACTION_TYPE: {
      SELECT_ALL:
        'SELECT * FROM transactiontype WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT tt.*, ttc.Prefix AS TransactionTypeConfigPrefix, ttc.Format AS TransactionTypeConfigFormat
        FROM transactiontype tt
        LEFT JOIN transactiontypeconfig ttc ON tt.TransactionTypeConfigId = ttc.Id AND ttc.TenantId = tt.TenantId
        WHERE tt.TenantId = ? ORDER BY tt.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM transactiontype WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontype WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT tt.*, ttc.Prefix AS TransactionTypeConfigPrefix, ttc.Format AS TransactionTypeConfigFormat
        FROM transactiontype tt
        LEFT JOIN transactiontypeconfig ttc ON tt.TransactionTypeConfigId = ttc.Id AND ttc.TenantId = tt.TenantId
        WHERE tt.Id = ? AND tt.TenantId = ?`,
      INSERT:
        'INSERT INTO transactiontype (Id, TenantId, Name, TransactionTypeConfigId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontype SET Name = ?, TransactionTypeConfigId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactiontype WHERE Id = ? AND TenantId = ?',
    },

    // Account Type Base Queries
    ACCOUNT_TYPE_BASE: {
      SELECT_ALL:
        'SELECT * FROM accounttypebase WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM accounttypebase WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM accounttypebase WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO accounttypebase (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE accounttypebase SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM accounttypebase WHERE Id = ? AND TenantId = ?',
    },
  },
  STATUSES: {
    SUCCESS: 'SUCCESS',
    DENIED: 'DENIED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_ATTEMPT: 'LOGIN_ATTEMPT',
    LOGIN_CRASH: 'LOGIN_CRASH',
    SWITCH_TENANT_DENIED: 'SWITCH_TENANT_DENIED',
    NOT_FOUND: '403_NOT_FOUND',
    FORBIDDEN: '403_FORBIDDEN',
    UNAUTHORIZED: '401_UNAUTHORIZED',
  },
  DEFAULTS: {
    AUDIT_LIMIT: 100,
    AUDIT_OFFSET: 0,
  },
  SCOPES: {
    TENANT_ADMIN: 'TENANT:ADMIN',
    TENANT_SUPER_ADMIN: 'TENANT:SUPER_ADMIN',
    REPORTS_READ: 'REPORTS:READ',
    REPORTS_WRITE: 'REPORTS:WRITE',
    BILLING_READ: 'billing:READ',
    BILLING_WRITE: 'billing:WRITE',
  },
}
