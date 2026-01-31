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
        'INSERT INTO TaxTypes (Id, TenantId, Name, Value, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO UOM (Id, TenantId, UnitName, IsPrimary, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE UOM SET UnitName = ?, IsPrimary = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM UOM WHERE Id = ? AND TenantId = ?',
    },

    // Category Queries
    CATEGORY: {
      SELECT_ALL:
        'SELECT * FROM CategoryDetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM CategoryDetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM CategoryDetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO CategoryDetail (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE CategoryDetail SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM CategoryDetail WHERE Id = ? AND TenantId = ?',
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
        'INSERT INTO transactiontypeconfig (Id, TenantId, StartCounterNo, Prefix, Format, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE transactiontypeconfig SET StartCounterNo = ?, Prefix = ?, Format = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
        'INSERT INTO organizationdetail (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE organizationdetail SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM organizationdetail WHERE Id = ? AND TenantId = ?',
    },

    // UOM Factor Queries
    UOM_FACTOR: {
      SELECT_ALL:
        'SELECT * FROM uomfactor WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM uomfactor WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM uomfactor WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO uomfactor (Id, TenantId, PrimaryUOMId, SecondaryUOMId, Factor, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO accounttypebase (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO transactiontypestatus (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO contactaddresstype (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO taxgroup (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE taxgroup SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM taxgroup WHERE Id = ? AND TenantId = ?',
    },

    // Tax Group Tax Type Mapper Queries
    TAX_GROUP_TAX_TYPE_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM taxgrouptaxtypemapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM taxgrouptaxtypemapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM taxgrouptaxtypemapper WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO taxgrouptaxtypemapper (Id, TenantId, TaxGroupId, TaxTypeId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO mapprovider (Id, TenantId, ProviderName, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO locationdetail (Id, TenantId, Lat, Lng, CF1, CF2, CF3, CF4, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE locationdetail SET Lat = ?, Lng = ?, CF1 = ?, CF2 = ?, CF3 = ?, CF4 = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM locationdetail WHERE Id = ? AND TenantId = ?',
    },

    // Map Provider Location Mapper Queries
    MAP_PROVIDER_LOCATION_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM mapproviderlocationmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM mapproviderlocationmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM mapproviderlocationmapper WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO mapproviderlocationmapper (Id, TenantId, MapProviderId, LocationDetailId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE mapproviderlocationmapper SET MapProviderId = ?, LocationDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM mapproviderlocationmapper WHERE Id = ? AND TenantId = ?',
    },

    // Contact Detail Queries
    CONTACT_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM contactdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM contactdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM contactdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO contactdetail (Id, TenantId, FirstName, LastName, MobileNo, AltMobileNo, Landline1, LandLine2, Ext1, Ext2, ContactAddressTypeId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE contactdetail SET FirstName = ?, LastName = ?, MobileNo = ?, AltMobileNo = ?, Landline1 = ?, LandLine2 = ?, Ext1 = ?, Ext2 = ?, ContactAddressTypeId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM contactdetail WHERE Id = ? AND TenantId = ?',
    },

    // Address Detail Queries
    ADDRESS_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM addressdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM addressdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM addressdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO addressdetail (Id, TenantId, AddressLine1, AddressLine2, City, State, Pincode, MapProviderLocationMapperId, Landmark, ContactAddressTypeId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE addressdetail SET AddressLine1 = ?, AddressLine2 = ?, City = ?, State = ?, Pincode = ?, MapProviderLocationMapperId = ?, Landmark = ?, ContactAddressTypeId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM addressdetail WHERE Id = ? AND TenantId = ?',
    },

    // Cost Info Queries
    COST_INFO: {
      SELECT_ALL:
        'SELECT * FROM costinfo WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM costinfo WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM costinfo WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO costinfo (Id, TenantId, Amount, TaxGroupId, IsTaxIncluded, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE costinfo SET Amount = ?, TaxGroupId = ?, IsTaxIncluded = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM costinfo WHERE Id = ? AND TenantId = ?',
    },

    // Branch Detail Queries
    BRANCH_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM branchdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM branchdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM branchdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO branchdetail (Id, TenantId, Name, AddressDetailId, ContactDetailId, OrganizationId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE branchdetail SET Name = ?, AddressDetailId = ?, ContactDetailId = ?, OrganizationId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM branchdetail WHERE Id = ? AND TenantId = ?',
    },

    // Branch User Group Mapper Queries
    BRANCH_USER_GROUP_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM branchusergroupmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM branchusergroupmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM branchusergroupmapper WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO branchusergroupmapper (Id, TenantId, BranchId, UserGroupId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE branchusergroupmapper SET BranchId = ?, UserGroupId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM branchusergroupmapper WHERE Id = ? AND TenantId = ?',
    },

    // Batch Detail Queries
    BATCH_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM batchdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM batchdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM batchdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO batchdetail (Id, TenantId, BatchNumber, ManufacturedDate, ExpiryDate, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE batchdetail SET BatchNumber = ?, ManufacturedDate = ?, ExpiryDate = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM batchdetail WHERE Id = ? AND TenantId = ?',
    },

    // Item Detail Queries
    ITEM_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM itemdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM itemdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM itemdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO itemdetail (Id, TenantId, Name, Code, Description, CategoryId, UOMId, CostInfoId, SKU, Barcode, HSNCode, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE itemdetail SET Name = ?, Code = ?, Description = ?, CategoryId = ?, UOMId = ?, CostInfoId = ?, SKU = ?, Barcode = ?, HSNCode = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM itemdetail WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Base Conversion Queries
    TRANSACTION_TYPE_BASE_CONVERSION: {
      SELECT_ALL:
        'SELECT * FROM transactiontypebaseconversion WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypebaseconversion WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypebaseconversion WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactiontypebaseconversion (Id, TenantId, TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE transactiontypebaseconversion SET TransactionTypeConfigId = ?, FromTransactionTypeStatusId = ?, ToTransactionTypeStatusId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM transactiontypebaseconversion WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Detail Log Queries
    TRANSACTION_DETAIL_LOG: {
      SELECT_ALL:
        'SELECT * FROM transactiondetaillog WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM transactiondetaillog WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiondetaillog WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactiondetaillog (Id, TenantId, TransactionNo, TransactionTypeConfigId, TransactionTypeStatusId, BranchId, TransactionDate, Remarks, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE transactiondetaillog SET TransactionNo = ?, TransactionTypeConfigId = ?, TransactionTypeStatusId = ?, BranchId = ?, TransactionDate = ?, Remarks = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactiondetaillog WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Item Detail Queries
    TRANSACTION_ITEM_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM transactionitemdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM transactionitemdetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactionitemdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactionitemdetail (Id, TenantId, TransactionDetailLogId, ItemDetailId, BatchDetailId, Quantity, UOMId, Rate, Amount, TaxGroupId, TaxAmount, DiscountAmount, NetAmount, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE transactionitemdetail SET TransactionDetailLogId = ?, ItemDetailId = ?, BatchDetailId = ?, Quantity = ?, UOMId = ?, Rate = ?, Amount = ?, TaxGroupId = ?, TaxAmount = ?, DiscountAmount = ?, NetAmount = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactionitemdetail WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Conversion Mapper Queries
    TRANSACTION_TYPE_CONVERSION_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM transactiontypeconversionmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypeconversionmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypeconversionmapper WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactiontypeconversionmapper (Id, TenantId, TransactionTypeBaseConversionId, FromTransactionDetailLogId, ToTransactionDetailLogId, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO paymentreceivedtype (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO paymentmode (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE paymentmode SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentmode WHERE Id = ? AND TenantId = ?',
    },

    // Payment Mode Transaction Detail Queries
    PAYMENT_MODE_TRANSACTION_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM paymentmodetransactiondetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT:
        'SELECT COUNT(*) as total FROM paymentmodetransactiondetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentmodetransactiondetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO paymentmodetransactiondetail (Id, TenantId, PaymentModeId, TransactionDetailLogId, Amount, ReferenceNo, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE paymentmodetransactiondetail SET PaymentModeId = ?, TransactionDetailLogId = ?, Amount = ?, ReferenceNo = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM paymentmodetransactiondetail WHERE Id = ? AND TenantId = ?',
    },

    // Payment Detail Queries
    PAYMENT_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM paymentdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM paymentdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM paymentdetail WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO paymentdetail (Id, TenantId, PaymentReceivedTypeId, TransactionDetailLogId, Amount, PaymentDate, ReferenceNo, Remarks, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE paymentdetail SET PaymentReceivedTypeId = ?, TransactionDetailLogId = ?, Amount = ?, PaymentDate = ?, ReferenceNo = ?, Remarks = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentdetail WHERE Id = ? AND TenantId = ?',
    },

    // Payment Breakup Queries
    PAYMENT_BREAKUP: {
      SELECT_ALL:
        'SELECT * FROM paymentbreakup WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM paymentbreakup WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentbreakup WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO paymentbreakup (Id, TenantId, PaymentDetailId, PaymentModeId, Amount, ReferenceNo, Remarks, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE paymentbreakup SET PaymentDetailId = ?, PaymentModeId = ?, Amount = ?, ReferenceNo = ?, Remarks = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentbreakup WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Queries
    TRANSACTION_TYPE: {
      SELECT_ALL:
        'SELECT * FROM transactiontype WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM transactiontype WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontype WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO transactiontype (Id, TenantId, Name, Description, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
      UPDATE:
        'UPDATE transactiontype SET Name = ?, Description = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
        'INSERT INTO accounttypebase (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
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
};
