-- Milestone PA-2: Platform Execution Events Backfill
-- Version: 000018
-- Name: ai_execution_events_backfill

-- Preflight checks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_execution_event') THEN
    RAISE EXCEPTION 'Preflight verification failed: ai_execution_event table does not exist.';
  END IF;
END $$;

-- 1. Add evolution columns as nullable first
ALTER TABLE ai_execution_event
  ADD COLUMN IF NOT EXISTS sequence_number INTEGER,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Deterministic Window-Based Sequence Backfill (partitioned by ai_execution_id ordering by created_at, id)
WITH sequenced AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY ai_execution_id
      ORDER BY created_at, id
    ) AS calculated_sequence
  FROM ai_execution_event
  WHERE sequence_number IS NULL
)
UPDATE ai_execution_event event
SET sequence_number = sequenced.calculated_sequence
FROM sequenced
WHERE event.id = sequenced.id;

-- 3. Backfill defaults for other new fields
UPDATE ai_execution_event SET attempt_number = 1 WHERE attempt_number IS NULL;
UPDATE ai_execution_event SET actor_type = 'system' WHERE actor_type IS NULL;

-- 4. Apply NOT NULL constraints after backfill
ALTER TABLE ai_execution_event ALTER COLUMN sequence_number SET NOT NULL;
ALTER TABLE ai_execution_event ALTER COLUMN attempt_number SET NOT NULL;
ALTER TABLE ai_execution_event ALTER COLUMN actor_type SET NOT NULL;

-- 5. Add unique constraint on sequence number per execution
CREATE UNIQUE INDEX uq_ai_execution_event_seq
ON ai_execution_event (ai_execution_id, sequence_number);

-- 6. Backfill next_event_sequence to the ai_execution records
UPDATE ai_execution execution
SET next_event_sequence = COALESCE(existing.maximum_sequence, 0)
FROM (
  SELECT
    ai_execution_id,
    MAX(sequence_number) AS maximum_sequence
  FROM ai_execution_event
  GROUP BY ai_execution_id
) existing
WHERE execution.id = existing.ai_execution_id;
