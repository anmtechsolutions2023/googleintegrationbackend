-- =============================================================================
-- counter-tokens.sql — UPGRADE AN EXISTING DATABASE IN PLACE
--
-- Brings a database that was built from an older 01-schema-definition.sql up to
-- what the counter-token feature needs, so it can be validated without a
-- re-seed.
--
-- THIS IS NOT PART OF THE INSTALL SEQUENCE. A fresh deploy runs
-- 01-schema-definition.sql + 02-seed-data.sql and needs none of this; those two
-- files remain the source of truth for the schema. Nothing here should ever be
-- copied back into them.
--
-- How to run:
--   mysql -u <user> -p <database_name> < database/upgrades/counter-tokens.sql
--
-- What it does:
--   PART 0 — Pre-flight checks (READ ONLY — run these first, read the output)
--   PART 1 — Backfill pos_token so its new NOT NULL columns can be added
--   PART 2 — Alter pos_token: new columns, new unique key, queue index
--   PART 3 — New tables: pos_token_counter, pos_setting
--   PART 4 — POS_TOKEN numbering series, for every tenant that already has one
--   PART 5 — Verification queries
--   PART 6 — Rollback
--
-- Idempotent: every step checks for itself first, so re-running is safe.
-- PART 2 is the only destructive step, and PART 1 is what makes it safe — do
-- not skip it.
-- =============================================================================


-- =============================================================================
-- PART 0 — PRE-FLIGHT (read only). Run these BEFORE anything else.
-- =============================================================================
-- Existing tokens were minted in the browser and may have no branch. The column
-- becomes NOT NULL in PART 2, so any row PART 1 cannot fix will block the
-- ALTER. This tells you the size of that problem before you start.

SELECT 'tokens total' AS check_name, COUNT(*) AS n FROM pos_token
UNION ALL
SELECT 'tokens with no branch', COUNT(*) FROM pos_token WHERE BranchDetailId IS NULL
UNION ALL
SELECT 'tokens whose tenant has no branch at all', COUNT(*)
  FROM pos_token t
 WHERE t.BranchDetailId IS NULL
   AND NOT EXISTS (SELECT 1 FROM branchdetail b WHERE b.TenantId = t.TenantId);

-- If the last count is non-zero, those rows cannot be given a branch by any
-- rule — there is nothing to point them at. They are dead test tokens from the
-- browser-numbered era. Delete them deliberately, then re-run this file:
--
--   DELETE t FROM pos_token t
--    WHERE t.BranchDetailId IS NULL
--      AND NOT EXISTS (SELECT 1 FROM branchdetail b WHERE b.TenantId = t.TenantId);


-- =============================================================================
-- PART 1 — Backfill, so the NOT NULL and UNIQUE in PART 2 can be applied
-- =============================================================================

-- 1a) Add the new columns as NULLable first. They are filled in below and only
--     then tightened — adding them NOT NULL against existing rows would fail.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token' AND COLUMN_NAME = 'TokenLabel') = 0,
  'ALTER TABLE pos_token
     ADD COLUMN TokenLabel VARCHAR(50) NULL AFTER TokenNumber,
     ADD COLUMN TokenDate  DATE        NULL AFTER TokenLabel,
     ADD COLUMN CalledAt   DATETIME    NULL AFTER Status,
     ADD COLUMN ServedAt   DATETIME    NULL AFTER CalledAt',
  'SELECT ''pos_token: new columns already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1b) The branch, from the order the token belongs to where there is one.
UPDATE pos_token t
  JOIN pos_order o ON o.Id = t.OrderId
   SET t.BranchDetailId = o.BranchDetailId
 WHERE t.BranchDetailId IS NULL
   AND o.BranchDetailId IS NOT NULL;

-- 1c) Anything left: the tenant's first branch. These are pre-feature tokens
--     with no order behind them, so there is no better answer than "the branch
--     this tenant trades from" — and a token has to belong to some queue.
UPDATE pos_token t
   SET t.BranchDetailId = (
     SELECT b.Id FROM branchdetail b
      WHERE b.TenantId = t.TenantId
      ORDER BY b.CreatedOn IS NULL, b.CreatedOn, b.Id
      LIMIT 1)
 WHERE t.BranchDetailId IS NULL;

-- 1d) The day each token belongs to, and what it reads as.
UPDATE pos_token
   SET TokenDate = COALESCE(DATE(CreatedOn), CURDATE())
 WHERE TokenDate IS NULL;

UPDATE pos_token
   SET TokenLabel = CAST(TokenNumber AS CHAR)
 WHERE TokenLabel IS NULL OR TokenLabel = '';

-- 1e) Collisions. Rows that were unique only because their branch was NULL
--     (MySQL treats NULLs as distinct in a unique index) can now clash on
--     (tenant, branch, date, number) — which is exactly the bug this feature
--     fixes, showing up as historical data. Renumber the losers above the
--     current maximum; they are history, and the number is meaningless now.
SET @maxnum := (SELECT COALESCE(MAX(TokenNumber), 0) FROM pos_token);
UPDATE pos_token t
  JOIN (
    SELECT Id, ROW_NUMBER() OVER (
             PARTITION BY TenantId, BranchDetailId, TokenDate, TokenNumber
             ORDER BY CreatedOn, Id) AS rn
      FROM pos_token
  ) d ON d.Id = t.Id
   SET t.TokenNumber = @maxnum + d.rn,
       t.TokenLabel  = CAST(@maxnum + d.rn AS CHAR)
 WHERE d.rn > 1;

-- Anything still NULL here means PART 0's last check was non-zero and was not
-- acted on. PART 2 will fail on it, loudly, rather than silently mangling data.
SELECT COUNT(*) AS rows_that_will_block_part_2
  FROM pos_token WHERE BranchDetailId IS NULL;


-- =============================================================================
-- PART 2 — Alter pos_token
-- =============================================================================

-- 2a) Tighten the backfilled columns.
SET @sql := IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token' AND COLUMN_NAME = 'TokenLabel') = 'YES',
  'ALTER TABLE pos_token
     MODIFY COLUMN TokenLabel     VARCHAR(50) NOT NULL,
     MODIFY COLUMN TokenDate      DATE        NOT NULL,
     MODIFY COLUMN BranchDetailId VARCHAR(50) NOT NULL',
  'SELECT ''pos_token: columns already NOT NULL''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2b) Drop the old unique key. Its name is whatever MySQL auto-assigned from
--     the first column (normally `TokenNumber`), so it is looked up rather than
--     assumed — DROP INDEX has no IF EXISTS.
SET @old_idx := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token'
     AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
     AND COLUMN_NAME = 'TokenNumber' AND SEQ_IN_INDEX = 1
   LIMIT 1);
SET @sql := IF(@old_idx IS NOT NULL,
  CONCAT('ALTER TABLE pos_token DROP INDEX `', @old_idx, '`'),
  'SELECT ''pos_token: old unique key already gone''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2c) The real uniqueness rule: one number per branch per day, with no
--     nullable column in it.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token'
      AND INDEX_NAME = 'uq_postoken_daily') = 0,
  'ALTER TABLE pos_token
     ADD UNIQUE KEY uq_postoken_daily (TenantId, BranchDetailId, TokenDate, TokenNumber)',
  'SELECT ''pos_token: daily unique key already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2d) The customer display polls this every few seconds.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token'
      AND INDEX_NAME = 'idx_postoken_queue') = 0,
  'ALTER TABLE pos_token
     ADD INDEX idx_postoken_queue (TenantId, BranchDetailId, TokenDate, Status)',
  'SELECT ''pos_token: queue index already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- =============================================================================
-- PART 3 — New tables
-- =============================================================================

-- The per-day, per-branch counter behind 'daily' numbering. Taken FOR UPDATE so
-- two tills serialise on it, with the unique key above as the backstop.
CREATE TABLE IF NOT EXISTS pos_token_counter (
    TenantId        VARCHAR(50)  NOT NULL,
    BranchDetailId  VARCHAR(50)  NOT NULL,
    TokenDate       DATE         NOT NULL,
    LastNumber      INT          NOT NULL DEFAULT 0,
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (TenantId, BranchDetailId, TokenDate)
);

-- Per-branch POS preferences. A branch with no row runs on the code default,
-- so this starts empty and that is correct.
CREATE TABLE IF NOT EXISTS pos_setting (
    Id              VARCHAR(50)   NOT NULL,
    TenantId        VARCHAR(50)   NOT NULL,
    BranchDetailId  VARCHAR(50)   NOT NULL,
    SettingKey      VARCHAR(100)  NOT NULL,
    SettingValue    VARCHAR(255)  NULL,
    Active          TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE KEY uq_possetting (TenantId, BranchDetailId, SettingKey)
);

-- Seed the counter from what each branch has already issued today, so switching
-- a live branch to the new numbering does not hand out a number it used an hour
-- ago. Harmless on a quiet database — it matches nothing.
INSERT IGNORE INTO pos_token_counter (TenantId, BranchDetailId, TokenDate, LastNumber, UpdatedOn, UpdatedBy)
SELECT TenantId, BranchDetailId, TokenDate, MAX(TokenNumber), NOW(), 'upgrade-script'
  FROM pos_token
 WHERE TokenDate = CURDATE()
 GROUP BY TenantId, BranchDetailId, TokenDate;


-- =============================================================================
-- PART 4 — POS_TOKEN numbering series
-- =============================================================================
-- Only needed by branches set to 'series' numbering; branches on the default
-- 'daily' never touch it. Added for every tenant that already has a POS_BILL
-- series, which is the set of tenants whose POS masters were provisioned.
INSERT INTO transactiontypeconfig
    (Id, TenantId, StartCounterNo, Prefix, Format, TagName, Active, CreatedOn, CreatedBy, UpdatedBy)
SELECT UUID(), c.TenantId, '1', 'TOK', 'TOK-{0000}', 'POS_TOKEN', 1, NOW(), 'upgrade-script', 'upgrade-script'
  FROM transactiontypeconfig c
 WHERE c.TagName = 'POS_BILL'
   AND NOT EXISTS (
     SELECT 1 FROM transactiontypeconfig x
      WHERE x.TenantId = c.TenantId AND x.TagName = 'POS_TOKEN');


-- =============================================================================
-- PART 5 — VERIFICATION. Run these and read the output.
-- =============================================================================

-- Shape of pos_token: TokenLabel/TokenDate/BranchDetailId must all read NO.
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
--   FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token'
--  ORDER BY ORDINAL_POSITION;

-- Keys: expect uq_postoken_daily + idx_postoken_queue, and NO unique index
-- starting at TokenNumber.
-- SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
--   FROM information_schema.STATISTICS
--  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_token'
--  GROUP BY INDEX_NAME, NON_UNIQUE;

-- New tables exist:
-- SHOW TABLES LIKE 'pos\_token\_counter';
-- SHOW TABLES LIKE 'pos\_setting';

-- One POS_TOKEN series per tenant:
-- SELECT TenantId, Prefix, Format, CurrentCounterNo
--   FROM transactiontypeconfig WHERE TagName = 'POS_TOKEN';

-- Today's queue, as the Token Queue screen reads it:
-- SELECT t.TokenLabel, t.Status, t.BranchDetailId, o.OrderNo, o.Total
--   FROM pos_token t LEFT JOIN pos_order o ON o.Id = t.OrderId
--  WHERE t.TokenDate = CURDATE()
--  ORDER BY t.TokenNumber DESC;

-- Which branches have chosen a numbering mode (empty = all on the 'daily'
-- default, which is the expected state until someone changes it):
-- SELECT BranchDetailId, SettingKey, SettingValue FROM pos_setting;

-- After settling one counter sale, this should return exactly one row:
-- SELECT * FROM pos_token_counter WHERE TokenDate = CURDATE();


-- =============================================================================
-- PART 6 — ROLLBACK (for a validation database)
-- =============================================================================
-- Restores the old shape. The backfilled TokenLabel/TokenDate values and any
-- renumbering from PART 1e are NOT restored — those rows keep their new
-- numbers. Take a dump first if that matters.
--
-- ALTER TABLE pos_token DROP INDEX uq_postoken_daily;
-- ALTER TABLE pos_token DROP INDEX idx_postoken_queue;
-- ALTER TABLE pos_token MODIFY COLUMN BranchDetailId VARCHAR(50) NULL;
-- ALTER TABLE pos_token
--   DROP COLUMN TokenLabel, DROP COLUMN TokenDate,
--   DROP COLUMN CalledAt,   DROP COLUMN ServedAt;
-- ALTER TABLE pos_token ADD UNIQUE KEY (TokenNumber, BranchDetailId, TenantId);
-- DROP TABLE IF EXISTS pos_token_counter;
-- DROP TABLE IF EXISTS pos_setting;
-- DELETE FROM transactiontypeconfig WHERE TagName = 'POS_TOKEN';
