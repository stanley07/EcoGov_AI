import { Pool } from "pg";
import { randomUUID } from "crypto";
import { sendDelivery } from "./providers/registry.js";

type ClaimedTask = {
  id: string;
  tenant_id: string;
  fencing_token: string;
  task_id: string;
  attempt_count: number;
  max_attempts: number;
  delivery_id: string;
};

export class NotificationRuntimeWorker {
  private static running = false;
  private static timer: NodeJS.Timeout | null = null;
  private static active: Promise<void> | null = null;
  private static readonly owner = `notification-${randomUUID()}`;

  static start(pool: Pool, pollIntervalMs = 5000): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try {
        this.active = this.pollAndProcess(pool);
        await this.active;
      } catch (error) {
        console.error(
          "Notification worker poll failed",
          error instanceof Error ? error.message : "unknown",
        );
      } finally {
        this.active = null;
      }
      if (this.running) this.timer = setTimeout(loop, pollIntervalMs);
    };
    this.timer = setTimeout(loop, 0);
  }

  static async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.active) await this.active;
  }

  static async pollAndProcess(pool: Pool): Promise<void> {
    const claimed = await pool.query<ClaimedTask>(
      `
      WITH fair AS (
        SELECT te.id
        FROM task_execution te
        WHERE te.task_type='govos.notification.delivery.v1' AND te.available_at<=NOW()
          AND (te.status IN ('pending','retryable_failed') OR (te.status='processing' AND te.lease_expires_at<NOW()))
        ORDER BY te.tenant_id,te.available_at,te.id
        LIMIT 10 FOR UPDATE SKIP LOCKED
      )
      UPDATE task_execution te SET status='processing',lease_owner=$1,
        lease_expires_at=NOW()+INTERVAL '60 seconds',last_heartbeat_at=NOW(),
        attempt_count=te.attempt_count+1,fencing_token=te.fencing_token+1,updated_at=NOW()
      FROM fair,notification_delivery d
      WHERE te.id=fair.id AND d.tenant_id=te.tenant_id AND d.task_execution_id=te.id
      RETURNING te.id,te.tenant_id,te.fencing_token,te.task_id,te.attempt_count,te.max_attempts,d.id delivery_id
    `,
      [this.owner],
    );
    for (const task of claimed.rows) await this.process(pool, task);
  }

  private static async process(pool: Pool, task: ClaimedTask): Promise<void> {
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      heartbeat = setInterval(() => {
        void pool.query(
          `UPDATE task_execution SET lease_expires_at=NOW()+INTERVAL '60 seconds',last_heartbeat_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='processing' AND lease_owner=$3 AND fencing_token=$4 AND lease_expires_at>NOW()`,
          [task.tenant_id, task.id, this.owner, task.fencing_token],
        );
      }, 20000);
      const result = await sendDelivery(pool, task.delivery_id, {
        tenantId: task.tenant_id,
        taskId: task.id,
        owner: this.owner,
        fencingToken: task.fencing_token,
      });
      if (heartbeat) clearInterval(heartbeat);
      if (result.status === "permanent_failure")
        await pool.query(
          `UPDATE notification_delivery SET state='permanent_failed',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND task_execution_id=$3 AND state NOT IN ('delivered','permanent_failed','dead_lettered','cancelled','expired')`,
          [task.tenant_id, task.delivery_id, task.id],
        );
      if (result.status === "ambiguous")
        await pool.query(
          `UPDATE notification_delivery SET state='dead_lettered',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND task_execution_id=$3 AND state NOT IN ('delivered','permanent_failed','dead_lettered','cancelled','expired')`,
          [task.tenant_id, task.delivery_id, task.id],
        );
      const terminal =
        result.status === "success" ||
        result.status === "permanent_failure" ||
        result.status === "ambiguous";
      const retryable = !terminal && task.attempt_count < task.max_attempts;
      const jitterSeconds = Math.floor(
        Math.random() *
          Math.min(900, 15 * Math.pow(2, Math.max(0, task.attempt_count - 1))),
      );
      const update = await pool.query(
        `UPDATE task_execution SET status=$1,lease_owner=NULL,lease_expires_at=NULL,completed_at=CASE WHEN $1 IN ('completed','permanently_failed') THEN NOW() ELSE completed_at END,available_at=CASE WHEN $1='retryable_failed' THEN NOW()+($5||' seconds')::interval ELSE available_at END,failure_code=$2,updated_at=NOW() WHERE tenant_id=$3 AND id=$4 AND status='processing' AND lease_owner=$6 AND fencing_token=$7 AND lease_expires_at>NOW()`,
        [
          retryable
            ? "retryable_failed"
            : result.status === "success"
              ? "completed"
              : "permanently_failed",
          result.errorCode || null,
          task.tenant_id,
          task.id,
          jitterSeconds,
          this.owner,
          task.fencing_token,
        ],
      );
      if (!update.rowCount) throw new Error("notification lease lost");
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      await pool.query(
        `UPDATE task_execution SET status=CASE WHEN attempt_count<max_attempts THEN 'retryable_failed' ELSE 'permanently_failed' END,lease_owner=NULL,lease_expires_at=NULL,available_at=NOW()+INTERVAL '30 seconds',failure_code='NOTIFICATION_EXECUTION_FAILED',updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND lease_owner=$3 AND fencing_token=$4`,
        [task.tenant_id, task.id, this.owner, task.fencing_token],
      );
    }
  }
}
