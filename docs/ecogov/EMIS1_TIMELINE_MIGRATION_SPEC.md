# GovOS Core Timeline Migration Specification

This document defines the schema design, constraints, indexing, and protection mechanisms for the universal operational timeline projection table (`operational_timeline_event`). 

> [!WARNING]
> **Pre-execution Policy**: No migration file will be generated until the timeline implementation phase is authorized.

---

## 1. Aggregate Identity vs. Source Event Identity

To maintain precise tracking and replayability across different applications, the schema separates the logical subject identity from the transactional event identity:
* **Aggregate ID (`aggregate_id`)**: Represents the logical root entity of the event. For example, a Facility `F1` or a Permit `P88`.
* **Source ID (`source_id`)**: Represents the unique business ID of the source entity (e.g. registration ID).
* **Source Event ID (`source_event_id`)**: Represents the specific triggering event table primary key (e.g. transition ID).

This distinction allows multiple independent events on the same aggregate to be queries together via `aggregate_id` while maintaining explicit lineage back to their triggering records.

---

## 2. Database Schema Design

```sql
CREATE TABLE operational_timeline_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    
    -- Event Identity
    source_type VARCHAR(100) NOT NULL, -- e.g., 'facility', 'inspection', 'permit'
    source_id UUID NOT NULL, -- The unique business ID of the source entity (e.g. registration ID)
    source_event_id UUID, -- References the specific triggering event table primary key (e.g. transition ID)
    source_event_type VARCHAR(100) NOT NULL, -- e.g., 'facility.created', 'permit.issued'
    event_key VARCHAR(255) NOT NULL, -- Unique deterministic idempotency key
    source_version VARCHAR(100) NOT NULL DEFAULT '1', -- Concurrency version of source record
    projection_version INTEGER NOT NULL DEFAULT 1,
    timeline_schema_version VARCHAR(50) NOT NULL DEFAULT 'v1', -- Decouples schema presentation upgrades
    
    -- Aggregate Identity
    aggregate_type VARCHAR(100) NOT NULL, -- e.g., 'facility', 'permit'
    aggregate_id UUID NOT NULL, -- Logical grouping aggregate root ID (UUID)
    
    -- Trace Lineage
    correlation_id UUID NOT NULL, -- Core trace context grouping related timeline steps
    workflow_instance_id UUID, -- References workflow_instance(id) if event is workflow-driven
    task_execution_id UUID REFERENCES task_execution(id) ON DELETE SET NULL, -- Worker task ID
    ai_execution_id UUID, -- References ai_execution(id) if event is AI-driven
    outcome VARCHAR(255), -- Event outcomes (e.g. 'succeeded', 'failed', 'recommended')
    
    -- Actor Snapshot
    actor_type VARCHAR(50) NOT NULL, -- 'user', 'subcontractor', 'ai', 'system', 'integration', 'external'
    actor_user_id UUID REFERENCES user_account(id) ON DELETE SET NULL, -- Present if actor_type = 'user'
    actor_subcontractor_id UUID, -- Present if actor_type = 'subcontractor' (references profiles)
    actor_external_id VARCHAR(255), -- Third-party identifier
    actor_display_name_snapshot VARCHAR(255) NOT NULL, -- e.g., 'John Doe', 'Gemini AI Agent'
    actor_role_snapshot VARCHAR(100) NOT NULL, -- e.g., 'director', 'inspector', 'system_cron'
    
    -- Presentation Data
    summary TEXT NOT NULL, -- Human-readable event description
    metadata_redacted JSONB DEFAULT '{}'::jsonb, -- Redacted JSON attributes
    
    -- Chronology
    occurred_at TIMESTAMPTZ NOT NULL, -- When the event occurred at source
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When the timeline row was inserted
    projected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When the timeline worker processed it
    
    -- Constraints
    CONSTRAINT unique_tenant_event_key UNIQUE (tenant_id, event_key),
    
    CONSTRAINT chk_timeline_actor_type CHECK (
        actor_type IN ('user', 'subcontractor', 'ai', 'system', 'integration', 'external')
    ),
    
    CONSTRAINT chk_timeline_actor_refs CHECK (
        (actor_type = 'user' AND actor_user_id IS NOT NULL) OR
        (actor_type = 'subcontractor' AND actor_subcontractor_id IS NOT NULL) OR
        (actor_type IN ('ai', 'system', 'integration', 'external'))
    ),
    
    CONSTRAINT chk_timeline_aggregate_type CHECK (
        aggregate_type IN (
            'facility', 'facility_registration', 'environmental_audit', 'inspection', 
            'incident', 'permit', 'compliance_assessment', 'enforcement_notice', 
            'waste_site', 'monitoring_station', 'laboratory_result', 'report_job'
        )
    ),
    
    CONSTRAINT chk_summary_length CHECK (char_length(summary) BETWEEN 1 AND 1000),
    CONSTRAINT chk_metadata_size CHECK (octet_length(metadata_redacted::text) <= 50000) -- limit metadata payload to 50KB
);
```

---

## 3. Uniqueness & Idempotency Key Policy
To prevent duplicate projection events during retries or replays, a strict deterministic `event_key` construction policy is enforced at the service layer:

```text
event_key = concat(source_type, ":", source_event_id, ":", source_event_type, ":", projection_version)
```

If a source entity has no separate event record (e.g. simple table inserts), it must incorporate its version:
```text
event_key = concat(source_type, ":", source_id, ":", source_event_type, ":v", source_version)
```

---

## 4. Indexing Strategy
The following indexes are designed to optimize query speeds and analytical loads:
```sql
-- 1. Optimized index for aggregate-specific timeline query
CREATE INDEX idx_timeline_event_aggregate_chronology
ON operational_timeline_event(tenant_id, aggregate_type, aggregate_id, occurred_at DESC, id DESC);

-- 2. Index for filtering timeline events by source event type
CREATE INDEX idx_timeline_event_type_chronology
ON operational_timeline_event(tenant_id, source_event_type, occurred_at DESC, id DESC);

-- 3. Index for global correlation trace timelines
CREATE INDEX idx_timeline_correlation
ON operational_timeline_event(tenant_id, correlation_id, occurred_at DESC);

-- 5. Index for source entity identity lookups
CREATE INDEX idx_timeline_source_identity
ON operational_timeline_event(tenant_id, source_type, source_id);
```

---

## 5. Controlled Rebuild Trigger Protection
To balance the strict audit integrity of the append-only timeline with the need to rebuild read-model projections, the table uses a trigger that checks both a session parameter and permissions:

```sql
CREATE OR REPLACE FUNCTION protect_operational_timeline()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if session parameter is on AND user has maintenance role privileges
  IF current_setting('ecogov.timeline_maintenance', true) = 'on' AND (
      pg_has_role(current_user, 'govos_maintenance', 'member') OR
      pg_has_role(current_user, 'postgres', 'member')
  ) THEN
    RETURN OLD;
  END IF;
  
  RAISE EXCEPTION 'Timeline projection entries are append-only. Modification or deletion is strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_operational_timeline
BEFORE UPDATE OR DELETE ON operational_timeline_event
FOR EACH ROW EXECUTE FUNCTION protect_operational_timeline();
```

*Note: Database rebuild procedures (e.g. `rebuildTenantTimeline`) defined with `SECURITY DEFINER` and owned by the database schema owner are the only supported entry points for data updates or deletions.*

---

## 6. Deployment & Verification Plan

### Preflight Verification
* Ensure PostgreSQL version is 15 or higher.
* Verify that all referenced tables (`tenant`, `task_execution`, `user_account`) exist in the target schema.
* Check that there is no existing table named `operational_timeline_event`.

### Clean Migration Test Plan
1. Create a clean database instance.
2. Run migrations `000001` through the new timeline migration file.
3. Assert that the `operational_timeline_event` table and all its indexes are created successfully.

### Upgrade Migration Test Plan
1. Restore a backup of a production database containing mock facilities.
2. Apply the timeline migration script.
3. Run the backfill script to populate initial facility creation events.
4. Assert that no existing data is mutated or dropped during the upgrade.

### Rollback/Forward-Fix Policy
* **Rollback Script**:
  ```sql
  DROP TABLE IF EXISTS operational_timeline_event CASCADE;
  DROP FUNCTION IF EXISTS protect_operational_timeline() CASCADE;
  ```
* **Forward-Fix Rule**: If errors are discovered post-deployment, a forward-fixing migration (e.g. modifying column specifications or adding indices) is preferred over dropping the table.
```

---
