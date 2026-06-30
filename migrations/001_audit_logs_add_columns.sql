-- Migration: 001_audit_logs_add_columns
-- Adds log_level, category, and resource_id columns to audit_logs.
-- Compatible with MySQL 5.7+ and MySQL 8.x.
-- Idempotent: safe to run multiple times via information_schema guards.
-- Run this BEFORE deploying the updated application code.

DROP PROCEDURE IF EXISTS _migrate_audit_logs;

DELIMITER //
CREATE PROCEDURE _migrate_audit_logs()
BEGIN

  -- ── Add log_level ────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'log_level'
  ) THEN
    ALTER TABLE audit_logs
      ADD COLUMN log_level ENUM('DEBUG','INFO','WARN','ERROR') NOT NULL DEFAULT 'INFO'
      AFTER status;
  END IF;

  -- ── Add category ─────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'category'
  ) THEN
    ALTER TABLE audit_logs
      ADD COLUMN category VARCHAR(50) NULL
      AFTER log_level;
  END IF;

  -- ── Add resource_id ──────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'resource_id'
  ) THEN
    ALTER TABLE audit_logs
      ADD COLUMN resource_id VARCHAR(255) NULL
      AFTER category;
  END IF;

  -- ── Backfill: ensure no NULLs in the NOT NULL column ─────────────────────
  UPDATE audit_logs SET log_level = 'INFO' WHERE log_level IS NULL;

  -- ── Index: idx_audit_level ────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND INDEX_NAME   = 'idx_audit_level'
  ) THEN
    CREATE INDEX idx_audit_level ON audit_logs (log_level);
  END IF;

  -- ── Index: idx_audit_category ─────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND INDEX_NAME   = 'idx_audit_category'
  ) THEN
    CREATE INDEX idx_audit_category ON audit_logs (category);
  END IF;

  -- ── Index: idx_audit_tenant_ts ────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND INDEX_NAME   = 'idx_audit_tenant_ts'
  ) THEN
    CREATE INDEX idx_audit_tenant_ts ON audit_logs (tenant_id, timestamp DESC);
  END IF;

  -- ── Index: idx_audit_email_ts ─────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND INDEX_NAME   = 'idx_audit_email_ts'
  ) THEN
    CREATE INDEX idx_audit_email_ts ON audit_logs (user_email, timestamp DESC);
  END IF;

END//
DELIMITER ;

CALL _migrate_audit_logs();
DROP PROCEDURE IF EXISTS _migrate_audit_logs;
