-- Add version columns for optimistic concurrency
ALTER TABLE subcontractor_quality_audit
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE subcontractor_enforcement_action
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE subcontractor_appeal
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
