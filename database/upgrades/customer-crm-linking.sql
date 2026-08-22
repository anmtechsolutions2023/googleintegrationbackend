-- =============================================================================
-- customer-crm-linking.sql — UPGRADE AN EXISTING DATABASE IN PLACE
--
-- Wires the CRM into the sale it has always sat beside but never touched.
--
-- What was already true: pos_order.CustomerId → pos_bill → ledger contact is a
-- complete chain, and posbill.settle already walks it. What was missing is that
-- NOTHING ever set pos_order.CustomerId (the till had no way to attach a
-- customer), and nothing ever wrote pos_customer.Visits / TotalSpent /
-- LoyaltyPoints — three columns that have read 0 since the table was created.
-- Feedback had the same shape of gap: a rating with no order behind it cannot
-- be traced to a table, a token, or the food that was served.
--
-- NOT part of the install sequence — 01-schema-definition.sql is the source of
-- truth and already carries this. This brings an ALREADY-DEPLOYED database up
-- to it without a re-seed.
--
-- How to run:
--   mysql -u <user> -p <database_name> < database/upgrades/customer-crm-linking.sql
--
-- Idempotent: every step checks information_schema first.
-- =============================================================================


-- =============================================================================
-- PART 0 — PRE-FLIGHT (read only)
-- =============================================================================
-- Existing feedback rows have no order to point at, which is expected and fine:
-- the column is nullable precisely so history survives.
SELECT 'customers' AS what, COUNT(*) AS n FROM pos_customer
UNION ALL SELECT 'feedback rows', COUNT(*) FROM pos_feedback
UNION ALL SELECT 'orders already carrying a customer', COUNT(*)
  FROM pos_order WHERE CustomerId IS NOT NULL;


-- =============================================================================
-- PART 1 — pos_customer.LastVisitAt
-- =============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_customer'
      AND COLUMN_NAME = 'LastVisitAt') = 0,
  'ALTER TABLE pos_customer ADD COLUMN LastVisitAt DATETIME NULL AFTER LoyaltyPoints',
  'SELECT ''pos_customer.LastVisitAt already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- =============================================================================
-- PART 2 — pos_feedback.OrderId
-- =============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_feedback'
      AND COLUMN_NAME = 'OrderId') = 0,
  'ALTER TABLE pos_feedback ADD COLUMN OrderId VARCHAR(50) NULL AFTER Comments',
  'SELECT ''pos_feedback.OrderId already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One rating per visit. A second card for the same order is an EDIT of the
-- first, not a second opinion. NULLs stay distinct in a MySQL unique index, so
-- pre-existing rows with no order are unaffected — which is what we want.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_feedback'
      AND INDEX_NAME = 'uq_posfeedback_order') = 0,
  'ALTER TABLE pos_feedback ADD UNIQUE KEY uq_posfeedback_order (OrderId, TenantId)',
  'SELECT ''uq_posfeedback_order already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_feedback'
      AND INDEX_NAME = 'idx_posfeedback_customer') = 0,
  'ALTER TABLE pos_feedback ADD INDEX idx_posfeedback_customer (TenantId, CustomerId)',
  'SELECT ''idx_posfeedback_customer already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_feedback'
      AND COLUMN_NAME = 'OrderId' AND REFERENCED_TABLE_NAME = 'pos_order') = 0,
  'ALTER TABLE pos_feedback ADD FOREIGN KEY (OrderId) REFERENCES pos_order(Id)',
  'SELECT ''pos_feedback.OrderId FK already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- =============================================================================
-- PART 3 — BACKFILL the CRM projection from the ledger
-- =============================================================================
-- Visits / TotalSpent / LastVisitAt are a projection, so they can be rebuilt
-- from the documents at any time — which is the point of keeping the ledger as
-- the truth. Recomputed rather than incremented, so running this twice cannot
-- double anybody's spend.
--
-- Counts only SETTLED and PARTIALLY_PAID sales, matching every finance report.
-- Orders that never carried a customer contribute nothing, so on a database
-- where the till could not attach one this correctly leaves every row at zero.
UPDATE pos_customer c
LEFT JOIN (
  SELECT o.CustomerId,
         COUNT(DISTINCT l.Id)          AS Visits,
         COALESCE(SUM(l.GrossAmount * o.Total / bt.BillTotal), 0) AS Spent,
         MAX(l.SettledAt)              AS LastVisitAt
    FROM pos_order o
    JOIN pos_bill_order bo ON bo.OrderId = o.Id AND bo.TenantId = o.TenantId
    JOIN pos_bill b        ON b.Id = bo.BillId  AND b.TenantId = bo.TenantId
    JOIN transactiondetaillog l ON l.Id = b.TransactionDetailLogId
    JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
    JOIN (
      SELECT bo2.BillId, SUM(o2.Total) AS BillTotal
        FROM pos_bill_order bo2
        JOIN pos_order o2 ON o2.Id = bo2.OrderId AND o2.TenantId = bo2.TenantId
       GROUP BY bo2.BillId
    ) bt ON bt.BillId = b.Id AND bt.BillTotal > 0
   WHERE o.CustomerId IS NOT NULL
     AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
   GROUP BY o.CustomerId
) agg ON agg.CustomerId = c.Id
SET c.Visits      = COALESCE(agg.Visits, 0),
    c.TotalSpent  = ROUND(COALESCE(agg.Spent, 0), 2),
    c.LastVisitAt = agg.LastVisitAt,
    -- Same rule the application applies going forward
    -- (poscustomer.stats.service.LOYALTY_POINTS_PER_RUPEE).
    c.LoyaltyPoints = FLOOR(COALESCE(agg.Spent, 0) / 100);


-- =============================================================================
-- PART 4 — VERIFICATION
-- =============================================================================
-- SELECT Name, Phone, Visits, TotalSpent, LoyaltyPoints, LastVisitAt
--   FROM pos_customer ORDER BY TotalSpent DESC;

-- Feedback, now traceable to the visit it describes:
-- SELECT f.Rating, f.Comments, o.OrderNo, COALESCE(o.TableName, 'Counter') AS Served
--   FROM pos_feedback f LEFT JOIN pos_order o ON o.Id = f.OrderId;

-- The projection must agree with the ledger. Expect no rows:
-- SELECT c.Id, c.TotalSpent FROM pos_customer c WHERE c.TotalSpent < 0;


-- =============================================================================
-- PART 5 — ROLLBACK
-- =============================================================================
-- ALTER TABLE pos_feedback DROP FOREIGN KEY <fk_name>;  -- see SHOW CREATE TABLE
-- ALTER TABLE pos_feedback DROP INDEX uq_posfeedback_order,
--                          DROP INDEX idx_posfeedback_customer,
--                          DROP COLUMN OrderId;
-- ALTER TABLE pos_customer DROP COLUMN LastVisitAt;
-- UPDATE pos_customer SET Visits = 0, TotalSpent = 0, LoyaltyPoints = 0;
