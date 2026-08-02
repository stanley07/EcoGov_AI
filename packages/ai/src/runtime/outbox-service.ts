import { Pool } from "pg";
import { logger } from "@govos/observability";
import * as crypto from "node:crypto";

export interface OutboxEvent {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
  attempt_count: number;
  deduplication_key: string;
}

export class OutboxEventDispatcher {
  private intervalId?: NodeJS.Timeout;
  private recoveryIntervalId?: NodeJS.Timeout;
  private isProcessing = false;
  private ownerId: string;

  constructor(private pool: Pool) {
    this.ownerId = `dispatcher-${crypto.randomUUID()}`;
  }

  public start(pollIntervalMs = 5000, recoveryIntervalMs = 30000): void {
    this.intervalId = setInterval(() => this.processPendingEvents(), pollIntervalMs);
    this.recoveryIntervalId = setInterval(() => this.recoverExpiredLeases(), recoveryIntervalMs);
  }

  public stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.recoveryIntervalId) clearInterval(this.recoveryIntervalId);
  }

  public async processPendingEvents(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const claimQuery = `
        UPDATE outbox_event
        SET status = 'processing',
            lock_owner = $1,
            locked_at = NOW(),
            lease_expires_at = NOW() + INTERVAL '30 seconds',
            attempt_count = attempt_count + 1
        WHERE id = (
          SELECT id 
          FROM outbox_event
          WHERE (status = 'pending' OR status = 'failed')
            AND available_at <= NOW()
            AND attempt_count < 5
            AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, tenant_id, aggregate_type, aggregate_id, event_type, payload, attempt_count, deduplication_key
      `;
      const res = await this.pool.query(claimQuery, [this.ownerId]);

      if (res.rows.length === 0) {
        this.isProcessing = false;
        return;
      }

      const event = res.rows[0] as OutboxEvent;

      const hb = setInterval(async () => {
        try {
          const updated = await this.pool.query(
            `UPDATE outbox_event
             SET lease_expires_at = NOW() + INTERVAL '30 seconds',
                 heartbeat_at = NOW()
             WHERE id = $1 AND status = 'processing' AND lock_owner = $2 AND lease_expires_at > NOW()`,
            [event.id, this.ownerId]
          );
          if (updated.rowCount === 0) {
            clearInterval(hb);
          }
        } catch {
          clearInterval(hb);
        }
      }, 10000);

      try {
        await this.dispatch(event);

        const completeRes = await this.pool.query(
          `UPDATE outbox_event
           SET status = 'completed',
               dispatched_at = NOW(),
               lease_expires_at = NULL,
               lock_owner = NULL
           WHERE id = $1 AND status = 'processing' AND lock_owner = $2 AND lease_expires_at > NOW()`,
          [event.id, this.ownerId]
        );

        if (completeRes.rowCount === 0) {
          throw new Error(`Outbox event lease was lost or expired during dispatch completion`);
        }

        logger.info({ eventId: event.id }, "Outbox event dispatched successfully");
      } catch (dispatchErr: any) {
        const delay = Math.min(300, 10 * Math.pow(2, event.attempt_count - 1));
        const status = event.attempt_count >= 5 ? "failed" : "pending";
        const rawErrCode = dispatchErr.message || "DISPATCH_FAILED";
        const errCode = rawErrCode.substring(0, 50);
        await this.pool.query(
          `UPDATE outbox_event
           SET status = $1,
               available_at = NOW() + ($2 || ' seconds')::INTERVAL,
               last_error_code = $3,
               lease_expires_at = NULL,
               lock_owner = NULL
           WHERE id = $4 AND status = 'processing' AND lock_owner = $5`,
          [status, delay.toString(), errCode, event.id, this.ownerId]
        );
        logger.error({ eventId: event.id, error: dispatchErr.message }, "Outbox event dispatch failed");
      } finally {
        clearInterval(hb);
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "Error claiming outbox events");
    } finally {
      this.isProcessing = false;
    }
  }

  public async recoverExpiredLeases(): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE outbox_event
         SET status = 'pending',
             lease_expires_at = NULL,
             lock_owner = NULL
         WHERE status = 'processing' AND lease_expires_at < NOW()`
      );
    } catch (err: any) {
      logger.error({ error: err.message }, "Error recovering expired outbox leases");
    }
  }

  private dispatchCallback?: (event: OutboxEvent) => Promise<void>;

  public setDispatchCallback(cb: (event: OutboxEvent) => Promise<void>): void {
    this.dispatchCallback = cb;
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    const taskName = `task_${event.deduplication_key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    logger.info({ eventId: event.id, taskName }, "Dispatching event");
    if (this.dispatchCallback) {
      await this.dispatchCallback(event);
    }
  }
}
