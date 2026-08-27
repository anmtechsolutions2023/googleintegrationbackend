// src/config/constants.js
// Centralized constants for queries, statuses, and other reusable strings
// Organized by domain/module for better maintainability and scalability

// ── Shared SQL fragments ─────────────────────────────────────────────────────
// Defined once, above the export, so the reports that share them cannot drift.
// They are static, whitelisted SQL — never user input — and are interpolated
// because MySQL cannot parameterise a projection or a GROUP BY expression.

/**
 * How a round is classified for reporting: where the sale happened.
 *
 * The TABLE wins over the order type, deliberately and in that order. A round
 * seated at a table is dine-in revenue whatever it was typed as, which is the
 * same rule that decides whether a counter token is issued at settle time — so
 * the report and the till cannot disagree about what a counter sale is.
 *
 * Requires `pos_order o` in scope.
 */
const CHANNEL_LABEL_SQL = `
  CASE
    WHEN o.TableId IS NOT NULL THEN 'Dine-in'
    WHEN LOWER(COALESCE(o.OrderType, '')) = 'takeaway' THEN 'Counter'
    WHEN LOWER(COALESCE(o.OrderType, '')) = 'delivery' THEN 'Delivery'
    ELSE 'Other'
  END`;

/**
 * Settled sale documents joined to the rounds they cover, apportioned.
 *
 * A bill covering several rounds is split between them by each round's share of
 * the bill (o.Total / SUM(o.Total)) — the same principle the pricing engine uses
 * to spread a discount. That is what makes any report built on this tie back to
 * the sales report to the paisa instead of merely looking plausible.
 *
 * Params, in order: tenantId (derived table), tenantId, transactionTypeName,
 * from, to. Shared by the venue and channel reports, which differ ONLY in what
 * they group by — duplicating this join is how two reports of the same money
 * start disagreeing.
 */
const APPORTIONED_SALE_ROUNDS_SQL = `
  FROM transactiondetaillog l
  JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
  JOIN transactiontype t       ON t.Id = l.TransactionTypeId
  JOIN pos_bill b        ON b.TransactionDetailLogId = l.Id AND b.TenantId = l.TenantId
  JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
  JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
  JOIN (
    SELECT bo2.BillId AS BillId, SUM(o2.Total) AS BillTotal
      FROM pos_bill_order bo2
      JOIN pos_order o2 ON o2.Id = bo2.OrderId AND o2.TenantId = bo2.TenantId
     WHERE bo2.TenantId = ?
     GROUP BY bo2.BillId
  ) bt ON bt.BillId = b.Id AND bt.BillTotal > 0
  WHERE l.TenantId = ? AND t.Name = ?
    AND l.TransactionDate BETWEEN ? AND ?
    AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')`;

/** The apportioned money columns every report over the above shares. */
const APPORTIONED_MONEY_SQL = `
  COUNT(DISTINCT o.Id)                          AS Orders,
  COUNT(DISTINCT l.Id)                          AS Bills,
  COALESCE(SUM(l.NetAmount      * o.Total / bt.BillTotal), 0) AS NetAmount,
  COALESCE(SUM(l.DiscountAmount * o.Total / bt.BillTotal), 0) AS DiscountAmount,
  COALESCE(SUM(l.TaxAmount      * o.Total / bt.BillTotal), 0) AS TaxAmount,
  COALESCE(SUM(l.GrossAmount    * o.Total / bt.BillTotal), 0) AS GrossAmount`;

module.exports = {
  QUERIES: {
    // User & Tenant Queries
    USER_TENANTS: {
      // Ordered by last_active_at so a member of several tenancies resumes
      // where they left off. Previously unordered, so tenantRows[0] — which
      // login uses as the active tenancy — could differ between logins.
      SELECT:
        'SELECT tenant_id, is_admin, is_super_admin, last_active_at FROM user_tenants WHERE user_email = ? AND is_active = TRUE ORDER BY last_active_at IS NULL, last_active_at DESC, tenant_id ASC',
      TOUCH_ACTIVE:
        'UPDATE user_tenants SET last_active_at = NOW() WHERE user_email = ? AND tenant_id = ?',
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
        'SELECT log_id, tenant_id, user_email, action, status, ip_address, log_level, category, resource_id, timestamp FROM audit_logs WHERE 1=1',
      COUNT:
        'SELECT COUNT(*) AS total FROM audit_logs WHERE 1=1',
      INSERT:
        'INSERT INTO audit_logs (tenant_id, user_email, action, status, ip_address, log_level, category, resource_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      INSERT_MIDDLEWARE:
        'INSERT INTO audit_logs (tenant_id, user_email, action, status, ip_address, log_level, category, resource_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    },

    // Tax Type Queries
    TAX_TYPES: {
      // Bulk import resolves a tax type by name before creating one: a whole
      // menu naming 'CGST' must produce a single CGST row, not one per item.
      SELECT_BY_NAME:
        'SELECT * FROM TaxTypes WHERE Name = ? AND TenantId = ? LIMIT 1',
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
      // Same get-or-create as CATEGORY above, keyed on UnitName.
      SELECT_BY_NAME:
        'SELECT * FROM UOM WHERE UnitName = ? AND TenantId = ? LIMIT 1',
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
      // Bulk import resolves a category by the name in the CSV before creating
      // one — 56 rows naming 'Tea' must produce a single category.
      SELECT_BY_NAME:
        'SELECT * FROM categorydetail WHERE Name = ? AND TenantId = ? LIMIT 1',
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
      SELECT_BY_TAGNAME:
        'SELECT * FROM transactiontypeconfig WHERE TagName = ? AND TenantId = ? LIMIT 1',
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
      SELECT_BY_NAME:
        'SELECT * FROM contactaddresstype WHERE Name = ? AND TenantId = ? LIMIT 1',
      INSERT:
        'INSERT INTO contactaddresstype (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE contactaddresstype SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM contactaddresstype WHERE Id = ? AND TenantId = ?',
    },

    // Tax Group Queries
    TAX_GROUP: {
      // A tax group resolved by name may exist with NO tax types mapped to it,
      // which computes 0% tax and looks like a working setup. The import
      // reports that back rather than silently pricing a menu at zero.
      SELECT_BY_NAME:
        'SELECT * FROM taxgroup WHERE Name = ? AND TenantId = ? LIMIT 1',
      COUNT_TYPES_IN_GROUP:
        'SELECT COUNT(*) AS total FROM taxgrouptaxtypemapper WHERE TaxGroupId = ? AND TenantId = ? AND Active = 1',
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
      // Guards the import against mapping the same type into the same group
      // twice — there is no unique key on the pair, so nothing else would.
      SELECT_BY_GROUP_AND_TYPE:
        'SELECT Id FROM taxgrouptaxtypemapper WHERE TaxGroupId = ? AND TaxTypeId = ? AND TenantId = ? LIMIT 1',
      // The rates a group actually holds, so an import can tell "you already
      // configured this, carry on" apart from "you are asking for something
      // different" — the difference between a re-run working and 56 rows failing.
      SELECT_COMPONENTS_OF_GROUP: `
        SELECT tt.Name, tt.Value
          FROM taxgrouptaxtypemapper m
          JOIN TaxTypes tt ON tt.Id = m.TaxTypeId
         WHERE m.TaxGroupId = ? AND m.TenantId = ? AND m.Active = 1`,
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
        LEFT JOIN branchdetail bd ON bugm.BranchDetailId = bd.Id AND bd.TenantId = bugm.TenantId
        WHERE bugm.TenantId = ? ORDER BY bugm.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM branchusergroupmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM branchusergroupmapper WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT bugm.*,
          bd.BranchName AS BranchName
        FROM branchusergroupmapper bugm
        LEFT JOIN branchdetail bd ON bugm.BranchDetailId = bd.Id AND bd.TenantId = bugm.TenantId
        WHERE bugm.Id = ? AND bugm.TenantId = ?`,
      INSERT:
        'INSERT INTO branchusergroupmapper (Id, TenantId, BranchDetailId, UserGroupId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE branchusergroupmapper SET BranchDetailId = ?, UserGroupId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
      // itemdetail.Name is UNIQUE per tenancy, so this decides skip-vs-update
      // on a re-run instead of letting the insert fail on the constraint.
      SELECT_BY_NAME:
        'SELECT * FROM itemdetail WHERE Name = ? AND TenantId = ? LIMIT 1',
      SELECT_ALL:
        'SELECT * FROM itemdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `SELECT t.*, cat.Name AS CategoryName, u.UnitName AS UOMName, ci.Amount AS CostAmount, ci.IsTaxIncluded AS CostIsTaxIncluded, tg.Name AS CostTaxGroupName FROM itemdetail t LEFT JOIN categorydetail cat ON t.CategoryId = cat.Id AND cat.TenantId = t.TenantId LEFT JOIN UOM u ON t.UOMId = u.Id AND u.TenantId = t.TenantId LEFT JOIN costinfo ci ON t.CostInfoId = ci.Id AND ci.TenantId = t.TenantId LEFT JOIN taxgroup tg ON ci.TaxGroupId = tg.Id AND tg.TenantId = t.TenantId WHERE t.TenantId = ?`,
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
        'INSERT INTO transactiontypebaseconversion (Id, TenantId, TransactionTypeConfigId, FromTransactionTypeStatusId, ToTransactionTypeStatusId, Tag, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontypebaseconversion SET TransactionTypeConfigId = ?, FromTransactionTypeStatusId = ?, ToTransactionTypeStatusId = ?, Tag = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
      // Priced line snapshots for one transaction log — used to total a payment
      // from what was actually invoiced rather than re-pricing it.
      SELECT_PRICED_BY_LOG:
        'SELECT Quantity, UnitPrice, NetAmount, TaxAmount, GrossAmount, TaxComponents FROM transactionitemdetail WHERE TransactionDetailLogId = ? AND TenantId = ? AND Active = 1',
      SELECT_ALL:
        'SELECT * FROM transactionitemdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT tid.*,
          tdl.TransactionNo, tdl.TransactionDate,
          i.Name AS ItemName, i.Code AS ItemCode, i.SKU AS ItemSKU
        FROM transactionitemdetail tid
        LEFT JOIN transactiondetaillog tdl ON tid.TransactionDetailLogId = tdl.Id AND tdl.TenantId = tid.TenantId
        LEFT JOIN itemdetail i ON tid.ItemId = i.Id AND i.TenantId = tid.TenantId
        WHERE tid.TenantId = ? ORDER BY tid.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM transactionitemdetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactionitemdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT tid.*,
          tdl.TransactionNo, tdl.TransactionDate,
          i.Name AS ItemName, i.Code AS ItemCode, i.SKU AS ItemSKU
        FROM transactionitemdetail tid
        LEFT JOIN transactiondetaillog tdl ON tid.TransactionDetailLogId = tdl.Id AND tdl.TenantId = tid.TenantId
        LEFT JOIN itemdetail i ON tid.ItemId = i.Id AND i.TenantId = tid.TenantId
        WHERE tid.Id = ? AND tid.TenantId = ?`,
      // The discount columns are named explicitly rather than left to the DDL
      // default. This endpoint prices without any discount concept, so the value
      // is 0 either way on insert — but naming it means an UPDATE carries the
      // ledger's figure forward instead of depending on the column simply not
      // being mentioned, which is what the SUM(line) = log invariant rests on.
      INSERT:
        'INSERT INTO transactionitemdetail (Id, TenantId, TransactionDetailLogId, LineNo, ItemId, Quantity, CostInfoId, UnitPrice, BasePrice, VariantAmount, NetAmount, DiscountAmount, ItemDiscountAmount, TaxAmount, GrossAmount, TaxComponents, Variants, Comment, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactionitemdetail SET TransactionDetailLogId = ?, LineNo = ?, ItemId = ?, Quantity = ?, CostInfoId = ?, UnitPrice = ?, BasePrice = ?, VariantAmount = ?, NetAmount = ?, DiscountAmount = ?, ItemDiscountAmount = ?, TaxAmount = ?, GrossAmount = ?, TaxComponents = ?, Variants = ?, Comment = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM transactionitemdetail WHERE Id = ? AND TenantId = ?',
    },

    // Transaction Type Conversion Mapper Queries
    TRANSACTION_TYPE_CONVERSION_MAPPER: {
      SELECT_ALL:
        'SELECT * FROM transactiontypeconversionmapper WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT ttcm.*,
          ttbc.TransactionTypeConfigId,
          tdl.TransactionNo, tdl.TransactionDate,
          tts.Name AS TransactionTypeStatusName
        FROM transactiontypeconversionmapper ttcm
        LEFT JOIN transactiontypebaseconversion ttbc ON ttcm.TransactionTypeBaseCoversionId = ttbc.Id AND ttbc.TenantId = ttcm.TenantId
        LEFT JOIN transactiondetaillog tdl ON ttcm.TransactionDetailLogId = tdl.Id AND tdl.TenantId = ttcm.TenantId
        LEFT JOIN transactiontypestatus tts ON ttcm.TransactionTypeStatusId = tts.Id AND tts.TenantId = ttcm.TenantId
        WHERE ttcm.TenantId = ? ORDER BY ttcm.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM transactiontypeconversionmapper WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM transactiontypeconversionmapper WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT ttcm.*,
          ttbc.TransactionTypeConfigId,
          tdl.TransactionNo, tdl.TransactionDate,
          tts.Name AS TransactionTypeStatusName
        FROM transactiontypeconversionmapper ttcm
        LEFT JOIN transactiontypebaseconversion ttbc ON ttcm.TransactionTypeBaseCoversionId = ttbc.Id AND ttbc.TenantId = ttcm.TenantId
        LEFT JOIN transactiondetaillog tdl ON ttcm.TransactionDetailLogId = tdl.Id AND tdl.TenantId = ttcm.TenantId
        LEFT JOIN transactiontypestatus tts ON ttcm.TransactionTypeStatusId = tts.Id AND tts.TenantId = ttcm.TenantId
        WHERE ttcm.Id = ? AND ttcm.TenantId = ?`,
      INSERT:
        'INSERT INTO transactiontypeconversionmapper (Id, TenantId, TransactionTypeBaseCoversionId, TransactionDetailLogId, TransactionTypeStatusId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE transactiontypeconversionmapper SET TransactionTypeBaseCoversionId = ?, TransactionDetailLogId = ?, TransactionTypeStatusId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
        'INSERT INTO paymentreceivedtype (Id, TenantId, Type, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentreceivedtype SET Type = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentreceivedtype WHERE Id = ? AND TenantId = ?',
    },

    // Payment Mode Queries
    PAYMENT_MODE: {
      SELECT_ALL:
        'SELECT * FROM paymentmode WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM paymentmode WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM paymentmode WHERE Id = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO paymentmode (Id, TenantId, Type, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentmode SET Type = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentmode WHERE Id = ? AND TenantId = ?',
    },

    // Payment Mode Transaction Detail Queries
    PAYMENT_MODE_TRANSACTION_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM paymentmodetransactiondetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT pmtd.*,
          pm.Type AS PaymentModeType
        FROM paymentmodetransactiondetail pmtd
        LEFT JOIN paymentmode pm ON pmtd.PaymentModeId = pm.Id AND pm.TenantId = pmtd.TenantId
        WHERE pmtd.TenantId = ? ORDER BY pmtd.CreatedOn DESC`,
      COUNT:
        'SELECT COUNT(*) as total FROM paymentmodetransactiondetail WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentmodetransactiondetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT pmtd.*,
          pm.Type AS PaymentModeType
        FROM paymentmodetransactiondetail pmtd
        LEFT JOIN paymentmode pm ON pmtd.PaymentModeId = pm.Id AND pm.TenantId = pmtd.TenantId
        WHERE pmtd.Id = ? AND pmtd.TenantId = ?`,
      INSERT:
        'INSERT INTO paymentmodetransactiondetail (Id, TenantId, PaymentModeId, RefNo, Comment, CF1, CF2, CF3, CF4, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentmodetransactiondetail SET PaymentModeId = ?, RefNo = ?, Comment = ?, CF1 = ?, CF2 = ?, CF3 = ?, CF4 = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE:
        'DELETE FROM paymentmodetransactiondetail WHERE Id = ? AND TenantId = ?',
    },

    // Payment Detail Queries
    PAYMENT_DETAIL: {
      SELECT_ALL:
        'SELECT * FROM paymentdetail WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT pd.*,
          atb.Name AS AccountTypeName,
          tdl.TransactionNo, tdl.TransactionDate
        FROM paymentdetail pd
        LEFT JOIN accounttypebase atb ON pd.AccountTypeBaseId = atb.Id AND atb.TenantId = pd.TenantId
        LEFT JOIN transactiondetaillog tdl ON pd.TransactionDetailLogId = tdl.Id AND tdl.TenantId = pd.TenantId
        WHERE pd.TenantId = ? ORDER BY pd.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM paymentdetail WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM paymentdetail WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT pd.*,
          atb.Name AS AccountTypeName,
          tdl.TransactionNo, tdl.TransactionDate
        FROM paymentdetail pd
        LEFT JOIN accounttypebase atb ON pd.AccountTypeBaseId = atb.Id AND atb.TenantId = pd.TenantId
        LEFT JOIN transactiondetaillog tdl ON pd.TransactionDetailLogId = tdl.Id AND tdl.TenantId = pd.TenantId
        WHERE pd.Id = ? AND pd.TenantId = ?`,
      INSERT:
        'INSERT INTO paymentdetail (Id, TenantId, AccountTypeBaseId, TransactionDetailLogId, DiscountAmount, RoundOff, TotalAmount, TaxesAmount, GrossAmount, UserId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentdetail SET AccountTypeBaseId = ?, TransactionDetailLogId = ?, DiscountAmount = ?, RoundOff = ?, TotalAmount = ?, TaxesAmount = ?, GrossAmount = ?, UserId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentdetail WHERE Id = ? AND TenantId = ?',
    },

    // Payment Breakup Queries
    PAYMENT_BREAKUP: {
      SELECT_ALL:
        'SELECT * FROM paymentbreakup WHERE TenantId = ? ORDER BY CreatedOn DESC',
      SELECT_ALL_WITH_DETAILS: `
        SELECT pb.*,
          atb.Name AS AccountTypeName,
          pd.TotalAmount, pd.GrossAmount,
          pmt.RefNo AS PaymentModeRefNo,
          prt.Type AS PaymentReceivedTypeName
        FROM paymentbreakup pb
        LEFT JOIN accounttypebase atb ON pb.AccountTypeBaseId = atb.Id AND atb.TenantId = pb.TenantId
        LEFT JOIN paymentdetail pd ON pb.PaymentDetailId = pd.Id AND pd.TenantId = pb.TenantId
        LEFT JOIN paymentmodetransactiondetail pmt ON pb.PaymentModeTransactionDetailId = pmt.Id AND pmt.TenantId = pb.TenantId
        LEFT JOIN paymentreceivedtype prt ON pb.PaymentReceivedTypeId = prt.Id AND prt.TenantId = pb.TenantId
        WHERE pb.TenantId = ? ORDER BY pb.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM paymentbreakup WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT * FROM paymentbreakup WHERE Id = ? AND TenantId = ?',
      SELECT_BY_ID_WITH_DETAILS: `
        SELECT pb.*,
          atb.Name AS AccountTypeName,
          pd.TotalAmount, pd.GrossAmount,
          pmt.RefNo AS PaymentModeRefNo,
          prt.Type AS PaymentReceivedTypeName
        FROM paymentbreakup pb
        LEFT JOIN accounttypebase atb ON pb.AccountTypeBaseId = atb.Id AND atb.TenantId = pb.TenantId
        LEFT JOIN paymentdetail pd ON pb.PaymentDetailId = pd.Id AND pd.TenantId = pb.TenantId
        LEFT JOIN paymentmodetransactiondetail pmt ON pb.PaymentModeTransactionDetailId = pmt.Id AND pmt.TenantId = pb.TenantId
        LEFT JOIN paymentreceivedtype prt ON pb.PaymentReceivedTypeId = prt.Id AND prt.TenantId = pb.TenantId
        WHERE pb.Id = ? AND pb.TenantId = ?`,
      INSERT:
        'INSERT INTO paymentbreakup (Id, TenantId, AccountTypeBaseId, PaymentDetailId, PaymentModeTransactionDetailId, PaymentReceivedTypeId, Amount, UserId, Timestamp, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentbreakup SET AccountTypeBaseId = ?, PaymentDetailId = ?, PaymentModeTransactionDetailId = ?, PaymentReceivedTypeId = ?, Amount = ?, UserId = ?, Timestamp = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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

    // ── POS (Front Desk) modules ──────────────────────────────────────────
    POS_FLOOR: {
      SELECT_ALL: 'SELECT * FROM pos_floor WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_floor WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_floor WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_floor (Id, TenantId, Name, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_floor SET Name = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_floor WHERE Id = ? AND TenantId = ?',
    },

    POS_TABLE: {
      SELECT_ALL: 'SELECT * FROM pos_table WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_table WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_table WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_table (Id, TenantId, Name, FloorId, Capacity, Status, CurrentOrderId, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_table SET Name = ?, FloorId = ?, Capacity = ?, Status = ?, CurrentOrderId = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_table WHERE Id = ? AND TenantId = ?',
    },

    POS_CHANNEL: {
      SELECT_ALL: 'SELECT * FROM pos_channel WHERE TenantId = ? ORDER BY SortOrder ASC, CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_channel WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_channel WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_channel (Id, TenantId, Name, Code, Description, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_channel SET Name = ?, Code = ?, Description = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_channel WHERE Id = ? AND TenantId = ?',
    },

    POS_VARIANT: {
      SELECT_ALL: 'SELECT * FROM pos_variant WHERE TenantId = ? ORDER BY SortOrder ASC, CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_variant WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_variant WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_variant (Id, TenantId, Name, Code, Description, SortOrder, Price, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_variant SET Name = ?, Code = ?, Description = ?, SortOrder = ?, Price = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_variant WHERE Id = ? AND TenantId = ?',
    },

    POS_FOOD_TYPE: {
      // The CSV names a food type by CODE (VEG / VEGAN / NONVEG), which is
      // the column UNIQUE (Code, TenantId) is on.
      SELECT_BY_CODE:
        'SELECT * FROM pos_food_type WHERE Code = ? AND TenantId = ? LIMIT 1',
      // A CSV says 'Non-Veg' (the NAME) where the code is 'NONVEG'. Matching on
      // code alone silently failed for exactly that value, so both columns are
      // fetched and compared after punctuation is stripped, in JS — SQL cannot
      // normalise the two sides consistently across collations.
      SELECT_ALL_FOR_TENANT:
        'SELECT Id, Name, Code FROM pos_food_type WHERE TenantId = ? AND Active = 1',
      SELECT_ALL: 'SELECT * FROM pos_food_type WHERE TenantId = ? ORDER BY SortOrder ASC, CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_food_type WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_food_type WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_food_type (Id, TenantId, Name, Code, Description, SortOrder, IsVeg, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_food_type SET Name = ?, Code = ?, Description = ?, SortOrder = ?, IsVeg = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_food_type WHERE Id = ? AND TenantId = ?',
    },

    POS_ITEM_META: {
      // UNIQUE (ItemDetailId, BranchDetailId, TenantId) — the publish pass
      // checks this so a re-run reports 'already on the menu' rather than
      // failing on the constraint.
      SELECT_BY_ITEM_BRANCH:
        'SELECT Id FROM pos_item_meta WHERE ItemDetailId = ? AND BranchDetailId = ? AND TenantId = ? LIMIT 1',
      // SELECT_ALL/SELECT_BY_ID aggregate linked channel/variant ids and the
      // linked costinfo amount so the client can pre-select and price.
      SELECT_ALL: `SELECT im.*,
          (SELECT JSON_ARRAYAGG(c.ChannelId) FROM pos_item_meta_channel c WHERE c.ItemMetaId = im.Id) AS ChannelIds,
          (SELECT JSON_ARRAYAGG(v.VariantId) FROM pos_item_meta_variant v WHERE v.ItemMetaId = im.Id) AS VariantIds,
          ci.Amount AS CostInfoAmount,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg
        FROM pos_item_meta im
        LEFT JOIN costinfo ci ON ci.Id = im.CostInfoId
        LEFT JOIN pos_food_type ft ON ft.Id = im.FoodTypeId
        WHERE im.TenantId = ? ORDER BY im.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_item_meta WHERE TenantId = ?',
      SELECT_BY_ID: `SELECT im.*,
          (SELECT JSON_ARRAYAGG(c.ChannelId) FROM pos_item_meta_channel c WHERE c.ItemMetaId = im.Id) AS ChannelIds,
          (SELECT JSON_ARRAYAGG(v.VariantId) FROM pos_item_meta_variant v WHERE v.ItemMetaId = im.Id) AS VariantIds,
          ci.Amount AS CostInfoAmount,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg
        FROM pos_item_meta im
        LEFT JOIN costinfo ci ON ci.Id = im.CostInfoId
        LEFT JOIN pos_food_type ft ON ft.Id = im.FoodTypeId
        WHERE im.Id = ? AND im.TenantId = ?`,
      INSERT: 'INSERT INTO pos_item_meta (Id, TenantId, ItemDetailId, FoodTypeId, CostInfoId, Channels, Prices, Variants, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_item_meta SET ItemDetailId = ?, FoodTypeId = ?, CostInfoId = ?, Channels = ?, Prices = ?, Variants = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_item_meta WHERE Id = ? AND TenantId = ?',
      // Order lines reference a menu row; pricing needs the cost record it
      // points at. Batched so an order costs one lookup, not one per line.
      SELECT_COSTINFO_BY_IDS:
        'SELECT Id, CostInfoId FROM pos_item_meta WHERE TenantId = ? AND Id IN (:ids)',
      // Selected variants are a flat surcharge on the item price. Resolved
      // server-side so a client cannot dictate what a variant costs.
      SELECT_VARIANT_PRICES_BY_IDS:
        'SELECT Id, Name, Code, Price FROM pos_variant WHERE TenantId = ? AND Active = 1 AND Id IN (:ids)',
      // Join-table sync helpers (channels + variants)
      DELETE_CHANNEL_LINKS: 'DELETE FROM pos_item_meta_channel WHERE ItemMetaId = ? AND TenantId = ?',
      INSERT_CHANNEL_LINK: 'INSERT INTO pos_item_meta_channel (Id, ItemMetaId, ChannelId, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?)',
      DELETE_VARIANT_LINKS: 'DELETE FROM pos_item_meta_variant WHERE ItemMetaId = ? AND TenantId = ?',
      INSERT_VARIANT_LINK: 'INSERT INTO pos_item_meta_variant (Id, ItemMetaId, VariantId, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?)',
    },

    // Which orders (rounds) a bill covers. pos_bill.OrderId only ever held the
    // first round, so the join table is the truth for recomputing a bill.
    POS_BILL_ORDER: {
      INSERT:
        'INSERT INTO pos_bill_order (Id, BillId, OrderId, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?)',
      DELETE_BY_BILL: 'DELETE FROM pos_bill_order WHERE BillId = ? AND TenantId = ?',
      SELECT_ORDER_IDS:
        'SELECT OrderId FROM pos_bill_order WHERE BillId = ? AND TenantId = ? ORDER BY CreatedOn ASC',
      // The priced line snapshots of every round on the bill, in one query.
      SELECT_ORDER_ITEMS:
        'SELECT Id, Items FROM pos_order WHERE TenantId = ? AND Id IN (:ids)',
    },

    POS_CUSTOMER: {
      SELECT_ALL: 'SELECT * FROM pos_customer WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_customer WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_customer WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_customer (Id, TenantId, Name, Phone, Email, Visits, TotalSpent, LoyaltyPoints, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_customer SET Name = ?, Phone = ?, Email = ?, Visits = ?, TotalSpent = ?, LoyaltyPoints = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_customer WHERE Id = ? AND TenantId = ?',

      // The till's lookup: find a regular by the number they give at the
      // counter, or by name. Phone first because that is what a customer
      // actually recites, and it is the column with the UNIQUE key.
      SEARCH: `
        SELECT Id, Name, Phone, Email, Visits, TotalSpent, LoyaltyPoints, LastVisitAt
          FROM pos_customer
         WHERE TenantId = ? AND Active = 1
           AND (Phone LIKE ? OR Name LIKE ?)
         ORDER BY (Phone = ?) DESC, LastVisitAt DESC, Name ASC
         LIMIT 10`,
      SELECT_BY_PHONE: 'SELECT * FROM pos_customer WHERE Phone = ? AND TenantId = ? LIMIT 1',

      // The CRM projection, incremented on the settle path. See
      // poscustomer.stats.service for why this increments rather than
      // recomputes, and why it runs on the settle transaction.
      RECORD_SALE: `
        UPDATE pos_customer
           SET Visits        = Visits + 1,
               TotalSpent    = TotalSpent + ?,
               LastVisitAt   = NOW(),
               UpdatedOn     = NOW(),
               UpdatedBy     = ?
         WHERE Id = ? AND TenantId = ?`,
      // Refund. Visits and spend are floored at zero: a projection that has
      // drifted must not be driven negative by a correction, and a customer
      // with -1 visits is a worse answer than one with 0.
      // A FULL return: the sale is entirely undone, so the visit comes off
      // with the spend.
      REVERSE_SALE: `
        UPDATE pos_customer
           SET Visits     = GREATEST(Visits - 1, 0),
               TotalSpent = GREATEST(TotalSpent - ?, 0),
               UpdatedOn  = NOW(),
               UpdatedBy  = ?
         WHERE Id = ? AND TenantId = ?`,
      // A PARTIAL return: value only.
      //
      // Returning one item from a four-item dinner did not un-happen the visit.
      // The old statement decremented Visits unconditionally, so a customer who
      // sent back a single naan lost a whole visit from their history — and
      // three partial returns could take three visits for one meal.
      REVERSE_SALE_VALUE_ONLY: `
        UPDATE pos_customer
           SET TotalSpent = GREATEST(TotalSpent - ?, 0),
               UpdatedOn  = NOW(),
               UpdatedBy  = ?
         WHERE Id = ? AND TenantId = ?`,
      // The points cache, moved by the loyalty ledger and nothing else.
      ADJUST_POINTS: `
        UPDATE pos_customer
           SET LoyaltyPoints = GREATEST(LoyaltyPoints + ?, 0),
               UpdatedOn     = NOW(),
               UpdatedBy     = ?
         WHERE Id = ? AND TenantId = ?`,

      // One customer's history: every round they have ordered, with the token
      // or table it was served at and the invoice it was billed on. This is
      // what turns a name in a list into a profile.
      ORDER_HISTORY: `
        SELECT o.Id AS OrderId, o.OrderNo, o.OrderType, o.Status, o.Total,
               o.CreatedOn, o.TableName, tk.TokenLabel,
               l.TransactionNo, s.Name AS LedgerStatus
          FROM pos_order o
          LEFT JOIN pos_token tk ON tk.OrderId = o.Id AND tk.TenantId = o.TenantId
          LEFT JOIN pos_bill_order bo ON bo.OrderId = o.Id AND bo.TenantId = o.TenantId
          LEFT JOIN pos_bill b ON b.Id = bo.BillId AND b.TenantId = bo.TenantId
          LEFT JOIN transactiondetaillog l ON l.Id = b.TransactionDetailLogId
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE o.CustomerId = ? AND o.TenantId = ?
         ORDER BY o.CreatedOn DESC
         LIMIT 50`,

      // What they said about those visits.
      FEEDBACK_HISTORY: `
        SELECT f.Id, f.Rating, f.Comments, f.CreatedOn, f.OrderId, o.OrderNo
          FROM pos_feedback f
          LEFT JOIN pos_order o ON o.Id = f.OrderId AND o.TenantId = f.TenantId
         WHERE f.CustomerId = ? AND f.TenantId = ?
         ORDER BY f.CreatedOn DESC
         LIMIT 50`,
    },

    POS_ORDER: {
      SELECT_ALL: 'SELECT * FROM pos_order WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_order WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_order WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_order (Id, TenantId, OrderNo, TableId, CustomerId, OrderType, ChannelId, Status, Items, SubTotal, TaxAmount, Total, BranchDetailId, TableName, FloorId, FloorName, TableCapacity, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_order SET OrderNo = ?, TableId = ?, CustomerId = ?, OrderType = ?, ChannelId = ?, Status = ?, Items = ?, SubTotal = ?, TaxAmount = ?, Total = ?, BranchDetailId = ?, TableName = ?, FloorId = ?, FloorName = ?, TableCapacity = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_order WHERE Id = ? AND TenantId = ?',
      // Domain action helper: update order status (e.g. after firing a KOT)
      SET_STATUS: 'UPDATE pos_order SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
    },

    POS_KOT: {
      SELECT_ALL: 'SELECT * FROM pos_kot WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_kot WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_kot WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_kot (Id, TenantId, KotNo, OrderId, TableId, Items, Status, FiredAt, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_kot SET KotNo = ?, OrderId = ?, TableId = ?, Items = ?, Status = ?, FiredAt = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_kot WHERE Id = ? AND TenantId = ?',
      // Domain action: mark a KOT ready (KDS)
      SET_STATUS: 'UPDATE pos_kot SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
    },

    POS_BILL: {
      SELECT_ALL: 'SELECT * FROM pos_bill WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_bill WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_bill WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_bill (Id, TenantId, BillNo, OrderId, SubTotal, TaxAmount, Discount, LineDiscounts, Total, Payments, Status, SettledAt, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_bill SET BillNo = ?, OrderId = ?, SubTotal = ?, TaxAmount = ?, Discount = ?, LineDiscounts = ?, Total = ?, Payments = ?, Status = ?, SettledAt = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_bill WHERE Id = ? AND TenantId = ?',
      // Domain action: settle a bill (record payments, mark paid). LineDiscounts
      // moves too — a settle may revise which dishes were discounted.
      SETTLE: 'UPDATE pos_bill SET Payments = ?, Discount = ?, LineDiscounts = ?, Total = ?, Status = ?, SettledAt = NOW(), UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // Settle re-prices the bill (discount before tax), so SubTotal/TaxAmount
      // move too — SETTLE alone only carries the payable Total.
      UPDATE_TOTALS:
        'UPDATE pos_bill SET SubTotal = ?, TaxAmount = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
    },

    // ── Portals: the aggregators that sell on our behalf ──────────────────
    //
    // A portal is a SELLER ON A CHANNEL, not a channel. See the table comment
    // in 01-schema-definition.sql §4.12c for why the two are separate.
    // Why goods came back. A CRUD master, mirroring expense_category.
    POS_RETURN_REASON: {
      SELECT_ALL: 'SELECT * FROM pos_return_reason WHERE TenantId = ? ORDER BY SortOrder ASC, Name ASC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_return_reason WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_return_reason WHERE Id = ? AND TenantId = ?',
      SELECT_BY_CODE: 'SELECT * FROM pos_return_reason WHERE Code = ? AND TenantId = ? LIMIT 1',
      INSERT:
        'INSERT INTO pos_return_reason (Id, TenantId, Name, Code, Description, IsFault, SortOrder, '
        + 'Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_return_reason SET Name = ?, Code = ?, Description = ?, IsFault = ?, '
        + 'SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_return_reason WHERE Id = ? AND TenantId = ?',
    },

    // An intent to notify, made durable inside the transaction that caused it.
    // There is no worker yet — see the table comment for why the rows are
    // written anyway.
    NOTIFICATION_OUTBOX: {
      INSERT:
        'INSERT INTO notification_outbox (Id, TenantId, EventType, Audience, SourceType, SourceId, '
        + 'Payload, Status, Attempts, AvailableOn, Active, CreatedOn, CreatedBy, UpdatedBy) '
        + "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), 1, NOW(), ?, ?)",
      SELECT_ALL:
        'SELECT * FROM notification_outbox WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM notification_outbox WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM notification_outbox WHERE Id = ? AND TenantId = ?',
      SELECT_BY_SOURCE:
        'SELECT * FROM notification_outbox WHERE TenantId = ? AND SourceType = ? AND SourceId = ? '
        + 'ORDER BY CreatedOn ASC',
    },

    POS_PORTAL: {
      SELECT_ALL: 'SELECT * FROM pos_portal WHERE TenantId = ? ORDER BY SortOrder ASC, Name ASC',
      // The queue needs the channel's name to say what a portal sells on, and
      // counts of its open orders and live listings — one query, not N.
      SELECT_ALL_WITH_DETAILS:
        'SELECT p.*, c.Name AS ChannelName, c.Code AS ChannelCode, ' +
        '(SELECT COUNT(*) FROM pos_portal_listing l WHERE l.PortalId = p.Id AND l.TenantId = p.TenantId AND l.Active = 1) AS ListingCount, ' +
        "(SELECT COUNT(*) FROM pos_portal_listing l WHERE l.PortalId = p.Id AND l.TenantId = p.TenantId AND l.Active = 1 AND l.SyncStatus <> 'synced') AS UnsyncedCount, " +
        "(SELECT COUNT(*) FROM pos_online_order o WHERE o.PortalId = p.Id AND o.TenantId = p.TenantId AND o.Active = 1 AND o.Status IN ('new','accepted','processing','out for delivery')) AS OpenOrderCount " +
        'FROM pos_portal p LEFT JOIN pos_channel c ON c.Id = p.ChannelId AND c.TenantId = p.TenantId ' +
        'WHERE p.TenantId = ? ORDER BY p.SortOrder ASC, p.Name ASC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_portal WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_portal WHERE Id = ? AND TenantId = ?',
      SELECT_BY_CODE: 'SELECT * FROM pos_portal WHERE Code = ? AND TenantId = ? LIMIT 1',
      // The webhook has no tenant: it resolves one FROM the portal it matched.
      // Deliberately code-only, and the caller must still verify the signature
      // before trusting the row.
      SELECT_ALL_BY_CODE: 'SELECT * FROM pos_portal WHERE Code = ? AND Active = 1',
      INSERT:
        'INSERT INTO pos_portal (Id, TenantId, Name, Code, ChannelId, Adapter, ColorHex, ShortCode, ' +
        'CommissionPct, CommissionAccountTypeBaseId, SettlementPaymentModeId, SortOrder, Active, ' +
        'CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_portal SET Name = ?, Code = ?, ChannelId = ?, Adapter = ?, ColorHex = ?, ShortCode = ?, ' +
        'CommissionPct = ?, CommissionAccountTypeBaseId = ?, SettlementPaymentModeId = ?, SortOrder = ?, ' +
        'Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_portal WHERE Id = ? AND TenantId = ?',
    },

    POS_PORTAL_BRANCH: {
      SELECT_ALL:
        'SELECT pb.*, b.BranchName, p.Name AS PortalName, p.Code AS PortalCode, p.ColorHex, p.ShortCode ' +
        'FROM pos_portal_branch pb ' +
        'LEFT JOIN branchdetail b ON b.Id = pb.BranchDetailId AND b.TenantId = pb.TenantId ' +
        'LEFT JOIN pos_portal p ON p.Id = pb.PortalId AND p.TenantId = pb.TenantId ' +
        'WHERE pb.TenantId = ? ORDER BY p.SortOrder ASC, b.BranchName ASC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_portal_branch WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_portal_branch WHERE Id = ? AND TenantId = ?',
      SELECT_BY_PORTAL:
        'SELECT pb.*, b.BranchName FROM pos_portal_branch pb ' +
        'LEFT JOIN branchdetail b ON b.Id = pb.BranchDetailId AND b.TenantId = pb.TenantId ' +
        'WHERE pb.PortalId = ? AND pb.TenantId = ? ORDER BY b.BranchName ASC',
      // How an inbound order finds its branch.
      SELECT_BY_EXTERNAL_STORE:
        'SELECT * FROM pos_portal_branch WHERE PortalId = ? AND ExternalStoreId = ? AND TenantId = ? LIMIT 1',
      INSERT:
        'INSERT INTO pos_portal_branch (Id, TenantId, PortalId, BranchDetailId, ExternalStoreId, ' +
        'IsOnline, PausedUntil, PauseReason, Active, CreatedOn, CreatedBy, UpdatedBy) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_portal_branch SET PortalId = ?, BranchDetailId = ?, ExternalStoreId = ?, ' +
        'IsOnline = ?, PausedUntil = ?, PauseReason = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? ' +
        'WHERE Id = ? AND TenantId = ?',
      // The kill switch, as its own statement: pausing must not require sending
      // every other column back and risk overwriting one.
      SET_ONLINE:
        'UPDATE pos_portal_branch SET IsOnline = ?, PausedUntil = ?, PauseReason = ?, ' +
        'UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_portal_branch WHERE Id = ? AND TenantId = ?',
    },

    POS_PORTAL_LISTING: {
      // Listings always read with the item they list — a matrix of uuids is
      // unusable, and the effective price needs the inherited cost anyway.
      SELECT_ALL:
        'SELECT l.*, i.Name AS ItemName, i.Code AS ItemCode, im.ItemDetailId, im.BranchDetailId, ' +
        'im.CostInfoId AS BaseCostInfoId, bc.Amount AS BaseAmount, oc.Amount AS OverrideAmount, ' +
        'p.Name AS PortalName, p.Code AS PortalCode ' +
        'FROM pos_portal_listing l ' +
        'JOIN pos_item_meta im ON im.Id = l.ItemMetaId AND im.TenantId = l.TenantId ' +
        'LEFT JOIN itemdetail i ON i.Id = im.ItemDetailId AND i.TenantId = im.TenantId ' +
        'LEFT JOIN costinfo bc ON bc.Id = im.CostInfoId AND bc.TenantId = im.TenantId ' +
        'LEFT JOIN costinfo oc ON oc.Id = l.PriceOverrideCostInfoId AND oc.TenantId = l.TenantId ' +
        'LEFT JOIN pos_portal p ON p.Id = l.PortalId AND p.TenantId = l.TenantId ' +
        'WHERE l.TenantId = ? ORDER BY l.SortOrder ASC, i.Name ASC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_portal_listing WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_portal_listing WHERE Id = ? AND TenantId = ?',
      SELECT_BY_PORTAL_ITEM:
        'SELECT * FROM pos_portal_listing WHERE PortalId = ? AND ItemMetaId = ? AND TenantId = ? LIMIT 1',
      // How an inbound order line finds our menu item.
      SELECT_BY_EXTERNAL_ITEM:
        'SELECT l.*, im.ItemDetailId, im.CostInfoId AS BaseCostInfoId ' +
        'FROM pos_portal_listing l ' +
        'JOIN pos_item_meta im ON im.Id = l.ItemMetaId AND im.TenantId = l.TenantId ' +
        'WHERE l.PortalId = ? AND l.ExternalItemId = ? AND l.TenantId = ? LIMIT 1',
      INSERT:
        'INSERT INTO pos_portal_listing (Id, TenantId, PortalId, ItemMetaId, ExternalItemId, ListedName, ' +
        'ListedDescription, PriceOverrideCostInfoId, Available, SortOrder, LastSyncedOn, SyncStatus, ' +
        'SyncError, Active, CreatedOn, CreatedBy, UpdatedBy) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_portal_listing SET PortalId = ?, ItemMetaId = ?, ExternalItemId = ?, ListedName = ?, ' +
        'ListedDescription = ?, PriceOverrideCostInfoId = ?, Available = ?, SortOrder = ?, ' +
        'LastSyncedOn = ?, SyncStatus = ?, SyncError = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? ' +
        'WHERE Id = ? AND TenantId = ?',
      // Bulk availability: what counter staff actually do, several times a day.
      // Editing 200 rows one PUT at a time is not a workflow.
      SET_AVAILABILITY:
        "UPDATE pos_portal_listing SET Available = ?, SyncStatus = 'pending', UpdatedOn = NOW(), " +
        'UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      MARK_SYNCED:
        'UPDATE pos_portal_listing SET LastSyncedOn = NOW(), SyncStatus = ?, SyncError = ?, ' +
        'UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_portal_listing WHERE Id = ? AND TenantId = ?',
      // The channel gate: a listing may only exist for an item that is sold on
      // the portal's channel at all. Coarse switch first, fine switch second.
      COUNT_CHANNEL_LINK:
        'SELECT COUNT(*) AS total FROM pos_item_meta_channel ' +
        'WHERE ItemMetaId = ? AND ChannelId = ? AND TenantId = ? AND Active = 1',
    },

    POS_PORTAL_CREDENTIAL: {
      SELECT_BY_PORTAL: 'SELECT * FROM pos_portal_credential WHERE PortalId = ? AND TenantId = ? LIMIT 1',
      // Webhook path: the portal row is already matched by code; this fetches the
      // secret to verify against. No tenant, because resolving one is the point.
      SELECT_FOR_VERIFY:
        'SELECT c.*, p.Id AS PortalId, p.Code AS PortalCode, p.Adapter, p.TenantId ' +
        'FROM pos_portal_credential c JOIN pos_portal p ON p.Id = c.PortalId AND p.TenantId = c.TenantId ' +
        'WHERE p.Code = ? AND p.Active = 1 AND c.Active = 1',
      INSERT:
        'INSERT INTO pos_portal_credential (Id, TenantId, PortalId, WebhookSecret, ApiKey, ApiSecret, ' +
        'ApiBaseUrl, TokenExpiresOn, Active, CreatedOn, CreatedBy, UpdatedBy) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_portal_credential SET WebhookSecret = ?, ApiKey = ?, ApiSecret = ?, ApiBaseUrl = ?, ' +
        'TokenExpiresOn = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_portal_credential WHERE PortalId = ? AND TenantId = ?',
    },

    POS_PORTAL_EVENT: {
      SELECT_ALL:
        'SELECT e.*, p.Name AS PortalName FROM pos_portal_event e ' +
        'LEFT JOIN pos_portal p ON p.Id = e.PortalId AND p.TenantId = e.TenantId ' +
        'WHERE e.TenantId = ? ORDER BY e.ReceivedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_portal_event WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_portal_event WHERE Id = ? AND TenantId = ?',
      // The idempotency lookup. Runs BEFORE any work: a byte-identical replay
      // must not create a second order, a second KOT and a second posting.
      SELECT_DUPLICATE:
        'SELECT Id, OnlineOrderId, ProcessingStatus FROM pos_portal_event ' +
        'WHERE PortalId = ? AND ExternalRef <=> ? AND EventType = ? AND PayloadHash = ? AND TenantId = ? LIMIT 1',
      INSERT:
        'INSERT INTO pos_portal_event (Id, TenantId, PortalId, ExternalRef, EventType, PayloadHash, ' +
        'RawPayload, ProcessingStatus, ProcessingError, OnlineOrderId, ReceivedOn, ProcessedOn, Active, ' +
        'CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), ?, ?)',
      MARK_PROCESSED:
        'UPDATE pos_portal_event SET ProcessingStatus = ?, ProcessingError = ?, OnlineOrderId = ?, ' +
        'ProcessedOn = NOW(), UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_portal_event WHERE Id = ? AND TenantId = ?',
    },

    POS_ONLINE_ORDER: {
      // Reads carry the portal's identity so the queue can draw the colour rail
      // and monogram from DATA rather than a switch on a platform string, and
      // the linked order/KOT so a card can show what the kitchen is doing.
      SELECT_ALL:
        'SELECT o.*, p.Name AS PortalName, p.Code AS PortalCode, p.ColorHex, p.ShortCode, ' +
        'p.CommissionPct, b.BranchName, ord.OrderNo, ord.Status AS OrderStatus ' +
        'FROM pos_online_order o ' +
        'LEFT JOIN pos_portal p ON p.Id = o.PortalId AND p.TenantId = o.TenantId ' +
        'LEFT JOIN branchdetail b ON b.Id = o.BranchDetailId AND b.TenantId = o.TenantId ' +
        'LEFT JOIN pos_order ord ON ord.Id = o.OrderId AND ord.TenantId = o.TenantId ' +
        'WHERE o.TenantId = ? ORDER BY o.CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_online_order WHERE TenantId = ?',
      SELECT_BY_ID:
        'SELECT o.*, p.Name AS PortalName, p.Code AS PortalCode, p.ColorHex, p.ShortCode, ' +
        'p.CommissionPct, p.SettlementPaymentModeId, p.CommissionAccountTypeBaseId, ' +
        'b.BranchName, ord.OrderNo, ord.Status AS OrderStatus ' +
        'FROM pos_online_order o ' +
        'LEFT JOIN pos_portal p ON p.Id = o.PortalId AND p.TenantId = o.TenantId ' +
        'LEFT JOIN branchdetail b ON b.Id = o.BranchDetailId AND b.TenantId = o.TenantId ' +
        'LEFT JOIN pos_order ord ON ord.Id = o.OrderId AND ord.TenantId = o.TenantId ' +
        'WHERE o.Id = ? AND o.TenantId = ?',
      // The raw row, without joins — for writes that read-modify-write and must
      // not have joined columns echoed back into an UPDATE.
      SELECT_RAW_BY_ID: 'SELECT * FROM pos_online_order WHERE Id = ? AND TenantId = ?',
      SELECT_BY_EXTERNAL_REF:
        'SELECT * FROM pos_online_order WHERE PortalId = ? AND ExternalRef = ? AND TenantId = ? LIMIT 1',
      INSERT:
        'INSERT INTO pos_online_order (Id, TenantId, PortalId, Platform, OrderId, PortalBranchId, ' +
        'ExternalRef, Status, Payload, OrderLines, HasUnmappedLines, CustomerName, CustomerPhone, ' +
        'ExternalCustomerRef, ItemsTotal, PortalDiscount, PackingCharge, DeliveryCharge, TaxAmount, ' +
        'GrossAmount, CommissionAmount, NetPayout, IsPrepaid, PlacedOn, PromisedOn, AcceptedOn, ReadyOn, ' +
        'PickedUpOn, DeliveredOn, RiderName, RiderPhone, CancelReason, CancelledBy, BranchDetailId, ' +
        'Active, CreatedOn, CreatedBy, UpdatedBy) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_online_order SET PortalId = ?, Platform = ?, OrderId = ?, PortalBranchId = ?, ' +
        'ExternalRef = ?, Status = ?, Payload = ?, OrderLines = ?, HasUnmappedLines = ?, CustomerName = ?, ' +
        'CustomerPhone = ?, ExternalCustomerRef = ?, ItemsTotal = ?, PortalDiscount = ?, PackingCharge = ?, ' +
        'DeliveryCharge = ?, TaxAmount = ?, GrossAmount = ?, CommissionAmount = ?, NetPayout = ?, ' +
        'IsPrepaid = ?, PlacedOn = ?, PromisedOn = ?, AcceptedOn = ?, ReadyOn = ?, PickedUpOn = ?, ' +
        'DeliveredOn = ?, RiderName = ?, RiderPhone = ?, CancelReason = ?, CancelledBy = ?, ' +
        'BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // Lifecycle moves, as their own statements. A status change must not have
      // to send 30 other columns back and risk overwriting one of them.
      SET_ACCEPTED:
        "UPDATE pos_online_order SET Status = 'accepted', OrderId = ?, AcceptedOn = NOW(), " +
        'UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SET_STATUS:
        'UPDATE pos_online_order SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? ' +
        'WHERE Id = ? AND TenantId = ?',
      SET_READY:
        "UPDATE pos_online_order SET Status = 'processing', ReadyOn = NOW(), UpdatedOn = NOW(), " +
        'UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SET_DELIVERED:
        "UPDATE pos_online_order SET Status = 'delivered', DeliveredOn = NOW(), UpdatedOn = NOW(), " +
        'UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SET_CANCELLED:
        "UPDATE pos_online_order SET Status = 'cancelled', CancelReason = ?, CancelledBy = ?, " +
        'UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_online_order WHERE Id = ? AND TenantId = ?',
    },

    POS_FEEDBACK: {
      // The order and the customer are joined in: a rating that cannot name the
      // visit it describes is an opinion with no context, which is what this
      // table held before OrderId existed.
      SELECT_ALL: `
        SELECT f.*, o.OrderNo, o.OrderType, o.TableName, o.Total AS OrderTotal,
               tk.TokenLabel, c.Name AS LinkedCustomerName, c.Phone AS CustomerPhone
          FROM pos_feedback f
          LEFT JOIN pos_order o    ON o.Id = f.OrderId AND o.TenantId = f.TenantId
          LEFT JOIN pos_token tk   ON tk.OrderId = o.Id AND tk.TenantId = o.TenantId
          LEFT JOIN pos_customer c ON c.Id = f.CustomerId AND c.TenantId = f.TenantId
         WHERE f.TenantId = ? ORDER BY f.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_feedback WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_feedback WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_feedback (Id, TenantId, CustomerId, CustomerName, Rating, Comments, OrderId, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_feedback SET CustomerId = ?, CustomerName = ?, Rating = ?, Comments = ?, OrderId = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_feedback WHERE Id = ? AND TenantId = ?',
      // Feedback already left for a round, so the till can offer an edit rather
      // than a duplicate the UNIQUE key would reject.
      SELECT_BY_ORDER: 'SELECT * FROM pos_feedback WHERE OrderId = ? AND TenantId = ? LIMIT 1',
    },

    POS_TOKEN: {
      // The order behind the token is joined in: a queue that cannot say what
      // #7 gets is just a number pad. Newest first — a counter works the top of
      // the list, and TokenNumber orders a day's queue where CreatedOn ties.
      SELECT_ALL: `
        SELECT t.*, o.OrderNo, o.Total AS OrderTotal, o.Items AS OrderItems
          FROM pos_token t
          LEFT JOIN pos_order o ON o.Id = t.OrderId
         WHERE t.TenantId = ? ORDER BY t.TokenDate DESC, t.TokenNumber DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_token WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_token WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_token (Id, TenantId, TokenNumber, TokenLabel, TokenDate, OrderId, Status, CalledAt, ServedAt, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_token SET TokenNumber = ?, TokenLabel = ?, TokenDate = ?, OrderId = ?, Status = ?, CalledAt = ?, ServedAt = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_token WHERE Id = ? AND TenantId = ?',
      // Domain action: advance the queue. CalledAt/ServedAt are stamped only on
      // the move that earns them, and only once — a recall must not overwrite
      // when the customer was first called.
      SET_STATUS: `
        UPDATE pos_token
           SET Status    = ?,
               CalledAt  = CASE WHEN ? = 'called' AND CalledAt IS NULL THEN NOW() ELSE CalledAt END,
               ServedAt  = CASE WHEN ? = 'served' AND ServedAt IS NULL THEN NOW() ELSE ServedAt END,
               UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ?`,
      // A deleted round must not leave its token calling for food that no
      // longer exists — and the OrderId FK would reject the delete outright.
      DELETE_BY_ORDER: 'DELETE FROM pos_token WHERE OrderId = ? AND TenantId = ?',
      SELECT_BY_ORDER: 'SELECT * FROM pos_token WHERE OrderId = ? AND TenantId = ? LIMIT 1',
    },

    // How the counter QUEUE performed, as opposed to what it earned.
    //
    // Deliberately not in LEDGER_REPORT: a token is operational state, not an
    // accounting document, and the reporting engine's one rule is that its
    // figures come from the ledger. Wait times belong to the queue that
    // measured them.
    //
    // Waits are measured only where both ends exist — a token still waiting has
    // no wait yet, and averaging it in as zero would flatter the number.
    POS_TOKEN_STATS: {
      SUMMARY: `
        SELECT
          COUNT(*)                                                     AS Issued,
          SUM(Status = 'served')                                       AS Served,
          SUM(Status = 'waiting')                                      AS Waiting,
          SUM(Status = 'called')                                       AS Called,
          SUM(Status = 'cancelled')                                    AS Cancelled,
          AVG(CASE WHEN CalledAt IS NOT NULL
                   THEN TIMESTAMPDIFF(SECOND, CreatedOn, CalledAt) END) AS AvgWaitSeconds,
          MAX(CASE WHEN CalledAt IS NOT NULL
                   THEN TIMESTAMPDIFF(SECOND, CreatedOn, CalledAt) END) AS MaxWaitSeconds,
          AVG(CASE WHEN ServedAt IS NOT NULL AND CalledAt IS NOT NULL
                   THEN TIMESTAMPDIFF(SECOND, CalledAt, ServedAt) END)  AS AvgCollectSeconds
        FROM pos_token
        WHERE TenantId = ? AND TokenDate BETWEEN ? AND ?`,
      BY_DAY: `
        SELECT
          TokenDate                AS Bucket,
          COUNT(*)                 AS Issued,
          SUM(Status = 'served')   AS Served,
          AVG(CASE WHEN CalledAt IS NOT NULL
                   THEN TIMESTAMPDIFF(SECOND, CreatedOn, CalledAt) END) AS AvgWaitSeconds
        FROM pos_token
        WHERE TenantId = ? AND TokenDate BETWEEN ? AND ?`,
    },

    // The per-day, per-branch counter behind 'daily' numbering. SELECT_FOR_UPDATE
    // must run inside a transaction — the lock is what serialises two tills.
    POS_TOKEN_COUNTER: {
      SELECT_FOR_UPDATE: 'SELECT LastNumber FROM pos_token_counter WHERE TenantId = ? AND BranchDetailId = ? AND TokenDate = ? FOR UPDATE',
      INSERT: 'INSERT INTO pos_token_counter (TenantId, BranchDetailId, TokenDate, LastNumber, UpdatedOn, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?)',
      UPDATE: 'UPDATE pos_token_counter SET LastNumber = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE TenantId = ? AND BranchDetailId = ? AND TokenDate = ?',
    },

    // Just enough of branchdetail to name a branch in a POS dropdown. The two
    // columns a picker needs and not one more — /api/branchdetails returns the
    // whole record and is gated on ORGANIZATION_READ, which a cashier working
    // one outlet's token queue has no business holding.
    POS_BRANCH: {
      SELECT_ALL: 'SELECT Id, BranchName FROM branchdetail WHERE TenantId = ? ORDER BY BranchName',
    },

    // Per-branch POS preferences. A missing row is a valid state meaning "use
    // the default", so reads never assume one exists.
    POS_SETTING: {
      SELECT_ALL: 'SELECT * FROM pos_setting WHERE TenantId = ? ORDER BY BranchDetailId, SettingKey',
      SELECT_BY_BRANCH: 'SELECT SettingKey, SettingValue FROM pos_setting WHERE TenantId = ? AND BranchDetailId = ?',
      SELECT_VALUE: 'SELECT SettingValue FROM pos_setting WHERE TenantId = ? AND BranchDetailId = ? AND SettingKey = ? LIMIT 1',
      // Tenant-wide: a loyalty rate that differed per branch would mean the same
      // spend earned differently depending on which till rang it up.
      SELECT_VALUE_FOR_TENANT: 'SELECT SettingValue FROM pos_setting WHERE TenantId = ? AND SettingKey = ? LIMIT 1',
      UPSERT: `
        INSERT INTO pos_setting (Id, TenantId, BranchDetailId, SettingKey, SettingValue, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE SettingValue = VALUES(SettingValue), UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)`,
    },

    // Everything hanging off ONE round: the token handed for it, its kitchen
    // tickets, and the invoice it was billed on. Assembled server-side so every
    // screen that links an order number opens the same view of it.
    POS_ORDER_DETAIL: {
      ORDER: `
        SELECT o.*, tk.Id AS TokenId, tk.TokenLabel, tk.TokenNumber,
               tk.Status AS TokenStatus, tk.TokenDate, tk.CalledAt, tk.ServedAt
          FROM pos_order o
          LEFT JOIN pos_token tk ON tk.OrderId = o.Id AND tk.TenantId = o.TenantId
         WHERE o.Id = ? AND o.TenantId = ?`,
      KOTS: `
        SELECT Id, KotNo, Status, FiredAt, CreatedOn
          FROM pos_kot WHERE OrderId = ? AND TenantId = ? ORDER BY CreatedOn ASC`,
      BILL: `
        SELECT b.Id AS BillId, b.BillNo, b.Status AS BillStatus, b.Total AS BillTotal,
               b.SettledAt, b.TransactionDetailLogId,
               l.TransactionNo, s.Name AS LedgerStatus
          FROM pos_bill_order bo
          JOIN pos_bill b ON b.Id = bo.BillId AND b.TenantId = bo.TenantId
          LEFT JOIN transactiondetaillog l ON l.Id = b.TransactionDetailLogId
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE bo.OrderId = ? AND bo.TenantId = ?
         ORDER BY b.CreatedOn DESC LIMIT 1`,
    },

    POS_EXPENSE: {
      SELECT_ALL: `
        SELECT e.*, ec.Name AS CategoryName, pm.Type AS PaymentMode, l.TransactionNo
          FROM pos_expense e
          LEFT JOIN expense_category ec ON ec.Id = e.ExpenseCategoryId
          LEFT JOIN paymentmode pm      ON pm.Id = e.PaymentModeId
          LEFT JOIN transactiondetaillog l ON l.Id = e.TransactionDetailLogId
         WHERE e.TenantId = ? ORDER BY e.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_expense WHERE TenantId = ?',
      SELECT_BY_ID: `
        SELECT e.*, ec.Name AS CategoryName, pm.Type AS PaymentMode, l.TransactionNo
          FROM pos_expense e
          LEFT JOIN expense_category ec ON ec.Id = e.ExpenseCategoryId
          LEFT JOIN paymentmode pm      ON pm.Id = e.PaymentModeId
          LEFT JOIN transactiondetaillog l ON l.Id = e.TransactionDetailLogId
         WHERE e.Id = ? AND e.TenantId = ?`,
      INSERT:
        'INSERT INTO pos_expense (Id, TenantId, ExpenseCategoryId, Description, Amount, ExpenseDate, PaymentModeId, Status, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_expense SET ExpenseCategoryId = ?, Description = ?, Amount = ?, ExpenseDate = ?, PaymentModeId = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_expense WHERE Id = ? AND TenantId = ?',
      APPROVE:
        "UPDATE pos_expense SET Status = 'approved', ApprovedBy = ?, ApprovedAt = NOW(), UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?",
      REJECT:
        "UPDATE pos_expense SET Status = 'cancelled', UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?",
    },

    EXPENSE_CATEGORY: {
      SELECT_ALL: `
        SELECT ec.*, a.Name AS AccountName FROM expense_category ec
          LEFT JOIN accounttypebase a ON a.Id = ec.AccountTypeBaseId
         WHERE ec.TenantId = ? ORDER BY ec.Name ASC`,
      COUNT: 'SELECT COUNT(*) as total FROM expense_category WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM expense_category WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO expense_category (Id, TenantId, Name, AccountTypeBaseId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE expense_category SET Name = ?, AccountTypeBaseId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM expense_category WHERE Id = ? AND TenantId = ?',
    },

    ASSET_CATEGORY: {
      SELECT_ALL: 'SELECT * FROM asset_category WHERE TenantId = ? ORDER BY Name ASC',
      COUNT: 'SELECT COUNT(*) as total FROM asset_category WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM asset_category WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO asset_category (Id, TenantId, Name, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE asset_category SET Name = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM asset_category WHERE Id = ? AND TenantId = ?',
    },

    ASSET: {
      SELECT_ALL: `
        SELECT a.*, ac.Name AS CategoryName, b.BranchName, c.FirstName AS SupplierFirstName, c.LastName AS SupplierLastName
          FROM asset a
          LEFT JOIN asset_category ac ON ac.Id = a.AssetCategoryId
          LEFT JOIN branchdetail b    ON b.Id = a.BranchDetailId
          LEFT JOIN contactdetail c   ON c.Id = a.SupplierContactDetailId
         WHERE a.TenantId = ? ORDER BY a.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM asset WHERE TenantId = ?',
      SELECT_BY_ID: `
        SELECT a.*, ac.Name AS CategoryName, b.BranchName
          FROM asset a
          LEFT JOIN asset_category ac ON ac.Id = a.AssetCategoryId
          LEFT JOIN branchdetail b    ON b.Id = a.BranchDetailId
         WHERE a.Id = ? AND a.TenantId = ?`,
      INSERT:
        'INSERT INTO asset (Id, TenantId, Name, AssetCategoryId, BranchDetailId, SerialNo, PurchaseDate, PurchaseCost, SupplierContactDetailId, Status, Notes, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE asset SET Name = ?, AssetCategoryId = ?, BranchDetailId = ?, SerialNo = ?, PurchaseDate = ?, PurchaseCost = ?, SupplierContactDetailId = ?, Status = ?, Notes = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM asset WHERE Id = ? AND TenantId = ?',
      // Register value by branch and category — the register's reason to exist.
      SUMMARY_BY_BRANCH: `
        SELECT b.Id AS BranchDetailId, b.BranchName, ac.Name AS CategoryName,
               COUNT(*) AS Assets, COALESCE(SUM(a.PurchaseCost), 0) AS PurchaseCost
          FROM asset a
          LEFT JOIN branchdetail b    ON b.Id = a.BranchDetailId
          LEFT JOIN asset_category ac ON ac.Id = a.AssetCategoryId
         WHERE a.TenantId = ? AND a.Active = 1
         GROUP BY b.Id, b.BranchName, ac.Name
         ORDER BY b.BranchName ASC, PurchaseCost DESC`,
    },

    POS_CASH_SESSION: {
      SELECT_ALL: `
        SELECT cs.*, b.BranchName FROM pos_cash_session cs
          LEFT JOIN branchdetail b ON b.Id = cs.BranchDetailId
         WHERE cs.TenantId = ? ORDER BY cs.OpenedAt DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_cash_session WHERE TenantId = ?',
      SELECT_BY_ID: `
        SELECT cs.*, b.BranchName FROM pos_cash_session cs
          LEFT JOIN branchdetail b ON b.Id = cs.BranchDetailId
         WHERE cs.Id = ? AND cs.TenantId = ?`,
      INSERT:
        'INSERT INTO pos_cash_session (Id, TenantId, BranchDetailId, CashierEmail, ShiftLabel, OpeningFloat, OpenedAt, OpenedBy, Status, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, 1, NOW(), ?, ?)',
      // Only an open session can be closed, and only once: the Status predicate
      // is the concurrency guard, so a double close updates zero rows.
      CLOSE: `
        UPDATE pos_cash_session
           SET ClosedAt = NOW(), ClosedBy = ?, CountedCash = ?, ExpectedCash = ?,
               Variance = ?, Notes = ?, Status = 'closed', UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ? AND Status = 'open'`,
      // One open till per cashier per branch — enforced here because MySQL
      // treats every NULL ClosedAt as distinct, so a UNIQUE key cannot say it.
      SELECT_OPEN_FOR_CASHIER:
        "SELECT Id FROM pos_cash_session WHERE TenantId = ? AND BranchDetailId = ? AND CashierEmail = ? AND Status = 'open' LIMIT 1",
      SELECT_OPEN_BY_ID:
        "SELECT * FROM pos_cash_session WHERE Id = ? AND TenantId = ? AND Status = 'open' LIMIT 1",
      DELETE: 'DELETE FROM pos_cash_session WHERE Id = ? AND TenantId = ?',
    },

    // POS_STAFF — RETIRED. A staff member is a MEMBERSHIP now: user_tenants
    // carries full_name / phone / branch_detail_id, and user_roles carries what
    // they may do. See ADMIN_USERS below.

    // Role-based scope resolution (Path A) — UNIONed with PERMISSIONS.SELECT in auth.service
    ROLE_SCOPES: {
      SELECT_BY_USER_TENANT: `
        SELECT DISTINCT f.scope, f.feature_short_name
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN features f ON rp.feature_id = f.feature_id
        WHERE ur.user_email = ? AND ur.tenant_id = ? AND f.is_active = TRUE
      `,
    },

    // Onboarding Request Queries
    ONBOARDING_REQUESTS: {
      SELECT_BY_EMAIL:
        'SELECT * FROM onboarding_requests WHERE email = ? ORDER BY requested_at DESC LIMIT 1',
      SELECT_ALL:
        'SELECT * FROM onboarding_requests WHERE 1=1',
      INSERT:
        'INSERT INTO onboarding_requests (id, email, name, google_sub, status) VALUES (?, ?, ?, ?, "PENDING")',
      UPDATE_NOTE:
        'UPDATE onboarding_requests SET request_note = ?, updated_at = NOW() WHERE email = ? AND status = "PENDING"',
      UPDATE_STATUS:
        'UPDATE onboarding_requests SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW(), tenant_id = ?, updated_at = NOW() WHERE id = ?',
    },

    // Invitation Queries
    //
    // The counterpart to ONBOARDING_REQUESTS: a request is raised BY a person
    // wanting in and has no tenant until approved; an invitation is raised BY a
    // tenancy and carries its tenant and roles from creation.
    INVITATIONS: {
      INSERT:
        'INSERT INTO tenant_invitations (id, tenant_id, email, is_admin, full_name, phone, branch_detail_id, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      INSERT_ROLE:
        'INSERT INTO tenant_invitation_roles (invitation_id, role_id) VALUES (?, ?)',
      // One tenancy's invitations, newest first, with the role names resolved
      // so a list can be read without a second round trip per row.
      SELECT_BY_TENANT: `
        SELECT i.*,
               GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') AS role_names,
               COUNT(ir.role_id) AS role_count
          FROM tenant_invitations i
          LEFT JOIN tenant_invitation_roles ir ON ir.invitation_id = i.id
          LEFT JOIN roles r ON r.id = ir.role_id
         WHERE i.tenant_id = ?
         GROUP BY i.id
         ORDER BY i.created_at DESC`,
      SELECT_BY_ID:
        'SELECT * FROM tenant_invitations WHERE id = ? AND tenant_id = ?',
      // Live invitations for one email, across every tenancy. Expiry is applied
      // in SQL so a lapsed invitation is simply not claimed, with no sweep job
      // needed to keep the claim path correct.
      SELECT_CLAIMABLE: `
        SELECT id, tenant_id, email, is_admin, full_name, phone, branch_detail_id
          FROM tenant_invitations
         WHERE email = ? AND status = 'PENDING'
           AND (expires_at IS NULL OR expires_at > NOW())`,
      SELECT_ROLE_IDS:
        'SELECT role_id FROM tenant_invitation_roles WHERE invitation_id = ?',
      MARK_ACCEPTED:
        "UPDATE tenant_invitations SET status = 'ACCEPTED', accepted_at = NOW() WHERE id = ?",
      REVOKE:
        "UPDATE tenant_invitations SET status = 'REVOKED' WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
      // Guard for the "already a member" case — an invitation is a membership
      // request, so re-inviting an existing member is an error rather than a
      // silent role edit.
      SELECT_EXISTING_MEMBERSHIP:
        'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      // Roles must belong to the inviting tenancy. Without this an admin could
      // name a role id from another tenant and grant its permissions.
      SELECT_ROLES_IN_TENANT:
        'SELECT id FROM roles WHERE tenant_id = ? AND is_active = 1',
    },

    // Role Queries
    ROLES: {
      SELECT_ALL:
        'SELECT * FROM roles WHERE tenant_id = ? ORDER BY is_system_role DESC, name ASC',
      SELECT_BY_ID:
        'SELECT * FROM roles WHERE id = ? AND tenant_id = ?',
      SELECT_WITH_COUNTS: `
        SELECT r.*,
          (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
          (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
        FROM roles r WHERE r.tenant_id = ? ORDER BY r.is_system_role DESC, r.name ASC`,
      INSERT:
        'INSERT INTO roles (id, tenant_id, name, description, is_system_role) VALUES (?, ?, ?, ?, 0)',
      UPDATE:
        'UPDATE roles SET name = ?, description = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ? AND is_system_role = 0',
      DELETE:
        'DELETE FROM roles WHERE id = ? AND tenant_id = ? AND is_system_role = 0',
    },

    // Role Permission Queries
    ROLE_PERMISSIONS: {
      SELECT_BY_ROLE: `
        SELECT rp.id, rp.role_id, rp.feature_id,
               f.feature_short_name, f.scope, f.display_name, f.category
        FROM role_permissions rp
        JOIN features f ON rp.feature_id = f.feature_id
        WHERE rp.role_id = ?`,
      DELETE_ALL_FOR_ROLE:
        'DELETE FROM role_permissions WHERE role_id = ?',
      INSERT:
        'INSERT INTO role_permissions (id, role_id, feature_id) VALUES (?, ?, ?)',
    },

    // User Role Queries
    USER_ROLES: {
      SELECT_BY_USER_TENANT: `
        SELECT ur.*, r.name AS role_name, r.description, r.is_system_role
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_email = ? AND ur.tenant_id = ?`,
      DELETE_ALL_FOR_USER:
        'DELETE FROM user_roles WHERE user_email = ? AND tenant_id = ?',
      INSERT:
        'INSERT INTO user_roles (id, user_email, tenant_id, role_id, assigned_by) VALUES (?, ?, ?, ?, ?)',
    },

    // Customer reports. All read SETTLED DOCUMENTS, not pos_order: an order
    // that was placed and never paid for is not a visit, and the ledger is what
    // knows the difference. Ten reports existed and not one was about people.
    LEDGER_REPORT_CUSTOMER: {
      // A refunded sale is not a visit. Every other report in this file narrows
      // to SETTLED/PARTIALLY_PAID, and these must too — otherwise a customer's
      // "credibility" would count purchases they handed straight back, and the
      // report would disagree with the CRM projection the refund already
      // reversed.
      // Who buys, how often, how much — the credibility view. Repeat customers
      // sort first because that is what the question is actually about.
      CUSTOMERS: `
        SELECT c.Id, c.Name, c.Phone, c.LoyaltyPoints, c.LastVisitAt,
               COUNT(DISTINCT l.Id)                       AS Orders,
               COALESCE(SUM(l.GrossAmount), 0)            AS Spend,
               COALESCE(AVG(l.GrossAmount), 0)            AS AverageOrder,
               MIN(l.TransactionDate)                     AS FirstVisit,
               MAX(l.TransactionDate)                     AS LastOrder,
               DATEDIFF(CURDATE(), MAX(l.TransactionDate)) AS DaysSinceLast,
               -- Days between first and last purchase, over orders: a rough
               -- visit interval that says more than a raw count. One-time
               -- buyers get NULL rather than a misleading zero.
               CASE WHEN COUNT(DISTINCT l.Id) > 1
                    THEN ROUND(DATEDIFF(MAX(l.TransactionDate), MIN(l.TransactionDate))
                               / (COUNT(DISTINCT l.Id) - 1), 1)
                    ELSE NULL END                          AS AvgDaysBetween
          FROM pos_customer c
          JOIN pos_order o        ON o.CustomerId = c.Id AND o.TenantId = c.TenantId
          JOIN pos_bill_order bo  ON bo.OrderId = o.Id AND bo.TenantId = o.TenantId
          JOIN pos_bill b         ON b.Id = bo.BillId AND b.TenantId = bo.TenantId
          JOIN transactiondetaillog l ON l.Id = b.TransactionDetailLogId
          JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE c.TenantId = ? AND l.TransactionDate BETWEEN ? AND ?
           AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL`,
      // No LIMIT here: it is appended by the caller as a clamped integer.
      // Binding it fails with ER_WRONG_ARGUMENTS, which is why every other
      // report in this file interpolates its limit too.
      CUSTOMERS_GROUP_BY: `
         GROUP BY c.Id, c.Name, c.Phone, c.LoyaltyPoints, c.LastVisitAt
         ORDER BY Orders DESC, Spend DESC`,

      // When they come. Day-of-week × hour, which is a shape you read rather
      // than a table you scan.
      VISIT_PATTERN: `
        SELECT DAYOFWEEK(l.TransactionDate) AS Dow,
               HOUR(l.CreatedOn)            AS Hour,
               COUNT(DISTINCT l.Id)         AS Visits,
               COALESCE(SUM(l.GrossAmount), 0) AS Spend
          FROM transactiondetaillog l
          JOIN pos_bill b        ON b.TransactionDetailLogId = l.Id
          JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
          JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
          JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE l.TenantId = ? AND l.TransactionDate BETWEEN ? AND ?
           AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL`,
      VISIT_PATTERN_GROUP_BY: ' GROUP BY Dow, Hour ORDER BY Dow, Hour',

      // How much of the trade is repeat trade — the headline number a manager
      // actually acts on.
      REPEAT_SUMMARY: `
        SELECT COUNT(*)                                   AS KnownCustomers,
               SUM(CASE WHEN Orders > 1 THEN 1 ELSE 0 END) AS RepeatCustomers,
               SUM(Orders)                                AS KnownOrders,
               COALESCE(SUM(Spend), 0)                    AS KnownSpend
          FROM (
            SELECT o.CustomerId, COUNT(DISTINCT l.Id) AS Orders, SUM(l.GrossAmount) AS Spend
              FROM pos_order o
              JOIN pos_bill_order bo ON bo.OrderId = o.Id AND bo.TenantId = o.TenantId
              JOIN pos_bill b        ON b.Id = bo.BillId AND b.TenantId = bo.TenantId
              JOIN transactiondetaillog l ON l.Id = b.TransactionDetailLogId
              JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
             WHERE o.TenantId = ? AND o.CustomerId IS NOT NULL
               AND l.TransactionDate BETWEEN ? AND ?
               AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL
             GROUP BY o.CustomerId
          ) per_customer`,

      // Every settled document in the tenancy over the window, so the repeat
      // rate has a denominator that includes walk-ins.
      TOTAL_DOCUMENTS: `
        SELECT COUNT(*) AS Documents, COALESCE(SUM(l.GrossAmount), 0) AS Gross
          FROM transactiondetaillog l
          JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE l.TenantId = ? AND l.TransactionDate BETWEEN ? AND ?
           AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL`,

      // Known customers who have stopped coming — the targeting list.
      LAPSED: `
        SELECT Id, Name, Phone, Visits, TotalSpent, LoyaltyPoints, LastVisitAt,
               DATEDIFF(CURDATE(), LastVisitAt) AS DaysSince
          FROM pos_customer
         WHERE TenantId = ? AND LastVisitAt IS NOT NULL
           AND LastVisitAt < DATE_SUB(CURDATE(), INTERVAL ? DAY)
         ORDER BY TotalSpent DESC`,
    },

    // Loyalty ledger — every movement of points, append-only.
    LOYALTY_LEDGER: {
      INSERT: `
        INSERT INTO pos_loyalty_ledger
          (Id, TenantId, CustomerId, EntryType, Points, SourceType, SourceId,
           ReversesId, Reason, BranchDetailId, CreatedOn, CreatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      // The authoritative balance. pos_customer.LoyaltyPoints is a cache of
      // this, and the two are compared by the reconciliation report.
      SELECT_BALANCE: `
        SELECT COALESCE(SUM(Points), 0) AS balance
          FROM pos_loyalty_ledger WHERE CustomerId = ? AND TenantId = ?`,
      // FOR UPDATE: two tills settling for one customer at the same moment
      // would otherwise both read the same balance and both spend it. Same
      // row-lock discipline the numbering series uses.
      SELECT_BALANCE_FOR_UPDATE: `
        SELECT COALESCE(SUM(Points), 0) AS balance
          FROM pos_loyalty_ledger WHERE CustomerId = ? AND TenantId = ? FOR UPDATE`,
      SELECT_STATEMENT: `
        SELECT Id, EntryType, Points, SourceType, SourceId, Reason, CreatedOn, CreatedBy
          FROM pos_loyalty_ledger
         WHERE CustomerId = ? AND TenantId = ?
         ORDER BY CreatedOn DESC, Id DESC
         LIMIT 100`,
      // The EARN a refund has to undo, found by the bill that created it.
      SELECT_ENTRY_BY_SOURCE: `
        SELECT Id, CustomerId, Points FROM pos_loyalty_ledger
         WHERE TenantId = ? AND SourceType = ? AND SourceId = ? AND EntryType = ?
         LIMIT 1`,
    },

    // Admin User Management Queries
    ADMIN_USERS: {
      // One row per person: who they are (the profile that used to live in
      // pos_staff), what they may do (roles), and whether they can administer.
      SELECT_ALL: `
        SELECT ut.user_email, ut.tenant_id, ut.is_admin, ut.is_super_admin,
               ut.is_active, ut.status,
               ut.full_name, ut.phone, ut.branch_detail_id,
               b.BranchName AS branch_name,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
        FROM user_tenants ut
        LEFT JOIN user_roles ur ON ut.user_email = ur.user_email AND ut.tenant_id = ur.tenant_id
        LEFT JOIN roles r ON ur.role_id = r.id
        LEFT JOIN branchdetail b ON b.Id = ut.branch_detail_id AND b.TenantId = ut.tenant_id
        WHERE ut.tenant_id = ?
        GROUP BY ut.user_email, ut.tenant_id
        ORDER BY ut.full_name IS NULL, ut.full_name ASC, ut.user_email ASC`,
      // Cross-tenant listing for super admins only. No tenant_id filter; each row
      // carries its tenant_id (plus a best-effort organization name for display).
      // setup_status is per TENANT, so every row of the same tenant carries the
      // same value. A tenant with no tenant_setup row has never run the
      // first-time wizard and reports PENDING.
      SELECT_ALL_TENANTS: `
        SELECT ut.user_email, ut.tenant_id, ut.is_admin, ut.is_super_admin,
               ut.is_active, ut.status,
               (SELECT o.Name FROM organizationdetail o
                  WHERE o.TenantId = ut.tenant_id
                  ORDER BY o.CreatedOn ASC LIMIT 1) AS tenant_name,
               COALESCE(ts.status, 'PENDING') AS setup_status,
               ts.completed_at AS setup_completed_at,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
        FROM user_tenants ut
        LEFT JOIN user_roles ur ON ut.user_email = ur.user_email AND ut.tenant_id = ur.tenant_id
        LEFT JOIN roles r ON ur.role_id = r.id
        LEFT JOIN tenant_setup ts ON ts.tenant_id = ut.tenant_id
        GROUP BY ut.user_email, ut.tenant_id, ts.status, ts.completed_at
        ORDER BY ut.tenant_id ASC, ut.user_email ASC`,
      COUNT_ALL_TENANTS: 'SELECT COUNT(*) as total FROM user_tenants',

      // ── Cross-tenant directory (super admin) ─────────────────────────────
      // One row per TENANCY rather than per membership. The flat listing above
      // cannot be grouped for display, because a page boundary can fall in the
      // middle of a tenancy and split its people across two pages.
      //
      // Every count is COUNT(DISTINCT CASE …) rather than SUM(): joining
      // user_roles multiplies a membership by the number of roles it holds, so
      // a plain SUM(is_admin) would report an admin with three roles as three
      // admins. The DISTINCT is on user_email, which is what is actually being
      // counted.
      SELECT_TENANT_DIRECTORY: `
        SELECT ut.tenant_id,
               (SELECT o.Name FROM organizationdetail o
                  WHERE o.TenantId = ut.tenant_id
                  ORDER BY o.CreatedOn ASC LIMIT 1) AS tenant_name,
               COUNT(DISTINCT ut.user_email) AS user_count,
               COUNT(DISTINCT CASE WHEN ut.is_admin = 1 THEN ut.user_email END) AS admin_count,
               COUNT(DISTINCT CASE WHEN ut.is_super_admin = 1 THEN ut.user_email END) AS super_admin_count,
               COUNT(DISTINCT CASE WHEN ut.status = 'SUSPENDED' THEN ut.user_email END) AS suspended_count,
               MAX(ut.last_active_at) AS last_active_at,
               (SELECT COUNT(*) FROM branchdetail b WHERE b.TenantId = ut.tenant_id) AS branch_count,
               COALESCE(ts.status, 'PENDING') AS setup_status,
               ts.completed_at AS setup_completed_at,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
          FROM user_tenants ut
          LEFT JOIN user_roles ur ON ur.user_email = ut.user_email AND ur.tenant_id = ut.tenant_id
          LEFT JOIN roles r ON r.id = ur.role_id
          LEFT JOIN tenant_setup ts ON ts.tenant_id = ut.tenant_id
         GROUP BY ut.tenant_id, ts.status, ts.completed_at
         ORDER BY tenant_name IS NULL, tenant_name ASC, ut.tenant_id ASC`,

      COUNT_TENANTS: 'SELECT COUNT(DISTINCT tenant_id) as total FROM user_tenants',

      // The people in ONE tenancy, named. Same shape as SELECT_ALL — the staff
      // profile included — but for a tenancy the caller is not signed in to, so
      // it takes the tenant id rather than reading it from the token. Only the
      // super-admin routes reach it.
      SELECT_BY_TENANT: `
        SELECT ut.user_email, ut.tenant_id, ut.is_admin, ut.is_super_admin,
               ut.is_active, ut.status, ut.last_active_at,
               ut.full_name, ut.phone, ut.branch_detail_id,
               b.BranchName AS branch_name,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
          FROM user_tenants ut
          LEFT JOIN user_roles ur ON ut.user_email = ur.user_email AND ut.tenant_id = ur.tenant_id
          LEFT JOIN roles r ON ur.role_id = r.id
          LEFT JOIN branchdetail b ON b.Id = ut.branch_detail_id AND b.TenantId = ut.tenant_id
         WHERE ut.tenant_id = ?
         GROUP BY ut.user_email, ut.tenant_id
         ORDER BY ut.full_name IS NULL, ut.full_name ASC, ut.user_email ASC`,
      // Membership flags for a single (email, tenant) pair — used by the super-admin
      // cross-tenant status change to verify existence and guard super admins.
      SELECT_FLAGS_BY_EMAIL_TENANT:
        'SELECT is_super_admin FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      SELECT_BY_EMAIL: `
        SELECT ut.*, GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
        FROM user_tenants ut
        LEFT JOIN user_roles ur ON ut.user_email = ur.user_email AND ut.tenant_id = ur.tenant_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE ut.user_email = ? AND ut.tenant_id = ?
        GROUP BY ut.user_email, ut.tenant_id`,
      INSERT_USER_TENANT:
        'INSERT INTO user_tenants (id, user_email, tenant_id, is_admin, is_super_admin, is_active, status) VALUES (?, ?, ?, 0, 0, 1, "ACTIVE")',
      // Parametrized variant: caller supplies is_admin / is_super_admin flags.
      // Used by the shared provisioning core (manual approve → 0/0, auto-approve → 1/0).
      INSERT_USER_TENANT_FLAGS:
        'INSERT INTO user_tenants (id, user_email, tenant_id, is_admin, is_super_admin, is_active, status) VALUES (?, ?, ?, ?, ?, 1, "ACTIVE")',
      UPDATE_STATUS:
        'UPDATE user_tenants SET is_active = ?, status = ?, updated_at = NOW() WHERE user_email = ? AND tenant_id = ?',
      DELETE:
        'DELETE FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      // TENANT:ADMIN is derived from this flag at login, never from a role.
      // Assigning a role NAMED 'TENANT_ADMIN' or 'SUPER_ADMIN' grants that
      // role's feature scopes and nothing else — which is why a user could hold
      // the SUPER_ADMIN role and still be refused the Access Control screen.
      SET_ADMIN_FLAG:
        'UPDATE user_tenants SET is_admin = ?, updated_at = NOW() WHERE user_email = ? AND tenant_id = ?',
      // The staff details, on the membership they belong to.
      UPDATE_PROFILE:
        'UPDATE user_tenants SET full_name = ?, phone = ?, branch_detail_id = ?, updated_at = NOW() WHERE user_email = ? AND tenant_id = ?',
    },

    // Feature / Scope Management Queries
    FEATURES: {
      SELECT_ALL:
        'SELECT * FROM features WHERE is_active = TRUE ORDER BY category ASC, feature_short_name ASC',
      SELECT_BY_ID:
        'SELECT * FROM features WHERE feature_id = ?',
      INSERT:
        'INSERT INTO features (feature_id, name, feature_short_name, scope, display_name, category, description, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      UPDATE:
        'UPDATE features SET display_name = ?, scope = ?, category = ?, description = ?, is_active = ? WHERE feature_id = ?',
      CHECK_IN_USE:
        'SELECT COUNT(*) as cnt FROM role_permissions WHERE feature_id = ?',
    },

    // Application Settings (global key/value config, super-admin owned)
    APP_SETTINGS: {
      SELECT_ALL:
        'SELECT setting_key, setting_value, updated_by, updated_at FROM app_settings ORDER BY setting_key ASC',
      SELECT_BY_KEY:
        'SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ?',
      UPSERT:
        'INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = NOW()',
    },

    // ── Accounting ledger ────────────────────────────────────────────────
    // Settling a POS bill posts a Sale document:
    //   transactiondetaillog → transactionitemdetail (lines)
    //                        → paymentdetail → paymentbreakup (one per tender)
    // with every status change recorded against a permitted transition.
    LEDGER: {
      // Numbering. The row lock is what stops two tills taking the same number;
      // UNIQUE(TransactionNo, TenantId) on the log is the backstop.
      SELECT_CONFIG_FOR_UPDATE:
        'SELECT Id, StartCounterNo, CurrentCounterNo, Prefix, Format FROM transactiontypeconfig WHERE Id = ? AND TenantId = ? FOR UPDATE',
      UPDATE_COUNTER:
        'UPDATE transactiontypeconfig SET CurrentCounterNo = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SELECT_CONFIG_BY_TAG:
        'SELECT Id FROM transactiontypeconfig WHERE TagName = ? AND TenantId = ? AND Active = 1 LIMIT 1',

      // Master lookups by name — the ledger addresses masters by meaning, not id.
      SELECT_STATUS_BY_NAME:
        'SELECT Id, Name FROM transactiontypestatus WHERE Name = ? AND TenantId = ? AND Active = 1 LIMIT 1',
      SELECT_TYPE_BY_NAME:
        'SELECT Id, TransactionTypeConfigId FROM transactiontype WHERE Name = ? AND TenantId = ? AND Active = 1 LIMIT 1',
      SELECT_ACCOUNT_BY_NAME:
        'SELECT Id, Kind FROM accounttypebase WHERE Name = ? AND TenantId = ? AND Active = 1 LIMIT 1',
      SELECT_RECEIVED_TYPE_BY_NAME:
        'SELECT Id FROM paymentreceivedtype WHERE Type = ? AND TenantId = ? AND Active = 1 LIMIT 1',
      // DefaultAccountTypeBaseId is what turns a tender into a cash movement:
      // it says which account the money landed in.
      SELECT_PAYMENT_MODE:
        'SELECT Id, Type, DefaultAccountTypeBaseId FROM paymentmode WHERE Id = ? AND TenantId = ? AND Active = 1 LIMIT 1',

      // Status machine: a move is legal only if the whitelist permits it, and
      // every move taken is recorded.
      SELECT_TRANSITION: `
        SELECT Id FROM transactiontypebaseconversion
         WHERE TransactionTypeConfigId = ? AND FromTransactionTypeStatusId = ?
           AND ToTransactionTypeStatusId = ? AND TenantId = ? AND Active = 1 LIMIT 1`,
      INSERT_CONVERSION_MAPPER:
        'INSERT INTO transactiontypeconversionmapper (Id, TenantId, TransactionTypeBaseCoversionId, TransactionDetailLogId, TransactionTypeStatusId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?)',
      SELECT_TRANSITION_HISTORY: `
        SELECT m.Id, m.CreatedOn, m.CreatedBy, s.Name AS StatusName, bc.Tag
          FROM transactiontypeconversionmapper m
          LEFT JOIN transactiontypestatus s ON s.Id = m.TransactionTypeStatusId
          LEFT JOIN transactiontypebaseconversion bc ON bc.Id = m.TransactionTypeBaseCoversionId
         WHERE m.TransactionDetailLogId = ? AND m.TenantId = ?
         ORDER BY m.CreatedOn ASC`,

      // Document
      INSERT_LOG: `
        INSERT INTO transactiondetaillog
          (Id, TenantId, TransactionNo, TransactionTypeConfigId, TransactionTypeId,
           TransactionTypeStatusId, BranchId, TransactionDate,
           NetAmount, TaxAmount, DiscountAmount, RoundOff, GrossAmount, TaxByComponent,
           ContactDetailId, CustomerName, CustomerMobile, Remarks, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      UPDATE_LOG_STATUS:
        'UPDATE transactiondetaillog SET TransactionTypeStatusId = ?, SettledAt = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SELECT_LOG_FULL: `
        SELECT l.*, s.Name AS StatusName, t.Name AS TypeName, b.BranchName
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN transactiontype t       ON t.Id = l.TransactionTypeId
          LEFT JOIN branchdetail b          ON b.Id = l.BranchId
         WHERE l.Id = ? AND l.TenantId = ?`,
      SELECT_LOG_LIST: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.GrossAmount, l.NetAmount,
               l.TaxAmount, l.CustomerName, l.CustomerMobile, l.SettledAt,
               s.Name AS StatusName, t.Name AS TypeName,
               -- What the customer was holding: a token number, or a table.
               -- Correlated subqueries rather than joins: a bill covering three
               -- rounds would fan this row out three times and every list total
               -- would triple. An invoice with no POS bill behind it (an
               -- expense) simply gets nulls.
               (SELECT GROUP_CONCAT(DISTINCT tk.TokenLabel ORDER BY tk.TokenNumber SEPARATOR ', ')
                  FROM pos_bill b
                  JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
                  JOIN pos_token tk      ON tk.OrderId = bo.OrderId AND tk.TenantId = bo.TenantId
                 WHERE b.TransactionDetailLogId = l.Id AND b.TenantId = l.TenantId) AS TokenLabels,
               (SELECT GROUP_CONCAT(DISTINCT o.TableName ORDER BY o.TableName SEPARATOR ', ')
                  FROM pos_bill b
                  JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
                  JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
                 WHERE b.TransactionDetailLogId = l.Id AND b.TenantId = l.TenantId) AS TableNames,
               (SELECT GROUP_CONCAT(DISTINCT o.OrderNo ORDER BY o.OrderNo SEPARATOR ', ')
                  FROM pos_bill b
                  JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
                  JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
                 WHERE b.TransactionDetailLogId = l.Id AND b.TenantId = l.TenantId) AS OrderNos
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN transactiontype t       ON t.Id = l.TransactionTypeId
         WHERE l.TenantId = ?`,

      // The rounds one invoice covers, each with the token issued for it (if
      // any) and the venue it was served at. This is what lets a ledger
      // document say "Token 7" or "Table G02" instead of standing alone with no
      // link back to the floor.
      SELECT_DOC_ORDERS: `
        SELECT o.Id            AS OrderId,
               o.OrderNo,
               o.OrderType,
               o.Status        AS OrderStatus,
               o.Total         AS OrderTotal,
               o.CreatedOn     AS OrderCreatedOn,
               o.TableId,
               o.TableName,
               o.FloorName,
               tk.Id           AS TokenId,
               tk.TokenLabel,
               tk.Status       AS TokenStatus
          FROM pos_bill b
          JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
          JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
          LEFT JOIN pos_token tk ON tk.OrderId = o.Id AND tk.TenantId = o.TenantId
         WHERE b.TransactionDetailLogId = ? AND b.TenantId = ?
         ORDER BY o.CreatedOn ASC`,
      COUNT_LOGS: 'SELECT COUNT(*) as total FROM transactiondetaillog WHERE TenantId = ?',

      // Lines
      INSERT_LINE: `
        INSERT INTO transactionitemdetail
          (Id, TenantId, TransactionDetailLogId, LineNo, ItemId, Quantity, CostInfoId,
           UnitPrice, BasePrice, VariantAmount, NetAmount, DiscountAmount, ItemDiscountAmount,
           TaxAmount, GrossAmount,
           TaxComponents, Variants, Comment, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      // ── Returns / credit notes ──────────────────────────────────────────
      //
      // A credit note is a transactiondetaillog row like any other, plus the
      // link back to what it reverses. Its own INSERT rather than extending
      // INSERT_LOG deliberately: the sale and expense paths are the money path
      // with a large test suite behind them, and a return has genuinely
      // different required columns. Neither statement is derived from the
      // other, so both name their columns explicitly.
      INSERT_RETURN_LOG: `
        INSERT INTO transactiondetaillog
          (Id, TenantId, TransactionNo, TransactionTypeConfigId, TransactionTypeId,
           TransactionTypeStatusId, BranchId, TransactionDate,
           NetAmount, TaxAmount, DiscountAmount, RoundOff, GrossAmount, TaxByComponent,
           ContactDetailId, CustomerName, CustomerMobile,
           ReversesLogId, SettlementStatus, SettlementRef, ReturnReasonId,
           Remarks, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      INSERT_RETURN_LINE: `
        INSERT INTO transactionitemdetail
          (Id, TenantId, TransactionDetailLogId, LineNo, ItemId, Quantity, CostInfoId,
           UnitPrice, BasePrice, VariantAmount, NetAmount, DiscountAmount, ItemDiscountAmount,
           TaxAmount, GrossAmount, TaxComponents, Variants, Comment,
           SourceLineId, RestockRequested,
           Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,

      // THE CONCURRENCY GUARD. Two cashiers refunding one invoice at the same
      // moment would both read "nothing returned yet" and both be allowed to
      // refund the whole thing. Locking the sale row serialises them, the same
      // discipline the numbering counter already uses to stop two tills taking
      // one invoice number.
      SELECT_SALE_FOR_RETURN: `
        SELECT l.Id, l.TenantId, l.TransactionNo, l.GrossAmount, l.NetAmount, l.TaxAmount,
               l.DiscountAmount, l.BranchId, l.ContactDetailId, l.CustomerName,
               l.CustomerMobile, l.TransactionTypeConfigId, l.TransactionTypeStatusId,
               l.SettledAt, s.Name AS StatusName
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE l.Id = ? AND l.TenantId = ?
         FOR UPDATE`,

      // How much of this sale has already come back. Read INSIDE the lock above.
      SELECT_RETURNED_TOTAL: `
        SELECT COALESCE(SUM(GrossAmount), 0) AS returned,
               COUNT(*) AS noteCount
          FROM transactiondetaillog
         WHERE ReversesLogId = ? AND TenantId = ? AND Active = 1`,

      // Per ORIGINAL LINE: how many units have already been sent back. This is
      // what stops a second return taking a quantity that was never sold.
      SELECT_RETURNED_BY_LINE: `
        SELECT r.SourceLineId, COALESCE(SUM(r.Quantity), 0) AS returnedQty
          FROM transactionitemdetail r
          JOIN transactiondetaillog n ON n.Id = r.TransactionDetailLogId AND n.TenantId = r.TenantId
         WHERE n.ReversesLogId = ? AND r.TenantId = ? AND n.Active = 1
         GROUP BY r.SourceLineId`,

      // The credit notes raised against one sale, for the detail drawer.
      SELECT_RETURNS_BY_SALE: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.GrossAmount, l.NetAmount,
               l.TaxAmount, l.SettlementStatus, l.SettlementRef, l.Remarks,
               l.CreatedOn, l.CreatedBy, s.Name AS StatusName,
               rr.Name AS ReasonName, rr.Code AS ReasonCode, rr.IsFault
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN pos_return_reason rr ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
         WHERE l.ReversesLogId = ? AND l.TenantId = ?
         ORDER BY l.CreatedOn ASC`,

      // Every sale's returned-to-date, for the ledger list's extra column.
      // One grouped read rather than N per-row queries.
      SELECT_RETURNED_TOTALS_BULK: `
        SELECT ReversesLogId AS saleId, COALESCE(SUM(GrossAmount), 0) AS returned,
               COUNT(*) AS noteCount
          FROM transactiondetaillog
         WHERE TenantId = ? AND ReversesLogId IS NOT NULL AND Active = 1
         GROUP BY ReversesLogId`,

      // Money owed but not yet handed back — the operational worklist.
      SELECT_PENDING_SETTLEMENTS: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.GrossAmount,
               l.SettlementStatus, l.CreatedOn, l.CreatedBy,
               orig.TransactionNo AS SaleNo, l.ReversesLogId,
               l.CustomerName, l.CustomerMobile, b.BranchName
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId
          LEFT JOIN branchdetail b ON b.Id = l.BranchId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1
           AND COALESCE(l.SettlementStatus, 'PENDING') = 'PENDING'
         ORDER BY l.CreatedOn ASC`,

      SET_SETTLEMENT_STATUS: `
        UPDATE transactiondetaillog
           SET SettlementStatus = ?, SettlementRef = COALESCE(?, SettlementRef),
               UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ?`,

      SELECT_LINES_BY_LOG: `
        SELECT t.*, i.Name AS ItemName
          FROM transactionitemdetail t
          LEFT JOIN itemdetail i ON i.Id = t.ItemId
         WHERE t.TransactionDetailLogId = ? AND t.TenantId = ?
         ORDER BY t.LineNo ASC`,
      // Line numbers are unique per document, so a plain CRUD insert needs the
      // next free slot rather than defaulting everything to 1.
      SELECT_NEXT_LINE_NO:
        'SELECT COALESCE(MAX(LineNo), 0) + 1 AS NextLineNo FROM transactionitemdetail WHERE TransactionDetailLogId = ? AND TenantId = ?',

      // Settlement
      INSERT_PAYMENT_DETAIL: `
        INSERT INTO paymentdetail
          (Id, TenantId, AccountTypeBaseId, TransactionDetailLogId, DiscountAmount,
           RoundOff, TotalAmount, TaxesAmount, GrossAmount, UserId, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      INSERT_PMTD: `
        INSERT INTO paymentmodetransactiondetail
          (Id, TenantId, PaymentModeId, RefNo, Comment, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      INSERT_BREAKUP: `
        INSERT INTO paymentbreakup
          (Id, TenantId, AccountTypeBaseId, PaymentDetailId, PaymentModeTransactionDetailId,
           PaymentReceivedTypeId, Amount, UserId, Timestamp, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1, NOW(), ?, ?)`,
      SELECT_TENDERS_BY_LOG: `
        SELECT b.Id, b.Amount, b.Timestamp, pm.Type AS PaymentMode, pmtd.RefNo,
               prt.Type AS ReceivedType, a.Name AS AccountName
          FROM paymentdetail pd
          JOIN paymentbreakup b ON b.PaymentDetailId = pd.Id AND b.TenantId = pd.TenantId
          LEFT JOIN paymentmodetransactiondetail pmtd ON pmtd.Id = b.PaymentModeTransactionDetailId
          LEFT JOIN paymentmode pm  ON pm.Id = pmtd.PaymentModeId
          LEFT JOIN paymentreceivedtype prt ON prt.Id = b.PaymentReceivedTypeId
          LEFT JOIN accounttypebase a ON a.Id = b.AccountTypeBaseId
         WHERE pd.TransactionDetailLogId = ? AND pd.TenantId = ?
         ORDER BY b.Timestamp ASC`,
      SELECT_PAYMENT_DETAIL_BY_LOG:
        'SELECT * FROM paymentdetail WHERE TransactionDetailLogId = ? AND TenantId = ? ORDER BY CreatedOn ASC',

      // POS bill link (posting + idempotency guard)
      SELECT_BILL_LEDGER_LINK:
        'SELECT TransactionDetailLogId FROM pos_bill WHERE Id = ? AND TenantId = ?',
      UPDATE_BILL_LEDGER_LINK:
        'UPDATE pos_bill SET TransactionDetailLogId = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // A refunded document must not leave the POS side claiming 'paid'.
      UPDATE_BILL_STATUS_BY_LOG:
        'UPDATE pos_bill SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE TransactionDetailLogId = ? AND TenantId = ?',
      // The bill a refund is reversing, and the customer whose record it has to
      // be taken back off. One query rather than three: the refund path is
      // already inside a transaction and should not walk the graph.
      SELECT_BILL_CUSTOMER_BY_LOG: `
        SELECT b.Id AS BillId, b.Total, b.BranchDetailId,
               (SELECT o.CustomerId
                  FROM pos_bill_order bo
                  JOIN pos_order o ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
                 WHERE bo.BillId = b.Id AND bo.TenantId = b.TenantId
                   AND o.CustomerId IS NOT NULL
                 LIMIT 1) AS CustomerId
          FROM pos_bill b
         WHERE b.TransactionDetailLogId = ? AND b.TenantId = ?
         LIMIT 1`,

      // Expense link (same posting + idempotency shape as the bill)
      SELECT_EXPENSE_LEDGER_LINK:
        'SELECT TransactionDetailLogId FROM pos_expense WHERE Id = ? AND TenantId = ?',
      UPDATE_EXPENSE_LEDGER_LINK:
        "UPDATE pos_expense SET TransactionDetailLogId = ?, Status = 'settled', UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?",
      SELECT_EXPENSE_CATEGORY_ACCOUNT: `
        SELECT ec.Id, ec.Name, ec.AccountTypeBaseId
          FROM expense_category ec
         WHERE ec.Id = ? AND ec.TenantId = ? AND ec.Active = 1 LIMIT 1`,
    },

    // Reporting. Every query here is tenant + date bounded and aggregates in
    // SQL — the range is never pulled into Node and reduced there.
    // Date predicates are parameterised; only the bucket expression and the
    // weekend filter are interpolated, and both come from a fixed whitelist in
    // utils/dateRange.js, never from request text.
    LEDGER_REPORT: {
      // ── Why every revenue query excludes reversals ─────────────────────────
      //
      // A credit note is a SETTLED document with lines and a customer, so a
      // query that filters on status alone counts it as a SALE: returned dishes
      // would inflate QuantitySold, and a refunded customer would look like a
      // repeat buyer. `l.ReversesLogId IS NULL` is the precise exclusion — a
      // credit note is exactly "a document that reverses another one".
      //
      // Returns are reported ALONGSIDE these as their own measure (see
      // RETURNS_SUMMARY below), never netted into them. That is what stops a
      // refund on Friday changing last Tuesday's gross: gross never moves, and
      // Net = Gross − Returns is computed for display.
      // Invoiced vs collected. GrossAmount is what the document says; the
      // paymentdetail subquery is what was actually taken, and the difference
      // is the outstanding balance that makes partial payment visible.
      SALES_SUMMARY: `
        SELECT
          COUNT(*)                                AS Documents,
          COALESCE(SUM(l.NetAmount), 0)           AS NetAmount,
          COALESCE(SUM(l.TaxAmount), 0)           AS TaxAmount,
          COALESCE(SUM(l.DiscountAmount), 0)      AS DiscountAmount,
          COALESCE(SUM(l.RoundOff), 0)            AS RoundOff,
          COALESCE(SUM(l.GrossAmount), 0)         AS GrossAmount,
          COALESCE(SUM(p.Collected), 0)           AS Collected,
          COALESCE(SUM(l.GrossAmount), 0) - COALESCE(SUM(p.Collected), 0) AS Outstanding
        FROM transactiondetaillog l
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        JOIN transactiontype t       ON t.Id = l.TransactionTypeId
        LEFT JOIN (
          SELECT TransactionDetailLogId, SUM(TotalAmount) AS Collected
            FROM paymentdetail WHERE TenantId = ? GROUP BY TransactionDetailLogId
        ) p ON p.TransactionDetailLogId = l.Id
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')`,

      // ── Returns, as their own measure ─────────────────────────────────────
      //
      // Deliberately a SEPARATE aggregate rather than a negative folded into
      // SALES_SUMMARY. Gross for a closed period must never change: a refund
      // processed in March cannot be allowed to alter February's reported
      // sales, or the number stops being trustworthy. Reports show
      // Gross · Returns · Net, where only the last two move.
      RETURNS_SUMMARY: `
        SELECT
          COUNT(*)                            AS ReturnCount,
          COALESCE(SUM(l.GrossAmount), 0)     AS ReturnedAmount,
          COALESCE(SUM(l.NetAmount), 0)       AS ReturnedNet,
          COALESCE(SUM(l.TaxAmount), 0)       AS ReturnedTax
        FROM transactiondetaillog l
        JOIN transactiontype t ON t.Id = l.TransactionTypeId
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND l.Active = 1`,

      RETURNS_TREND: `
        SELECT
          {{BUCKET}}                          AS Bucket,
          COUNT(*)                            AS ReturnCount,
          COALESCE(SUM(l.GrossAmount), 0)     AS ReturnedAmount
        FROM transactiondetaillog l
        JOIN transactiontype t ON t.Id = l.TransactionTypeId
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND l.Active = 1
        GROUP BY Bucket ORDER BY Bucket ASC`,

      // Whether returns are a kitchen problem, a menu problem or a till
      // problem. Unanswerable while the reason was free text typed by twelve
      // cashiers — see pos_return_reason.
      RETURN_REASONS: `
        SELECT
          COALESCE(rr.Name, 'Unspecified')    AS ReasonName,
          COALESCE(rr.Code, 'NONE')           AS ReasonCode,
          COALESCE(rr.IsFault, 0)             AS IsFault,
          COUNT(*)                            AS ReturnCount,
          COALESCE(SUM(l.GrossAmount), 0)     AS ReturnedAmount
        FROM transactiondetaillog l
        JOIN transactiontype t ON t.Id = l.TransactionTypeId
        LEFT JOIN pos_return_reason rr ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND l.Active = 1
        GROUP BY rr.Id, rr.Name, rr.Code, rr.IsFault
        ORDER BY ReturnedAmount DESC`,

      // WHICH DISHES COME BACK, and at what rate.
      //
      // Only answerable because a credit note carries its own priced lines and
      // each names the sale line it reverses. Before that the data did not
      // exist at any granularity — refundSale() took only (logId, reason).
      RETURN_BY_PRODUCT: `
        SELECT
          ti.ItemId,
          i.Name                              AS ItemName,
          COALESCE(SUM(ti.Quantity), 0)       AS QuantityReturned,
          COALESCE(SUM(ti.GrossAmount), 0)    AS ReturnedAmount,
          COUNT(DISTINCT ti.TransactionDetailLogId) AS ReturnCount,
          SUM(CASE WHEN ti.RestockRequested = 1 THEN ti.Quantity ELSE 0 END) AS QuantityRestockable
        FROM transactionitemdetail ti
        JOIN transactiondetaillog l ON l.Id = ti.TransactionDetailLogId AND l.TenantId = ti.TenantId
        JOIN transactiontype t ON t.Id = l.TransactionTypeId
        LEFT JOIN itemdetail i ON i.Id = ti.ItemId AND i.TenantId = ti.TenantId
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND l.Active = 1
        GROUP BY ti.ItemId, i.Name
        ORDER BY ReturnedAmount DESC`,

      SALES_TREND: `
        SELECT
          {{BUCKET}}                              AS Bucket,
          COUNT(*)                                AS Documents,
          COALESCE(SUM(l.GrossAmount), 0)         AS GrossAmount,
          COALESCE(SUM(l.DiscountAmount), 0)      AS DiscountAmount,
          COALESCE(SUM(l.TaxAmount), 0)           AS TaxAmount
        FROM transactiondetaillog l
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        JOIN transactiontype t       ON t.Id = l.TransactionTypeId
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
        GROUP BY Bucket ORDER BY Bucket ASC`,

      // Product performance. Quantity, revenue and discount come from the line
      // snapshots, so a renamed or repriced item cannot rewrite history.
      PRODUCT_SALES: `
        SELECT
          ti.ItemId,
          i.Name                                  AS ItemName,
          c.Name                                  AS CategoryName,
          COALESCE(SUM(ti.Quantity), 0)           AS QuantitySold,
          COALESCE(SUM(ti.NetAmount), 0)          AS NetAmount,
          COALESCE(SUM(ti.DiscountAmount), 0)     AS DiscountAmount,
          COALESCE(SUM(ti.TaxAmount), 0)          AS TaxAmount,
          COALESCE(SUM(ti.GrossAmount), 0)        AS GrossAmount,
          COUNT(DISTINCT ti.TransactionDetailLogId) AS Documents
        FROM transactionitemdetail ti
        JOIN transactiondetaillog l  ON l.Id = ti.TransactionDetailLogId
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        LEFT JOIN itemdetail i       ON i.Id = ti.ItemId
        LEFT JOIN categorydetail c   ON c.Id = i.CategoryId
        WHERE ti.TenantId = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL`,

      // Revenue by floor and table.
      //
      // The ledger has no idea what a table is, so this walks BACKWARDS to find
      // out: document ← pos_bill ← pos_bill_order → pos_order, and reads the
      // venue SNAPSHOT frozen on the round (see modules/posorder/posVenue.js) so
      // renaming a table or moving it between floors cannot rewrite history.
      //
      // A bill can cover several rounds, possibly on different tables, so that
      // join fans out and a naive SUM(l.GrossAmount) would count one document
      // once per round. Each document's amounts are therefore APPORTIONED across
      // its rounds by the round's share of the bill (o.Total / SUM(o.Total)) —
      // the same principle the pricing engine uses to spread a discount. The
      // consequence that matters: this report's total ties back to the sales
      // report exactly, instead of being a plausible but different number.
      //
      // Derived table rather than a window function: nothing else in this
      // codebase needs one, and a single report is a poor reason to take a
      // dependency on the server's MySQL version.
      // Table-less rounds are named by CHANNEL rather than pooled under one
      // 'No table' row. Counter and delivery are different businesses, and a
      // single anonymous bucket holding both grows with counter volume while
      // reading like a floor-plan gap.
      VENUE_REVENUE: `
        SELECT
          o.FloorId                                     AS FloorId,
          COALESCE(o.FloorName, 'Unassigned')           AS FloorName,
          o.TableId                                     AS TableId,
          COALESCE(o.TableName, ${CHANNEL_LABEL_SQL})   AS TableName,
          MAX(o.TableCapacity)                          AS Capacity,
          ${APPORTIONED_MONEY_SQL}
        ${APPORTIONED_SALE_ROUNDS_SQL}`,

      // The grouping the projection above requires, kept beside it so the two
      // cannot drift.
      //
      // The channel expression is REPEATED here rather than referenced by its
      // alias: `TableName` in a GROUP BY resolves to the real pos_order column
      // of that name, not to the aliased expression, which leaves o.OrderType
      // ungrouped and fails outright under only_full_group_by.
      VENUE_GROUP_BY: `
        GROUP BY o.FloorId, FloorName, o.TableId, COALESCE(o.TableName, ${CHANNEL_LABEL_SQL})
        ORDER BY GrossAmount DESC`,

      // The same money, cut by WHERE THE SALE HAPPENED rather than by table.
      // Counter revenue was previously invisible: it is in every total, but no
      // report could name it, so "how much came over the counter today?" had no
      // answer. Built on the same apportioned join as the venue report, so the
      // two can never disagree about the same bill.
      CHANNEL_REVENUE: `
        SELECT
          ${CHANNEL_LABEL_SQL}                          AS Channel,
          ${APPORTIONED_MONEY_SQL}
        ${APPORTIONED_SALE_ROUNDS_SQL}`,

      // How much we gave away, per product, split by WHY.
      // ItemDiscountAmount is the part decided on the dish itself; the remainder
      // is its share of a whole-bill discount. Only the first answers "which
      // products do we choose to discount?".
      DISCOUNT_SUMMARY: `
        SELECT
          COUNT(DISTINCT l.Id)                                       AS Documents,
          COALESCE(SUM(ti.DiscountAmount), 0)                        AS DiscountAmount,
          COALESCE(SUM(ti.ItemDiscountAmount), 0)                    AS ItemDiscountAmount,
          COALESCE(SUM(ti.DiscountAmount - ti.ItemDiscountAmount), 0) AS BillDiscountAmount,
          COALESCE(SUM(ti.GrossAmount), 0)                           AS GrossAmount
        FROM transactionitemdetail ti
        JOIN transactiondetaillog l  ON l.Id = ti.TransactionDetailLogId
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        WHERE ti.TenantId = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL`,

      DISCOUNT_BY_PRODUCT: `
        SELECT
          ti.ItemId,
          i.Name                                                     AS ItemName,
          COALESCE(SUM(ti.Quantity), 0)                              AS QuantitySold,
          COALESCE(SUM(ti.DiscountAmount), 0)                        AS DiscountAmount,
          COALESCE(SUM(ti.ItemDiscountAmount), 0)                    AS ItemDiscountAmount,
          COALESCE(SUM(ti.DiscountAmount - ti.ItemDiscountAmount), 0) AS BillDiscountAmount,
          COALESCE(SUM(ti.GrossAmount), 0)                           AS GrossAmount,
          COUNT(DISTINCT ti.TransactionDetailLogId)                  AS Documents
        FROM transactionitemdetail ti
        JOIN transactiondetaillog l  ON l.Id = ti.TransactionDetailLogId
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        LEFT JOIN itemdetail i       ON i.Id = ti.ItemId
        WHERE ti.TenantId = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL
          AND ti.DiscountAmount > 0`,

      DISCOUNT_BY_BILL: `
        SELECT
          l.Id, l.TransactionNo, l.TransactionDate, l.CustomerName,
          l.GrossAmount, l.DiscountAmount,
          COALESCE(SUM(ti.ItemDiscountAmount), 0)                    AS ItemDiscountAmount,
          l.DiscountAmount - COALESCE(SUM(ti.ItemDiscountAmount), 0) AS BillDiscountAmount
        FROM transactiondetaillog l
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        JOIN transactiontype t       ON t.Id = l.TransactionTypeId
        LEFT JOIN transactionitemdetail ti
               ON ti.TransactionDetailLogId = l.Id AND ti.TenantId = l.TenantId
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.DiscountAmount > 0`,

      // Unpaid: what has been invoiced but not fully collected.
      PENDING_PAYMENT: `
        SELECT
          l.Id, l.TransactionNo, l.TransactionDate, l.GrossAmount,
          l.CustomerName, l.CustomerMobile,
          COALESCE(p.Collected, 0)                        AS Collected,
          l.GrossAmount - COALESCE(p.Collected, 0)        AS Outstanding
        FROM transactiondetaillog l
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        JOIN transactiontype t       ON t.Id = l.TransactionTypeId
        LEFT JOIN (
          SELECT TransactionDetailLogId, SUM(TotalAmount) AS Collected
            FROM paymentdetail WHERE TenantId = ? GROUP BY TransactionDetailLogId
        ) p ON p.TransactionDetailLogId = l.Id
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND l.GrossAmount - COALESCE(p.Collected, 0) > 0
        ORDER BY l.TransactionDate DESC`,

      // Unbilled: rounds still open on the floor. Operational, so it reads the
      // POS tables — there is no document for a sale that has not happened.
      PENDING_UNBILLED: `
        SELECT o.Id, o.OrderNo, o.OrderType, o.Status, o.Items, o.Total, o.CreatedOn,
               o.TableId, o.BranchDetailId
          FROM pos_order o
          LEFT JOIN pos_bill_order bo ON bo.OrderId = o.Id AND bo.TenantId = o.TenantId
          LEFT JOIN pos_bill b        ON b.Id = bo.BillId AND b.TenantId = o.TenantId
         WHERE o.TenantId = ?
           AND o.CreatedOn BETWEEN ? AND ?
           AND (b.Id IS NULL OR b.Status IN ('unpaid', 'partially_paid'))
         ORDER BY o.CreatedOn DESC`,

      // Tender mix / Z-report. Refunds and expense payments are negative rows,
      // so SUM() nets them without a special case.
      TENDER_MIX: `
        SELECT
          pm.Id                                   AS PaymentModeId,
          pm.Type                                 AS PaymentMode,
          a.Name                                  AS AccountName,
          a.Kind                                  AS AccountKind,
          COUNT(*)                                AS Tenders,
          COALESCE(SUM(CASE WHEN b.Amount > 0 THEN b.Amount ELSE 0 END), 0) AS Inflow,
          COALESCE(SUM(CASE WHEN b.Amount < 0 THEN -b.Amount ELSE 0 END), 0) AS Outflow,
          COALESCE(SUM(b.Amount), 0)              AS NetAmount
        FROM paymentbreakup b
        JOIN paymentmodetransactiondetail pmtd ON pmtd.Id = b.PaymentModeTransactionDetailId
        JOIN paymentmode pm  ON pm.Id = pmtd.PaymentModeId
        LEFT JOIN accounttypebase a ON a.Id = b.AccountTypeBaseId
        WHERE b.TenantId = ? AND b.Timestamp BETWEEN ? AND ?
        GROUP BY pm.Id, pm.Type, a.Name, a.Kind
        ORDER BY NetAmount DESC`,

      // Cash flow per account. Only asset accounts hold money, so this is the
      // "where is the cash" view rather than the "what did we earn" view.
      CASH_FLOW: `
        SELECT
          a.Id                                    AS AccountTypeBaseId,
          a.Name                                  AS AccountName,
          a.Kind                                  AS AccountKind,
          COALESCE(SUM(CASE WHEN b.Amount > 0 THEN b.Amount ELSE 0 END), 0) AS Inflow,
          COALESCE(SUM(CASE WHEN b.Amount < 0 THEN -b.Amount ELSE 0 END), 0) AS Outflow,
          COALESCE(SUM(b.Amount), 0)              AS NetMovement
        FROM paymentbreakup b
        JOIN accounttypebase a ON a.Id = b.AccountTypeBaseId
        WHERE b.TenantId = ? AND a.Kind = 'ASSET' AND b.Timestamp BETWEEN ? AND ?
        GROUP BY a.Id, a.Name, a.Kind
        ORDER BY a.Name ASC`,

      // Expected cash for a till: opening float plus every cash movement in the
      // session's window at that branch. Sales add, expenses and refunds subtract
      // — all of them are already rows in paymentbreakup.
      SESSION_CASH_MOVEMENT: `
        SELECT COALESCE(SUM(b.Amount), 0) AS NetCash
          FROM paymentbreakup b
          JOIN paymentdetail pd ON pd.Id = b.PaymentDetailId AND pd.TenantId = b.TenantId
          JOIN transactiondetaillog l ON l.Id = pd.TransactionDetailLogId
          JOIN accounttypebase a ON a.Id = b.AccountTypeBaseId
         WHERE b.TenantId = ? AND a.Name = 'Cash'
           AND (l.BranchId = ? OR ? IS NULL)
           AND b.Timestamp >= ? AND b.Timestamp <= ?`,

      // Spend by category, from the Expense documents rather than pos_expense,
      // so an unapproved claim never counts as a cost.
      EXPENSE_SUMMARY: `
        SELECT
          ec.Id                                   AS ExpenseCategoryId,
          ec.Name                                 AS CategoryName,
          COUNT(*)                                AS Entries,
          COALESCE(SUM(e.Amount), 0)              AS Amount
        FROM pos_expense e
        JOIN expense_category ec ON ec.Id = e.ExpenseCategoryId
        JOIN transactiondetaillog l ON l.Id = e.TransactionDetailLogId
        WHERE e.TenantId = ? AND l.TransactionDate BETWEEN ? AND ?
        GROUP BY ec.Id, ec.Name
        ORDER BY Amount DESC`,

      EXPENSE_TREND: `
        SELECT {{BUCKET}} AS Bucket,
               COUNT(*)                           AS Entries,
               COALESCE(SUM(e.Amount), 0)         AS Amount
        FROM pos_expense e
        JOIN transactiondetaillog l ON l.Id = e.TransactionDetailLogId
        WHERE e.TenantId = ? AND l.TransactionDate BETWEEN ? AND ?
        GROUP BY Bucket ORDER BY Bucket ASC`,
    },

    // Tax & pricing chain: costinfo → taxgroup → taxgrouptaxtypemapper → TaxTypes.
    // Every join is tenant-scoped AND Active-filtered, so deactivating a tax type
    // silently drops it out of its group — the intended way to retire a component.
    // One row per (costinfo × tax type); the service groups them.
    PRICING: {
      SELECT_CHAIN_BY_COSTINFO_IDS: `
        SELECT ci.Id AS CostInfoId, ci.Amount, ci.IsTaxIncluded,
               tg.Id AS TaxGroupId, tg.Name AS TaxGroupName,
               tt.Id AS TaxTypeId, tt.Name AS TaxTypeName, tt.Value AS TaxTypeValue
        FROM costinfo ci
        LEFT JOIN taxgroup tg
               ON tg.Id = ci.TaxGroupId AND tg.TenantId = ci.TenantId AND tg.Active = 1
        LEFT JOIN taxgrouptaxtypemapper tgm
               ON tgm.TaxGroupId = tg.Id AND tgm.TenantId = ci.TenantId AND tgm.Active = 1
        LEFT JOIN TaxTypes tt
               ON tt.Id = tgm.TaxTypeId AND tt.TenantId = ci.TenantId AND tt.Active = 1
        WHERE ci.TenantId = ? AND ci.Id IN (:ids)`,
      SELECT_CHAIN_BY_GROUP_ID: `
        SELECT tg.Id AS TaxGroupId, tg.Name AS TaxGroupName,
               tt.Id AS TaxTypeId, tt.Name AS TaxTypeName, tt.Value AS TaxTypeValue
        FROM taxgroup tg
        LEFT JOIN taxgrouptaxtypemapper tgm
               ON tgm.TaxGroupId = tg.Id AND tgm.TenantId = tg.TenantId AND tgm.Active = 1
        LEFT JOIN TaxTypes tt
               ON tt.Id = tgm.TaxTypeId AND tt.TenantId = tg.TenantId AND tt.Active = 1
        WHERE tg.TenantId = ? AND tg.Id = ? AND tg.Active = 1`,
    },

    // First-time master-data setup state, one row per tenant. A missing row is
    // equivalent to PENDING — see database/01-schema-definition.sql §1.1b.
    TENANT_SETUP: {
      SELECT_BY_TENANT:
        'SELECT tenant_id, status, completed_at, completed_by FROM tenant_setup WHERE tenant_id = ?',
      UPSERT_COMPLETED:
        "INSERT INTO tenant_setup (tenant_id, status, completed_at, completed_by) VALUES (?, 'COMPLETED', NOW(), ?) ON DUPLICATE KEY UPDATE status = 'COMPLETED', completed_at = NOW(), completed_by = VALUES(completed_by)",
    },

    // Per-tenant IAM provisioning (clone the standard role catalog to a new tenant)
    TENANT_PROVISION: {
      SELECT_TEMPLATE_ROLES:
        'SELECT id, name, description, is_system_role, is_active FROM roles WHERE tenant_id = ?',
      INSERT_ROLE_FULL:
        'INSERT INTO roles (id, tenant_id, name, description, is_system_role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      SELECT_ROLE_FEATURE_IDS:
        'SELECT feature_id FROM role_permissions WHERE role_id = ?',
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
    FAILED: 'FAILED',
    // A bulk operation where some rows succeeded and some did not. Neither
    // SUCCESS nor FAILED is true of it, and the audit trail should not have
    // to round one way or the other.
    PARTIAL: 'PARTIAL',
    DENIED: 'DENIED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_ATTEMPT: 'LOGIN_ATTEMPT',
    LOGIN_CRASH: 'LOGIN_CRASH',
    SWITCH_TENANT_DENIED: 'SWITCH_TENANT_DENIED',
    NOT_FOUND: '403_NOT_FOUND',
    FORBIDDEN: '403_FORBIDDEN',
    UNAUTHORIZED: '401_UNAUTHORIZED',
    ONBOARDING_ATTEMPT: 'ONBOARDING_ATTEMPT',
    ONBOARDING_APPROVED: 'ONBOARDING_APPROVED',
    ONBOARDING_AUTO_APPROVED: 'ONBOARDING_AUTO_APPROVED',
    ONBOARDING_REJECTED: 'ONBOARDING_REJECTED',
    ONBOARDING_REOPENED: 'ONBOARDING_REOPENED',
    CREATED: 'CREATED',
    UPDATED: 'UPDATED',
    DELETED: 'DELETED',
    SUSPENDED: 'SUSPENDED',
    ACTIVATED: 'ACTIVATED',
  },
  // Canonical POS status vocabularies — single source of truth shared by the
  // Joi validation schemas, the Swagger docs and the frontend, which colour-codes
  // by these exact values.
  //
  // All lowercase, matching the DDL defaults (pos_table 'free', pos_order 'open',
  // pos_kot 'pending', pos_order.OrderType 'dinein'). Mixed casing is what made
  // the KDS and the dashboard disagree: readers compared 'Ready' against a server
  // that only ever wrote 'ready', so every KOT counted as pending forever. The
  // schemas below normalize with .lowercase(), so a stale title-case payload
  // converges rather than being rejected.
  POS_TABLE_STATUSES: ['free', 'occupied', 'reserved'],
  POS_ORDER_STATUSES: ['open', 'fired', 'closed', 'cancelled'],
  POS_ORDER_TYPES: ['dinein', 'takeaway', 'delivery'],
  POS_KOT_STATUSES: ['pending', 'ready', 'cancelled'],
  POS_TOKEN_STATUSES: ['waiting', 'called', 'served', 'cancelled'],

  // How a branch numbers its counter tokens. Configured per branch in
  // pos_setting under POS_SETTING_KEYS.TOKEN_NUMBERING.
  //   DAILY  — restarts at 1 every day, per branch. What a physical token
  //            counter does, and what keeps the number short enough to call out.
  //   SERIES — continuous TOK-0001 from the POS_TOKEN numbering series. That
  //            series lives in transactiontypeconfig, which is TENANT-scoped, so
  //            branches sharing a tenant share the counter.
  // How spend becomes loyalty. One number, named, because it appears in the
  // live settle path AND in the rebuild that recomputes the projection from the
  // ledger — two implementations of "how many points is that?" would drift.
  // Invitations. A fortnight is long enough for somebody to get around to
  // signing in, and short enough that a forgotten invitation to an ex-employee
  // does not stay live indefinitely.
  INVITATION: { EXPIRY_DAYS: 14 },

  LOYALTY: {
    // Fallback only. A tenant's own rate lives in pos_setting under
    // 'loyalty.rupees_per_point' — the same per-branch mechanism token
    // numbering already uses, rather than a second configuration store.
    RUPEES_PER_POINT: 100,
    SETTING_KEY: 'loyalty.rupees_per_point',   // = POS_SETTING_KEYS.LOYALTY_RATE
    ENTRY: {
      EARN: 'EARN',
      REVERSAL: 'REVERSAL',
      REDEEM: 'REDEEM',
      ADJUSTMENT: 'ADJUSTMENT',
      EXPIRY: 'EXPIRY',
    },
    // RETURN is what makes a SECOND partial refund legal. The ledger's
    // UNIQUE (TenantId, SourceType, SourceId, EntryType) rejects a second
    // REVERSAL against the same BILL — correct, it is what stops a dropped
    // response clawing back twice — so each credit note is its own source
    // instead of weakening the key.
    SOURCE: { BILL: 'BILL', RETURN: 'RETURN', MANUAL: 'MANUAL', RULE: 'RULE' },
  },

  TOKEN_NUMBERING: { DAILY: 'daily', SERIES: 'series' },
  // Absence of a pos_setting row means DAILY — a branch that has never been
  // configured behaves like a token counter, which is the unsurprising default.
  TOKEN_NUMBERING_DEFAULT: 'daily',
  POS_SETTING_KEYS: {
    TOKEN_NUMBERING: 'token.numbering',
    // How spend becomes points. Registered here so the settings endpoint can
    // actually write it: keys are whitelisted, and a key the reader knows but
    // the whitelist does not is a setting that silently cannot be changed.
    LOYALTY_RATE: 'loyalty.rupees_per_point',
  },
  // Series tag + fallback prefix for 'series' numbering.
  POS_TOKEN_SERIES: { TAG: 'POS_TOKEN', PREFIX: 'TOK' },
  // Ordered: the Tracking board advances an order one stage at a time, so the
  // order of this list IS the workflow. 'cancelled' is an exit, not a stage.
  POS_ONLINE_ORDER_STAGES: ['new', 'accepted', 'processing', 'out for delivery', 'delivered'],
  POS_ONLINE_ORDER_STATUSES: [
    'new', 'accepted', 'processing', 'out for delivery', 'delivered', 'cancelled',
  ],

  // ── Portals ──────────────────────────────────────────────────────────────
  //
  // Which move is legal from which state. The queue used to jump 'new' straight
  // to 'processing' on Accept while the tracking board drew 'accepted' as stage
  // one, so the status a manager read never matched the button a cashier had
  // pressed. One table, consulted by both.
  //
  // 'cancelled' is an exit from any live state, never a stage.
  POS_ONLINE_ORDER_TRANSITIONS: {
    new: ['accepted', 'cancelled'],
    accepted: ['processing', 'cancelled'],
    processing: ['out for delivery', 'delivered', 'cancelled'],
    'out for delivery': ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  },
  // Portals require a coded reason on a rejection, so it is not free text.
  POS_ONLINE_ORDER_REJECT_REASONS: [
    'out_of_stock', 'kitchen_full', 'store_closed', 'item_unavailable',
    'unable_to_deliver', 'other',
  ],
  // Whether a listing matches what the portal currently shows.
  POS_PORTAL_SYNC_STATUSES: ['pending', 'synced', 'failed'],
  // Adapter slugs. 'manual' always ships: it is the fallback when an
  // integration is down, the harness the others are tested against, and what a
  // tenant with no API access uses forever.
  POS_PORTAL_ADAPTERS: ['manual', 'zomato.v1', 'swiggy.v1', 'district.v1'],
  POS_PORTAL_DEFAULT_ADAPTER: 'manual',
  // What the ingest pipeline records about one inbound event.
  POS_PORTAL_EVENT_STATUSES: ['received', 'processed', 'duplicate', 'failed', 'needs_mapping'],
  POS_PORTAL_EVENT_TYPES: [
    'order.created', 'order.updated', 'order.cancelled', 'rider.assigned',
  ],
  // The channel a portal sells on, by code. Portals hang off this channel and
  // the listing gate is checked against it.
  POS_ONLINE_CHANNEL_CODE: 'ONLINE',
  AUDIT_CATEGORIES: {
    AUTH:         'AUTH',
    ONBOARDING:   'ONBOARDING',
    USER_MGMT:    'USER_MGMT',
    ROLE_MGMT:    'ROLE_MGMT',
    FEATURE_MGMT: 'FEATURE_MGMT',
    TENANT_MGMT:  'TENANT_MGMT',
    TRANSACTION:  'TRANSACTION',
    MASTER_DATA:  'MASTER_DATA',
    PAYMENTS:     'PAYMENTS',
    REPORTS:      'REPORTS',
    POS:          'POS',
    GENERAL:      'GENERAL',
  },
  AUDIT_ACTIONS: {
    // Auth
    LOGIN_SUCCESS:            'User signed in',
    LOGIN_ATTEMPT:            'Sign-in attempted',
    LOGIN_CRASH:              'Sign-in failed (system error)',
    LOGOUT:                   'User signed out',
    SWITCH_TENANT:            'Switched tenant',
    SWITCH_TENANT_DENIED:     'Tenant switch denied (no access)',
    // Onboarding
    ONBOARDING_ATTEMPT:       'Onboarding request submitted',
    ONBOARDING_APPROVED:      'Onboarding request approved',
    ONBOARDING_AUTO_APPROVED: 'Onboarding request auto-approved',
    ONBOARDING_REJECTED:      'Onboarding request rejected',
    CHECK_ONBOARDING_STATUS:  'Checked onboarding status',
    UPDATE_ONBOARDING_NOTE:   'Updated onboarding note',
    VIEW_ONBOARDING:          'Viewed pending onboarding requests',
    APPROVE_ONBOARDING:       'Approved onboarding request',
    REJECT_ONBOARDING:        'Rejected onboarding request',
    REOPEN_ONBOARDING:        'Reopened rejected onboarding request',
    // User management
    VIEW_USERS:               'Viewed user list',
    VIEW_USER_DETAIL:         'Viewed user details',
    VIEW_USER_ROLES:          'Viewed user roles',
    UPDATE_USER_ROLES:        'Updated user roles',
    UPDATE_USER_STATUS:       'Updated user status',
    ACTIVATE_USER:            'Activated user account',
    SUSPEND_USER:             'Suspended user account',
    REMOVE_USER:              'Removed user from tenant',
    // Role management
    VIEW_ROLES:               'Viewed roles list',
    CREATE_ROLE:              'Created new role',
    UPDATE_ROLE:              'Updated role details',
    DELETE_ROLE:              'Deleted role',
    VIEW_ROLE_PERMISSIONS:    'Viewed role permissions',
    UPDATE_ROLE_PERMISSIONS:  'Updated role permissions',
    // Feature management
    VIEW_FEATURES:            'Viewed features list',
    CREATE_FEATURE:           'Created new feature',
    UPDATE_FEATURE:           'Updated feature',
    DELETE_FEATURE:           'Deleted feature',
    // First-time tenancy setup
    MASTER_SETUP_COMPLETED:   'Completed first-time tenancy setup',
    MASTER_SETUP_BLOCKED:     'Access blocked — tenancy setup incomplete',
    // Data / reports
    VIEW_ADMIN_SETTINGS:      'Viewed admin settings',
    VIEW_GENERAL_DATA:        'Viewed general data',
    VIEW_REPORTS:             'Viewed reports',
    VIEW_BILLING:             'Viewed billing data',
    VIEW_AUDIT_LOGS:          'Viewed audit logs',
    // General
    VIEW_APPLICATION:         'Viewed application',
    VIEW_APP_CONFIG:          'Viewed application configuration',
    UPDATE_APP_CONFIG:        'Updated application configuration',
  },
  DEFAULTS: {
    AUDIT_LIMIT: 50,
    AUDIT_OFFSET: 0,
    AUDIT_MAX_LIMIT: 500,
  },
  // Onboarding auto-approval configuration.
  // TEMPLATE_TENANT_ID is the reference tenant whose standard role catalog is
  // cloned into every auto-created tenant (the seeded ANM Tech tenant).
  ONBOARDING: {
    SETTING_AUTO_APPROVE: 'onboarding.auto_approve.enabled',
    TEMPLATE_TENANT_ID:
      process.env.ONBOARDING_TEMPLATE_TENANT_ID ||
      'e3845e08-dcc2-11f0-8e78-0242ac110002',
    AUTO_APPROVE_ROLE: 'TENANT_ADMIN',
    AUTO_REVIEWER: 'system-auto',
  },
  // Accounting ledger master names. The ledger addresses masters by MEANING,
  // not by id, so seeds can be re-issued without breaking code. Values must
  // match database/02-seed-data.sql PART 11.
  LEDGER: {
    TYPE_POS_SALE:        'POS Sale',
    TYPE_EXPENSE:         'Expense',
    // A credit note. Its own document type with its own number series, because
    // a return IS a document — not a status the sale moves into. See
    // ledger.returns.service.js for why that distinction carries the feature.
    TYPE_POS_RETURN:      'POS Return',
    STATUS_DRAFT:         'DRAFT',
    STATUS_PARTIALLY_PAID:'PARTIALLY_PAID',
    STATUS_SETTLED:       'SETTLED',
    STATUS_CANCELLED:     'CANCELLED',
    STATUS_REFUNDED:      'REFUNDED',
    ACCOUNT_SALES:        'Sales',
    ACCOUNT_CASH:         'Cash',
    ACCOUNT_EXPENSES:     'Expenses',
    // Store credit is a LIABILITY, not money leaving the drawer. Issuing it as
    // a cash refund would make the till short by an amount that never left it.
    ACCOUNT_STORE_CREDIT: 'Store Credit',
    RECEIVED_FULL:        'Full',
    RECEIVED_PARTIAL:     'Partial',
    RECEIVED_REFUND:      'Refund',
    RECEIVED_PAYMENT:     'Payment',
    // A settled document is never edited — corrections happen by reversal.
    IMMUTABLE_STATUSES:   ['SETTLED', 'PARTIALLY_PAID', 'REFUNDED', 'CANCELLED'],
    // Modes that must carry a reference number for reconciliation.
    REF_REQUIRED_MODES:   ['Card', 'UPI', 'Wallet'],

    // ── Returns ────────────────────────────────────────────────────────────
    //
    // How refunded a SALE is. Deliberately NOT a stored status: it is derived
    // from SUM(credit notes) against GrossAmount, so a second partial return
    // needs no state transition and the sale itself is never mutated.
    REFUND_STATE: {
      NONE:      'NONE',
      PARTIAL:   'PARTIALLY_REFUNDED',
      FULL:      'REFUNDED',
    },
    // Has the money actually gone back? Every refund today is executed at the
    // till, so PENDING → SETTLED is a human marking it done. The vocabulary
    // exists now so a gateway can be wired in later without reshaping
    // documents already written.
    SETTLEMENT_STATUS: {
      PENDING: 'PENDING',
      SETTLED: 'SETTLED',
      FAILED:  'FAILED',
    },
    SETTLEMENT_STATUSES: ['PENDING', 'SETTLED', 'FAILED'],
    // Where the refund goes. ORIGINAL mirrors each tender back to the mode it
    // arrived on; STORE_CREDIT books a liability instead of moving money.
    REFUND_DESTINATION: { ORIGINAL: 'ORIGINAL', STORE_CREDIT: 'STORE_CREDIT' },
    // How a partial refund is split across the tenders the sale was paid with.
    //
    // CASH_FIRST is what a till actually does and is what keeps a drawer count
    // honest. The invariant that matters more than the choice: NO MODE IS EVER
    // REFUNDED MORE THAN IT RECEIVED — otherwise a sequence of partial returns
    // can hand back cash the customer never paid in cash.
    TENDER_APPORTIONMENT: 'CASH_FIRST',
  },

  // Why goods came back. Seeded as a master (pos_return_reason) so returns can
  // be GROUPED; the free-text note rides alongside rather than instead of it.
  // IsFault separates "we got it wrong" from "they changed their mind", which
  // is what turns a refund report into a kitchen-quality signal.
  // [Name, Code, IsFault, SortOrder]
  POS_RETURN_REASONS: [
    ['Wrong item served',    'WRONG_ITEM',   1, 1],
    ['Quality complaint',    'QUALITY',      1, 2],
    ['Item arrived late',    'LATE',         1, 3],
    ['Item unavailable',     'UNAVAILABLE',  1, 4],
    ['Billed in error',      'BILLING_ERROR', 1, 5],
    ['Customer changed mind', 'CHANGED_MIND', 0, 6],
    ['Other',                'OTHER',        0, 7],
  ],

  // POS bill lifecycle. These strings are written by settle and read by every
  // report; they were previously inline literals, and a report filtering on
  // 'Settled' against a service writing 'paid' silently returned zero revenue.
  POS_BILL_STATUS: {
    UNPAID:         'unpaid',
    PARTIALLY_PAID: 'partially_paid',
    PAID:           'paid',
    // Some of it came back, the rest stands. Without this a partly-returned
    // bill had to claim either 'paid' (a lie by omission) or 'refunded' (a lie
    // outright), and every report reading this column inherited the lie.
    PARTIALLY_REFUNDED: 'partially_refunded',
    REFUNDED:       'refunded',
    VOID:           'void',
  },

  // Expense lifecycle. A DRAFT claim is not a cost; only settling posts to the
  // ledger, which is why APPROVED sits between the two.
  EXPENSE_STATUS: {
    DRAFT:     'draft',
    APPROVED:  'approved',
    SETTLED:   'settled',
    CANCELLED: 'cancelled',
  },

  CASH_SESSION_STATUS: {
    OPEN:   'open',
    CLOSED: 'closed',
  },

  ASSET_STATUS: {
    IN_USE:       'in_use',
    UNDER_REPAIR: 'under_repair',
    RETIRED:      'retired',
  },

  // First-time tenancy (master-data) setup gate.
  TENANT_SETUP: {
    STATUS_PENDING: 'PENDING',
    STATUS_COMPLETED: 'COMPLETED',
    // Machine-readable code on the 403 the gate returns, so clients can route
    // the user to the wizard instead of matching on message text.
    ERROR_CODE: 'TENANT_SETUP_REQUIRED',
    // Path prefixes that stay reachable while a tenant's setup is incomplete:
    // sign-in, the guest/onboarding flow, logout/profile, audit logs, the setup
    // wizard itself, tenant switching, and the super-admin app-config endpoint.
    ALLOWED_PATH_PREFIXES: [
      '/api/auth',
      '/api/onboarding',
      '/api/user',
      '/api/audit',
      '/api/master-data',
      '/api/tenants',
      '/api/admin/app-config',
      '/api-docs',
    ],
  },
  // Bulk import limits. 500 bounds one request without a paging protocol; a
  // menu larger than that is a data migration, not a menu, and should not be
  // arriving through a form in somebody's browser.
  IMPORT: {
    MAX_ROWS: 500,
    ON_DUPLICATE: { SKIP: 'skip', UPDATE: 'update' },
    // When a row names a tax group but states no components, these are applied.
    // A deliberate product decision: an Indian restaurant menu is 5% GST split
    // CGST/SGST intra-state, and a menu that silently prices at 0% is the worse
    // failure. The preview says how many rows this will touch, so it is never
    // applied without being announced — and any row that states its own
    // components overrides it entirely.
    DEFAULT_TAX_COMPONENTS: [
      { name: 'CGST', value: '2.5' },
      { name: 'SGST', value: '2.5' },
    ],
  },

  SCOPES: {
    TENANT_ADMIN: 'TENANT:ADMIN',
    TENANT_SUPER_ADMIN: 'TENANT:SUPER_ADMIN',
    REPORTS_READ: 'REPORTS:READ',
    REPORTS_WRITE: 'REPORTS:WRITE',
    BILLING_READ: 'billing:READ',
    BILLING_WRITE: 'billing:WRITE',
    GUEST_EXPLORE: 'guest:explore',
    ADMIN_ACCESS: 'admin:access',
    AUDIT_READ: 'AUDIT:READ',
    // Feature-category scopes (granted via IAM roles → role_permissions → features)
    MASTER_DATA_READ: 'MASTER_DATA:READ',
    MASTER_DATA_WRITE: 'MASTER_DATA:WRITE',
    ORGANIZATION_READ: 'ORGANIZATION:READ',
    ORGANIZATION_WRITE: 'ORGANIZATION:WRITE',
    TRANSACTIONS_READ: 'TRANSACTIONS:READ',
    TRANSACTIONS_WRITE: 'TRANSACTIONS:WRITE',
    INVENTORY_READ: 'INVENTORY:READ',
    INVENTORY_WRITE: 'INVENTORY:WRITE',
    CONTACTS_READ: 'CONTACTS:READ',
    CONTACTS_WRITE: 'CONTACTS:WRITE',
    PAYMENTS_READ: 'PAYMENTS:READ',
    PAYMENTS_WRITE: 'PAYMENTS:WRITE',
    // POS (Front Desk) feature-category scopes
    POS_CONFIG_READ: 'POS_CONFIG:READ',
    POS_CONFIG_WRITE: 'POS_CONFIG:WRITE',
    POS_ORDER_READ: 'POS_ORDER:READ',
    POS_ORDER_WRITE: 'POS_ORDER:WRITE',
    POS_KITCHEN_READ: 'POS_KITCHEN:READ',
    POS_KITCHEN_WRITE: 'POS_KITCHEN:WRITE',
    POS_BILLING_READ: 'POS_BILLING:READ',
    POS_BILLING_WRITE: 'POS_BILLING:WRITE',
    POS_CRM_READ: 'POS_CRM:READ',
    POS_CRM_WRITE: 'POS_CRM:WRITE',
    POS_OPS_READ: 'POS_OPS:READ',
    POS_OPS_WRITE: 'POS_OPS:WRITE',
    POS_REPORTS_READ: 'POS_REPORTS:READ',
    // Approving an expense commits money, so it is deliberately separate from
    // POS_OPS:WRITE — the person who raises a claim should not approve it.
    EXPENSE_APPROVE: 'EXPENSE:APPROVE',
    // The asset register is finance-owned reference data, not floor operations.
    ASSET_READ: 'ASSET:READ',
    ASSET_WRITE: 'ASSET:WRITE',
  },
};

// ─── Shared scope sets ────────────────────────────────────────────────────────
// Named unions used by more than one route module, so a rule is stated once
// instead of being copied — and so widening one is a reviewable edit in a single
// place rather than a guess made module by module.
//
// Declared after module.exports is assembled because they are built FROM
// SCOPES above.
const { SCOPES } = module.exports;

module.exports.SCOPE_SETS = {
  /**
   * POS reference data: the branches, floor plan, tables, menu, variants,
   * channels and food types that a Front Desk screen needs to draw itself.
   *
   * The rule this encodes: **a read follows the capability that needs it, not
   * the module that owns it.** The floor plan is POS config, but a till cannot
   * render its table grid without it, so gating it on POS_CONFIG alone meant
   * Billing was offered to POS_ORDER:READ and then refused its own contents.
   * The same held for the KDS, the Tables screen and Finance's venue report.
   *
   * This is NOT a return to granting whole categories per role — the failure
   * that PART 8b of the seed used to cause. That handed every ROLE READ on
   * twelve categories; this admits specific capabilities on specific ENDPOINTS,
   * for reads only. WRITE on every one of these stays POS_CONFIG:WRITE, so a
   * waiter can see the floor plan and still cannot edit it.
   *
   * Non-POS scopes are here for named reasons: TRANSACTIONS labels revenue by
   * venue on Finance, ASSET draws the branch picker on the register, and
   * ORGANIZATION covers master-data users reaching the same lists.
   */
  POS_REFERENCE_READ: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
    SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
    SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
    SCOPES.POS_KITCHEN_READ, SCOPES.POS_KITCHEN_WRITE,
    SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
    SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE,
    SCOPES.POS_REPORTS_READ,
    SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE,
    SCOPES.ASSET_READ, SCOPES.ASSET_WRITE,
    SCOPES.ORGANIZATION_READ, SCOPES.ORGANIZATION_WRITE,
  ],

  /**
   * Reading an ORDER, for screens that already display a reference to one.
   *
   * The order-link modal is reached from the token queue, the customer profile,
   * the ledger and the dashboard — none of which is gated on POS_ORDER. Opening
   * the order behind a ticket, an invoice or a customer's history is a read of a
   * record that screen is already showing; creating or voiding one is not, and
   * stays on POS_ORDER:WRITE.
   */
  POS_ORDER_REFERENCE_READ: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
    SCOPES.POS_KITCHEN_READ, SCOPES.POS_KITCHEN_WRITE,
    SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE,
    SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
    SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
    SCOPES.POS_REPORTS_READ,
    SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE,
  ],

  /**
   * Looking a CUSTOMER up, for screens that attach one to something.
   *
   * The picker on the till searches this list; putting a customer on a bill is
   * part of taking the order. Editing the CRM record itself stays POS_CRM.
   */
  POS_CUSTOMER_LOOKUP_READ: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE,
    SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
    SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
  ],
};
