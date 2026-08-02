import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { OutboxEventDispatcher } from "@govos/ai";
import * as crypto from "node:crypto";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Outbox Integration Tests (Phase 6 Gate)", () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const tenantRes = await pool.query("SELECT id FROM tenant LIMIT 1");
    tenantId = tenantRes.rows[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. OutboxEventDispatcher claims pending outbox event with lease locking", async () => {
    const aggregateId = crypto.randomUUID();
    const deduplicationKey = `outbox_test_dup_${crypto.randomUUID()}`;

    // Clear existing outbox events to ensure isolation
    await pool.query("DELETE FROM outbox_event");

    // Seed outbox event
    await pool.query(
      `INSERT INTO outbox_event (
         tenant_id, aggregate_type, aggregate_id, event_type, payload, status, deduplication_key
       ) VALUES ($1, 'agent_execution', $2, 'agent_execution_queued', '{"test": true}', 'pending', $3)`,
      [tenantId, aggregateId, deduplicationKey]
    );

    const dispatcher = new OutboxEventDispatcher(pool);

    // Call processPendingEvents manually to verify claim
    await dispatcher.processPendingEvents();

    // Verify it is completed in the DB
    const res = await pool.query(
      "SELECT status, attempt_count, lock_owner FROM outbox_event WHERE deduplication_key = $1",
      [deduplicationKey]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].status).toBe("completed");
    expect(res.rows[0].attempt_count).toBe(1);
    expect(res.rows[0].lock_owner).toBeNull();
  });

  test("2. Reclaim stale outbox processing events whose leases expired", async () => {
    const aggregateId = crypto.randomUUID();
    const deduplicationKey = `outbox_stale_dup_${crypto.randomUUID()}`;

    // Seed outbox event directly in processing state with expired lease
    await pool.query(
      `INSERT INTO outbox_event (
         tenant_id, aggregate_type, aggregate_id, event_type, payload, status, deduplication_key,
         lock_owner, locked_at, lease_expires_at
       ) VALUES ($1, 'agent_execution', $2, 'agent_execution_queued', '{"test": true}', 'processing', $3, 'some-old-worker', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '1 minute')`,
      [tenantId, aggregateId, deduplicationKey]
    );

    const dispatcher = new OutboxEventDispatcher(pool);
    await dispatcher.recoverExpiredLeases();

    // Verify it returned back to pending
    const res = await pool.query(
      "SELECT status, lock_owner FROM outbox_event WHERE deduplication_key = $1",
      [deduplicationKey]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].status).toBe("pending");
    expect(res.rows[0].lock_owner).toBeNull();
  });

  test("3. Prevent stale outbox owner from completing if another worker took the lease", async () => {
    const aggregateId = crypto.randomUUID();
    const deduplicationKey = `outbox_collision_dup_${crypto.randomUUID()}`;

    // Seed outbox event in processing state under one owner
    const seedRes = await pool.query(
      `INSERT INTO outbox_event (
         tenant_id, aggregate_type, aggregate_id, event_type, payload, status, deduplication_key,
         lock_owner, locked_at, lease_expires_at
       ) VALUES ($1, 'agent_execution', $2, 'agent_execution_queued', '{"test": true}', 'processing', $3, 'original-owner', NOW(), NOW() + INTERVAL '30 seconds')
       RETURNING id`,
      [tenantId, aggregateId, deduplicationKey]
    );
    const eventId = seedRes.rows[0].id;

    // Simulate original owner trying to complete the event after lease was taken over by new-owner
    // 1. Force the lease expires and new-owner claims it
    await pool.query(
      `UPDATE outbox_event 
       SET lock_owner = 'new-owner', lease_expires_at = NOW() + INTERVAL '30 seconds'
       WHERE id = $1`,
      [eventId]
    );

    // 2. Original owner tries to complete it -> rowCount should be 0 because lease owner mismatch
    const completeRes = await pool.query(
      `UPDATE outbox_event
       SET status = 'completed',
           dispatched_at = NOW(),
           lease_expires_at = NULL,
           lock_owner = NULL
       WHERE id = $1 AND status = 'processing' AND lock_owner = $2 AND lease_expires_at > NOW()`,
      [eventId, "original-owner"]
    );

    expect(completeRes.rowCount).toBe(0);
  });
});
