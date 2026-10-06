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

/**
 * What has been COLLECTED on a document: every payment row against it.
 *
 * A sale paid short and topped up later has one paymentdetail per payment, so
 * this is a SUM, never a join — a join would fan the document out once per
 * payment and multiply every figure beside it. Requires `transactiondetaillog l`.
 */
const COLLECTED_SQL = `(SELECT COALESCE(SUM(pdx.TotalAmount), 0) FROM paymentdetail pdx
    WHERE pdx.TransactionDetailLogId = l.Id AND pdx.TenantId = l.TenantId)`;

/** What has come BACK on a sale: every credit note against it. Requires `l`. */
const RETURNED_SQL = `(SELECT COALESCE(SUM(cnx.GrossAmount), 0) FROM transactiondetaillog cnx
    WHERE cnx.ReversesLogId = l.Id AND cnx.TenantId = l.TenantId AND cnx.Active = 1)`;

/**
 * What is still OWED on a sale.
 *
 *   Due = Gross − Returns − Collected − Written off, never below zero.
 *
 * Returns come off the due first: a guest who paid ₹200 of ₹288 and sends back
 * a ₹149 dish owes nothing and is owed ₹61, not ₹149. The same rule is applied
 * in Node by ledger.due.js — this is its SQL twin, for filters and sums.
 */
const DUE_SQL = `GREATEST(0, ROUND(l.GrossAmount - ${RETURNED_SQL} - ${COLLECTED_SQL}
    - COALESCE(l.WriteOffAmount, 0), 2))`;

/**
 * Who may be named as a table's waiter: an active member who can TAKE ORDERS —
 * an administrator of the tenancy, or someone whose roles grant
 * POS_ORDER:WRITE. That covers waiters, cashiers and managers and leaves out
 * kitchen-only and accounts staff, who would never be serving a table.
 *
 * The grant is read exactly as sign-in reads it (PERMISSIONS.SELECT_ALL_GRANTS):
 * a role of THIS tenancy, still active, holding an active feature — so the
 * picker can never list someone the till itself would refuse.
 * Requires `user_tenants ut`.
 */
const TAKES_ORDERS_SQL = `(
    ut.is_admin = 1 OR ut.is_super_admin = 1
    OR EXISTS (
      SELECT 1
        FROM user_roles ur
        JOIN roles r
          ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.is_active = TRUE
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN features f ON f.feature_id = rp.feature_id AND f.is_active = TRUE
       WHERE ur.tenant_id = ut.tenant_id
         AND ur.user_phone = ut.user_phone
         AND f.feature_short_name = 'POS_ORDER' AND f.scope = 'WRITE'
    )
  )`;

/**
 * A member as the till names them: their name, or — only when none was ever
 * entered — their mobile, so nobody appears as a blank line in the picker.
 * Requires `user_tenants ut`.
 */
const MEMBER_NAME_SQL = "COALESCE(NULLIF(TRIM(ut.full_name), ''), ut.user_phone)";

/**
 * The token or table a document was served at, and its rounds — correlated
 * subqueries rather than joins, so a bill covering three rounds does not fan
 * the row out three times. Requires `transactiondetaillog l`.
 */
const DOC_SOURCE_COLUMNS_SQL = `
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
                 WHERE b.TransactionDetailLogId = l.Id AND b.TenantId = l.TenantId) AS OrderNos`;

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
      //
      // tenant_name is the tenancy's first organization, as the platform
      // directory names it — the tenant switcher showed bare ids, which left a
      // member of three tenancies guessing which one was the restaurant.
      SELECT:
        'SELECT tenant_id, is_admin, is_super_admin, full_name, last_active_at, (SELECT o.Name FROM organizationdetail o WHERE o.TenantId = user_tenants.tenant_id ORDER BY o.CreatedOn ASC LIMIT 1) AS tenant_name FROM user_tenants WHERE user_phone = ? AND is_active = TRUE ORDER BY last_active_at IS NULL, last_active_at DESC, tenant_id ASC',
      TOUCH_ACTIVE:
        'UPDATE user_tenants SET last_active_at = NOW() WHERE user_phone = ? AND tenant_id = ?',
    },

    // Permissions Queries
    PERMISSIONS: {
      // Every feature scope a member holds through their roles in one tenancy.
      // Roles are the only grant path: the legacy per-membership table
      // (tenant_features) was a second, invisible one — no screen or API wrote
      // it, yet any row in it granted permissions nobody could see.
      //
      // roles is joined on BOTH the id and the tenancy, and must be active. A
      // user_roles row pointing at another tenancy's role, or at a role that was
      // deactivated, therefore grants nothing — the join used to be by role id
      // alone, so either kind of row reached the token.
      SELECT_ALL_GRANTS: `
        SELECT DISTINCT f.scope, f.feature_short_name
        FROM user_roles ur
        JOIN roles r
          ON r.id = ur.role_id
         AND r.tenant_id = ur.tenant_id
         AND r.is_active = TRUE
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN features f ON f.feature_id = rp.feature_id
        WHERE ur.tenant_id = ?
          AND ur.user_phone = ?
          AND f.is_active = TRUE
      `,
    },

    // Audit Logs Queries
    AUDIT_LOGS: {
      SELECT:
        'SELECT log_id, tenant_id, user_phone, action, status, ip_address, log_level, category, resource_id, details, timestamp FROM audit_logs WHERE 1=1',
      COUNT:
        'SELECT COUNT(*) AS total FROM audit_logs WHERE 1=1',
      INSERT:
        'INSERT INTO audit_logs (tenant_id, user_phone, action, status, ip_address, log_level, category, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      INSERT_MIDDLEWARE:
        'INSERT INTO audit_logs (tenant_id, user_phone, action, status, ip_address, log_level, category, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    },

    // Tax Type Queries
    TAX_TYPES: {
      // Bulk import resolves a tax type by name before creating one: a whole
      // menu naming 'CGST' must produce a single CGST row, not one per item.
      SELECT_BY_NAME:
        'SELECT * FROM TaxTypes WHERE Name = ? AND TenantId = ? LIMIT 1',
      // A tax type is its NAME AND ITS RATE together, which is what the unique
      // key says. Resolving on the name alone handed a GST 18% group the CGST
      // row already standing at 2.5%, and every 18% item silently billed 5%.
      SELECT_BY_NAME_AND_VALUE:
        'SELECT * FROM TaxTypes WHERE Name = ? AND Value = ? AND TenantId = ? LIMIT 1',
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
      // ParentName is joined so a list can show "Starters → Soups" without a
      // second call. Self-join on the SAME tenant: a parent from another
      // tenancy is not a hierarchy, it is a leak.
      SELECT_ALL: `SELECT c.*, p.Name AS ParentName,
          -- Tags set on the SECTION (pos_category_tag). Every dish filed here
          -- inherits them, which is what makes tagging a menu tractable: one
          -- assignment covers a section instead of one per dish.
          (SELECT JSON_ARRAYAGG(ct.TagId) FROM pos_category_tag ct WHERE ct.CategoryId = c.Id) AS TagIds,
          -- How many dishes this section holds. Tagging a category is a BULK
          -- edit — it reaches every dish filed here — and a form that does not
          -- say so is hiding the interesting part of the action.
          (SELECT COUNT(*) FROM itemdetail i
            WHERE i.CategoryId = c.Id AND i.TenantId = c.TenantId) AS ItemCount
        FROM categorydetail c
        LEFT JOIN categorydetail p ON p.Id = c.ParentId AND p.TenantId = c.TenantId
        WHERE c.TenantId = ? ORDER BY c.SortOrder ASC, c.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM categorydetail WHERE TenantId = ?',
      SELECT_BY_ID: `SELECT c.*, p.Name AS ParentName,
          -- Tags set on the SECTION (pos_category_tag). Every dish filed here
          -- inherits them, which is what makes tagging a menu tractable: one
          -- assignment covers a section instead of one per dish.
          (SELECT JSON_ARRAYAGG(ct.TagId) FROM pos_category_tag ct WHERE ct.CategoryId = c.Id) AS TagIds,
          -- How many dishes this section holds. Tagging a category is a BULK
          -- edit — it reaches every dish filed here — and a form that does not
          -- say so is hiding the interesting part of the action.
          (SELECT COUNT(*) FROM itemdetail i
            WHERE i.CategoryId = c.Id AND i.TenantId = c.TenantId) AS ItemCount
        FROM categorydetail c
        LEFT JOIN categorydetail p ON p.Id = c.ParentId AND p.TenantId = c.TenantId
        WHERE c.Id = ? AND c.TenantId = ?`,
      // Only categories that may BE a parent: top-level ones. A menu tree is
      // two levels deep, so anything already holding a ParentId is a leaf.
      SELECT_PARENT_CANDIDATES: `SELECT Id, Name FROM categorydetail
        WHERE TenantId = ? AND ParentId IS NULL AND Active = 1
        ORDER BY SortOrder ASC, Name ASC`,
      // Does this category have children? Asked before it is given a parent of
      // its own, and before it is deleted.
      COUNT_CHILDREN:
        'SELECT COUNT(*) AS total FROM categorydetail WHERE ParentId = ? AND TenantId = ?',
      INSERT:
        'INSERT INTO categorydetail (Id, TenantId, Name, ParentId, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE categorydetail SET Name = ?, ParentId = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM categorydetail WHERE Id = ? AND TenantId = ?',
      // Replace-in-place, the same shape positemmeta.syncLinks uses for
      // channels and variants: delete the set, insert the new one, inside the
      // caller's transaction.
      DELETE_TAG_LINKS: 'DELETE FROM pos_category_tag WHERE CategoryId = ? AND TenantId = ?',
      INSERT_TAG_LINK:
        'INSERT INTO pos_category_tag (Id, CategoryId, TagId, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?)',
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
        'INSERT INTO contactdetail (Id, TenantId, FirstName, LastName, Email, MobileNo, AltMobileNo, Landline1, LandLine2, Ext1, Ext2, ContactAddressTypeId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE contactdetail SET FirstName = ?, LastName = ?, Email = ?, MobileNo = ?, AltMobileNo = ?, Landline1 = ?, LandLine2 = ?, Ext1 = ?, Ext2 = ?, ContactAddressTypeId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
        'INSERT INTO branchdetail (Id, TenantId, OrganizationDetailId, ContactDetailId, AddressDetailId, TransactionTypeConfigId, BranchName, TINNo, GSTIN, PAN, FSSAI, CF1, CF2, CF3, CF4, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE branchdetail SET OrganizationDetailId = ?, ContactDetailId = ?, AddressDetailId = ?, TransactionTypeConfigId = ?, BranchName = ?, TINNo = ?, GSTIN = ?, PAN = ?, FSSAI = ?, CF1 = ?, CF2 = ?, CF3 = ?, CF4 = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
        'INSERT INTO itemdetail (Id, TenantId, Name, Code, Description, CategoryId, UOMId, CostInfoId, SKU, Barcode, HSNCode, SupplyType, SACCode, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE itemdetail SET Name = ?, Code = ?, Description = ?, CategoryId = ?, UOMId = ?, CostInfoId = ?, SKU = ?, Barcode = ?, HSNCode = ?, SupplyType = ?, SACCode = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
          bd.BranchName AS BranchName
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
          bd.BranchName AS BranchName
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
      // The ACCOUNT a tender lands in rides along with the mode. The till shows
      // it under each payment option, which is what stops a counter sale being
      // settled to 'Zomato Settlement' — that books to Aggregator Receivable,
      // money we are owed for weeks, and leaves the cash session short by the
      // whole sale with nothing on screen to explain it.
      // ORDER BY SortOrder, NOT CreatedOn. The till takes the first row as its
      // default tender, and CreatedOn is a DATETIME every provisioned mode shares
      // to the second — so this used to be DESC and the default tender was
      // whatever was created last. Id breaks any remaining tie so a page of
      // results is stable across requests.
      SELECT_ALL: `SELECT pm.*,
          a.Name AS AccountName, a.Kind AS AccountKind
        FROM paymentmode pm
        LEFT JOIN accounttypebase a
          ON a.Id = pm.DefaultAccountTypeBaseId AND a.TenantId = pm.TenantId
        WHERE pm.TenantId = ? ORDER BY pm.SortOrder ASC, pm.Id ASC`,
      COUNT: 'SELECT COUNT(*) as total FROM paymentmode WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM paymentmode WHERE Id = ? AND TenantId = ?',
      // Where a newly created method sorts: after everything that exists. NULL
      // (no rows yet) coalesces to 0, so the first method a tenant creates is 1.
      NEXT_SORT_ORDER:
        'SELECT COALESCE(MAX(SortOrder), 0) + 1 AS nextSortOrder FROM paymentmode WHERE TenantId = ?',
      // DefaultAccountTypeBaseId is written here for the first time. It has been
      // a column since the ledger shipped and the SELECT above has always joined
      // its name — but no INSERT or UPDATE ever set it, so every method created
      // through the API booked to no account at all.
      INSERT:
        'INSERT INTO paymentmode (Id, TenantId, Type, DefaultAccountTypeBaseId, RequiresReference, EnabledByDefault, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE paymentmode SET Type = ?, DefaultAccountTypeBaseId = ?, RequiresReference = ?, EnabledByDefault = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM paymentmode WHERE Id = ? AND TenantId = ?',
    },

    // QR diner sessions, ended by settling the bill.
    POS_DINER_SESSION: {
      // Every table the bill's rounds sat at. A dine-in bill covers several
      // rounds and — after a table transfer — they need not all be one table.
      TABLES_FOR_ORDERS:
        'SELECT DISTINCT TableId FROM pos_order WHERE TenantId = ? AND TableId IS NOT NULL AND Id IN (:ids)',
      // A timestamp, not a flag: the next party scans the same printed code
      // minutes later and their session must survive this.
      END_SESSIONS:
        'UPDATE pos_table SET DinerSessionsEndedOn = NOW(), UpdatedOn = NOW(), UpdatedBy = ? WHERE TenantId = ? AND Id IN (:ids)',
      ENDED_AT:
        'SELECT DinerSessionsEndedOn FROM pos_table WHERE Id = ? AND TenantId = ? LIMIT 1',
    },

    // Today's portion counts. See pos_item_daily_stock in the schema for why a
    // row per day, and why its ABSENCE is meaningful.
    POS_DAILY_STOCK: {
      // The counts screen: every tracked dish on a branch, with today's row if
      // there is one. LEFT JOIN, because "tracked but not set today" is a state
      // the screen has to show rather than a row it can skip.
      SELECT_FOR_DAY: `SELECT im.Id AS ItemMetaId, idt.Name AS ItemName,
          im.StockTracked, im.MaxPerOrder,
          ds.Id AS StockId, ds.PreparedQty, ds.SoldQty
        FROM pos_item_meta im
        JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
        LEFT JOIN pos_item_daily_stock ds
          ON ds.ItemMetaId = im.Id AND ds.TenantId = im.TenantId
         AND ds.BusinessDate = ? AND ds.Active = 1
        WHERE im.TenantId = ? AND im.BranchDetailId = ? AND im.Active = 1
          AND im.StockTracked = 1
        ORDER BY idt.Name ASC`,
      // The order path's read: the counts for a specific set of dishes, used to
      // resolve state before the write and to give a better message than the
      // UPDATE's silence. Advisory only — CONSUME below is the authority.
      SELECT_FOR_ITEMS: `SELECT im.Id AS ItemMetaId, idt.Name AS ItemName,
          im.StockTracked, im.MaxPerOrder,
          ds.PreparedQty, ds.SoldQty
        FROM pos_item_meta im
        JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
        LEFT JOIN pos_item_daily_stock ds
          ON ds.ItemMetaId = im.Id AND ds.TenantId = im.TenantId
         AND ds.BusinessDate = ? AND ds.Active = 1
        WHERE im.TenantId = ? AND im.Id IN (:ids)`,
      UPSERT:
        'INSERT INTO pos_item_daily_stock (Id, TenantId, BranchDetailId, ItemMetaId, BusinessDate, PreparedQty, SoldQty, Active, CreatedOn, CreatedBy, UpdatedBy) '
        + 'VALUES (?, ?, ?, ?, ?, ?, 0, 1, NOW(), ?, ?) '
        // SoldQty is NOT reset: changing today's prepared figure at 3pm must not
        // forget what has already gone out of the kitchen.
        + 'ON DUPLICATE KEY UPDATE PreparedQty = VALUES(PreparedQty), Active = 1, UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)',
      CLEAR:
        'DELETE FROM pos_item_daily_stock WHERE TenantId = ? AND ItemMetaId = ? AND BusinessDate = ?',
      // THE GUARD AND THE DEDUCTION ARE ONE STATEMENT. Two orders racing for the
      // last portion both run this; the engine serialises them on the row, the
      // first wins, and the second's WHERE no longer matches. affectedRows = 0
      // is "somebody just took it", not an error to retry.
      CONSUME: `UPDATE pos_item_daily_stock
           SET SoldQty = SoldQty + ?, UpdatedOn = NOW(), UpdatedBy = ?
         WHERE TenantId = ? AND ItemMetaId = ? AND BusinessDate = ? AND Active = 1
           AND PreparedQty - SoldQty >= ?`,
      // A portal order has already charged the guest, so it decrements WITHOUT
      // the guard and is allowed to go negative. A negative count is honest; a
      // refused order the aggregator has taken money for is not.
      CONSUME_UNCHECKED: `UPDATE pos_item_daily_stock
           SET SoldQty = SoldQty + ?, UpdatedOn = NOW(), UpdatedBy = ?
         WHERE TenantId = ? AND ItemMetaId = ? AND BusinessDate = ? AND Active = 1`,
      // Floored at zero: a release must never invent portions that were not sold.
      RELEASE: `UPDATE pos_item_daily_stock
           SET SoldQty = GREATEST(SoldQty - ?, 0), UpdatedOn = NOW(), UpdatedBy = ?
         WHERE TenantId = ? AND ItemMetaId = ? AND BusinessDate = ? AND Active = 1`,
    },

    // Which tenders each OUTLET accepts. The catalogue above is tenant-wide;
    // this is the per-branch override over it.
    POS_BRANCH_PAYMENT_METHOD: {
      // The resolve query. BranchEnabled is NULL exactly when this branch has
      // made no decision, which is the signal the service turns into "inherit
      // EnabledByDefault" — see the table comment in 01-schema-definition.sql.
      //
      // Ordered by SortOrder so the till's first offered tender, and therefore
      // the tender a sale defaults to, is the same on every request.
      SELECT_RESOLVED: `SELECT pm.Id, pm.Type, pm.Active, pm.SortOrder,
          pm.RequiresReference, pm.EnabledByDefault,
          pm.DefaultAccountTypeBaseId AS AccountId,
          a.Name AS AccountName, a.Kind AS AccountKind,
          bpm.Enabled AS BranchEnabled
        FROM paymentmode pm
        LEFT JOIN accounttypebase a
          ON a.Id = pm.DefaultAccountTypeBaseId AND a.TenantId = pm.TenantId
        LEFT JOIN pos_branch_payment_method bpm
          ON bpm.PaymentModeId = pm.Id AND bpm.TenantId = pm.TenantId
         AND bpm.BranchDetailId = ? AND bpm.Active = 1
        WHERE pm.TenantId = ?
        ORDER BY pm.SortOrder ASC, pm.Id ASC`,
      // `:ids` is replaced with one bound placeholder per id by the repository.
      // The ids themselves are always bound, never interpolated.
      SELECT_MODES_BY_IDS:
        'SELECT Id, Type, Active, EnabledByDefault FROM paymentmode WHERE TenantId = ? AND Id IN (:ids)',
      UPSERT:
        'INSERT INTO pos_branch_payment_method (Id, TenantId, BranchDetailId, PaymentModeId, Enabled, Active, CreatedOn, CreatedBy, UpdatedBy) '
        + 'VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?) '
        + 'ON DUPLICATE KEY UPDATE Enabled = VALUES(Enabled), Active = 1, UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)',
      DELETE_ONE:
        'DELETE FROM pos_branch_payment_method WHERE TenantId = ? AND BranchDetailId = ? AND PaymentModeId = ?',
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

    // When a category is on the menu. Day and time live in ONE row: a portal
    // sends a timing as a single rule, and splitting them makes every read a
    // cross-product with no way to say which time belongs to which day.
    POS_CATEGORY_SCHEDULE: {
      SELECT_BY_CATEGORY: `SELECT * FROM pos_category_schedule
        WHERE CategoryId = ? AND TenantId = ?
        ORDER BY DayOfWeek ASC, StartTime ASC`,
      DELETE_BY_CATEGORY:
        'DELETE FROM pos_category_schedule WHERE CategoryId = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_category_schedule (Id, CategoryId, DayOfWeek, StartTime, EndTime, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)',
      // Every rule in the tenancy, for the menu push — one read rather than one
      // per category.
      SELECT_ALL_FOR_TENANT: `SELECT s.*, c.Name AS CategoryName
        FROM pos_category_schedule s
        JOIN categorydetail c ON c.Id = s.CategoryId AND c.TenantId = s.TenantId
        WHERE s.TenantId = ? AND s.Active = 1
        ORDER BY c.SortOrder ASC, s.DayOfWeek ASC, s.StartTime ASC`,
      // Is this category on the menu right now? Counts the rules it HAS, and
      // the rules that currently MATCH. Zero rules means always available, so
      // the caller needs both numbers to tell "no rules" from "no match".
      COUNT_ACTIVE_NOW: `SELECT
          (SELECT COUNT(*) FROM pos_category_schedule
            WHERE CategoryId = ? AND TenantId = ? AND Active = 1) AS RuleCount,
          (SELECT COUNT(*) FROM pos_category_schedule
            WHERE CategoryId = ? AND TenantId = ? AND Active = 1
              AND DayOfWeek = ? AND StartTime <= ? AND EndTime > ?) AS MatchCount`,
    },

    // What KIND of meat, for portals that filter on it. Orthogonal to food
    // type: a dish is Non-Veg AND Chicken.
    POS_MEAT_TYPE: {
      SELECT_ALL: 'SELECT * FROM pos_meat_type WHERE TenantId = ? ORDER BY SortOrder ASC, CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_meat_type WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_meat_type WHERE Id = ? AND TenantId = ?',
      SELECT_BY_CODE: 'SELECT * FROM pos_meat_type WHERE Code = ? AND TenantId = ? LIMIT 1',
      INSERT: 'INSERT INTO pos_meat_type (Id, TenantId, Name, Code, Description, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_meat_type SET Name = ?, Code = ?, Description = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_meat_type WHERE Id = ? AND TenantId = ?',
    },

    // One tag taxonomy, three TagTypes (CATEGORY / BEVERAGE / CUISINE).
    POS_MENU_TAG: {
      SELECT_ALL: 'SELECT * FROM pos_menu_tag WHERE TenantId = ? ORDER BY TagType ASC, SortOrder ASC, CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_menu_tag WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_menu_tag WHERE Id = ? AND TenantId = ?',
      SELECT_BY_CODE: 'SELECT * FROM pos_menu_tag WHERE Code = ? AND TenantId = ? LIMIT 1',
      // The menu editor offers tags one type at a time; a single list of all
      // three would make the beverage picker show cuisines.
      SELECT_BY_TYPE: 'SELECT * FROM pos_menu_tag WHERE TagType = ? AND TenantId = ? AND Active = 1 ORDER BY SortOrder ASC',
      INSERT: 'INSERT INTO pos_menu_tag (Id, TenantId, Name, Code, TagType, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_menu_tag SET Name = ?, Code = ?, TagType = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_menu_tag WHERE Id = ? AND TenantId = ?',
    },

    // A block of choices offered against a dish. NOT a variant — a variant
    // replaces the price, a group augments it and validates a selection count.
    POS_ADDON_GROUP: {
      // Aggregates its options so the menu editor draws a group and its
      // choices in one read rather than N+1.
      SELECT_ALL: `SELECT g.*,
          (SELECT COUNT(*) FROM pos_addon a WHERE a.AddonGroupId = g.Id AND a.Active = 1) AS AddonCount
        FROM pos_addon_group g
        WHERE g.TenantId = ? ORDER BY g.SortOrder ASC, g.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_addon_group WHERE TenantId = ?',
      SELECT_BY_ID: `SELECT g.*,
          (SELECT COUNT(*) FROM pos_addon a WHERE a.AddonGroupId = g.Id AND a.Active = 1) AS AddonCount
        FROM pos_addon_group g
        WHERE g.Id = ? AND g.TenantId = ?`,
      SELECT_BY_CODE: 'SELECT * FROM pos_addon_group WHERE Code = ? AND TenantId = ? LIMIT 1',
      INSERT: 'INSERT INTO pos_addon_group (Id, TenantId, Name, Code, Description, MinSelection, MaxSelection, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_addon_group SET Name = ?, Code = ?, Description = ?, MinSelection = ?, MaxSelection = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_addon_group WHERE Id = ? AND TenantId = ?',
    },

    // One selectable option inside a group.
    POS_ADDON: {
      // Joins the food type so a dietary badge renders without a second call —
      // a veg pizza with a chicken topping is not a veg order, and the badge is
      // the only thing that says so.
      SELECT_ALL: `SELECT a.*, g.Name AS AddonGroupName,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg
        FROM pos_addon a
        LEFT JOIN pos_addon_group g ON g.Id = a.AddonGroupId
        LEFT JOIN pos_food_type ft ON ft.Id = a.FoodTypeId
        WHERE a.TenantId = ? ORDER BY a.SortOrder ASC, a.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_addon WHERE TenantId = ?',
      SELECT_BY_ID: `SELECT a.*, g.Name AS AddonGroupName,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg
        FROM pos_addon a
        LEFT JOIN pos_addon_group g ON g.Id = a.AddonGroupId
        LEFT JOIN pos_food_type ft ON ft.Id = a.FoodTypeId
        WHERE a.Id = ? AND a.TenantId = ?`,
      SELECT_BY_CODE: 'SELECT * FROM pos_addon WHERE Code = ? AND TenantId = ? LIMIT 1',
      // Joins the group as well as the food type, so every read of an add-on
      // returns the SAME shape. Without it this endpoint alone answered with an
      // undefined AddonGroupName, and a list bound to that column rendered a
      // blank cell only on this one screen.
      SELECT_BY_GROUP: `SELECT a.*, g.Name AS AddonGroupName,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg
        FROM pos_addon a
        LEFT JOIN pos_addon_group g ON g.Id = a.AddonGroupId
        LEFT JOIN pos_food_type ft ON ft.Id = a.FoodTypeId
        WHERE a.AddonGroupId = ? AND a.TenantId = ? ORDER BY a.SortOrder ASC`,
      INSERT: 'INSERT INTO pos_addon (Id, TenantId, AddonGroupId, Name, Code, Price, FoodTypeId, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_addon SET AddonGroupId = ?, Name = ?, Code = ?, Price = ?, FoodTypeId = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_addon WHERE Id = ? AND TenantId = ?',
    },

    // Why an order was refused, in a controlled vocabulary.
    POS_REJECTION_REASON: {
      SELECT_ALL: `SELECT r.*, p.Name AS PortalName
        FROM pos_rejection_reason r
        LEFT JOIN pos_portal p ON p.Id = r.PortalId
        WHERE r.TenantId = ? ORDER BY r.SortOrder ASC, r.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_rejection_reason WHERE TenantId = ?',
      SELECT_BY_ID: `SELECT r.*, p.Name AS PortalName
        FROM pos_rejection_reason r
        LEFT JOIN pos_portal p ON p.Id = r.PortalId
        WHERE r.Id = ? AND r.TenantId = ?`,
      // The reject dialog offers house reasons plus this portal's own. NULL
      // PortalId is the house set, so it must be admitted explicitly — a plain
      // equality on PortalId would silently return nothing for every portal.
      SELECT_FOR_PORTAL: `SELECT * FROM pos_rejection_reason
        WHERE TenantId = ? AND Active = 1 AND (PortalId IS NULL OR PortalId = ?)
        ORDER BY SortOrder ASC`,
      INSERT: 'INSERT INTO pos_rejection_reason (Id, TenantId, Name, Code, ExternalCode, PortalId, RequiresItems, Description, SortOrder, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_rejection_reason SET Name = ?, Code = ?, ExternalCode = ?, PortalId = ?, RequiresItems = ?, Description = ?, SortOrder = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_rejection_reason WHERE Id = ? AND TenantId = ?',
    },

    POS_ITEM_META: {
      // UNIQUE (ItemDetailId, BranchDetailId, TenantId) — the publish pass
      // checks this so a re-run reports 'already on the menu' rather than
      // failing on the constraint.
      SELECT_BY_ITEM_BRANCH:
        'SELECT Id FROM pos_item_meta WHERE ItemDetailId = ? AND BranchDetailId = ? AND TenantId = ? LIMIT 1',
      // A round stores the MENU entry's id in its Items JSON, but an offer
      // triggers on the CATALOGUE item and its category. Without this the two
      // id spaces never meet and every item trigger counts zero — see
      // posbill.repository.getOrderLinesTx.
      SELECT_CATALOGUE_IDS: `
        SELECT im.Id AS MetaId, im.ItemDetailId, i.CategoryId
          FROM pos_item_meta im
          LEFT JOIN itemdetail i ON i.Id = im.ItemDetailId AND i.TenantId = im.TenantId
         WHERE im.TenantId = ? AND im.Id IN (:ids)`,
      // SELECT_ALL/SELECT_BY_ID aggregate linked channel/variant ids and the
      // linked costinfo amount so the client can pre-select and price.
      SELECT_ALL: `SELECT im.*,
          (SELECT JSON_ARRAYAGG(c.ChannelId) FROM pos_item_meta_channel c WHERE c.ItemMetaId = im.Id) AS ChannelIds,
          (SELECT JSON_ARRAYAGG(v.VariantId) FROM pos_item_meta_variant v WHERE v.ItemMetaId = im.Id) AS VariantIds,
          -- {variantId: surcharge} where THIS dish prices a variant its own way.
          -- Absent ids use the variant's default price.
          (SELECT JSON_OBJECTAGG(v.VariantId, v.Surcharge) FROM pos_item_meta_variant v
            WHERE v.ItemMetaId = im.Id AND v.Surcharge IS NOT NULL) AS VariantPrices,
          (SELECT JSON_ARRAYAGG(ag.AddonGroupId) FROM pos_item_meta_addon_group ag WHERE ag.ItemMetaId = im.Id) AS AddonGroupIds,
          (SELECT JSON_ARRAYAGG(tg.TagId) FROM pos_item_meta_tag tg WHERE tg.ItemMetaId = im.Id) AS TagIds,
          ci.Amount AS CostInfoAmount,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg,
          -- The meat taxonomy is orthogonal to food type: a dish is Non-Veg AND
          -- Chicken, and a portal filter needs the second name, not the id.
          mt.Name AS MeatTypeName,
          -- The till groups its menu by these. A dish's category lives on
          -- itemdetail, not on the POS extension row, so it takes two joins to
          -- reach — which is why the menu payload carried no category at all
          -- and the grid had nothing to group by.
          cat.Id AS CategoryId, cat.Name AS CategoryName,
          -- The dish's NAME, from the catalogue row this menu entry extends.
          -- The till used to resolve it with one GET /api/itemdetails/:id PER
          -- DISH — 51 extra requests on every Billing load, each taking a pool
          -- connection, for a column two joins away in the query that was
          -- already running.
          idt.Name AS ItemName,
          -- The dish photo's version, or NULL for none. The till's picture
          -- tiles put it on the photo URL as v, so a cached copy lasts until it changes.
          (SELECT UNIX_TIMESTAMP(ph.UpdatedOn) FROM pos_item_photo ph
            WHERE ph.TenantId = im.TenantId AND ph.ItemDetailId = im.ItemDetailId LIMIT 1) AS PhotoVersion,
          -- ── Tags, from BOTH levels, kept apart ─────────────────────────────
          -- Not merged in SQL: the till draws a tag set on the dish differently
          -- from one inherited from its section, so it has to know which is
          -- which. The union happens where it is displayed and filtered.
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.Id, 'name', t.Name, 'type', t.TagType))
             FROM pos_item_meta_tag mt
             JOIN pos_menu_tag t ON t.Id = mt.TagId
            WHERE mt.ItemMetaId = im.Id) AS OwnTags,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.Id, 'name', t.Name, 'type', t.TagType))
             FROM pos_category_tag ct
             JOIN pos_menu_tag t ON t.Id = ct.TagId
            WHERE ct.CategoryId = idt.CategoryId AND ct.TenantId = im.TenantId) AS CategoryTags
        FROM pos_item_meta im
        LEFT JOIN costinfo ci ON ci.Id = im.CostInfoId
        LEFT JOIN pos_food_type ft ON ft.Id = im.FoodTypeId
        LEFT JOIN pos_meat_type mt ON mt.Id = im.MeatTypeId
        LEFT JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
        LEFT JOIN categorydetail cat ON cat.Id = idt.CategoryId AND cat.TenantId = im.TenantId
        WHERE im.TenantId = ? ORDER BY im.CreatedOn DESC`,
      COUNT: 'SELECT COUNT(*) as total FROM pos_item_meta WHERE TenantId = ?',
      SELECT_BY_ID: `SELECT im.*,
          (SELECT JSON_ARRAYAGG(c.ChannelId) FROM pos_item_meta_channel c WHERE c.ItemMetaId = im.Id) AS ChannelIds,
          (SELECT JSON_ARRAYAGG(v.VariantId) FROM pos_item_meta_variant v WHERE v.ItemMetaId = im.Id) AS VariantIds,
          -- {variantId: surcharge} where THIS dish prices a variant its own way.
          -- Absent ids use the variant's default price.
          (SELECT JSON_OBJECTAGG(v.VariantId, v.Surcharge) FROM pos_item_meta_variant v
            WHERE v.ItemMetaId = im.Id AND v.Surcharge IS NOT NULL) AS VariantPrices,
          (SELECT JSON_ARRAYAGG(ag.AddonGroupId) FROM pos_item_meta_addon_group ag WHERE ag.ItemMetaId = im.Id) AS AddonGroupIds,
          (SELECT JSON_ARRAYAGG(tg.TagId) FROM pos_item_meta_tag tg WHERE tg.ItemMetaId = im.Id) AS TagIds,
          ci.Amount AS CostInfoAmount,
          ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg,
          -- The meat taxonomy is orthogonal to food type: a dish is Non-Veg AND
          -- Chicken, and a portal filter needs the second name, not the id.
          mt.Name AS MeatTypeName,
          -- The till groups its menu by these. A dish's category lives on
          -- itemdetail, not on the POS extension row, so it takes two joins to
          -- reach — which is why the menu payload carried no category at all
          -- and the grid had nothing to group by.
          cat.Id AS CategoryId, cat.Name AS CategoryName,
          -- The dish's NAME, from the catalogue row this menu entry extends.
          -- The till used to resolve it with one GET /api/itemdetails/:id PER
          -- DISH — 51 extra requests on every Billing load, each taking a pool
          -- connection, for a column two joins away in the query that was
          -- already running.
          idt.Name AS ItemName,
          -- The dish photo's version, or NULL for none. The till's picture
          -- tiles put it on the photo URL as v, so a cached copy lasts until it changes.
          (SELECT UNIX_TIMESTAMP(ph.UpdatedOn) FROM pos_item_photo ph
            WHERE ph.TenantId = im.TenantId AND ph.ItemDetailId = im.ItemDetailId LIMIT 1) AS PhotoVersion,
          -- ── Tags, from BOTH levels, kept apart ─────────────────────────────
          -- Not merged in SQL: the till draws a tag set on the dish differently
          -- from one inherited from its section, so it has to know which is
          -- which. The union happens where it is displayed and filtered.
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.Id, 'name', t.Name, 'type', t.TagType))
             FROM pos_item_meta_tag mt
             JOIN pos_menu_tag t ON t.Id = mt.TagId
            WHERE mt.ItemMetaId = im.Id) AS OwnTags,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.Id, 'name', t.Name, 'type', t.TagType))
             FROM pos_category_tag ct
             JOIN pos_menu_tag t ON t.Id = ct.TagId
            WHERE ct.CategoryId = idt.CategoryId AND ct.TenantId = im.TenantId) AS CategoryTags
        FROM pos_item_meta im
        LEFT JOIN costinfo ci ON ci.Id = im.CostInfoId
        LEFT JOIN pos_food_type ft ON ft.Id = im.FoodTypeId
        LEFT JOIN pos_meat_type mt ON mt.Id = im.MeatTypeId
        LEFT JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
        LEFT JOIN categorydetail cat ON cat.Id = idt.CategoryId AND cat.TenantId = im.TenantId
        WHERE im.Id = ? AND im.TenantId = ?`,
      INSERT: 'INSERT INTO pos_item_meta (Id, TenantId, ItemDetailId, FoodTypeId, CostInfoId, Channels, Prices, Variants, ServesCount, PortionSize, MeatTypeId, PrepTimeMinutes, StockTracked, MaxPerOrder, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_item_meta SET ItemDetailId = ?, FoodTypeId = ?, CostInfoId = ?, Channels = ?, Prices = ?, Variants = ?, ServesCount = ?, PortionSize = ?, MeatTypeId = ?, PrepTimeMinutes = ?, StockTracked = ?, MaxPerOrder = ?, BranchDetailId = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_item_meta WHERE Id = ? AND TenantId = ?',
      // Order lines reference a menu row; pricing needs the cost record it
      // points at. Batched so an order costs one lookup, not one per line.
      SELECT_COSTINFO_BY_IDS:
        'SELECT Id, CostInfoId FROM pos_item_meta WHERE TenantId = ? AND Id IN (:ids)',
      // Selected variants are a flat surcharge on the item price. Resolved
      // server-side so a client cannot dictate what a variant costs.
      SELECT_VARIANT_PRICES_BY_IDS:
        'SELECT Id, Name, Code, Price FROM pos_variant WHERE TenantId = ? AND Active = 1 AND Id IN (:ids)',
      // Selected add-ons, priced the same way and for the same reason. The
      // group is joined in because a line cannot be validated without the
      // Min/Max pair that owns the add-on, and fetching it separately would
      // mean a second round trip to answer one question.
      SELECT_ADDON_PRICES_BY_IDS:
        `SELECT a.Id, a.Name, a.Code, a.Price, a.AddonGroupId,
                g.Name AS GroupName, g.MinSelection, g.MaxSelection
           FROM pos_addon a
           JOIN pos_addon_group g
             ON g.Id = a.AddonGroupId AND g.TenantId = a.TenantId AND g.Active = 1
          WHERE a.TenantId = ? AND a.Active = 1 AND a.Id IN (:ids)`,
      // Which choice blocks a dish offers, and the rules each one carries.
      // Needed on its own because a MISSING required selection can only be
      // caught by reading the groups the dish HAS — the ids on the line say
      // nothing about the group nobody answered.
      SELECT_ADDON_RULES_BY_ITEM_IDS:
        `SELECT l.ItemMetaId, g.Id AS GroupId, g.Name AS GroupName,
                g.MinSelection, g.MaxSelection
           FROM pos_item_meta_addon_group l
           JOIN pos_addon_group g
             ON g.Id = l.AddonGroupId AND g.TenantId = l.TenantId AND g.Active = 1
          WHERE l.TenantId = ? AND l.Active = 1 AND l.ItemMetaId IN (:ids)
          ORDER BY l.SortOrder, g.SortOrder`,
      // Join-table sync helpers (channels + variants + add-on groups + tags).
      // All four follow the same replace-the-set shape: delete this item's rows,
      // then insert the supplied ones, inside the caller's transaction.
      DELETE_CHANNEL_LINKS: 'DELETE FROM pos_item_meta_channel WHERE ItemMetaId = ? AND TenantId = ?',
      INSERT_CHANNEL_LINK: 'INSERT INTO pos_item_meta_channel (Id, ItemMetaId, ChannelId, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?)',
      DELETE_VARIANT_LINKS: 'DELETE FROM pos_item_meta_variant WHERE ItemMetaId = ? AND TenantId = ?',
      // Surcharge NULL = the variant's own price; a number = this dish's.
      INSERT_VARIANT_LINK: 'INSERT INTO pos_item_meta_variant (Id, ItemMetaId, VariantId, Surcharge, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)',
      // Per-dish variant prices for a batch of menu rows. Pricing reads these
      // so a cart is charged what the dish says, not the variant's default.
      SELECT_VARIANT_SURCHARGES:
        'SELECT ItemMetaId, VariantId, Surcharge FROM pos_item_meta_variant '
        + 'WHERE TenantId = ? AND Active = 1 AND Surcharge IS NOT NULL AND ItemMetaId IN (:ids)',
      DELETE_ADDON_GROUP_LINKS: 'DELETE FROM pos_item_meta_addon_group WHERE ItemMetaId = ? AND TenantId = ?',
      INSERT_ADDON_GROUP_LINK: 'INSERT INTO pos_item_meta_addon_group (Id, ItemMetaId, AddonGroupId, SortOrder, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)',
      DELETE_TAG_LINKS: 'DELETE FROM pos_item_meta_tag WHERE ItemMetaId = ? AND TenantId = ?',
      INSERT_TAG_LINK: 'INSERT INTO pos_item_meta_tag (Id, ItemMetaId, TagId, TenantId, Active, CreatedOn, CreatedBy) VALUES (?, ?, ?, ?, 1, NOW(), ?)',
      // ── Bulk update (Menu Master) ─────────────────────────────────────────
      // The rows a bulk change targets, with a name for the audit log. Counted
      // against the ids sent, so a change to a dish deleted meanwhile is
      // refused rather than applied to the rest in silence.
      SELECT_BULK_TARGETS: `
        SELECT im.Id, im.Active, idt.Name AS ItemName
          FROM pos_item_meta im
          LEFT JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
         WHERE im.TenantId = ? AND im.Id IN (:ids)`,
      // Each dish's current links, so "add Chinese" can keep what is there.
      SELECT_CHANNEL_LINKS_FOR: 'SELECT ItemMetaId, ChannelId AS LinkId FROM pos_item_meta_channel WHERE TenantId = ? AND ItemMetaId IN (:ids) ORDER BY CreatedOn',
      SELECT_VARIANT_LINKS_FOR: 'SELECT ItemMetaId, VariantId AS LinkId FROM pos_item_meta_variant WHERE TenantId = ? AND ItemMetaId IN (:ids) ORDER BY CreatedOn',
      SELECT_ADDON_GROUP_LINKS_FOR: 'SELECT ItemMetaId, AddonGroupId AS LinkId FROM pos_item_meta_addon_group WHERE TenantId = ? AND ItemMetaId IN (:ids) ORDER BY SortOrder',
      SELECT_TAG_LINKS_FOR: 'SELECT ItemMetaId, TagId AS LinkId FROM pos_item_meta_tag WHERE TenantId = ? AND ItemMetaId IN (:ids) ORDER BY CreatedOn',
      // Dishes turned off in Menu Master. An order line naming one is refused.
      SELECT_INACTIVE_BY_IDS: 'SELECT Id FROM pos_item_meta WHERE TenantId = ? AND Active = 0 AND Id IN (:ids)',

      // Nutrition is 1:1 and OPTIONAL, so it is written as an upsert rather than
      // created alongside every item — most tenants will never fill it in, and a
      // blank row per dish is noise the compliance report has to filter out.
      //
      // ON DUPLICATE KEY on UNIQUE (ItemMetaId, TenantId): one statement covers
      // both "first time" and "editing", so no read-then-branch is needed.
      UPSERT_NUTRITION: `INSERT INTO pos_item_nutrition
          (Id, ItemMetaId, ServingSizeG, Calories, ProteinG, CarbohydrateG, SugarG, FatG, SaturatedFatG, FibreG, SodiumMg, Allergens, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE
          ServingSizeG = VALUES(ServingSizeG), Calories = VALUES(Calories),
          ProteinG = VALUES(ProteinG), CarbohydrateG = VALUES(CarbohydrateG),
          SugarG = VALUES(SugarG), FatG = VALUES(FatG),
          SaturatedFatG = VALUES(SaturatedFatG), FibreG = VALUES(FibreG),
          SodiumMg = VALUES(SodiumMg), Allergens = VALUES(Allergens),
          UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)`,
      SELECT_NUTRITION:
        'SELECT * FROM pos_item_nutrition WHERE ItemMetaId = ? AND TenantId = ?',
      // Clearing nutrition is deleting the row, not blanking ten columns — a row
      // of nulls says "somebody filled this in as unknown", which is a different
      // claim from "no nutrition data exists".
      DELETE_NUTRITION:
        'DELETE FROM pos_item_nutrition WHERE ItemMetaId = ? AND TenantId = ?',
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
      // Rounds that are already on ANOTHER bill that has been invoiced. Settling
      // them again would issue a second invoice for the same food — which is
      // exactly what happened when a part-paid table was settled a second time.
      SELECT_POSTED_ELSEWHERE: `
        SELECT o.OrderNo, l.TransactionNo
          FROM pos_bill_order bo
          JOIN pos_bill b  ON b.Id = bo.BillId AND b.TenantId = bo.TenantId
          JOIN pos_order o ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
          JOIN transactiondetaillog l ON l.Id = b.TransactionDetailLogId AND l.TenantId = b.TenantId
         WHERE bo.TenantId = ? AND bo.BillId <> ? AND bo.OrderId IN (:ids)
         LIMIT 1`,
    },

    POS_CUSTOMER: {
      SELECT_ALL: 'SELECT * FROM pos_customer WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_customer WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_customer WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_customer (Id, TenantId, Name, Phone, Email, Visits, TotalSpent, LoyaltyPoints, BranchDetailId, GSTIN, LegalName, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_customer SET Name = ?, Phone = ?, Email = ?, Visits = ?, TotalSpent = ?, LoyaltyPoints = ?, BranchDetailId = ?, GSTIN = ?, LegalName = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // The GST identity snapshotted onto an invoice at settle.
      SELECT_TAX_IDENTITY: 'SELECT Name, GSTIN, LegalName FROM pos_customer WHERE Id = ? AND TenantId = ? LIMIT 1',
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
      // One number, one customer. The id is excluded so an update that keeps
      // its own number is not refused as a clash with itself.
      SELECT_ID_BY_PHONE_EXCEPT:
        'SELECT Id, Name FROM pos_customer WHERE Phone = ? AND TenantId = ? AND Id <> ? LIMIT 1',
      // A diner naming themselves after a first visit saved them as a guest.
      SET_NAME:
        'UPDATE pos_customer SET Name = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',

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
      INSERT: 'INSERT INTO pos_order (Id, TenantId, OrderNo, TableId, CustomerId, OrderType, ChannelId, Status, Items, SubTotal, TaxAmount, Total, BranchDetailId, TableName, FloorId, FloorName, TableCapacity, CookingInstructions, NoCutlery, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE: 'UPDATE pos_order SET OrderNo = ?, TableId = ?, CustomerId = ?, OrderType = ?, ChannelId = ?, Status = ?, Items = ?, SubTotal = ?, TaxAmount = ?, Total = ?, BranchDetailId = ?, TableName = ?, FloorId = ?, FloorName = ?, TableCapacity = ?, CookingInstructions = ?, NoCutlery = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      DELETE: 'DELETE FROM pos_order WHERE Id = ? AND TenantId = ?',
      // Domain action helper: update order status (e.g. after firing a KOT)
      SET_STATUS: 'UPDATE pos_order SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // Covers and waiter. Their own statement rather than columns on INSERT /
      // UPDATE: those are shared with the transfer path, which rewrites a round
      // wholesale and must leave who is serving it alone.
      SET_SERVICE:
        'UPDATE pos_order SET GuestCount = ?, WaiterId = ?, WaiterName = ?, UpdatedOn = NOW(), UpdatedBy = ? '
        + 'WHERE Id = ? AND TenantId = ?',
      // A bill printed for the guest to check, before payment.
      MARK_BILL_PRINTED:
        'UPDATE pos_order SET BillPrintedAt = NOW(), UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // Who can be named as a table's waiter: active members who can take
      // orders (TAKES_ORDERS_SQL), by name — the mobile only stands in for a
      // member who has no name. Name and outlet are all that is returned.
      SELECT_WAITERS: `
        SELECT ut.id AS Id, ${MEMBER_NAME_SQL} AS Name, ut.branch_detail_id AS BranchDetailId
          FROM user_tenants ut
         WHERE ut.tenant_id = ? AND ut.is_active = 1 AND ut.status = 'ACTIVE'
           AND ${TAKES_ORDERS_SQL}
         ORDER BY Name ASC`,
      // The same rule, for one member: assigning a waiter the picker would not
      // offer is refused, whoever sends it.
      SELECT_WAITER_BY_ID: `
        SELECT ut.id AS Id, ${MEMBER_NAME_SQL} AS Name
          FROM user_tenants ut
         WHERE ut.id = ? AND ut.tenant_id = ? AND ut.is_active = 1 AND ut.status = 'ACTIVE'
           AND ${TAKES_ORDERS_SQL}`,
      // A waiter already serving one of this table's OPEN rounds. Lets the next
      // round carry them even if their role has since changed — the rule
      // above decides who may be newly ASSIGNED, not who may finish the meal.
      SELECT_TABLE_WAITER: `
        SELECT WaiterId, WaiterName FROM pos_order
         WHERE TenantId = ? AND TableId = ? AND WaiterId = ?
           AND LOWER(COALESCE(Status, '')) NOT IN ('closed', 'settled', 'cancelled')
         LIMIT 1`,
    },

    POS_KOT: {
      SELECT_ALL: 'SELECT * FROM pos_kot WHERE TenantId = ? ORDER BY CreatedOn DESC',
      COUNT: 'SELECT COUNT(*) as total FROM pos_kot WHERE TenantId = ?',
      SELECT_BY_ID: 'SELECT * FROM pos_kot WHERE Id = ? AND TenantId = ?',
      INSERT: 'INSERT INTO pos_kot (Id, TenantId, KotNo, OrderId, TableId, Items, CookingInstructions, NoCutlery, Status, FiredAt, BranchDetailId, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
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
        'CommissionPct, CommissionAccountTypeBaseId, SettlementPaymentModeId, SortOrder, GSTIN, Active, ' +
        'CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_portal SET Name = ?, Code = ?, ChannelId = ?, Adapter = ?, ColorHex = ?, ShortCode = ?, ' +
        'CommissionPct = ?, CommissionAccountTypeBaseId = ?, SettlementPaymentModeId = ?, SortOrder = ?, ' +
        'GSTIN = ?, Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
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
        // Promoted out of the raw Payload at ingest so the KOT writer can
        // reach them without knowing any portal's payload shape.
        'CookingInstructions, NoCutlery, ' +
        'Active, CreatedOn, CreatedBy, UpdatedBy) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
      UPDATE:
        'UPDATE pos_online_order SET PortalId = ?, Platform = ?, OrderId = ?, PortalBranchId = ?, ' +
        'ExternalRef = ?, Status = ?, Payload = ?, OrderLines = ?, HasUnmappedLines = ?, CustomerName = ?, ' +
        'CustomerPhone = ?, ExternalCustomerRef = ?, ItemsTotal = ?, PortalDiscount = ?, PackingCharge = ?, ' +
        'DeliveryCharge = ?, TaxAmount = ?, GrossAmount = ?, CommissionAmount = ?, NetPayout = ?, ' +
        'IsPrepaid = ?, PlacedOn = ?, PromisedOn = ?, AcceptedOn = ?, ReadyOn = ?, PickedUpOn = ?, ' +
        'DeliveredOn = ?, RiderName = ?, RiderPhone = ?, CancelReason = ?, CancelledBy = ?, ' +
        'BranchDetailId = ?, CookingInstructions = ?, NoCutlery = ?, ' +
        'Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // Lifecycle moves, as their own statements. A status change must not have
      // to send 30 other columns back and risk overwriting one of them.
      // KptMinutes and KptSetOn are written HERE, in the same statement that
      // marks the order accepted. They are two halves of one promise — the
      // number, and the moment it was given — and a second statement could
      // commit one without the other.
      SET_ACCEPTED:
        "UPDATE pos_online_order SET Status = 'accepted', OrderId = ?, AcceptedOn = NOW(), " +
        'KptMinutes = ?, KptSetOn = NOW(), ' +
        'UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // The slowest dish on the order decides the KPT: the kitchen is not done
      // until its last item is, so MAX is the honest aggregate, not AVG or SUM.
      // Lines that carry no prep time contribute nothing rather than a zero.
      SELECT_MAX_PREP_TIME: `SELECT MAX(PrepTimeMinutes) AS MaxPrep
        FROM pos_item_meta
        WHERE TenantId = ? AND PrepTimeMinutes IS NOT NULL AND Id IN (:ids)`,
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
    // ── Campaigns and offers ────────────────────────────────────────────
    // An offer is not a second way to price a bill: the engine turns these
    // rules into the same per-line discounts a cashier types by hand, and
    // posbill.recomputeTotals keeps deciding how the money works.
    POS_CAMPAIGN: {
      SELECT_ALL: `
        SELECT c.*,
               (SELECT COUNT(*) FROM pos_offer o
                 WHERE o.CampaignId = c.Id AND o.TenantId = c.TenantId AND o.Active = 1) AS OfferCount,
               (SELECT COUNT(*) FROM pos_offer_redemption r
                 WHERE r.CampaignId = c.Id AND r.TenantId = c.TenantId AND r.Active = 1) AS RedemptionCount
          FROM pos_campaign c
         WHERE c.TenantId = ? AND c.Active = 1
         ORDER BY c.StartsOn DESC, c.Name ASC`,
      SELECT_BY_ID: 'SELECT * FROM pos_campaign WHERE Id = ? AND TenantId = ?',
      INSERT: `
        INSERT INTO pos_campaign
          (Id, TenantId, Name, Code, Description, StartsOn, EndsOn, DaysOfWeek,
           StartTime, EndTime, BudgetAmount, Status, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      UPDATE: `
        UPDATE pos_campaign
           SET Name = ?, Description = ?, StartsOn = ?, EndsOn = ?, DaysOfWeek = ?,
               StartTime = ?, EndTime = ?, BudgetAmount = ?, Status = ?,
               UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ?`,
      SET_STATUS:
        'UPDATE pos_campaign SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // Maintained as redemptions are written, so the budget cap is enforced
      // without summing the redemption table on every bill.
      ADD_SPEND:
        'UPDATE pos_campaign SET SpentAmount = SpentAmount + ?, UpdatedOn = NOW() WHERE Id = ? AND TenantId = ?',
      SOFT_DELETE:
        'UPDATE pos_campaign SET Active = 0, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SELECT_BRANCHES:
        'SELECT BranchDetailId FROM pos_campaign_branch WHERE CampaignId = ? AND TenantId = ?',
      INSERT_BRANCH: `
        INSERT INTO pos_campaign_branch (Id, TenantId, CampaignId, BranchDetailId, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
      DELETE_BRANCHES:
        'DELETE FROM pos_campaign_branch WHERE CampaignId = ? AND TenantId = ?',
    },

    POS_OFFER: {
      SELECT_BY_CAMPAIGN: `
        SELECT o.*, ti.Name AS TriggerItemName, tc.Name AS TriggerCategoryName,
               ri.Name AS RewardItemName
          FROM pos_offer o
          LEFT JOIN itemdetail ti     ON ti.Id = o.TriggerItemId
          LEFT JOIN categorydetail tc ON tc.Id = o.TriggerCategoryId
          LEFT JOIN itemdetail ri     ON ri.Id = o.RewardItemId
         WHERE o.CampaignId = ? AND o.TenantId = ? AND o.Active = 1
         ORDER BY o.SortOrder ASC, o.Name ASC`,
      SELECT_BY_ID: `
        SELECT o.*, ti.Name AS TriggerItemName, tc.Name AS TriggerCategoryName,
               ri.Name AS RewardItemName
          FROM pos_offer o
          LEFT JOIN itemdetail ti     ON ti.Id = o.TriggerItemId
          LEFT JOIN categorydetail tc ON tc.Id = o.TriggerCategoryId
          LEFT JOIN itemdetail ri     ON ri.Id = o.RewardItemId
         WHERE o.Id = ? AND o.TenantId = ?`,
      INSERT: `
        INSERT INTO pos_offer
          (Id, TenantId, CampaignId, Name, SortOrder, TriggerKind, TriggerItemId,
           TriggerCategoryId, TriggerMinQty, TriggerMinAmount, RewardKind, RewardItemId,
           RewardQuantity, RewardPercent, ApplyTo, MaxPerBill, MaxPerCustomerPerDay,
           MaxTotalRedemptions, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      UPDATE: `
        UPDATE pos_offer
           SET Name = ?, SortOrder = ?, TriggerKind = ?, TriggerItemId = ?,
               TriggerCategoryId = ?, TriggerMinQty = ?, TriggerMinAmount = ?,
               RewardKind = ?, RewardItemId = ?, RewardQuantity = ?, RewardPercent = ?,
               ApplyTo = ?, MaxPerBill = ?, MaxPerCustomerPerDay = ?,
               MaxTotalRedemptions = ?, UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ?`,
      SOFT_DELETE:
        'UPDATE pos_offer SET Active = 0, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      BUMP_REDEMPTIONS:
        'UPDATE pos_offer SET RedemptionCount = RedemptionCount + ? WHERE Id = ? AND TenantId = ?',

      // Every offer that could fire on this bill, right now.
      //
      // The whole "is it running" question is ONE query rather than a status
      // column somebody has to keep true: within its dates, on the right
      // weekday, inside its hours, under its budget, at this branch.
      // A campaign with no branch rows runs everywhere — the common case,
      // stored as nothing rather than a row per branch to maintain.
      SELECT_ACTIVE: `
        SELECT o.*, c.Name AS CampaignName, c.BudgetAmount, c.SpentAmount
          FROM pos_offer o
          JOIN pos_campaign c ON c.Id = o.CampaignId AND c.TenantId = o.TenantId
         WHERE o.TenantId = ? AND o.Active = 1
           AND c.Active = 1 AND c.Status = 'ACTIVE'
           AND c.StartsOn <= ? AND (c.EndsOn IS NULL OR c.EndsOn >= ?)
           AND (c.DaysOfWeek IS NULL OR c.DaysOfWeek = ''
                OR FIND_IN_SET(?, c.DaysOfWeek) > 0)
           AND (c.StartTime IS NULL OR c.EndTime IS NULL
                OR (c.StartTime <= c.EndTime AND ? BETWEEN c.StartTime AND c.EndTime)
                OR (c.StartTime >  c.EndTime AND (? >= c.StartTime OR ? <= c.EndTime)))
           AND (c.BudgetAmount IS NULL OR c.SpentAmount < c.BudgetAmount)
           AND (o.MaxTotalRedemptions IS NULL OR o.RedemptionCount < o.MaxTotalRedemptions)
           AND (NOT EXISTS (SELECT 1 FROM pos_campaign_branch b
                             WHERE b.CampaignId = c.Id AND b.TenantId = c.TenantId)
                OR EXISTS (SELECT 1 FROM pos_campaign_branch b
                            WHERE b.CampaignId = c.Id AND b.TenantId = c.TenantId
                              AND b.BranchDetailId = ?))
         ORDER BY o.SortOrder ASC`,
    },

    POS_OFFER_REDEMPTION: {
      INSERT: `
        INSERT INTO pos_offer_redemption
          (Id, TenantId, OfferId, CampaignId, BranchDetailId, BillId,
           TransactionDetailLogId, PosCustomerId, LineRef, ItemId, Quantity,
           DiscountAmount, BillGrossAmount, RedeemedOn, RedeemedBy,
           Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 1, NOW(), ?, ?)`,
      // "Has this customer already used it today" — checked before a redemption
      // is allowed, which is why the (TenantId, ContactDetailId, OfferId) index
      // exists.
      // How many times THIS customer has already taken THIS offer today.
      // Batched per offer rather than per line: one read answers the whole cart.
      COUNT_FOR_CUSTOMER_TODAY: `
        SELECT OfferId, COUNT(*) AS n FROM pos_offer_redemption
         WHERE TenantId = ? AND PosCustomerId = ?
           AND Active = 1 AND DATE(RedeemedOn) = CURDATE()
         GROUP BY OfferId`,
      SELECT_BY_CAMPAIGN: `
        SELECT r.*, o.Name AS OfferName, i.Name AS ItemName,
               l.TransactionNo, b.BranchName,
               pc.Name AS CustomerName, pc.Phone AS CustomerPhone, pc.Visits AS CustomerVisits
          FROM pos_offer_redemption r
          JOIN pos_offer o ON o.Id = r.OfferId
          LEFT JOIN itemdetail i ON i.Id = r.ItemId
          LEFT JOIN transactiondetaillog l ON l.Id = r.TransactionDetailLogId
          LEFT JOIN branchdetail b ON b.Id = r.BranchDetailId
          LEFT JOIN pos_customer pc ON pc.Id = r.PosCustomerId
         WHERE r.TenantId = ? AND r.CampaignId = ? AND r.Active = 1
         ORDER BY r.RedeemedOn DESC
         LIMIT 200`,
      // What the campaign cost, and what it moved. Cost is exact; the revenue
      // beside it is what those bills came to, never presented as uplift.
      SUMMARY: `
        SELECT COUNT(*) AS Redemptions,
               COUNT(DISTINCT r.TransactionDetailLogId) AS Bills,
               COALESCE(SUM(r.DiscountAmount), 0) AS GivenAway,
               COALESCE(SUM(DISTINCT_BILLS.Gross), 0) AS RevenueOnThoseBills
          FROM pos_offer_redemption r
          LEFT JOIN (SELECT DISTINCT TransactionDetailLogId, BillGrossAmount AS Gross
                       FROM pos_offer_redemption
                      WHERE TenantId = ? AND CampaignId = ? AND Active = 1) DISTINCT_BILLS
                 ON DISTINCT_BILLS.TransactionDetailLogId = r.TransactionDetailLogId
         WHERE r.TenantId = ? AND r.CampaignId = ? AND r.Active = 1`,
      BY_OFFER: `
        SELECT r.OfferId, o.Name AS OfferName,
               COUNT(*) AS Redemptions,
               COALESCE(SUM(r.DiscountAmount), 0) AS GivenAway,
               COUNT(DISTINCT r.TransactionDetailLogId) AS Bills
          FROM pos_offer_redemption r
          JOIN pos_offer o ON o.Id = r.OfferId
         WHERE r.TenantId = ? AND r.CampaignId = ? AND r.Active = 1
         GROUP BY r.OfferId, o.Name
         ORDER BY GivenAway DESC`,
      BY_HOUR: `
        SELECT HOUR(r.RedeemedOn) AS Hour, COUNT(*) AS Redemptions
          FROM pos_offer_redemption r
         WHERE r.TenantId = ? AND r.CampaignId = ? AND r.Active = 1
         GROUP BY HOUR(r.RedeemedOn)
         ORDER BY Hour ASC`,
    },

    // Whether this tenant charges GST — see pos_tax_setting in the schema.
    TAX_SETTING: {
      SELECT: 'SELECT GstCharging, OffReason, UpdatedOn, UpdatedBy FROM pos_tax_setting WHERE TenantId = ? LIMIT 1',
      // Locks the row (or the gap where it will go) so two admins flipping the
      // switch at once serialise instead of writing two history rows that
      // disagree about what the value was "from".
      SELECT_FOR_UPDATE: 'SELECT GstCharging, OffReason FROM pos_tax_setting WHERE TenantId = ? LIMIT 1 FOR UPDATE',
      // Each branch's GSTIN, for the settings card. The GST switch is one value
      // for the business, but the registration it files under is per branch.
      SELECT_BRANCHES:
        'SELECT Id, BranchName, GSTIN FROM branchdetail WHERE TenantId = ? AND COALESCE(Active, 1) = 1 ORDER BY BranchName ASC, Id ASC',
      UPDATE_BRANCH_GSTIN:
        'UPDATE branchdetail SET GSTIN = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      UPSERT: `
        INSERT INTO pos_tax_setting (TenantId, GstCharging, OffReason, CreatedOn, CreatedBy, UpdatedOn, UpdatedBy)
        VALUES (?, ?, ?, NOW(), ?, NOW(), ?)
        ON DUPLICATE KEY UPDATE GstCharging = VALUES(GstCharging), OffReason = VALUES(OffReason),
                                UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)`,
      INSERT_HISTORY:
        'INSERT INTO pos_tax_mode_history (Id, TenantId, FromCharging, ToCharging, OffReason, ChangedBy, ChangedOn) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      SELECT_HISTORY:
        'SELECT Id, FromCharging, ToCharging, OffReason, ChangedBy, ChangedOn FROM pos_tax_mode_history WHERE TenantId = ? ORDER BY ChangedOn DESC, Id DESC LIMIT 50',
      // Every change up to the end of a report range, oldest first — enough to
      // replay which state each day of the range was in.
      SELECT_HISTORY_UNTIL:
        'SELECT FromCharging, ToCharging, OffReason, ChangedBy, ChangedOn FROM pos_tax_mode_history WHERE TenantId = ? AND ChangedOn <= ? ORDER BY ChangedOn ASC, Id ASC',
      // What blocks the switch: any round still open anywhere. A bill that is
      // half tax invoice and half bill of supply cannot be printed honestly.
      SELECT_OPEN_ORDERS: `
        SELECT o.Id, o.OrderNo, o.OrderType, o.TableName, o.Total, o.CreatedOn
          FROM pos_order o
         WHERE o.TenantId = ? AND o.Active = 1
           AND LOWER(COALESCE(o.Status, '')) NOT IN ('closed', 'settled', 'cancelled')
         ORDER BY o.CreatedOn ASC
         LIMIT 50`,
    },

    // GST return exports. Every query reads LEDGER documents only — the invoice
    // as issued — and takes the branch as `(? IS NULL OR l.BranchId = ?)` so the
    // pack (one GSTIN) and the reference export (any branch) share them.
    GST_EXPORT: {
      SELECT_BRANCH: 'SELECT Id, BranchName, GSTIN FROM branchdetail WHERE Id = ? AND TenantId = ? LIMIT 1',
      // One row per document. `Source` answers "how was this sold" — which
      // portal, which channel — through the bill's rounds. A credit note reads
      // the source of the sale it reverses, since it has no bill of its own.
      SELECT_DOCUMENTS: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.BranchId, b.BranchName,
               l.NetAmount, l.TaxAmount, l.DiscountAmount, l.RoundOff, l.GrossAmount,
               l.TaxMode, l.BuyerGstin, l.BuyerLegalName, l.SellerGstin, l.CustomerName, l.ReversesLogId, l.CreatedOn,
               t.Name AS TypeName, s.Name AS StatusName,
               orig.TransactionNo AS OriginalNo, orig.TransactionDate AS OriginalDate,
               orig.BuyerGstin AS OriginalBuyerGstin, orig.BuyerLegalName AS OriginalBuyerLegalName,
               (SELECT JSON_OBJECT('portalName', p.Name, 'portalGstin', p.GSTIN,
                                   'channel', ch.Name, 'orderType', o.OrderType)
                  FROM pos_bill pb
                  JOIN pos_bill_order bo ON bo.BillId = pb.Id AND bo.TenantId = pb.TenantId
                  JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
                  LEFT JOIN pos_channel ch       ON ch.Id = o.ChannelId
                  LEFT JOIN pos_online_order oo  ON oo.OrderId = o.Id AND oo.TenantId = o.TenantId
                  LEFT JOIN pos_portal p         ON p.Id = oo.PortalId
                 WHERE pb.TransactionDetailLogId = COALESCE(l.ReversesLogId, l.Id)
                   AND pb.TenantId = l.TenantId
                 ORDER BY p.Id IS NULL
                 LIMIT 1) AS Source
          FROM transactiondetaillog l
          JOIN transactiontype t              ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiontypestatus s   ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN branchdetail b            ON b.Id = l.BranchId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId AND orig.TenantId = l.TenantId
         WHERE l.TenantId = ? AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name IN (?, ?)
         ORDER BY l.TransactionDate ASC, l.CreatedOn ASC, l.TransactionNo ASC`,
      SELECT_LINES: `
        SELECT d.TransactionDetailLogId AS LogId, d.LineNo, d.ItemId, d.Quantity, d.UnitPrice,
               d.NetAmount, d.DiscountAmount, d.TaxAmount, d.GrossAmount, d.TaxComponents,
               d.Variants, d.Addons, d.TaxCharged, d.Comment,
               i.Name AS ItemName, i.SACCode, i.HSNCode
          FROM transactionitemdetail d
          JOIN transactiondetaillog l ON l.Id = d.TransactionDetailLogId AND l.TenantId = d.TenantId
          JOIN transactiontype t      ON t.Id = l.TransactionTypeId
          LEFT JOIN itemdetail i      ON i.Id = d.ItemId AND i.TenantId = d.TenantId
         WHERE l.TenantId = ? AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name IN (?, ?)
         ORDER BY d.TransactionDetailLogId, d.LineNo`,
      // "Cash + UPI" per document, for the registers.
      SELECT_TENDERS: `
        SELECT pd.TransactionDetailLogId AS LogId,
               GROUP_CONCAT(DISTINCT pm.Type ORDER BY pm.Type SEPARATOR ' + ') AS Modes
          FROM paymentdetail pd
          JOIN transactiondetaillog l ON l.Id = pd.TransactionDetailLogId AND l.TenantId = pd.TenantId
          JOIN paymentbreakup pbk     ON pbk.PaymentDetailId = pd.Id AND pbk.TenantId = pd.TenantId
          JOIN paymentmodetransactiondetail pmt ON pmt.Id = pbk.PaymentModeTransactionDetailId
          JOIN paymentmode pm         ON pm.Id = pmt.PaymentModeId
         WHERE l.TenantId = ? AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
         GROUP BY pd.TransactionDetailLogId`,
      // The split report. Returns count against sales, so a refunded plate
      // does not stay in "sold with GST".
      SPLIT_TOTALS: `
        SELECT CASE WHEN l.TaxMode = 'gst' THEN 'with' ELSE 'without' END AS Bucket,
               SUM(CASE WHEN t.Name = ? THEN 1 ELSE 0 END) AS Bills,
               SUM(CASE WHEN t.Name = ? THEN -l.NetAmount ELSE l.NetAmount END) AS NetAmount,
               SUM(CASE WHEN t.Name = ? THEN -l.TaxAmount ELSE l.TaxAmount END) AS TaxAmount,
               SUM(CASE WHEN t.Name = ? THEN -l.GrossAmount ELSE l.GrossAmount END) AS GrossAmount
          FROM transactiondetaillog l
          JOIN transactiontype t            ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE l.TenantId = ? AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name IN (?, ?)
           AND s.Name IN (?, ?, ?)
         GROUP BY Bucket`,
      SPLIT_TAX_COMPONENTS: `
        SELECT d.TaxComponents,
               CASE WHEN t.Name = ? THEN -1 ELSE 1 END AS Sign
          FROM transactionitemdetail d
          JOIN transactiondetaillog l       ON l.Id = d.TransactionDetailLogId AND l.TenantId = d.TenantId
          JOIN transactiontype t            ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         WHERE l.TenantId = ? AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name IN (?, ?)
           AND s.Name IN (?, ?, ?)
           AND d.TaxCharged = 1 AND l.TaxMode = 'gst'`,
      // Sign is (1 - 2 * isReturn), written out five times rather than joined in,
      // so the query runs on any MySQL 8 without LATERAL.
      SPLIT_PRODUCTS: `
        SELECT d.ItemId, MAX(COALESCE(i.Name, d.Comment)) AS ItemName,
               SUM(CASE WHEN d.TaxCharged = 1 AND l.TaxMode = 'gst' THEN (1 - 2 * (t.Name = ?)) * d.Quantity ELSE 0 END)    AS QtyWith,
               SUM(CASE WHEN d.TaxCharged = 1 AND l.TaxMode = 'gst' THEN (1 - 2 * (t.Name = ?)) * d.GrossAmount ELSE 0 END) AS GrossWith,
               SUM(CASE WHEN d.TaxCharged = 1 AND l.TaxMode = 'gst' THEN (1 - 2 * (t.Name = ?)) * d.TaxAmount ELSE 0 END)   AS TaxWith,
               SUM(CASE WHEN d.TaxCharged = 1 AND l.TaxMode = 'gst' THEN 0 ELSE (1 - 2 * (t.Name = ?)) * d.Quantity END)    AS QtyWithout,
               SUM(CASE WHEN d.TaxCharged = 1 AND l.TaxMode = 'gst' THEN 0 ELSE (1 - 2 * (t.Name = ?)) * d.GrossAmount END) AS GrossWithout
          FROM transactionitemdetail d
          JOIN transactiondetaillog l       ON l.Id = d.TransactionDetailLogId AND l.TenantId = d.TenantId
          JOIN transactiontype t            ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN itemdetail i            ON i.Id = d.ItemId AND i.TenantId = d.TenantId
         WHERE l.TenantId = ? AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name IN (?, ?)
           AND s.Name IN (?, ?, ?)
         GROUP BY d.ItemId
         ORDER BY (GrossWith + GrossWithout) DESC
         LIMIT 200`,
    },

    GST_FILING: {
      UPSERT: `
        INSERT INTO pos_gst_filing (Id, TenantId, BranchId, Period, FiledOn, RecordedBy, RecordedOn)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE FiledOn = VALUES(FiledOn), RecordedBy = VALUES(RecordedBy), RecordedOn = NOW()`,
      SELECT_ONE:
        'SELECT Period, FiledOn, RecordedBy, RecordedOn FROM pos_gst_filing WHERE TenantId = ? AND BranchId = ? AND Period = ? LIMIT 1',
    },

    // A branch's logo and payment QR. Bytes in the database — see the note on the
    // table; there is no static file server and no object store here.
    POS_BRANCH_MEDIA: {
      // Metadata only. The bytes of two images are the largest thing this module
      // moves, and the listing exists to answer "is there a logo" — a question
      // that must not cost half a megabyte to ask.
      SELECT_META_BY_BRANCH: `
        SELECT Id, Kind, MimeType, Width, Height, ByteSize, UpdatedOn, UpdatedBy, CreatedOn, CreatedBy
          FROM pos_branch_media
         WHERE TenantId = ? AND BranchDetailId = ? AND Active = 1`,
      SELECT_ONE: `
        SELECT Id, Kind, MimeType, Width, Height, ByteSize, Bytes, UpdatedOn, UpdatedBy, CreatedOn, CreatedBy
          FROM pos_branch_media
         WHERE TenantId = ? AND BranchDetailId = ? AND Kind = ? AND Active = 1
         LIMIT 1`,
      // UNIQUE (TenantId, BranchDetailId, Kind) is what makes this an upsert. A
      // branch has ONE logo; replacing it must not leave the old row behind for
      // whichever the next query happens to return first.
      UPSERT: `
        INSERT INTO pos_branch_media
          (Id, TenantId, BranchDetailId, Kind, MimeType, Width, Height, ByteSize, Bytes,
           Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE
          MimeType = VALUES(MimeType), Width = VALUES(Width), Height = VALUES(Height),
          ByteSize = VALUES(ByteSize), Bytes = VALUES(Bytes), Active = 1,
          UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)`,
      // A hard delete. A soft one would keep several kilobytes of blob per
      // removed image forever, and "remove my logo" has no undo worth the row.
      DELETE_ONE:
        'DELETE FROM pos_branch_media WHERE TenantId = ? AND BranchDetailId = ? AND Kind = ?',
      // Which kinds exist, for the receipt resolver. It needs to know whether to
      // emit a URL, and must not read the bytes to find out.
      // Which kinds exist AND when each last changed. The timestamp is what makes a
      // REPLACED image reach the paper: the client keys its cached copy on the URL,
      // and without a version a new logo at the same address is never re-fetched.
      SELECT_KINDS:
        'SELECT Kind, UpdatedOn, CreatedOn FROM pos_branch_media WHERE TenantId = ? AND BranchDetailId = ? AND Active = 1',
    },

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
      // Setting a field back to its default DELETES the override rather than
      // storing the default value. A stored default looks identical until the
      // default changes, at which point every branch that never chose anything
      // is silently pinned to the old one.
      DELETE_KEY:
        'DELETE FROM pos_setting WHERE TenantId = ? AND BranchDetailId = ? AND SettingKey = ?',
      // Only the receipt keys, for one branch. LIKE on a prefix rather than
      // reading every setting the branch holds.
      SELECT_BY_PREFIX:
        "SELECT SettingKey, SettingValue FROM pos_setting WHERE TenantId = ? AND BranchDetailId = ? AND SettingKey LIKE CONCAT(?, '%')",
    },

    // ── QR table ordering ─────────────────────────────────────────────────
    // One printed code per table. The Token is the ONLY thing in the QR image;
    // tenant, branch and table are resolved from it server-side, never taken
    // from the URL. See QR_TABLE_ORDERING_DESIGN.md §3.1.
    POS_TABLE_QR: {
      // Every live table in one branch, with its code when it has one. A table's
      // branch is its own, or its floor's — pos_table.BranchDetailId is nullable
      // and older rows only carry the floor.
      SELECT_BRANCH_TABLES: `
        SELECT t.Id AS TableId, t.Name AS TableName, t.Capacity, t.FloorId,
               f.Name AS FloorName,
               COALESCE(t.BranchDetailId, f.BranchDetailId) AS BranchDetailId,
               q.Id AS QrId, q.Token, q.CreatedOn AS IssuedOn, q.UpdatedOn AS RotatedOn
          FROM pos_table t
          LEFT JOIN pos_floor f ON f.Id = t.FloorId AND f.TenantId = t.TenantId
          LEFT JOIN pos_table_qr q ON q.TableId = t.Id AND q.TenantId = t.TenantId AND q.Active = 1
         WHERE t.TenantId = ? AND t.Active = 1
           AND COALESCE(t.BranchDetailId, f.BranchDetailId) = ?
         ORDER BY f.Name, t.Name`,
      SELECT_TABLE: `
        SELECT t.Id AS TableId, t.Name AS TableName,
               COALESCE(t.BranchDetailId, f.BranchDetailId) AS BranchDetailId
          FROM pos_table t
          LEFT JOIN pos_floor f ON f.Id = t.FloorId AND f.TenantId = t.TenantId
         WHERE t.Id = ? AND t.TenantId = ? AND t.Active = 1
         LIMIT 1`,
      // UNIQUE (TableId, TenantId): two people pressing "print" at once converge
      // on one code instead of the second failing.
      INSERT: `
        INSERT INTO pos_table_qr
          (Id, Token, TableId, BranchDetailId, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE Id = Id`,
      // Rotating overwrites the token in place: the printed card stops resolving
      // at once, and every diner session opened with it fails its next request.
      ROTATE: `
        UPDATE pos_table_qr
           SET Token = ?, BranchDetailId = ?, Active = 1, UpdatedOn = NOW(), UpdatedBy = ?
         WHERE TableId = ? AND TenantId = ?`,
      // The public resolve. Unknown, rotated and retired all miss the same way.
      SELECT_BY_TOKEN: `
        SELECT q.Id AS QrId, q.TenantId, q.BranchDetailId, q.TableId,
               t.Name AS TableName, f.Name AS FloorName,
               b.BranchName, o.Name AS BusinessName
          FROM pos_table_qr q
          JOIN pos_table t ON t.Id = q.TableId AND t.TenantId = q.TenantId AND t.Active = 1
          LEFT JOIN pos_floor f ON f.Id = t.FloorId AND f.TenantId = t.TenantId
          LEFT JOIN branchdetail b ON b.Id = q.BranchDetailId AND b.TenantId = q.TenantId
          LEFT JOIN organizationdetail o ON o.Id = b.OrganizationDetailId AND o.TenantId = b.TenantId
         WHERE q.Token = ? AND q.Active = 1
         LIMIT 1`,
      // What a diner session re-checks on every request.
      SELECT_ACTIVE_BY_ID: `
        SELECT q.Id AS QrId, q.TenantId, q.BranchDetailId, q.TableId
          FROM pos_table_qr q
          JOIN pos_table t ON t.Id = q.TableId AND t.TenantId = q.TenantId AND t.Active = 1
         WHERE q.Id = ? AND q.Active = 1
         LIMIT 1`,
    },

    // What a diner may read and do. Everything is keyed on values from the
    // diner's SESSION (tenant, branch, table, customer), never on the request.
    POS_DINE: {
      // A dish photo for the guest menu, by the menu entry the guest was given
      // and only at the branch their table is in. Thumbnail unless :full.
      PHOTO_FOR_META: `
        SELECT COALESCE(ph.ThumbMimeType, ph.MimeType) AS MimeType, COALESCE(ph.ThumbBytes, ph.Bytes) AS Bytes,
               UNIX_TIMESTAMP(ph.UpdatedOn) AS Version
          FROM pos_item_meta im
          JOIN pos_item_photo ph ON ph.TenantId = im.TenantId AND ph.ItemDetailId = im.ItemDetailId
         WHERE im.TenantId = ? AND im.BranchDetailId = ? AND im.Id = ? AND im.Active = 1
         LIMIT 1`,
      PHOTO_FOR_META_FULL: `
        SELECT ph.MimeType, ph.Bytes, UNIX_TIMESTAMP(ph.UpdatedOn) AS Version
          FROM pos_item_meta im
          JOIN pos_item_photo ph ON ph.TenantId = im.TenantId AND ph.ItemDetailId = im.ItemDetailId
         WHERE im.TenantId = ? AND im.BranchDetailId = ? AND im.Id = ? AND im.Active = 1
         LIMIT 1`,
      CHANNEL_BY_CODE:
        'SELECT Id FROM pos_channel WHERE TenantId = ? AND Code = ? LIMIT 1',
      INSERT_CHANNEL: `
        INSERT INTO pos_channel (Id, Name, Code, Description, SortOrder, TenantId, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE Id = Id`,
      // The branch's menu. Unpaginated on purpose: one branch's menu is read
      // whole by one screen, and a page boundary would hide dishes from guests.
      MENU_FOR_BRANCH: `
        SELECT im.Id, im.ItemDetailId, im.CostInfoId, im.PortionSize, im.ServesCount, im.PrepTimeMinutes,
               im.StockTracked, im.MaxPerOrder,
               (SELECT UNIX_TIMESTAMP(ph.UpdatedOn) FROM pos_item_photo ph
                 WHERE ph.TenantId = im.TenantId AND ph.ItemDetailId = im.ItemDetailId LIMIT 1) AS PhotoVersion,
               idt.Name AS ItemName, idt.Description,
               cat.Id AS CategoryId, cat.Name AS CategoryName,
               ft.Name AS FoodTypeName, ft.IsVeg AS FoodTypeIsVeg,
               (SELECT JSON_ARRAYAGG(c.ChannelId) FROM pos_item_meta_channel c
                 WHERE c.ItemMetaId = im.Id AND c.Active = 1) AS ChannelIds
          FROM pos_item_meta im
          JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
          LEFT JOIN categorydetail cat ON cat.Id = idt.CategoryId AND cat.TenantId = im.TenantId
          LEFT JOIN pos_food_type ft ON ft.Id = im.FoodTypeId
         WHERE im.TenantId = ? AND im.BranchDetailId = ? AND im.Active = 1
         ORDER BY cat.Name, idt.Name`,
      VARIANTS_FOR_ITEMS: `
        SELECT l.ItemMetaId, v.Id, v.Name, COALESCE(l.Surcharge, v.Price) AS Price
          FROM pos_item_meta_variant l
          JOIN pos_variant v ON v.Id = l.VariantId AND v.TenantId = l.TenantId AND v.Active = 1
         WHERE l.TenantId = ? AND l.Active = 1 AND l.ItemMetaId IN (:ids)
         ORDER BY v.SortOrder, v.Name`,
      ADDONS_FOR_ITEMS: `
        SELECT l.ItemMetaId, g.Id AS GroupId, g.Name AS GroupName,
               g.MinSelection, g.MaxSelection,
               a.Id AS AddonId, a.Name AS AddonName, a.Price
          FROM pos_item_meta_addon_group l
          JOIN pos_addon_group g ON g.Id = l.AddonGroupId AND g.TenantId = l.TenantId AND g.Active = 1
          JOIN pos_addon a ON a.AddonGroupId = g.Id AND a.TenantId = g.TenantId AND a.Active = 1
         WHERE l.TenantId = ? AND l.Active = 1 AND l.ItemMetaId IN (:ids)
         ORDER BY l.SortOrder, g.SortOrder, a.SortOrder, a.Name`,
      // Which of these menu rows belong to THIS branch and are on sale. The
      // order service checks tenant, not branch; a diner at one outlet must not
      // order another outlet's dish by id. The NAME comes back too: it is what
      // prints on the kitchen ticket, so it is taken from the catalogue and
      // never from what a phone sent.
      ITEMS_ON_BRANCH: `
        SELECT im.Id, idt.Name
          FROM pos_item_meta im
          JOIN itemdetail idt ON idt.Id = im.ItemDetailId AND idt.TenantId = im.TenantId
         WHERE im.TenantId = ? AND im.BranchDetailId = ? AND im.Active = 1 AND im.Id IN (:ids)`,
      // One diner's rounds at one table, from this session on.
      ORDERS_FOR_DINER: `
        SELECT o.Id, o.OrderNo, o.Status, o.Items, o.SubTotal, o.TaxAmount, o.Total,
               o.CookingInstructions, o.CreatedOn, o.RejectionNote,
               rr.Name AS RejectionReason,
               (SELECT k.Status FROM pos_kot k
                 WHERE k.OrderId = o.Id AND k.TenantId = o.TenantId
                   AND LOWER(k.Status) <> 'cancelled'
                 ORDER BY k.CreatedOn DESC LIMIT 1) AS KotStatus
          FROM pos_order o
          LEFT JOIN pos_rejection_reason rr ON rr.Id = o.RejectionReasonId AND rr.TenantId = o.TenantId
         WHERE o.TenantId = ? AND o.TableId = ? AND o.CustomerId = ? AND o.CreatedOn >= ?
         ORDER BY o.CreatedOn DESC
         LIMIT 20`,
    },

    // The staff side of a QR round: the review queue, accept and reject.
    POS_QR_ORDER: {
      // Placed from a phone, still open, and never sent to the kitchen. A round
      // with a live ticket has been accepted; a cancelled one was rejected.
      // `? IS NULL OR` lets one query serve "this branch" and "every branch".
      SELECT_PENDING: `
        SELECT o.Id, o.OrderNo, o.TableId, o.TableName, o.FloorName, o.BranchDetailId,
               o.Items, o.SubTotal, o.TaxAmount, o.Total, o.CookingInstructions, o.CreatedOn,
               c.Id AS CustomerId, c.Name AS CustomerName, c.Phone AS CustomerPhone,
               c.Visits, c.TotalSpent, c.LastVisitAt
          FROM pos_order o
          JOIN pos_channel ch ON ch.Id = o.ChannelId AND ch.TenantId = o.TenantId AND ch.Code = ?
          LEFT JOIN pos_customer c ON c.Id = o.CustomerId AND c.TenantId = o.TenantId
         WHERE o.TenantId = ? AND LOWER(o.Status) = 'open'
           AND (? IS NULL OR o.BranchDetailId = ?)
           AND NOT EXISTS (SELECT 1 FROM pos_kot k
                            WHERE k.OrderId = o.Id AND k.TenantId = o.TenantId
                              AND LOWER(k.Status) <> 'cancelled')
         ORDER BY o.CreatedOn ASC`,
      // Locked for the decision: two staff pressing Accept and Reject at once
      // must produce one outcome.
      SELECT_FOR_DECISION: `
        SELECT o.Id, o.Status, o.TableId, o.ChannelId, ch.Code AS ChannelCode,
               (SELECT COUNT(*) FROM pos_kot k
                 WHERE k.OrderId = o.Id AND k.TenantId = o.TenantId
                   AND LOWER(k.Status) <> 'cancelled') AS LiveKots
          FROM pos_order o
          LEFT JOIN pos_channel ch ON ch.Id = o.ChannelId AND ch.TenantId = o.TenantId
         WHERE o.Id = ? AND o.TenantId = ?
         FOR UPDATE`,
      REJECT: `
        UPDATE pos_order
           SET Status = 'cancelled', RejectionReasonId = ?, RejectionNote = ?,
               UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ? AND LOWER(Status) = 'open'`,
      // House reasons only: a portal's own reasons mean nothing to a diner.
      REJECTION_REASONS: `
        SELECT Id, Name, Code FROM pos_rejection_reason
         WHERE TenantId = ? AND Active = 1 AND PortalId IS NULL
         ORDER BY Name`,
      REJECTION_REASON_BY_ID:
        'SELECT Id FROM pos_rejection_reason WHERE Id = ? AND TenantId = ? AND Active = 1 AND PortalId IS NULL LIMIT 1',
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
               b.SettledAt, b.TransactionDetailLogId, b.BranchDetailId,
               l.TransactionNo, s.Name AS LedgerStatus,
               -- Paid and owed on the invoice, so the order can say "₹88 due"
               -- and offer to collect it.
               l.GrossAmount AS InvoiceTotal, l.WriteOffAmount,
               l.CustomerName, l.CustomerMobile, l.SettledAt AS InvoiceSettledAt,
               CASE WHEN l.Id IS NULL THEN 0 ELSE ${COLLECTED_SQL} END AS Collected,
               CASE WHEN l.Id IS NULL THEN 0 ELSE ${RETURNED_SQL} END AS Returned
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
        'INSERT INTO pos_cash_session (Id, TenantId, BranchDetailId, CashierPhone, ShiftLabel, OpeningFloat, OpenedAt, OpenedBy, Status, Active, CreatedOn, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, 1, NOW(), ?, ?)',
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
        "SELECT Id FROM pos_cash_session WHERE TenantId = ? AND BranchDetailId = ? AND CashierPhone = ? AND Status = 'open' LIMIT 1",
      SELECT_OPEN_BY_ID:
        "SELECT * FROM pos_cash_session WHERE Id = ? AND TenantId = ? AND Status = 'open' LIMIT 1",
      DELETE: 'DELETE FROM pos_cash_session WHERE Id = ? AND TenantId = ?',
    },

    // POS_STAFF — RETIRED. A staff member is a MEMBERSHIP now: user_tenants
    // carries full_name / phone / branch_detail_id, and user_roles carries what
    // they may do. See ADMIN_USERS below.

    // One-time code challenges.
    //
    // The rate limits are counted HERE, in the table, rather than in memory:
    // an in-process counter resets on every deploy and is per-instance, and
    // both of those turn a spend limit into a suggestion.
    AUTH_OTP: {
      // context_ref / tenant_id are NULL for staff sign-in. A DINER challenge
      // carries the QR code it was requested at and that code's tenant: the
      // first binds the code to one table, the second is what the per-
      // restaurant daily cap counts.
      INSERT: `
        INSERT INTO auth_otp_challenge
               (id, phone, purpose, code_hash, expires_at, request_ip, context_ref, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,

      // The one challenge a verify may act on. Expiry and single-use are both
      // applied in SQL so a consumed or lapsed row simply is not found.
      SELECT_LIVE_BY_ID: `
        SELECT id, phone, purpose, code_hash, attempts, expires_at, context_ref, tenant_id
          FROM auth_otp_challenge
         WHERE id = ?
           AND consumed_at IS NULL
           AND expires_at > NOW()`,

      // Stamped in the SAME transaction that issues the token. The affectedRows
      // count is what makes it safe: two concurrent verifies both read a live
      // row, but only one UPDATE can match consumed_at IS NULL.
      CONSUME: `
        UPDATE auth_otp_challenge
           SET consumed_at = NOW()
         WHERE id = ? AND consumed_at IS NULL`,

      BUMP_ATTEMPTS:
        'UPDATE auth_otp_challenge SET attempts = attempts + 1 WHERE id = ?',

      // A new request invalidates any earlier live code for that number, so
      // only one is ever valid and an old message cannot be replayed.
      // Scoped to the PURPOSE: a diner asking for a code at a table must not
      // burn a staff sign-in code the same person is halfway through typing on
      // the till, and the reverse.
      CONSUME_LIVE_FOR_PHONE: `
        UPDATE auth_otp_challenge
           SET consumed_at = NOW()
         WHERE phone = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()`,

      // Counts only what was actually SENT. A request for an unregistered
      // number records a row and sends nothing — it floods no handset and
      // costs nothing, so charging it against the per-number budget punishes
      // the wrong thing: the number gets locked out at the exact moment it
      // becomes valid. Abuse of that path is still bounded by the per-IP limit,
      // which counts every request.
      COUNT_RECENT_FOR_PHONE: `
        SELECT COUNT(*) AS n FROM auth_otp_challenge
         WHERE phone = ? AND delivery_status <> 'PENDING'
           AND created_at > (NOW() - INTERVAL ? SECOND)`,

      COUNT_RECENT_FOR_IP: `
        SELECT COUNT(*) AS n FROM auth_otp_challenge
         WHERE request_ip = ? AND created_at > (NOW() - INTERVAL ? SECOND)`,

      // The cost circuit breaker. Counts what was actually SENT — a row that
      // never reached Meta cost nothing and must not consume the day's budget.
      //
      // STAFF ONLY. Diner codes are counted by COUNT_DINER_SENT_TODAY below and
      // never reach this breaker — when it trips, the POS stops letting anyone
      // sign in, and a busy dining room must not be able to cause that.
      COUNT_SENT_TODAY: `
        SELECT COUNT(*) AS n FROM auth_otp_challenge
         WHERE created_at >= CURDATE() AND delivery_status <> 'PENDING'
           AND purpose IN ('LOGIN', 'SIGNUP')`,

      // ── Diner limits (QR table ordering) ────────────────────────────────
      // The platform-wide diner breaker. Separate count, separate cap.
      COUNT_DINER_SENT_TODAY: `
        SELECT COUNT(*) AS n FROM auth_otp_challenge
         WHERE created_at >= CURDATE() AND delivery_status <> 'PENDING'
           AND purpose = 'DINER'`,
      // One restaurant's share of the day, across all of its branches.
      COUNT_DINER_SENT_TODAY_FOR_TENANT: `
        SELECT COUNT(*) AS n FROM auth_otp_challenge
         WHERE tenant_id = ? AND purpose = 'DINER'
           AND created_at >= CURDATE() AND delivery_status <> 'PENDING'`,
      // Per printed QR code. Counts every REQUEST, sent or not: this is the
      // limit that stops a photographed card being used to walk a number list.
      COUNT_RECENT_FOR_CONTEXT: `
        SELECT COUNT(*) AS n FROM auth_otp_challenge
         WHERE context_ref = ? AND created_at > (NOW() - INTERVAL ? SECOND)`,

      // The most recent SENT challenge, for the resend cooldown. Same reason
      // as above: there is nothing to wait for after a message that never left.
      SELECT_LAST_FOR_PHONE: `
        SELECT created_at FROM auth_otp_challenge
         WHERE phone = ? AND delivery_status <> 'PENDING'
         ORDER BY created_at DESC LIMIT 1`,

      SET_SENT: `
        UPDATE auth_otp_challenge
           SET wa_message_id = ?, delivery_status = 'SENT'
         WHERE id = ?`,

      SET_FAILED: `
        UPDATE auth_otp_challenge
           SET delivery_status = 'FAILED', failure_code = ?
         WHERE id = ?`,

      // Joined from the webhook on Meta's message id.
      SET_DELIVERY_BY_WAMID: `
        UPDATE auth_otp_challenge
           SET delivery_status = ?, failure_code = ?
         WHERE wa_message_id = ?`,
    },

    // Onboarding Request Queries
    ONBOARDING_REQUESTS: {
      SELECT_BY_PHONE:
        'SELECT * FROM onboarding_requests WHERE phone = ? ORDER BY requested_at DESC LIMIT 1',
      SELECT_ALL:
        'SELECT * FROM onboarding_requests WHERE 1=1',
      INSERT:
        "INSERT INTO onboarding_requests (id, phone, name, status) VALUES (?, ?, ?, 'PENDING')",
      UPDATE_NOTE:
        "UPDATE onboarding_requests SET request_note = ?, updated_at = NOW() WHERE phone = ? AND status = 'PENDING'",
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
        'INSERT INTO tenant_invitations (id, tenant_id, phone, is_admin, full_name, branch_detail_id, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
      // Live invitations for one number, across every tenancy. Expiry is
      // applied in SQL so a lapsed invitation is simply not claimed, with no
      // sweep job needed to keep the claim path correct.
      SELECT_CLAIMABLE: `
        SELECT id, tenant_id, phone, is_admin, full_name, branch_detail_id
          FROM tenant_invitations
         WHERE phone = ? AND status = 'PENDING'
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
        'SELECT id FROM user_tenants WHERE user_phone = ? AND tenant_id = ?',
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
      // What still depends on a role. user_roles and tenant_invitation_roles
      // both cascade on delete, so without these a delete would silently strip
      // the role from everyone holding it and from every pending invitation.
      SELECT_HOLDERS: `
        SELECT ut.user_phone, ut.full_name
        FROM user_roles ur
        JOIN user_tenants ut ON ut.user_phone = ur.user_phone AND ut.tenant_id = ur.tenant_id
        WHERE ur.role_id = ? AND ur.tenant_id = ?
        ORDER BY ut.full_name`,
      COUNT_PENDING_INVITATIONS: `
        SELECT COUNT(*) AS total
        FROM tenant_invitation_roles ir
        JOIN tenant_invitations i ON i.id = ir.invitation_id
        WHERE ir.role_id = ? AND i.tenant_id = ? AND i.status = 'PENDING'`,
    },

    // Role Permission Queries
    ROLE_PERMISSIONS: {
      SELECT_BY_ROLE: `
        SELECT rp.id, rp.role_id, rp.feature_id,
               f.feature_short_name, f.scope, f.display_name, f.category
        FROM role_permissions rp
        JOIN features f ON rp.feature_id = f.feature_id
        WHERE rp.role_id = ?`,
      // Every grant of every role in one tenancy — the permission matrix,
      // role comparison and access preview all read this one result.
      SELECT_FOR_TENANT: `
        SELECT rp.role_id, rp.feature_id
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        WHERE r.tenant_id = ?`,
      DELETE_ALL_FOR_ROLE:
        'DELETE FROM role_permissions WHERE role_id = ?',
      INSERT:
        'INSERT INTO role_permissions (id, role_id, feature_id) VALUES (?, ?, ?)',
    },

    // User Role Queries
    USER_ROLES: {
      // Joined on the tenancy as well as the id, so a row naming another
      // tenancy's role is never reported as one this member holds here.
      SELECT_BY_USER_TENANT: `
        SELECT ur.*, r.name AS role_name, r.description, r.is_system_role,
               r.is_active AS role_is_active
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id AND r.tenant_id = ur.tenant_id
        WHERE ur.user_phone = ? AND ur.tenant_id = ?`,
      DELETE_ALL_FOR_USER:
        'DELETE FROM user_roles WHERE user_phone = ? AND tenant_id = ?',
      INSERT:
        'INSERT INTO user_roles (id, user_phone, tenant_id, role_id, assigned_by) VALUES (?, ?, ?, ?, ?)',
    },

    // The menu editor and the menu file (modules/menu).
    //
    // A DISH is the catalogue item (itemdetail) plus its menu entries — one
    // pos_item_meta per branch it is sold at — and everything hanging off
    // those. The loaders read that whole shape for a set of dishes in a fixed
    // number of queries, so the editor, the export and the import's preview
    // all see a dish the same way. `:items` is replaced with an IN list of
    // item ids, or with nothing for the whole menu.
    MENU: {
      DISH_ITEMS: `
        SELECT i.Id, i.Name, i.Code, i.Description, i.SKU, i.Barcode, i.HSNCode, i.SACCode,
               i.SupplyType, i.Active, i.CategoryId, i.UOMId, i.CostInfoId,
               c.Name AS CategoryName, pc.Name AS ParentCategoryName,
               u.UnitName, ci.Amount, ci.IsTaxIncluded, ci.TaxGroupId, tg.Name AS TaxGroupName,
               -- The photo's version (seconds since epoch of its last save), or
               -- NULL for none. Photo URLs carry it, so a cached copy is used
               -- until the photo changes.
               (SELECT UNIX_TIMESTAMP(ph.UpdatedOn) FROM pos_item_photo ph
                 WHERE ph.ItemDetailId = i.Id AND ph.TenantId = i.TenantId LIMIT 1) AS PhotoVersion
          FROM itemdetail i
          LEFT JOIN categorydetail c  ON c.Id = i.CategoryId
          LEFT JOIN categorydetail pc ON pc.Id = c.ParentId
          LEFT JOIN UOM u             ON u.Id = i.UOMId
          LEFT JOIN costinfo ci       ON ci.Id = i.CostInfoId
          LEFT JOIN taxgroup tg       ON tg.Id = ci.TaxGroupId
         WHERE i.TenantId = ? :items
         ORDER BY c.Name ASC, i.Name ASC`,
      DISH_METAS: `
        SELECT m.Id, m.ItemDetailId, m.BranchDetailId, m.Active, m.CostInfoId,
               m.FoodTypeId, ft.Name AS FoodTypeName, m.MeatTypeId, mt.Name AS MeatTypeName,
               m.ServesCount, m.PortionSize, m.PrepTimeMinutes, m.StockTracked, m.MaxPerOrder,
               mc.Amount AS MetaAmount, m.CreatedOn
          FROM pos_item_meta m
          LEFT JOIN pos_food_type ft ON ft.Id = m.FoodTypeId
          LEFT JOIN pos_meat_type mt ON mt.Id = m.MeatTypeId
          LEFT JOIN costinfo mc      ON mc.Id = m.CostInfoId
         WHERE m.TenantId = ? :items
         ORDER BY m.CreatedOn ASC`,
      DISH_CHANNELS: `
        SELECT l.ItemMetaId, l.ChannelId
          FROM pos_item_meta_channel l
          JOIN pos_item_meta m ON m.Id = l.ItemMetaId
         WHERE m.TenantId = ? AND l.Active = 1 :items`,
      DISH_VARIANTS: `
        SELECT l.ItemMetaId, v.Id, v.Name, v.Price AS DefaultPrice, l.Surcharge, v.SortOrder
          FROM pos_item_meta_variant l
          JOIN pos_item_meta m ON m.Id = l.ItemMetaId
          JOIN pos_variant v   ON v.Id = l.VariantId
         WHERE m.TenantId = ? AND l.Active = 1 :items
         ORDER BY v.SortOrder ASC, v.Name ASC`,
      DISH_ADDON_GROUPS: `
        SELECT l.ItemMetaId, g.Id, g.Name, l.SortOrder
          FROM pos_item_meta_addon_group l
          JOIN pos_item_meta m   ON m.Id = l.ItemMetaId
          JOIN pos_addon_group g ON g.Id = l.AddonGroupId
         WHERE m.TenantId = ? AND l.Active = 1 :items
         ORDER BY l.SortOrder ASC`,
      DISH_TAGS: `
        SELECT l.ItemMetaId, t.Id, t.Name
          FROM pos_item_meta_tag l
          JOIN pos_item_meta m ON m.Id = l.ItemMetaId
          JOIN pos_menu_tag t  ON t.Id = l.TagId
         WHERE m.TenantId = ? AND l.Active = 1 :items
         ORDER BY t.Name ASC`,
      DISH_NUTRITION: `
        SELECT n.*
          FROM pos_item_nutrition n
          JOIN pos_item_meta m ON m.Id = n.ItemMetaId
         WHERE m.TenantId = ? :items`,
      DISH_LISTINGS: `
        SELECT l.Id, l.ItemMetaId, l.PortalId, l.Active, l.ListedName,
               l.PriceOverrideCostInfoId, oc.Amount AS OverrideAmount
          FROM pos_portal_listing l
          JOIN pos_item_meta m ON m.Id = l.ItemMetaId
          LEFT JOIN costinfo oc ON oc.Id = l.PriceOverrideCostInfoId
         WHERE m.TenantId = ? :items`,
      TAX_COMPONENTS: `
        SELECT tgm.TaxGroupId, tt.Name, tt.Value
          FROM taxgrouptaxtypemapper tgm
          JOIN TaxTypes tt ON tt.Id = tgm.TaxTypeId AND tt.TenantId = tgm.TenantId AND tt.Active = 1
         WHERE tgm.TenantId = ? AND tgm.Active = 1
         ORDER BY tt.Name ASC`,

      // ── What a dish can be sold through ─────────────────────────────────
      // Looked up, never created by the editor or a file: a typo in a branch
      // name must be an error, not a new outlet.
      BRANCHES: 'SELECT Id, BranchName AS Name FROM branchdetail WHERE TenantId = ? AND Active = 1 ORDER BY BranchName',
      CHANNELS: 'SELECT Id, Name, Code FROM pos_channel WHERE TenantId = ? AND Active = 1 ORDER BY SortOrder, Name',
      PORTALS: 'SELECT Id, Name, Code, ChannelId FROM pos_portal WHERE TenantId = ? AND Active = 1 ORDER BY SortOrder, Name',

      // ── Masters the editor offers, and creates on demand ───────────────
      CATEGORIES: `SELECT c.Id, c.Name, p.Name AS ParentName FROM categorydetail c
                     LEFT JOIN categorydetail p ON p.Id = c.ParentId
                    WHERE c.TenantId = ? AND c.Active = 1 ORDER BY c.Name`,
      CATEGORY_BY_NAME_PARENT:
        'SELECT Id FROM categorydetail WHERE TenantId = ? AND Name = ? AND ((? IS NULL AND ParentId IS NULL) OR ParentId = ?) LIMIT 1',
      UNITS: 'SELECT Id, UnitName AS Name FROM UOM WHERE TenantId = ? AND Active = 1 ORDER BY UnitName',
      TAX_GROUPS: 'SELECT Id, Name FROM taxgroup WHERE TenantId = ? AND Active = 1 ORDER BY Name',
      FOOD_TYPES: 'SELECT Id, Name, Code, IsVeg FROM pos_food_type WHERE TenantId = ? AND Active = 1 ORDER BY SortOrder, Name',
      MEAT_TYPES: 'SELECT Id, Name, Code FROM pos_meat_type WHERE TenantId = ? AND Active = 1 ORDER BY SortOrder, Name',
      TAGS: 'SELECT Id, Name, Code, TagType FROM pos_menu_tag WHERE TenantId = ? AND Active = 1 ORDER BY Name',
      VARIANTS: 'SELECT Id, Name, Code, Price FROM pos_variant WHERE TenantId = ? AND Active = 1 ORDER BY SortOrder, Name',
      ADDON_GROUPS: `SELECT g.Id, g.Name, g.Code, g.MinSelection, g.MaxSelection,
                            a.Id AS AddonId, a.Name AS AddonName, a.Code AS AddonCode, a.Price AS AddonPrice,
                            ft.Name AS AddonFoodType, a.SortOrder AS AddonSort
                       FROM pos_addon_group g
                       LEFT JOIN pos_addon a ON a.AddonGroupId = g.Id AND a.TenantId = g.TenantId AND a.Active = 1
                       LEFT JOIN pos_food_type ft ON ft.Id = a.FoodTypeId
                      WHERE g.TenantId = ? AND g.Active = 1
                      ORDER BY g.SortOrder, g.Name, a.SortOrder, a.Name`,
      // Code uniqueness for anything this module invents a code for.
      CODE_TAKEN: {
        pos_food_type: 'SELECT 1 FROM pos_food_type WHERE TenantId = ? AND Code = ? LIMIT 1',
        pos_meat_type: 'SELECT 1 FROM pos_meat_type WHERE TenantId = ? AND Code = ? LIMIT 1',
        pos_menu_tag: 'SELECT 1 FROM pos_menu_tag WHERE TenantId = ? AND Code = ? LIMIT 1',
        pos_variant: 'SELECT 1 FROM pos_variant WHERE TenantId = ? AND Code = ? LIMIT 1',
        pos_addon_group: 'SELECT 1 FROM pos_addon_group WHERE TenantId = ? AND Code = ? LIMIT 1',
        pos_addon: 'SELECT 1 FROM pos_addon WHERE TenantId = ? AND Code = ? LIMIT 1',
        itemdetail: 'SELECT 1 FROM itemdetail WHERE TenantId = ? AND Code = ? LIMIT 1',
      },
      ITEM_BY_CODE: 'SELECT Id FROM itemdetail WHERE TenantId = ? AND Code = ? LIMIT 1',
      ITEM_BY_NAME: 'SELECT Id FROM itemdetail WHERE TenantId = ? AND Name = ? LIMIT 1',
      ADDON_IN_GROUP: 'SELECT Id FROM pos_addon WHERE TenantId = ? AND AddonGroupId = ? AND Name = ? LIMIT 1',
      UPDATE_ADDON: `UPDATE pos_addon SET Price = ?, FoodTypeId = ?, SortOrder = ?, Active = 1,
                            UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?`,
      UPDATE_ADDON_GROUP_RULE: `UPDATE pos_addon_group SET MinSelection = ?, MaxSelection = ?,
                                       UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?`,

      // ── Writing a dish ─────────────────────────────────────────────────
      SET_META_ACTIVE:
        'UPDATE pos_item_meta SET Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SET_ITEM_ACTIVE:
        'UPDATE itemdetail SET Active = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      // A listing is "listed" while Active. Available stays the counter's
      // out-of-stock switch and is not touched by a menu edit.
      UPDATE_LISTING: `UPDATE pos_portal_listing
                          SET Active = ?, ListedName = ?, PriceOverrideCostInfoId = ?,
                              SyncStatus = 'pending', UpdatedOn = NOW(), UpdatedBy = ?
                        WHERE Id = ? AND TenantId = ?`,

      // ── Photos ─────────────────────────────────────────────────────────
      PHOTO_UPSERT: `INSERT INTO pos_item_photo
          (Id, TenantId, ItemDetailId, MimeType, Width, Height, ByteSize, Bytes,
           ThumbMimeType, ThumbByteSize, ThumbBytes, CreatedOn, CreatedBy, UpdatedOn, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), ?)
        ON DUPLICATE KEY UPDATE MimeType = VALUES(MimeType), Width = VALUES(Width), Height = VALUES(Height),
          ByteSize = VALUES(ByteSize), Bytes = VALUES(Bytes),
          ThumbMimeType = VALUES(ThumbMimeType), ThumbByteSize = VALUES(ThumbByteSize), ThumbBytes = VALUES(ThumbBytes),
          UpdatedOn = NOW(), UpdatedBy = VALUES(UpdatedBy)`,
      // The image itself, for an <img>: the thumbnail or the full photo, never
      // both — a 25KB list thumbnail must not drag 500KB along with it.
      PHOTO_IMAGE_THUMB: `SELECT COALESCE(ThumbMimeType, MimeType) AS MimeType, COALESCE(ThumbBytes, Bytes) AS Bytes,
          UNIX_TIMESTAMP(UpdatedOn) AS Version
          FROM pos_item_photo WHERE TenantId = ? AND ItemDetailId = ? LIMIT 1`,
      PHOTO_IMAGE_FULL: `SELECT MimeType, Bytes, UNIX_TIMESTAMP(UpdatedOn) AS Version
          FROM pos_item_photo WHERE TenantId = ? AND ItemDetailId = ? LIMIT 1`,
      PHOTO_GET:
        'SELECT MimeType, Width, Height, ByteSize, Bytes, UpdatedOn FROM pos_item_photo WHERE TenantId = ? AND ItemDetailId = ? LIMIT 1',
      PHOTO_DELETE: 'DELETE FROM pos_item_photo WHERE TenantId = ? AND ItemDetailId = ?',
    },

    // CSV exports (modules/export). One query per file, each ROW-LEVEL: the
    // reports aggregate, an export hands over the rows behind them. Every
    // query takes (tenantId, branchId, branchId, …) with `? IS NULL OR` for
    // the branch, so "all branches" needs no second copy of the SQL. Optional
    // filters are appended by the definition before ORDER BY, which is why
    // none of these end in one.
    EXPORT: {
      // Sales, credit notes and expenses. Paid and Returned are the same
      // correlated sums the Dues screen uses, so a document's Due here is the
      // Due there. Params: tenantId, branchId, branchId, from, to.
      LEDGER_DOCUMENTS: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.SettledAt,
               t.Name AS TypeName, s.Name AS StatusName, br.BranchName,
               l.CustomerName, l.CustomerMobile, l.BuyerGstin, l.BuyerLegalName, l.TaxMode,
               l.NetAmount, l.TaxAmount, l.DiscountAmount, l.RoundOff, l.GrossAmount,
               l.TaxByComponent, COALESCE(l.WriteOffAmount, 0) AS WriteOffAmount,
               ${COLLECTED_SQL} AS Paid,
               ${RETURNED_SQL} AS Returned,
               orig.TransactionNo AS ReversesNo
          FROM transactiondetaillog l
          JOIN transactiontype t              ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiontypestatus s   ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN branchdetail br           ON br.Id = l.BranchId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId AND orig.TenantId = l.TenantId
         WHERE l.TenantId = ? AND l.Active = 1
           AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?`,
      // One row per line of a sale or credit note. Variants and add-ons are the
      // snapshots printed on the bill. Params: tenantId, branchId, branchId,
      // from, to, saleType, returnType.
      LEDGER_LINES: `
        SELECT l.TransactionNo, l.TransactionDate, t.Name AS TypeName, br.BranchName,
               d.LineNo, COALESCE(i.Name, d.Comment) AS ItemName, i.Code AS ItemCode,
               i.HSNCode, i.SACCode, d.Variants, d.Addons,
               d.Quantity, d.UnitPrice, d.DiscountAmount, d.NetAmount, d.TaxAmount,
               d.GrossAmount, d.TaxComponents
          FROM transactionitemdetail d
          JOIN transactiondetaillog l ON l.Id = d.TransactionDetailLogId AND l.TenantId = d.TenantId
          JOIN transactiontype t      ON t.Id = l.TransactionTypeId
          LEFT JOIN branchdetail br   ON br.Id = l.BranchId
          LEFT JOIN itemdetail i      ON i.Id = d.ItemId AND i.TenantId = d.TenantId
         WHERE l.TenantId = ? AND l.Active = 1
           AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name IN (?, ?)`,
      // Money as it moved: one row per tender, signed (refunds and expense
      // payments are negative). Bounded on the breakup's own UTC Timestamp, the
      // same frame the Z-report reads. Params: tenantId, branchId, branchId,
      // fromUtc, toUtc.
      PAYMENTS: `
        SELECT b.Timestamp, l.TransactionNo, t.Name AS TypeName, br.BranchName,
               pm.Type AS Method, a.Name AS AccountName, b.Amount, pmtd.RefNo,
               b.CreatedBy, l.CustomerName
          FROM paymentbreakup b
          JOIN paymentdetail pd       ON pd.Id = b.PaymentDetailId AND pd.TenantId = b.TenantId
          JOIN transactiondetaillog l ON l.Id = pd.TransactionDetailLogId AND l.TenantId = pd.TenantId
          JOIN transactiontype t      ON t.Id = l.TransactionTypeId
          LEFT JOIN paymentmodetransactiondetail pmtd ON pmtd.Id = b.PaymentModeTransactionDetailId
          LEFT JOIN paymentmode pm    ON pm.Id = pmtd.PaymentModeId
          LEFT JOIN accounttypebase a ON a.Id = b.AccountTypeBaseId
          LEFT JOIN branchdetail br   ON br.Id = l.BranchId
         WHERE b.TenantId = ? AND b.Active = 1
           AND (? IS NULL OR l.BranchId = ?)
           AND b.Timestamp BETWEEN ? AND ?`,
      // One row per returned LINE, so "which dish came back" is a filter in
      // Excel. Refunded-to is the same subquery the returns register uses.
      // Params: tenantId, branchId, branchId, from, to, returnType.
      RETURNS: `
        SELECT l.TransactionNo, l.TransactionDate, orig.TransactionNo AS SaleNo,
               br.BranchName, l.CustomerName, l.CustomerMobile, l.CreatedBy,
               COALESCE(l.SettlementStatus, 'PENDING') AS SettlementStatus,
               d.LineNo, COALESCE(i.Name, d.Comment) AS ItemName, d.Quantity, d.GrossAmount,
               COALESCE(rr.Name, 'Unspecified') AS ReasonName, COALESCE(rr.IsFault, 0) AS IsFault,
               (SELECT GROUP_CONCAT(DISTINCT COALESCE(pm.Type, acc.Name) SEPARATOR ', ')
                  FROM paymentdetail pd
                  JOIN paymentbreakup pb ON pb.PaymentDetailId = pd.Id AND pb.TenantId = pd.TenantId
                  LEFT JOIN paymentmodetransactiondetail pmtd ON pmtd.Id = pb.PaymentModeTransactionDetailId
                  LEFT JOIN paymentmode pm ON pm.Id = pmtd.PaymentModeId
                  LEFT JOIN accounttypebase acc ON acc.Id = pb.AccountTypeBaseId
                 WHERE pd.TransactionDetailLogId = l.Id AND pd.TenantId = l.TenantId
                   AND pb.Amount < 0) AS RefundedTo
          FROM transactionitemdetail d
          JOIN transactiondetaillog l ON l.Id = d.TransactionDetailLogId AND l.TenantId = d.TenantId
          JOIN transactiontype t      ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId AND orig.TenantId = l.TenantId
          LEFT JOIN pos_return_reason rr ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
          LEFT JOIN branchdetail br   ON br.Id = l.BranchId
          LEFT JOIN itemdetail i      ON i.Id = d.ItemId AND i.TenantId = d.TenantId
         WHERE l.TenantId = ? AND l.Active = 1
           AND (? IS NULL OR l.BranchId = ?)
           AND l.TransactionDate BETWEEN ? AND ?
           AND t.Name = ?`,
      // Shifts OPENED in the range. Params: tenantId, branchId, branchId,
      // fromUtc, toUtc.
      CASH_SESSIONS: `
        SELECT cs.Id, br.BranchName, cs.CashierPhone, cs.ShiftLabel, cs.OpenedAt, cs.ClosedAt,
               cs.OpeningFloat, cs.ExpectedCash, cs.CountedCash, cs.Variance, cs.Status, cs.Notes,
               cs.OpenedBy, cs.ClosedBy
          FROM pos_cash_session cs
          LEFT JOIN branchdetail br ON br.Id = cs.BranchDetailId
         WHERE cs.TenantId = ? AND cs.Active = 1
           AND (? IS NULL OR cs.BranchDetailId = ?)
           AND cs.OpenedAt BETWEEN ? AND ?`,
      // Every claim, not only the settled ones the Expenses report counts: the
      // approval trail is the point of this file. Dated by ExpenseDate, falling
      // back to when it was raised. Params: tenantId, branchId, branchId, from, to.
      EXPENSES: `
        SELECT e.ExpenseDate, e.CreatedOn, l.TransactionNo, br.BranchName,
               ec.Name AS CategoryName, e.Description, pm.Type AS PaidBy, e.Amount,
               e.Status, e.ApprovedBy, e.ApprovedAt, e.CreatedBy
          FROM pos_expense e
          JOIN expense_category ec    ON ec.Id = e.ExpenseCategoryId
          LEFT JOIN paymentmode pm    ON pm.Id = e.PaymentModeId
          LEFT JOIN transactiondetaillog l ON l.Id = e.TransactionDetailLogId
          LEFT JOIN branchdetail br   ON br.Id = e.BranchDetailId
         WHERE e.TenantId = ? AND e.Active = 1
           AND (? IS NULL OR e.BranchDetailId = ?)
           AND DATE(COALESCE(e.ExpenseDate, e.CreatedOn)) BETWEEN ? AND ?`,
      // The register, undated. Params: tenantId, branchId, branchId.
      ASSETS: `
        SELECT a.Name, ac.Name AS CategoryName, br.BranchName, a.SerialNo, a.PurchaseDate,
               a.PurchaseCost, a.Status, a.Notes, l.TransactionNo,
               TRIM(CONCAT(COALESCE(cd.FirstName, ''), ' ', COALESCE(cd.LastName, ''))) AS SupplierName
          FROM asset a
          JOIN asset_category ac      ON ac.Id = a.AssetCategoryId
          LEFT JOIN branchdetail br   ON br.Id = a.BranchDetailId
          LEFT JOIN contactdetail cd  ON cd.Id = a.SupplierContactDetailId
          LEFT JOIN transactiondetaillog l ON l.Id = a.TransactionDetailLogId
         WHERE a.TenantId = ? AND a.Active = 1
           AND (? IS NULL OR a.BranchDetailId = ?)`,
      // The CRM list. Visits / TotalSpent / LoyaltyPoints are the projection
      // the till keeps on settle. Params: tenantId, branchId, branchId.
      CUSTOMERS: `
        SELECT c.Name, c.Phone, c.Email, c.GSTIN, c.LegalName, br.BranchName,
               c.CreatedOn, c.LastVisitAt, c.Visits, c.TotalSpent, c.LoyaltyPoints,
               DATEDIFF(CURDATE(), c.LastVisitAt) AS DaysAway
          FROM pos_customer c
          LEFT JOIN branchdetail br ON br.Id = c.BranchDetailId
         WHERE c.TenantId = ? AND c.Active = 1
           AND (? IS NULL OR c.BranchDetailId = ?)`,
      // Points movements in the range, every branch: the running balance is
      // tenant-wide, so it is computed over all of them and the branch is
      // filtered afterwards. Source names the invoice — a BILL source is the
      // pos_bill, a RETURN source is the credit note itself.
      // Params: tenantId, fromUtc, toUtc.
      LOYALTY: `
        SELECT ll.Id, ll.CustomerId, ll.CreatedOn, c.Name, c.Phone, ll.EntryType, ll.Points,
               ll.SourceType, ll.Reason, ll.BranchDetailId, br.BranchName, ll.CreatedBy,
               CASE ll.SourceType
                 WHEN 'RETURN' THEN (SELECT x.TransactionNo FROM transactiondetaillog x
                                      WHERE x.Id = ll.SourceId AND x.TenantId = ll.TenantId)
                 WHEN 'BILL'   THEN (SELECT x.TransactionNo FROM pos_bill pb
                                       JOIN transactiondetaillog x ON x.Id = pb.TransactionDetailLogId
                                      WHERE pb.Id = ll.SourceId AND pb.TenantId = ll.TenantId)
               END AS SourceNo
          FROM pos_loyalty_ledger ll
          JOIN pos_customer c       ON c.Id = ll.CustomerId
          LEFT JOIN branchdetail br ON br.Id = ll.BranchDetailId
         WHERE ll.TenantId = ? AND ll.CreatedOn BETWEEN ? AND ?
         ORDER BY ll.CreatedOn ASC, ll.Id ASC`,
      // Each customer's balance before the range opens. :ids is expanded by the
      // caller to one placeholder per customer. Params: tenantId, fromUtc, ...ids.
      LOYALTY_OPENING: `
        SELECT CustomerId, COALESCE(SUM(Points), 0) AS Opening
          FROM pos_loyalty_ledger
         WHERE TenantId = ? AND CreatedOn < ? AND CustomerId IN (:ids)
         GROUP BY CustomerId`,
      // Ratings with the visit they were about. Params: tenantId, branchId,
      // branchId, fromUtc, toUtc.
      FEEDBACK: `
        SELECT f.CreatedOn, COALESCE(c.Name, f.CustomerName) AS CustomerName, c.Phone,
               f.Rating, f.Comments, br.BranchName, o.OrderType, o.TableName,
               ch.Name AS ChannelName,
               (SELECT x.TransactionNo
                  FROM pos_bill_order bo
                  JOIN pos_bill pb ON pb.Id = bo.BillId AND pb.TenantId = bo.TenantId
                  JOIN transactiondetaillog x ON x.Id = pb.TransactionDetailLogId
                 WHERE bo.OrderId = f.OrderId AND bo.TenantId = f.TenantId
                 LIMIT 1) AS BillNo
          FROM pos_feedback f
          LEFT JOIN pos_customer c  ON c.Id = f.CustomerId
          LEFT JOIN pos_order o     ON o.Id = f.OrderId AND o.TenantId = f.TenantId
          LEFT JOIN pos_channel ch  ON ch.Id = o.ChannelId
          LEFT JOIN branchdetail br ON br.Id = f.BranchDetailId
         WHERE f.TenantId = ? AND f.Active = 1
           AND (? IS NULL OR f.BranchDetailId = ?)
           AND f.CreatedOn BETWEEN ? AND ?`,
      CAMPAIGNS: `
        SELECT Id, Name, Code, Status, StartsOn, EndsOn, DaysOfWeek, StartTime, EndTime,
               BudgetAmount, SpentAmount
          FROM pos_campaign
         WHERE TenantId = ? AND Active = 1
         ORDER BY StartsOn DESC, Name ASC`,
      // Redemptions in the range, one row per campaign per bill — rolled up in
      // Node so a bill with three redemptions counts its revenue once.
      // Params: tenantId, branchId, branchId, fromUtc, toUtc.
      CAMPAIGN_REDEMPTIONS: `
        SELECT CampaignId, BillId, COUNT(*) AS Redemptions,
               COALESCE(SUM(DiscountAmount), 0) AS Given,
               MAX(BillGrossAmount) AS BillGross
          FROM pos_offer_redemption
         WHERE TenantId = ? AND Active = 1
           AND (? IS NULL OR BranchDetailId = ?)
           AND RedeemedOn BETWEEN ? AND ?
         GROUP BY CampaignId, BillId`,
      // The catalogue in the import template's shape. Food type comes from the
      // dish's first branch entry: the template has one column, the menu one
      // per branch. Params: tenantId.
      MENU_ITEMS: `
        SELECT i.Name, i.Code, i.Description, i.HSNCode, i.SACCode,
               c.Name AS CategoryName, u.UnitName, ci.Amount AS Price, ci.IsTaxIncluded,
               tg.Id AS TaxGroupId, tg.Name AS TaxGroupName,
               (SELECT ft.Name FROM pos_item_meta m
                  JOIN pos_food_type ft ON ft.Id = m.FoodTypeId
                 WHERE m.ItemDetailId = i.Id AND m.TenantId = i.TenantId AND m.Active = 1
                 ORDER BY m.CreatedOn ASC LIMIT 1) AS FoodTypeName
          FROM itemdetail i
          LEFT JOIN categorydetail c ON c.Id = i.CategoryId
          LEFT JOIN UOM u            ON u.Id = i.UOMId
          LEFT JOIN costinfo ci      ON ci.Id = i.CostInfoId
          LEFT JOIN taxgroup tg      ON tg.Id = ci.TaxGroupId
         WHERE i.TenantId = ? AND i.Active = 1
         ORDER BY c.Name ASC, i.Name ASC`,
      // Each tax group's components, for "CGST:2.5|SGST:2.5". Params: tenantId.
      TAX_GROUP_COMPONENTS: `
        SELECT tgm.TaxGroupId, tt.Name, tt.Value
          FROM taxgrouptaxtypemapper tgm
          JOIN TaxTypes tt ON tt.Id = tgm.TaxTypeId AND tt.TenantId = tgm.TenantId AND tt.Active = 1
         WHERE tgm.TenantId = ? AND tgm.Active = 1
         ORDER BY tt.Name ASC`,
      // One row per dish per branch. Price is the branch's own cost info when
      // it has one, else the catalogue's. Params: tenantId, branchId, branchId.
      MENU_BRANCH: `
        SELECT i.Code, i.Name, c.Name AS CategoryName, br.BranchName,
               COALESCE(mc.Amount, ci.Amount) AS Price,
               COALESCE(mtg.Name, tg.Name) AS TaxGroupName,
               ft.Name AS FoodTypeName, mt.Name AS MeatTypeName,
               m.ServesCount, m.PortionSize, m.PrepTimeMinutes, m.StockTracked, m.MaxPerOrder,
               (SELECT GROUP_CONCAT(ch.Name ORDER BY ch.SortOrder, ch.Name SEPARATOR '; ')
                  FROM pos_item_meta_channel mch
                  JOIN pos_channel ch ON ch.Id = mch.ChannelId
                 WHERE mch.ItemMetaId = m.Id AND mch.TenantId = m.TenantId AND mch.Active = 1) AS Channels,
               (SELECT GROUP_CONCAT(v.Name ORDER BY v.SortOrder, v.Name SEPARATOR '; ')
                  FROM pos_item_meta_variant mv
                  JOIN pos_variant v ON v.Id = mv.VariantId
                 WHERE mv.ItemMetaId = m.Id AND mv.TenantId = m.TenantId AND mv.Active = 1) AS Variants,
               (SELECT GROUP_CONCAT(g.Name ORDER BY mg.SortOrder, g.Name SEPARATOR '; ')
                  FROM pos_item_meta_addon_group mg
                  JOIN pos_addon_group g ON g.Id = mg.AddonGroupId
                 WHERE mg.ItemMetaId = m.Id AND mg.TenantId = m.TenantId AND mg.Active = 1) AS AddonGroups
          FROM pos_item_meta m
          JOIN itemdetail i          ON i.Id = m.ItemDetailId AND i.TenantId = m.TenantId
          LEFT JOIN categorydetail c ON c.Id = i.CategoryId
          LEFT JOIN branchdetail br  ON br.Id = m.BranchDetailId
          LEFT JOIN costinfo mc      ON mc.Id = m.CostInfoId
          LEFT JOIN taxgroup mtg     ON mtg.Id = mc.TaxGroupId
          LEFT JOIN costinfo ci      ON ci.Id = i.CostInfoId
          LEFT JOIN taxgroup tg      ON tg.Id = ci.TaxGroupId
          LEFT JOIN pos_food_type ft ON ft.Id = m.FoodTypeId
          LEFT JOIN pos_meat_type mt ON mt.Id = m.MeatTypeId
         WHERE m.TenantId = ? AND m.Active = 1 AND i.Active = 1
           AND (? IS NULL OR m.BranchDetailId = ?)
         ORDER BY br.BranchName ASC, c.Name ASC, i.Name ASC`,
      // Variants and add-ons in one file. "Used by" counts dishes, not branch
      // entries. Params: tenantId, tenantId.
      MENU_OPTIONS: `
        SELECT 'Variant' AS Kind, NULL AS GroupName, NULL AS MinSelection, NULL AS MaxSelection,
               v.Name, v.Code, v.Price, NULL AS FoodTypeName, v.SortOrder,
               (SELECT COUNT(DISTINCT m.ItemDetailId) FROM pos_item_meta_variant mv
                  JOIN pos_item_meta m ON m.Id = mv.ItemMetaId AND m.Active = 1
                 WHERE mv.VariantId = v.Id AND mv.TenantId = v.TenantId AND mv.Active = 1) AS UsedBy
          FROM pos_variant v
         WHERE v.TenantId = ? AND v.Active = 1
        UNION ALL
        SELECT 'Add-on', g.Name, g.MinSelection, g.MaxSelection,
               a.Name, a.Code, a.Price, ft.Name, a.SortOrder,
               (SELECT COUNT(DISTINCT m.ItemDetailId) FROM pos_item_meta_addon_group mg
                  JOIN pos_item_meta m ON m.Id = mg.ItemMetaId AND m.Active = 1
                 WHERE mg.AddonGroupId = g.Id AND mg.TenantId = g.TenantId AND mg.Active = 1)
          FROM pos_addon a
          JOIN pos_addon_group g     ON g.Id = a.AddonGroupId AND g.Active = 1
          LEFT JOIN pos_food_type ft ON ft.Id = a.FoodTypeId
         WHERE a.TenantId = ? AND a.Active = 1
         ORDER BY Kind DESC, GroupName ASC, SortOrder ASC, Name ASC`,
      // Trading hours, one row per window. DayOfWeek is 0 = Sunday (JS
      // getDay()). Params: tenantId.
      CATEGORY_HOURS: `
        SELECT c.Name AS CategoryName, s.DayOfWeek, s.StartTime, s.EndTime
          FROM pos_category_schedule s
          JOIN categorydetail c ON c.Id = s.CategoryId
         WHERE s.TenantId = ? AND s.Active = 1
         ORDER BY c.Name ASC, s.DayOfWeek ASC, s.StartTime ASC`,
      // Portions counted per day. Params: tenantId, branchId, branchId, from, to.
      DAILY_STOCK: `
        SELECT ds.BusinessDate, br.BranchName, i.Name, i.Code, ds.PreparedQty, ds.SoldQty
          FROM pos_item_daily_stock ds
          JOIN pos_item_meta m      ON m.Id = ds.ItemMetaId
          JOIN itemdetail i         ON i.Id = m.ItemDetailId
          LEFT JOIN branchdetail br ON br.Id = ds.BranchDetailId
         WHERE ds.TenantId = ? AND ds.Active = 1
           AND (? IS NULL OR ds.BranchDetailId = ?)
           AND ds.BusinessDate BETWEEN ? AND ?
         ORDER BY ds.BusinessDate ASC, br.BranchName ASC, i.Name ASC`,
      // The lapsed list without the report's 500-row cap. Params: tenantId, days.
      LAPSED: `
        SELECT Name, Phone, Visits, TotalSpent, LoyaltyPoints, LastVisitAt,
               DATEDIFF(CURDATE(), LastVisitAt) AS DaysSince
          FROM pos_customer
         WHERE TenantId = ? AND Active = 1 AND LastVisitAt IS NOT NULL
           AND LastVisitAt < DATE_SUB(CURDATE(), INTERVAL ? DAY)
         ORDER BY TotalSpent DESC`,
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
    // ── Tenant deletion ──────────────────────────────────────────────────────
    // Erasing a tenancy is 72 statements in a fixed order, and the order is not
    // a preference: 97 of the schema's 111 foreign keys are RESTRICT, there is
    // no `tenants` table, and no foreign key anywhere points at a tenant id. So
    // the database cascades NOTHING from a tenancy — run a wave early and the
    // whole transaction aborts on a constraint instead of deleting anything.
    //
    // Held as an ordered list rather than 72 named keys because the ORDER is the
    // contract; a name per statement would invite reading them as independent.
    // Waves come from the schema's own dependency graph — regenerate rather than
    // hand-edit if a table is added, and add it to the right wave.
    TENANT_DELETE: {
      // Who is in this tenancy. Read BEFORE the sweep — user_tenants is deleted
      // in wave 2 and is the only record of membership that exists.
      SELECT_MEMBERS: 'SELECT user_phone FROM user_tenants WHERE tenant_id = ?',

      // Of those, the ones for whom this is their ONLY tenancy. They are the
      // people whose platform-level onboarding record has to be cleared as well;
      // anybody with another membership keeps theirs untouched.
      //
      // Read before the sweep for the same reason as above.
      SELECT_SOLE_MEMBERS: `
        SELECT ut.user_phone
        FROM user_tenants ut
        WHERE ut.tenant_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM user_tenants other
            WHERE other.user_phone = ut.user_phone
              AND other.tenant_id <> ut.tenant_id
          )`,

      // onboarding_requests is UNIQUE(email) — ONE row per person for the whole
      // platform, not one per tenancy. That is why it is deleted by email and
      // never by tenant_id: clearing it for somebody who still belongs to
      // another tenancy would erase a live user's record, and NOT clearing it
      // for somebody who no longer belongs anywhere leaves a stale APPROVED row
      // that auth's guest path reads on their next sign-in — returning
      // onboardingStatus APPROVED with a null tenantId, and (because
      // auto-approval sits in the `else` of that same check) permanently
      // preventing them from ever being provisioned again.
      DELETE_ONBOARDING_BY_PHONE: 'DELETE FROM onboarding_requests WHERE phone = ?',

      // Does this tenancy exist at all? Distinguishes a 404 from a delete that
      // silently affected nothing. Membership is the right test because it is
      // also what the All Tenants directory lists — a tenancy the caller cannot
      // see there is one they cannot address here, and a garbage id is refused
      // before 72 DELETE statements run against it.
      COUNT_MEMBERSHIPS: 'SELECT COUNT(*) AS total FROM user_tenants WHERE tenant_id = ?',

      // Super-admin rank lives on the MEMBERSHIP (user_tenants.is_super_admin),
      // not on the person, so deleting the tenancy a super admin belongs to
      // deletes their rank with it. If that was their only membership the
      // platform loses a super admin permanently, and possibly its last one.
      // Refused outright rather than warned about — the same instinct as
      // SUPER_ADMIN_IMMUTABLE, applied one level up.
      COUNT_SUPER_ADMINS: `
        SELECT COUNT(*) AS total FROM user_tenants
        WHERE tenant_id = ? AND is_super_admin = TRUE`,

      // Who ran this tenancy. TENANT:ADMIN is derived from is_admin rather than
      // from a role, so this flag IS the answer. Read before the sweep for the
      // same reason as the membership queries above: afterwards the rows are
      // gone and the audit trail could never say whose tenancy it was.
      SELECT_ADMINS: `
        SELECT user_phone FROM user_tenants
        WHERE tenant_id = ? AND is_admin = TRUE
        ORDER BY user_phone`,

      // Rows that point at ANOTHER ROW OF THE SAME TABLE, cut loose before the
      // sweep. Executed first, inside the same transaction.
      //
      // The sweep empties each table with one DELETE, and InnoDB checks a
      // foreign key row by row as it deletes, not once the statement is done.
      // So when a table references itself, a single
      // "DELETE … WHERE TenantId = ?" fails with ER_ROW_IS_REFERENCED_2 the
      // moment it reaches a parent row before the child that points at it — and
      // which comes first is just the order of the primary key, a random uuid.
      // A tenancy with no returns, no reversals and no sub-categories never
      // trips it, which is why it passed locally and failed on a real tenancy.
      //
      // Nulling the links first makes the order irrelevant. Nothing is lost:
      // every row touched here is deleted by the sweep a moment later, in the
      // same transaction.
      UNLINK_SELF_REFERENCES: [
        // A return / credit-note line → the sale line it returns.
        'UPDATE transactionitemdetail SET SourceLineId = NULL WHERE TenantId = ? AND SourceLineId IS NOT NULL',
        // A reversing document → the document it reverses.
        'UPDATE transactiondetaillog SET ReversesLogId = NULL WHERE TenantId = ? AND ReversesLogId IS NOT NULL',
        // A sub-category → its parent category.
        'UPDATE categorydetail SET ParentId = NULL WHERE TenantId = ? AND ParentId IS NOT NULL',
      ],

      // The sweep. Executed in array order, all inside ONE transaction.
      SWEEP: [
        // ── Wave 1 ─ Leaf rows: ledger lines, POS movements, join tables, role grants.
        //   app_settings: GLOBAL table — never deleted
        //   onboarding_requests: handled by email, not by tenant — see clearOnboardingFor()
        //   role_permissions: removed by ON DELETE CASCADE
        //   tenant_invitation_roles: removed by ON DELETE CASCADE
        'DELETE FROM asset WHERE TenantId = ?',
        'DELETE FROM audit_logs WHERE tenant_id = ?',
        // Diner OTP challenges carry the restaurant they were sent for; staff
        // ones carry none (tenant_id NULL) and are untouched.
        'DELETE FROM auth_otp_challenge WHERE tenant_id = ?',
        'DELETE FROM batchdetail WHERE TenantId = ?',
        'DELETE FROM branchusergroupmapper WHERE TenantId = ?',
        'DELETE FROM notification_outbox WHERE TenantId = ?',
        'DELETE FROM paymentbreakup WHERE TenantId = ?',
        'DELETE FROM pos_bill_order WHERE TenantId = ?',
        'DELETE FROM pos_campaign_branch WHERE TenantId = ?',
        'DELETE FROM pos_cash_session WHERE TenantId = ?',
        'DELETE FROM pos_category_schedule WHERE TenantId = ?',
        'DELETE FROM pos_category_tag WHERE TenantId = ?',
        'DELETE FROM pos_expense WHERE TenantId = ?',
        'DELETE FROM pos_feedback WHERE TenantId = ?',
        'DELETE FROM pos_item_meta_addon_group WHERE TenantId = ?',
        // Today's portion counts. Ahead of pos_item_meta for the same reason as
        // its siblings: the FK cascades, but the sweep counts every row it
        // removes rather than leaving any to the engine.
        'DELETE FROM pos_item_daily_stock WHERE TenantId = ?',
        'DELETE FROM pos_item_meta_channel WHERE TenantId = ?',
        'DELETE FROM pos_item_meta_tag WHERE TenantId = ?',
        'DELETE FROM pos_item_meta_variant WHERE TenantId = ?',
        'DELETE FROM pos_item_nutrition WHERE TenantId = ?',
        // Dish photos hang off itemdetail, which is swept later.
        'DELETE FROM pos_item_photo WHERE TenantId = ?',
        'DELETE FROM pos_kot WHERE TenantId = ?',
        'DELETE FROM pos_loyalty_ledger WHERE TenantId = ?',
        'DELETE FROM pos_offer_redemption WHERE TenantId = ?',
        'DELETE FROM pos_online_order WHERE TenantId = ?',
        'DELETE FROM pos_portal_category WHERE TenantId = ?',
        'DELETE FROM pos_portal_credential WHERE TenantId = ?',
        'DELETE FROM pos_portal_event WHERE TenantId = ?',
        // OUT OF ALPHABETICAL ORDER ON PURPOSE. The variant rows hang off
        // pos_portal_listing, so sorting this line after its parent — where the
        // name would otherwise put it — makes the parent delete fail on the FK.
        'DELETE FROM pos_portal_listing_variant WHERE TenantId = ?',
        'DELETE FROM pos_portal_listing WHERE TenantId = ?',
        'DELETE FROM pos_setting WHERE TenantId = ?',
        // The branch's logo and payment QR. Wave 1 and no foreign key, so its place
        // here is free — but it MUST be swept: these are blobs, so a tenancy left
        // behind is kilobytes per branch that nothing will ever read again.
        'DELETE FROM pos_branch_media WHERE TenantId = ?',
        // Before pos_table (wave 4): a table's QR code references it RESTRICT.
        'DELETE FROM pos_table_qr WHERE TenantId = ?',
        // Which tenders each outlet accepts. MUST precede paymentmode in Wave 2:
        // the FK onto it is ON DELETE CASCADE, so MySQL would cope either way —
        // but the sweep does not rely on cascades anywhere else, and a row left
        // to a cascade is a row nobody counted.
        'DELETE FROM pos_branch_payment_method WHERE TenantId = ?',
        // The GST switch, its history and recorded filings. No foreign keys in or
        // out, so their place in the sweep is free.
        'DELETE FROM pos_tax_setting WHERE TenantId = ?',
        'DELETE FROM pos_tax_mode_history WHERE TenantId = ?',
        'DELETE FROM pos_gst_filing WHERE TenantId = ?',
        'DELETE FROM pos_token WHERE TenantId = ?',
        'DELETE FROM pos_token_counter WHERE TenantId = ?',
        'DELETE FROM taxgrouptaxtypemapper WHERE TenantId = ?',
        'DELETE FROM tenant_setup WHERE tenant_id = ?',
        'DELETE FROM transactionitemdetail WHERE TenantId = ?',
        'DELETE FROM transactiontypeconversionmapper WHERE TenantId = ?',
        'DELETE FROM uomfactor WHERE TenantId = ?',
        'DELETE FROM user_roles WHERE tenant_id = ?',
        // ── Wave 2 ─ Documents and the IAM spine. user_tenants dies here — members are read BEFORE this runs.
        //   features: GLOBAL table — never deleted
        'DELETE FROM TaxTypes WHERE TenantId = ?',
        'DELETE FROM asset_category WHERE TenantId = ?',
        'DELETE FROM expense_category WHERE TenantId = ?',
        'DELETE FROM paymentdetail WHERE TenantId = ?',
        // pos_addon before its group; the group after the item links in Wave 1.
        'DELETE FROM pos_addon WHERE TenantId = ?',
        'DELETE FROM pos_addon_group WHERE TenantId = ?',
        // Tags after both join tables (pos_item_meta_tag, pos_category_tag).
        'DELETE FROM pos_menu_tag WHERE TenantId = ?',
        // After pos_online_order (Wave 1), which points at it, and before
        // pos_portal (Wave 3), which it points at.
        'DELETE FROM pos_rejection_reason WHERE TenantId = ?',
        'DELETE FROM paymentmodetransactiondetail WHERE TenantId = ?',
        'DELETE FROM paymentreceivedtype WHERE TenantId = ?',
        'DELETE FROM pos_bill WHERE TenantId = ?',
        'DELETE FROM pos_item_meta WHERE TenantId = ?',
        'DELETE FROM pos_offer WHERE TenantId = ?',
        'DELETE FROM pos_portal_branch WHERE TenantId = ?',
        'DELETE FROM pos_variant WHERE TenantId = ?',
        'DELETE FROM roles WHERE tenant_id = ?',
        'DELETE FROM tenant_invitations WHERE tenant_id = ?',
        'DELETE FROM transactiontypebaseconversion WHERE TenantId = ?',
        'DELETE FROM user_tenants WHERE tenant_id = ?',
        // ── Wave 3 ─ Items, orders, portals, the ledger head.
        'DELETE FROM itemdetail WHERE TenantId = ?',
        'DELETE FROM pos_campaign WHERE TenantId = ?',
        'DELETE FROM pos_food_type WHERE TenantId = ?',
        // Same wave and same reason as pos_food_type: pos_item_meta (Wave 2)
        // points at both, so neither can go before it.
        'DELETE FROM pos_meat_type WHERE TenantId = ?',
        'DELETE FROM pos_order WHERE TenantId = ?',
        'DELETE FROM pos_portal WHERE TenantId = ?',
        'DELETE FROM transactiondetaillog WHERE TenantId = ?',
        // ── Wave 4 ─ Catalogue and floor master data.
        'DELETE FROM UOM WHERE TenantId = ?',
        'DELETE FROM categorydetail WHERE TenantId = ?',
        'DELETE FROM costinfo WHERE TenantId = ?',
        'DELETE FROM paymentmode WHERE TenantId = ?',
        'DELETE FROM pos_channel WHERE TenantId = ?',
        'DELETE FROM pos_customer WHERE TenantId = ?',
        'DELETE FROM pos_return_reason WHERE TenantId = ?',
        'DELETE FROM pos_table WHERE TenantId = ?',
        'DELETE FROM transactiontype WHERE TenantId = ?',
        'DELETE FROM transactiontypestatus WHERE TenantId = ?',
        // ── Wave 5 ─ Account bases, floors, tax groups.
        'DELETE FROM accounttypebase WHERE TenantId = ?',
        'DELETE FROM pos_floor WHERE TenantId = ?',
        'DELETE FROM taxgroup WHERE TenantId = ?',
        // ── Wave 6 ─ The branch itself.
        'DELETE FROM branchdetail WHERE TenantId = ?',
        // ── Wave 7 ─ Organisation, address, contact, numbering series.
        'DELETE FROM addressdetail WHERE TenantId = ?',
        'DELETE FROM contactdetail WHERE TenantId = ?',
        'DELETE FROM organizationdetail WHERE TenantId = ?',
        'DELETE FROM transactiontypeconfig WHERE TenantId = ?',
        // ── Wave 8 ─ Address types and the location mapper.
        'DELETE FROM contactaddresstype WHERE TenantId = ?',
        'DELETE FROM mapproviderlocationmapper WHERE TenantId = ?',
        // ── Wave 9 ─ Geography roots.
        'DELETE FROM locationdetail WHERE TenantId = ?',
        'DELETE FROM mapprovider WHERE TenantId = ?',
      ],
    },

    ADMIN_USERS: {
      // One row per person: who they are (the profile that used to live in
      // pos_staff), what they may do (roles), and whether they can administer.
      SELECT_ALL: `
        SELECT ut.user_phone, ut.tenant_id, ut.is_admin, ut.is_super_admin,
               ut.is_active, ut.status,
               ut.full_name, ut.branch_detail_id,
               b.BranchName AS branch_name,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
        FROM user_tenants ut
        LEFT JOIN user_roles ur ON ut.user_phone = ur.user_phone AND ut.tenant_id = ur.tenant_id
        LEFT JOIN roles r ON ur.role_id = r.id
        LEFT JOIN branchdetail b ON b.Id = ut.branch_detail_id AND b.TenantId = ut.tenant_id
        WHERE ut.tenant_id = ?
        GROUP BY ut.user_phone, ut.tenant_id
        ORDER BY ut.full_name IS NULL, ut.full_name ASC, ut.user_phone ASC`,
      // Cross-tenant listing for super admins only. No tenant_id filter; each row
      // carries its tenant_id (plus a best-effort organization name for display).
      // setup_status is per TENANT, so every row of the same tenant carries the
      // same value. A tenant with no tenant_setup row has never run the
      // first-time wizard and reports PENDING.
      SELECT_ALL_TENANTS: `
        SELECT ut.user_phone, ut.tenant_id, ut.is_admin, ut.is_super_admin,
               ut.is_active, ut.status,
               (SELECT o.Name FROM organizationdetail o
                  WHERE o.TenantId = ut.tenant_id
                  ORDER BY o.CreatedOn ASC LIMIT 1) AS tenant_name,
               COALESCE(ts.status, 'PENDING') AS setup_status,
               ts.completed_at AS setup_completed_at,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
        FROM user_tenants ut
        LEFT JOIN user_roles ur ON ut.user_phone = ur.user_phone AND ut.tenant_id = ur.tenant_id
        LEFT JOIN roles r ON ur.role_id = r.id
        LEFT JOIN tenant_setup ts ON ts.tenant_id = ut.tenant_id
        GROUP BY ut.user_phone, ut.tenant_id, ts.status, ts.completed_at
        ORDER BY ut.tenant_id ASC, ut.user_phone ASC`,
      COUNT_ALL_TENANTS: 'SELECT COUNT(*) as total FROM user_tenants',

      // ── Cross-tenant directory (super admin) ─────────────────────────────
      // One row per TENANCY rather than per membership. The flat listing above
      // cannot be grouped for display, because a page boundary can fall in the
      // middle of a tenancy and split its people across two pages.
      //
      // Every count is COUNT(DISTINCT CASE …) rather than SUM(): joining
      // user_roles multiplies a membership by the number of roles it holds, so
      // a plain SUM(is_admin) would report an admin with three roles as three
      // admins. The DISTINCT is on user_phone, which is what is actually being
      // counted.
      SELECT_TENANT_DIRECTORY: `
        SELECT ut.tenant_id,
               (SELECT o.Name FROM organizationdetail o
                  WHERE o.TenantId = ut.tenant_id
                  ORDER BY o.CreatedOn ASC LIMIT 1) AS tenant_name,
               COUNT(DISTINCT ut.user_phone) AS user_count,
               COUNT(DISTINCT CASE WHEN ut.is_admin = 1 THEN ut.user_phone END) AS admin_count,
               COUNT(DISTINCT CASE WHEN ut.is_super_admin = 1 THEN ut.user_phone END) AS super_admin_count,
               COUNT(DISTINCT CASE WHEN ut.status = 'SUSPENDED' THEN ut.user_phone END) AS suspended_count,
               MAX(ut.last_active_at) AS last_active_at,
               (SELECT COUNT(*) FROM branchdetail b WHERE b.TenantId = ut.tenant_id) AS branch_count,
               COALESCE(ts.status, 'PENDING') AS setup_status,
               ts.completed_at AS setup_completed_at,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
          FROM user_tenants ut
          LEFT JOIN user_roles ur ON ur.user_phone = ut.user_phone AND ur.tenant_id = ut.tenant_id
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
        SELECT ut.user_phone, ut.tenant_id, ut.is_admin, ut.is_super_admin,
               ut.is_active, ut.status, ut.last_active_at,
               ut.full_name, ut.branch_detail_id,
               b.BranchName AS branch_name,
               GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
          FROM user_tenants ut
          LEFT JOIN user_roles ur ON ut.user_phone = ur.user_phone AND ut.tenant_id = ur.tenant_id
          LEFT JOIN roles r ON ur.role_id = r.id
          LEFT JOIN branchdetail b ON b.Id = ut.branch_detail_id AND b.TenantId = ut.tenant_id
         WHERE ut.tenant_id = ?
         GROUP BY ut.user_phone, ut.tenant_id
         ORDER BY ut.full_name IS NULL, ut.full_name ASC, ut.user_phone ASC`,
      // Membership flags for a single (email, tenant) pair — used by the super-admin
      // cross-tenant status change to verify existence and guard super admins.
      SELECT_FLAGS_BY_PHONE_TENANT:
        'SELECT is_super_admin FROM user_tenants WHERE user_phone = ? AND tenant_id = ?',
      // What the per-request access check needs to know about a membership:
      // whether it still exists and is usable, and the two flags that become
      // TENANT:ADMIN and TENANT:SUPER_ADMIN.
      SELECT_ACCESS_FLAGS:
        'SELECT is_admin, is_super_admin, is_active, status FROM user_tenants WHERE user_phone = ? AND tenant_id = ?',
      // A membership's state before a change, for the audit row's before → after.
      SELECT_STATE: `
        SELECT ut.full_name, ut.branch_detail_id, b.BranchName AS branch_name,
               ut.is_admin, ut.is_super_admin, ut.status
        FROM user_tenants ut
        LEFT JOIN branchdetail b ON b.Id = ut.branch_detail_id
        WHERE ut.user_phone = ? AND ut.tenant_id = ?`,
      SELECT_BRANCH_NAME:
        'SELECT BranchName FROM branchdetail WHERE Id = ? AND TenantId = ?',
      // Who can grant access in a tenancy, for the Access Denied page. Names and
      // numbers only — what any member is already shown on a staff rota.
      SELECT_ADMINISTRATORS: `
        SELECT full_name, user_phone
        FROM user_tenants
        WHERE tenant_id = ? AND is_admin = TRUE AND is_active = TRUE AND status = 'ACTIVE'
        ORDER BY full_name`,
      SELECT_BY_PHONE: `
        SELECT ut.*, GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
        FROM user_tenants ut
        LEFT JOIN user_roles ur ON ut.user_phone = ur.user_phone AND ut.tenant_id = ur.tenant_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE ut.user_phone = ? AND ut.tenant_id = ?
        GROUP BY ut.user_phone, ut.tenant_id`,
      INSERT_USER_TENANT:
        "INSERT INTO user_tenants (id, user_phone, tenant_id, is_admin, is_super_admin, is_active, status) VALUES (?, ?, ?, 0, 0, 1, 'ACTIVE')",
      // Parametrized variant: caller supplies is_admin / is_super_admin flags.
      // Used by the shared provisioning core (manual approve → 0/0, auto-approve → 1/0).
      // full_name is NOT NULL, so every membership insert must carry one.
      // Callers fall back to the number: an admin can correct a name, but a
      // failed INSERT costs somebody their login.
      INSERT_USER_TENANT_FLAGS:
        "INSERT INTO user_tenants (id, user_phone, full_name, tenant_id, is_admin, is_super_admin, is_active, status) VALUES (?, ?, ?, ?, ?, ?, 1, 'ACTIVE')",
      UPDATE_STATUS:
        'UPDATE user_tenants SET is_active = ?, status = ?, updated_at = NOW() WHERE user_phone = ? AND tenant_id = ?',
      DELETE:
        'DELETE FROM user_tenants WHERE user_phone = ? AND tenant_id = ?',
      // TENANT:ADMIN is derived from this flag at login, never from a role.
      // Assigning a role NAMED 'TENANT_ADMIN' or 'SUPER_ADMIN' grants that
      // role's feature scopes and nothing else — which is why a user could hold
      // the SUPER_ADMIN role and still be refused the Access Control screen.
      SET_ADMIN_FLAG:
        'UPDATE user_tenants SET is_admin = ?, updated_at = NOW() WHERE user_phone = ? AND tenant_id = ?',
      // The staff details, on the membership they belong to.
      UPDATE_PROFILE:
        'UPDATE user_tenants SET full_name = ?, branch_detail_id = ?, updated_at = NOW() WHERE user_phone = ? AND tenant_id = ?',
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
      // The whole catalogue as keys, to validate a role's grants and to work
      // out what each one depends on (see config/permissionRules.js).
      SELECT_KEYS:
        'SELECT feature_id, feature_short_name, scope, is_active FROM features',
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
      // RequiresReference rides along: the reference rule is a property of the
      // METHOD, not of its name. It used to be enforced by matching Type against
      // a hardcoded ['Card','UPI','Wallet'], so renaming 'Card' to 'Credit Card'
      // silently stopped the ledger requiring one.
      SELECT_PAYMENT_MODE:
        'SELECT Id, Type, DefaultAccountTypeBaseId, RequiresReference FROM paymentmode WHERE Id = ? AND TenantId = ? AND Active = 1 LIMIT 1',

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
           ContactDetailId, CustomerName, CustomerMobile, TaxMode, BuyerGstin, BuyerLegalName,
           SellerGstin, Remarks, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      // The branch's GSTIN at the moment a sale is issued — snapshotted onto
      // the document as SellerGstin.
      SELECT_BRANCH_GSTIN: 'SELECT GSTIN FROM branchdetail WHERE Id = ? AND TenantId = ? LIMIT 1',
      UPDATE_LOG_STATUS:
        'UPDATE transactiondetaillog SET TransactionTypeStatusId = ?, SettledAt = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
      SELECT_LOG_FULL: `
        SELECT l.*, s.Name AS StatusName, t.Name AS TypeName, b.BranchName,
               -- The sale a credit note came off. A note is meaningless
               -- without it, and carrying the number here saves the UI a
               -- second read just to label the link back.
               orig.TransactionNo AS OriginalNo,
               rr.Name AS ReasonName, rr.Code AS ReasonCode, rr.IsFault
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN transactiontype t       ON t.Id = l.TransactionTypeId
          LEFT JOIN branchdetail b          ON b.Id = l.BranchId
          LEFT JOIN transactiondetaillog orig
                 ON orig.Id = l.ReversesLogId AND orig.TenantId = l.TenantId
          LEFT JOIN pos_return_reason rr
                 ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
         WHERE l.Id = ? AND l.TenantId = ?`,
      SELECT_LOG_LIST: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.GrossAmount, l.NetAmount,
               l.TaxAmount, l.CustomerName, l.CustomerMobile, l.SettledAt,
               l.WriteOffAmount, l.BranchId,
               s.Name AS StatusName, t.Name AS TypeName,
               -- What has been taken against it so far. The list shows Paid and
               -- Due beside the total, so a partly-paid invoice can be spotted
               -- and collected without opening it.
               ${COLLECTED_SQL} AS Collected,
               -- What the customer was holding: a token number, or a table.
               -- Correlated subqueries rather than joins: a bill covering three
               -- rounds would fan this row out three times and every list total
               -- would triple. An invoice with no POS bill behind it (an
               -- expense) simply gets nulls.
${DOC_SOURCE_COLUMNS_SQL}
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN transactiontype t       ON t.Id = l.TransactionTypeId
         WHERE l.TenantId = ?`,
      // The due expression, for the list's "Dues only" filter. Static SQL,
      // never user input.
      DUE_EXPR: DUE_SQL,

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
           UnitPrice, BasePrice, VariantAmount, AddonAmount, NetAmount, DiscountAmount, ItemDiscountAmount,
           TaxAmount, GrossAmount,
           TaxComponents, Variants, Addons, TaxCharged, Note, Comment, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
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
           ContactDetailId, CustomerName, CustomerMobile, TaxMode, BuyerGstin, BuyerLegalName,
           SellerGstin, ReversesLogId, SettlementStatus, SettlementRef, ReturnReasonId,
           Remarks, Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
      INSERT_RETURN_LINE: `
        INSERT INTO transactionitemdetail
          (Id, TenantId, TransactionDetailLogId, LineNo, ItemId, Quantity, CostInfoId,
           UnitPrice, BasePrice, VariantAmount, AddonAmount, NetAmount, DiscountAmount, ItemDiscountAmount,
           TaxAmount, GrossAmount, TaxComponents, Variants, Addons, TaxCharged, Note, Comment,
           SourceLineId, RestockRequested,
           Active, CreatedOn, CreatedBy, UpdatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,

      // THE CONCURRENCY GUARD. Two cashiers refunding one invoice at the same
      // moment would both read "nothing returned yet" and both be allowed to
      // refund the whole thing. Locking the sale row serialises them, the same
      // discipline the numbering counter already uses to stop two tills taking
      // one invoice number.
      SELECT_SALE_FOR_RETURN: `
        SELECT l.Id, l.TenantId, l.TransactionNo, l.GrossAmount, l.NetAmount, l.TaxAmount,
               l.DiscountAmount, l.BranchId, l.ContactDetailId, l.CustomerName,
               l.CustomerMobile, l.TransactionTypeConfigId, l.TransactionTypeStatusId,
               l.TaxMode, l.BuyerGstin, l.BuyerLegalName, l.SellerGstin,
               l.SettledAt, l.WriteOffAmount, s.Name AS StatusName
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
               orig.TransactionNo AS SaleNo, l.ReversesLogId, l.ReversesLogId AS SaleId,
               l.CustomerName, l.CustomerMobile, b.BranchName
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId
          LEFT JOIN branchdetail b ON b.Id = l.BranchId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1
           AND COALESCE(l.SettlementStatus, 'PENDING') = 'PENDING'
         ORDER BY l.CreatedOn ASC`,

      // ── The returns register ───────────────────────────────────────────
      //
      // Every credit note, with everything a business needs to trace one:
      // WHAT came back, off WHICH invoice, for WHOSE order, WHY, to WHICH
      // tender, and WHO did it. That last one is the standard shrinkage
      // control and the reason CreatedBy is selected rather than left in the
      // audit log where nobody joins it.
      //
      // The refund tender is DERIVED from the negative breakups rather than
      // stored: money can go back across two modes (cash first, then card),
      // and a single stored "destination" column could not say so. Store
      // credit shows as its account name because no payment mode moved.
      SELECT_RETURNS_LIST: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.CreatedOn, l.CreatedBy,
               l.GrossAmount, l.NetAmount, l.TaxAmount,
               l.SettlementStatus, l.SettlementRef, l.Remarks,
               l.ReversesLogId                       AS SaleId,
               orig.TransactionNo                    AS SaleNo,
               orig.GrossAmount                      AS SaleGross,
               l.ContactDetailId, l.CustomerName, l.CustomerMobile,
               l.BranchId, b.BranchName,
               rr.Id AS ReasonId, rr.Name AS ReasonName, rr.Code AS ReasonCode, rr.IsFault,
               s.Name AS StatusName,
               (SELECT COUNT(*) FROM transactionitemdetail ti
                 WHERE ti.TransactionDetailLogId = l.Id AND ti.TenantId = l.TenantId) AS LineCount,
               (SELECT COALESCE(SUM(ti.Quantity), 0) FROM transactionitemdetail ti
                 WHERE ti.TransactionDetailLogId = l.Id AND ti.TenantId = l.TenantId) AS QuantityReturned,
               (SELECT GROUP_CONCAT(DISTINCT ti.Comment ORDER BY ti.LineNo SEPARATOR ', ')
                  FROM transactionitemdetail ti
                 WHERE ti.TransactionDetailLogId = l.Id AND ti.TenantId = l.TenantId) AS ItemNames,
               -- Where the money actually went. COALESCE so store credit —
               -- which moves no payment mode — still names its account.
               (SELECT GROUP_CONCAT(DISTINCT COALESCE(pm.Type, acc.Name) SEPARATOR ', ')
                  FROM paymentdetail pd
                  JOIN paymentbreakup pb ON pb.PaymentDetailId = pd.Id AND pb.TenantId = pd.TenantId
                  LEFT JOIN paymentmodetransactiondetail pmtd
                         ON pmtd.Id = pb.PaymentModeTransactionDetailId
                  LEFT JOIN paymentmode pm ON pm.Id = pmtd.PaymentModeId
                  LEFT JOIN accounttypebase acc ON acc.Id = pb.AccountTypeBaseId
                 WHERE pd.TransactionDetailLogId = l.Id AND pd.TenantId = l.TenantId
                   AND pb.Amount < 0) AS RefundedTo
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN pos_return_reason rr ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
          LEFT JOIN branchdetail b ON b.Id = l.BranchId AND b.TenantId = l.TenantId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1`,

      COUNT_RETURNS_LIST: `
        SELECT COUNT(*) AS total
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId
          LEFT JOIN pos_return_reason rr ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1`,

      // The same filtered set, totalled. Read alongside the page so the header
      // reports the WHOLE selection rather than the fifty rows on screen —
      // "₹6,240 returned this month" must not change when you turn the page.
      SUM_RETURNS_LIST: `
        SELECT COALESCE(SUM(l.GrossAmount), 0) AS ReturnedAmount,
               COALESCE(SUM(l.NetAmount), 0)   AS ReturnedNet,
               COALESCE(SUM(l.TaxAmount), 0)   AS ReturnedTax,
               COUNT(*)                        AS ReturnCount,
               COALESCE(SUM(CASE WHEN rr.IsFault = 1 THEN l.GrossAmount ELSE 0 END), 0) AS FaultAmount
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
          LEFT JOIN transactiondetaillog orig ON orig.Id = l.ReversesLogId
          LEFT JOIN pos_return_reason rr ON rr.Id = l.ReturnReasonId AND rr.TenantId = l.TenantId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1`,

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
               prt.Type AS ReceivedType, a.Name AS AccountName,
               b.PaymentDetailId, b.CreatedBy
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

      // ── Collecting a balance ──────────────────────────────────────────────
      // The sale, LOCKED, before anything is read about what it still owes. Two
      // cashiers collecting the same invoice at once would otherwise both read
      // "₹88 due" and both take it.
      SELECT_SALE_FOR_COLLECT: `
        SELECT l.Id, l.TransactionNo, l.GrossAmount, l.BranchId,
               l.TransactionTypeConfigId, l.TransactionTypeStatusId,
               l.ContactDetailId, l.CustomerName, l.CustomerMobile,
               l.WriteOffAmount, l.SettledAt,
               s.Name AS StatusName, t.Name AS TypeName
          FROM transactiondetaillog l
          LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          LEFT JOIN transactiontype t       ON t.Id = l.TransactionTypeId
         WHERE l.Id = ? AND l.TenantId = ?
         FOR UPDATE`,
      // Every payment taken against one document, however many there were.
      SELECT_COLLECTED_TOTAL: `
        SELECT COALESCE(SUM(TotalAmount), 0) AS collected
          FROM paymentdetail
         WHERE TransactionDetailLogId = ? AND TenantId = ?`,
      // What the customer has paid and NOT had back: the sale's payment rows
      // netted against every refund row on its credit notes, store credit
      // included. A return refunds only what this exceeds what they keep.
      SELECT_NET_PAID: `
        SELECT COALESCE(SUM(b.Amount), 0) AS netPaid
          FROM paymentbreakup b
          JOIN paymentdetail pd ON pd.Id = b.PaymentDetailId AND pd.TenantId = b.TenantId
         WHERE b.TenantId = ?
           AND pd.TransactionDetailLogId IN (
                 SELECT Id FROM transactiondetaillog
                  WHERE TenantId = ? AND (Id = ? OR ReversesLogId = ?)
               )`,
      // WrittenOffAt is an INSTANT, stamped in UTC like every DATETIME the pool
      // writes (config/db.js pins it to 'Z'). NOW() is the server's own zone,
      // which on a server not set to UTC would file an evening write-off under
      // the next day once the register reads it as UTC.
      SET_WRITE_OFF: `
        UPDATE transactiondetaillog
           SET WriteOffAmount = ?, WriteOffReason = ?, WriteOffNote = ?,
               WrittenOffAt = UTC_TIMESTAMP(), WrittenOffBy = ?, UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ?`,
      // The names behind the mobiles that wrote balances off. Read separately
      // and matched in Node rather than joined, so a register row never depends
      // on the membership still existing. `:phones` is a placeholder list.
      SELECT_MEMBER_NAMES:
        'SELECT id, user_phone, full_name FROM user_tenants WHERE tenant_id = ? AND user_phone IN (:phones)',
      // Who owes the balance, added after the fact for a sale saved short with
      // no name. Only the snapshot moves — the CRM customer is untouched.
      SET_DEBTOR: `
        UPDATE transactiondetaillog
           SET CustomerName = ?, CustomerMobile = ?, UpdatedOn = NOW(), UpdatedBy = ?
         WHERE Id = ? AND TenantId = ?`,
      // Moves the POS bill on only from the status it is expected to be in, so
      // a bill already marked refunded is never flipped back to 'paid'.
      UPDATE_BILL_STATUS_BY_LOG_FROM:
        'UPDATE pos_bill SET Status = ?, UpdatedOn = NOW(), UpdatedBy = ? WHERE TransactionDetailLogId = ? AND TenantId = ? AND Status = ?',

      // Every sale still owed money, oldest first — the Dues worklist. Small by
      // nature (only part-paid sales), so filtering by age and text happens in
      // Node over this one read. Params: businessDate, tenantId, typeName.
      SELECT_DUES: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.CreatedOn, l.GrossAmount,
               l.CustomerName, l.CustomerMobile, l.ContactDetailId, l.BranchId,
               br.BranchName, l.WriteOffAmount,
               DATEDIFF(?, l.TransactionDate) AS AgeDays,
               ${COLLECTED_SQL} AS Collected,
               ${RETURNED_SQL} AS Returned,
               (SELECT MAX(pdl.CreatedOn) FROM paymentdetail pdl
                 WHERE pdl.TransactionDetailLogId = l.Id AND pdl.TenantId = l.TenantId) AS LastPaymentAt,
${DOC_SOURCE_COLUMNS_SQL}
          FROM transactiondetaillog l
          JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          JOIN transactiontype t       ON t.Id = l.TransactionTypeId
          LEFT JOIN branchdetail br    ON br.Id = l.BranchId
         WHERE l.TenantId = ? AND t.Name = ? AND s.Name = 'PARTIALLY_PAID' AND l.Active = 1
           AND ${DUE_SQL} > 0.01`,

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
      // ── Write-offs ─────────────────────────────────────────────────────────
      //
      // Balances given up on, counted by the day they were WRITTEN OFF — not the
      // bill's date. "How much did we write off this month" is a question about
      // decisions taken this month; a September bill written off on 2 October
      // belongs to October, and is reported as "on an earlier bill".
      //
      // WrittenOffAt is a UTC instant, so callers bound it with the UTC edges of
      // the local days (toDateTimeBounds). Each query's WHERE clause is the same
      // and ends where the caller appends its branch / venue / weekend clause.
      //
      // Grouped four ways at once and rolled up in Node: one scan answers the
      // totals, by reason, by who, by day, and the earlier-bills split.
      // Params: rangeFrom (earlier-bill cut), tenantId, typeName, from, to.
      WRITE_OFF_GROUPS: `
        SELECT l.WriteOffReason AS Reason,
               l.WrittenOffBy   AS WrittenOffBy,
               {{BUCKET}}       AS WrittenOffDay,
               CASE WHEN l.TransactionDate < ? THEN 1 ELSE 0 END AS OnEarlierBill,
               COUNT(*)                            AS Bills,
               COALESCE(SUM(l.WriteOffAmount), 0)  AS Amount,
               COALESCE(MAX(l.WriteOffAmount), 0)  AS Largest
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1
           AND l.WriteOffAmount > 0
           AND l.WrittenOffAt BETWEEN ? AND ?
         GROUP BY l.WriteOffReason, l.WrittenOffBy, WrittenOffDay, OnEarlierBill`,
      // Every write-off, newest first. Params as WRITE_OFF_GROUPS.
      WRITE_OFF_ROWS: `
        SELECT l.Id, l.TransactionNo, l.TransactionDate, l.GrossAmount,
               l.CustomerName, l.CustomerMobile, l.BranchId, br.BranchName,
               l.WriteOffAmount, l.WriteOffReason, l.WriteOffNote,
               l.WrittenOffAt, l.WrittenOffBy,
               CASE WHEN l.TransactionDate < ? THEN 1 ELSE 0 END AS OnEarlierBill,
               ${COLLECTED_SQL} AS Collected,
               ${RETURNED_SQL} AS Returned,
${DOC_SOURCE_COLUMNS_SQL}
          FROM transactiondetaillog l
          JOIN transactiontype t    ON t.Id = l.TransactionTypeId
          LEFT JOIN branchdetail br ON br.Id = l.BranchId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1
           AND l.WriteOffAmount > 0
           AND l.WrittenOffAt BETWEEN ? AND ?`,
      // Names written off more than once — by mobile where the bill has one,
      // otherwise by name. A walk-in with neither cannot be grouped and is left
      // out rather than lumped together. Params: tenantId, typeName, from, to.
      WRITE_OFF_REPEATS: `
        SELECT MAX(l.CustomerName)   AS CustomerName,
               MAX(l.CustomerMobile) AS CustomerMobile,
               COUNT(*)                           AS Times,
               COALESCE(SUM(l.WriteOffAmount), 0) AS Amount,
               MAX(l.WrittenOffAt)                AS LastAt
          FROM transactiondetaillog l
          JOIN transactiontype t ON t.Id = l.TransactionTypeId
         WHERE l.TenantId = ? AND t.Name = ? AND l.Active = 1
           AND l.WriteOffAmount > 0
           AND l.WrittenOffAt BETWEEN ? AND ?
           AND COALESCE(NULLIF(TRIM(l.CustomerMobile), ''), NULLIF(TRIM(l.CustomerName), '')) IS NOT NULL
         GROUP BY COALESCE(NULLIF(TRIM(l.CustomerMobile), ''), LOWER(TRIM(l.CustomerName)))
        HAVING COUNT(*) > 1
         ORDER BY Amount DESC
         LIMIT 20`,
      // What was invoiced in the same window, by BILL date as every sales figure
      // is — the denominator of "share of sales". Same document scope as
      // SALES_SUMMARY. Params: tenantId, typeName, from, to.
      WRITE_OFF_INVOICED: `
        SELECT COALESCE(SUM(l.GrossAmount), 0) AS Invoiced
          FROM transactiondetaillog l
          JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
          JOIN transactiontype t       ON t.Id = l.TransactionTypeId
         WHERE l.TenantId = ? AND t.Name = ?
           AND l.TransactionDate BETWEEN ? AND ?
           AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')`,

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
          -- Still owed, per document, then summed: returns come off a part-paid
          -- sale's due first, and a written-off balance is no longer owed. The
          -- old Gross − Collected kept counting both as outstanding.
          COALESCE(SUM(GREATEST(0, l.GrossAmount - COALESCE(r.Returned, 0)
                                 - COALESCE(p.Collected, 0) - l.WriteOffAmount)), 0) AS Outstanding,
          -- Balances given up on. Their own figure, never folded into discount.
          COALESCE(SUM(l.WriteOffAmount), 0)      AS WrittenOff
        FROM transactiondetaillog l
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        JOIN transactiontype t       ON t.Id = l.TransactionTypeId
        LEFT JOIN (
          SELECT TransactionDetailLogId, SUM(TotalAmount) AS Collected
            FROM paymentdetail WHERE TenantId = ? GROUP BY TransactionDetailLogId
        ) p ON p.TransactionDetailLogId = l.Id
        LEFT JOIN (
          SELECT ReversesLogId, SUM(GrossAmount) AS Returned
            FROM transactiondetaillog
           WHERE ReversesLogId IS NOT NULL AND Active = 1
           GROUP BY ReversesLogId
        ) r ON r.ReversesLogId = l.Id
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
          rr.Id                               AS ReasonId,
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
          -- What options and add-ons added on top of the dish price, per unit
          -- times quantity, BEFORE discount. Part of GrossAmount, not beside it.
          COALESCE(SUM(ti.VariantAmount * ti.Quantity), 0) AS OptionsAmount,
          COALESCE(SUM(ti.AddonAmount * ti.Quantity), 0)   AS AddonsAmount,
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

      // The lines behind the options & add-ons report: only those that carried
      // a choice, with the choice SNAPSHOT as sold. Same document scope as
      // PRODUCT_SALES, so the two reports always describe the same sales.
      // Aggregated in ledger.options.report — the snapshot is JSON in two
      // historical shapes, and a take rate needs a denominator SQL cannot see.
      OPTION_LINES: `
        SELECT ti.ItemId, ti.Quantity, ti.Variants, ti.Addons
        FROM transactionitemdetail ti
        JOIN transactiondetaillog l  ON l.Id = ti.TransactionDetailLogId
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        LEFT JOIN itemdetail i       ON i.Id = ti.ItemId
        WHERE ti.TenantId = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
          AND l.ReversesLogId IS NULL
          AND (JSON_LENGTH(COALESCE(ti.Variants, JSON_ARRAY())) > 0
               OR JSON_LENGTH(COALESCE(ti.Addons, JSON_ARRAY())) > 0)`,

      // Which sold dishes OFFER which variant or add-on group on today's menu —
      // the denominator of a take rate. Keyed by the catalogue item, which is
      // what an invoice line references. :ids is expanded twice.
      OPTION_OFFERS: `
        SELECT m.ItemDetailId AS ItemId, 'variant' AS Kind, mv.VariantId AS OptionId
          FROM pos_item_meta m
          JOIN pos_item_meta_variant mv ON mv.ItemMetaId = m.Id AND mv.TenantId = m.TenantId AND mv.Active = 1
         WHERE m.TenantId = ? AND m.Active = 1 AND m.ItemDetailId IN (:ids)
        UNION
        SELECT m.ItemDetailId AS ItemId, 'group' AS Kind, mg.AddonGroupId AS OptionId
          FROM pos_item_meta m
          JOIN pos_item_meta_addon_group mg ON mg.ItemMetaId = m.Id AND mg.TenantId = m.TenantId AND mg.Active = 1
         WHERE m.TenantId = ? AND m.Active = 1 AND m.ItemDetailId IN (:ids)`,

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
          ${DUE_SQL}                                      AS Outstanding
        FROM transactiondetaillog l
        JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        JOIN transactiontype t       ON t.Id = l.TransactionTypeId
        LEFT JOIN (
          SELECT TransactionDetailLogId, SUM(TotalAmount) AS Collected
            FROM paymentdetail WHERE TenantId = ? GROUP BY TransactionDetailLogId
        ) p ON p.TransactionDetailLogId = l.Id
        WHERE l.TenantId = ? AND t.Name = ?
          AND l.TransactionDate BETWEEN ? AND ?
          AND s.Name = 'PARTIALLY_PAID'
          AND ${DUE_SQL} > 0.01
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

  // QR table ordering. See QR_TABLE_ORDERING_DESIGN.md.
  QR_ORDERING: {
    // The sales channel a diner's round is recorded under. How the front desk
    // tells a phone order from a till order, and how reports split the revenue.
    CHANNEL: {
      CODE: 'QR',
      NAME: 'QR Table Order',
      DESCRIPTION: 'Placed by a guest from the QR code on their table.',
      SORT_ORDER: 4,
    },
    // Until a restaurant links dishes to the QR channel, the dine-in menu is
    // what a guest at a table sees — so switching the feature on needs no setup.
    FALLBACK_CHANNEL_CODE: 'DINEIN',
    // Per branch, in pos_setting. No row = the default below.
    SETTING_KEYS: { ENABLED: 'qr.ordering.enabled', MODE: 'qr.ordering.mode', SHOW_PHOTOS: 'qr.ordering.showPhotos' },
    MODES: { MENU: 'menu', ORDER: 'order' },
    // Dish photos show on the guest menu unless a branch turns them off.
    DEFAULTS: { ENABLED: false, MODE: 'order', SHOW_PHOTOS: true },
    // 128 bits: the only thing between the internet and a table's order queue.
    TOKEN_BYTES: 16,
    SESSION_AUDIENCE: 'diner',
    // CreatedBy on a diner's round. Fits pos_order.CreatedBy (VARCHAR 50).
    CREATED_BY_PREFIX: 'diner:',
    GUEST_NAME: 'Guest',
    // A cart larger than this is not a table's order.
    MAX_LINES: 40,
    MAX_QUANTITY: 50,
  },

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
    // Whether sending a round to the kitchen also puts it on paper. WHEN it
    // prints only; HOW MANY copies is already a per-document field in the
    // receipt format (Receipt Format → Kitchen ticket → Copies), and a second
    // control for the same thing would let the two disagree.
    KOT_AUTO_PRINT: 'kot.auto_print',
    // Fallback Kitchen Preparation Time, in minutes, for a branch. Used when no
    // line on an order carries its own PrepTimeMinutes — a KPT of zero would
    // promise a portal the food is already made.
    KPT_DEFAULT_MINUTES: 'kpt.default_minutes',
    // The quick-pick kitchen notes Billing offers ("Less spicy", "No onion").
    // A JSON list of strings, per branch — a Jain outlet and a grill want
    // different ones.
    KITCHEN_NOTE_PRESETS: 'kitchen.note_presets',
  },

  // Minutes. The number a portal is told the kitchen needs, and the number a
  // merchant rating is scored against, so the fallback has to be a plausible
  // real answer rather than a neutral-looking zero.
  KPT: {
    DEFAULT_MINUTES: 20,
    MIN_MINUTES: 1,
    // Two hours. Anything beyond this is a typo (200 for 20), and a portal that
    // accepts it shows the customer an absurd promise.
    MAX_MINUTES: 120,
  },

  // Values for POS_SETTING_KEYS.KOT_AUTO_PRINT.
  //   ON  — the ticket prints the moment the round is sent. What a kitchen
  //         printer is for: nobody has to remember a second action.
  //   OFF — nothing prints automatically; the pass keeps a Print button for
  //         reprints. For a screen-only kitchen with no printer attached.
  KOT_AUTO_PRINT: { ON: 'on', OFF: 'off' },
  KOT_AUTO_PRINT_DEFAULT: 'on',
  // Limits on what the kitchen is told. See modules/posorder/kitchenNotes.js.
  KITCHEN_NOTES: {
    // A dish note typed at the till. Two lines of an 80mm ticket at the note's
    // size; longer is refused rather than cut, because half an allergy is worse
    // than none.
    LINE_MAX: 140,
    // The whole-order note. = pos_order / pos_kot.CookingInstructions VARCHAR(500).
    ORDER_MAX: 500,
    // = transactionitemdetail.Note VARCHAR(255). Wider than LINE_MAX so a portal
    // note, which is not held to the till's limit, still reaches the invoice.
    STORED_LINE_MAX: 255,
    // One quick-pick, and how many a branch may keep. 20 × 40 plus JSON
    // punctuation stays under pos_setting.SettingValue VARCHAR(1000).
    PRESET_MAX: 40,
    PRESETS_MAX: 20,
    DEFAULT_PRESETS: ['Less spicy', 'Extra spicy', 'Less salt', 'Less oil', 'No onion', 'No garlic', 'Jain'],
  },
  // Covers at one table, = pos_order.GuestCount SMALLINT. A banquet of 500 is
  // real; 5000 is a slipped key, and it would skew every per-cover report.
  POS_GUEST_COUNT_MAX: 999,
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
    UPDATE_USER_PROFILE:      'Updated staff details',
    GRANT_ADMIN:              'Granted administrator access',
    REVOKE_ADMIN:             'Withdrew administrator access',
    // Both kinds, for the route-level row (which fires on failures too).
    UPDATE_USER_ADMIN:        'Changed administrator access',
    ACTIVATE_USER:            'Activated user account',
    SUSPEND_USER:             'Suspended user account',
    REMOVE_USER:              'Removed user from tenant',
    DELETE_TENANT:            'Deleted tenancy and all of its data',
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
  // Which clock the trading day runs on.
  //
  // app_settings has no tenant_id, so this is a PLATFORM default rather than a
  // per-tenant one — the right shape while every outlet is in one country, and
  // the reason it lives here instead of on pos_setting. Moving it per-branch
  // later is a column plus a lookup; nothing else here changes.
  //
  // It exists because a category schedule is written in the outlet's local time
  // ("breakfast 07:00-11:00") and evaluated on a server that is UTC in
  // production. Without it a 07:00 window opens at 12:30 IST.
  CLOCK: {
    SETTING_TIMEZONE: 'pos.timezone',
    // Only ever used when the setting is missing or names a zone this Node
    // build does not know. Wrong is better than crashed, and it is logged.
    DEFAULT_TIMEZONE: 'Asia/Kolkata',
  },

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

    // ── Collecting a balance ─────────────────────────────────────────────
    //
    // Why a balance was given up on. Coded so write-offs can be grouped; OTHER
    // needs a note, because "other" alone explains nothing to whoever audits
    // it later. [Code, Label, NoteRequired]
    WRITE_OFF_REASONS: [
      ['CUSTOMER_LEFT', 'Customer left without paying', false],
      ['DISPUTED',      'Disputed item',                false],
      ['STAFF_GUEST',   "Staff or owner's guest",       false],
      ['OTHER',         'Other',                        true],
    ],
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

  // The three kinds of menu tag, kept in ONE master (pos_menu_tag) separated by
  // TagType. Named here rather than left as inline strings for the same reason
  // as the bill statuses below: a picker filtering on 'Beverage' against a
  // service writing 'BEVERAGE' silently offers an empty list.
  POS_MENU_TAG_TYPES: {
    CATEGORY: 'CATEGORY',
    BEVERAGE: 'BEVERAGE',
    CUISINE: 'CUISINE',
  },

  // GST 9(5) bifurcation on itemdetail.SupplyType. Restaurant supply is a
  // SERVICE; a sealed bottle sold alongside it is GOODS, and the two attract
  // different treatment on the same bill.
  SUPPLY_TYPES: {
    GOODS: 'GOODS',
    SERVICE: 'SERVICE',
  },

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
  // The tenant's zero-rate tax group, provisioned at first-time setup. An item
  // whose tax group is left blank is sold under it — in the setup wizard and in
  // the CSV import alike. It never carries rates: an empty group IS the
  // exemption.
  TAX_GROUP_DEFAULTS: {
    EXEMPT_NAME: 'Exempt (0%)',
  },

  // ── Branch media: the logo and payment QR a bill can carry ─────────────────
  // Limits are deliberately small. A thermal printer has ONE ink and 384 dots
  // across an 80mm roll, so detail beyond that is bytes spent on nothing — and
  // these images travel to a till over Bluetooth LE, where a megabyte is a
  // visible pause before the paper moves.
  MEDIA: {
    KINDS: ['logo', 'paymentQr'],
    // 512KB decoded. Generous for a 384px monochrome logo; mean enough that a
    // phone photo pasted in by mistake is refused with a message rather than
    // stored and printed as a grey smear.
    MAX_BYTES: 512 * 1024,
    // The client downscales to PRINT_WIDTH_PX before uploading. These are the
    // outer bounds the server enforces regardless, so a caller that skips the
    // downscale is refused rather than obeyed.
    MAX_WIDTH_PX: 1024,
    MAX_HEIGHT_PX: 1024,
    // 384 dots is the full width of an 80mm head; 58mm paper is 320. The client
    // targets the larger and the renderer scales down for narrow paper.
    PRINT_WIDTH_PX: 384,
  },

  // Dish photos (pos_item_photo). The full photo follows MEDIA's limits; the
  // thumbnail is a small JPEG the browser makes at upload for lists.
  MENU_PHOTO: {
    THUMB_MAX_PX: 480,
    THUMB_MAX_BYTES: 96 * 1024,
    // A photo URL carries ?v=<version>, so a cached copy is right until the
    // photo changes — and then the URL changes with it.
    CACHE_SECONDS: 365 * 24 * 60 * 60,
  },

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
    // QR table ordering. READ sees the table codes and the queue of orders
    // guests placed from their phones; WRITE issues, prints and rotates codes,
    // switches the feature per branch, and accepts or rejects those orders.
    // A feature row like every POS_* scope, so it is granted through roles and
    // reaches an invited user with the role they are invited into.
    POS_QR_READ: 'POS_QR:READ',
    POS_QR_WRITE: 'POS_QR:WRITE',
    // Approving an expense commits money, so it is deliberately separate from
    // POS_OPS:WRITE — the person who raises a claim should not approve it.
    EXPENSE_APPROVE: 'EXPENSE:APPROVE',
    // Money going back out: a refund against a settled bill, or settling a
    // return. Separate from TRANSACTIONS:WRITE, which editors and operations
    // staff hold to keep the books and the numbering — neither job should be
    // able to hand money back.
    REFUND_APPROVE: 'REFUND:APPROVE',
    // The asset register is finance-owned reference data, not floor operations.
    ASSET_READ: 'ASSET:READ',
    ASSET_WRITE: 'ASSET:WRITE',
    // Taking the customer list OUT of the system: names, mobiles and emails in
    // bulk, as a file. Separate from POS_CRM:READ, which front-of-house
    // managers hold to look a guest up one at a time — seeing a record on
    // screen and walking off with all of them are different trusts. Also the
    // only permission that may un-mask mobiles in any export.
    CUSTOMER_EXPORT: 'CUSTOMER:EXPORT',
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
    // The QR codes screen needs the branch picker and the floor plan to draw
    // itself, like every other Front Desk screen.
    SCOPES.POS_QR_READ, SCOPES.POS_QR_WRITE,
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

  /**
   * QR table ordering — the printed codes and the branch switch.
   *
   * READ lists and prints the codes; MANAGE issues a new one, rotates one or
   * turns the feature on and off. Both belong to POS_QR alone: a code is a
   * public door into the branch's order queue, so opening one is not something
   * menu setup (POS_CONFIG) should grant by accident.
   */
  POS_QR_CODES_READ: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_QR_READ, SCOPES.POS_QR_WRITE,
  ],
  POS_QR_MANAGE: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_QR_WRITE,
  ],

  /**
   * The orders guests placed from their phones.
   *
   * Reviewing one IS taking an order — accepting fires the kitchen ticket — so
   * the floor staff who already hold POS_ORDER can see and decide them without a
   * second grant. POS_QR admits the same, for a role built around QR service.
   */
  POS_QR_ORDER_READ: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_QR_READ, SCOPES.POS_QR_WRITE,
    SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
  ],
  POS_QR_ORDER_DECIDE: [
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_QR_WRITE, SCOPES.POS_ORDER_WRITE,
  ],
};
