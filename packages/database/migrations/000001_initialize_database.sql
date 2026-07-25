-- Foundational Database Migration
-- Version: 000001
-- Name: initialize_database

CREATE TABLE system_metadata (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_metadata (key, value)
VALUES ('db_version', '1.0.0');
