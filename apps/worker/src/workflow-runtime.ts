import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const WF_RUNTIME_BATCH_SIZE = 100;
export const WF_RUNTIME_LEASE_SECONDS = 60;
export const WF_RUNTIME_MAX_ATTEMPTS = 5;

const digest = (value: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class WorkflowRuntimeWorker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopping = false;
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly owner = `wf-worker-${crypto.randomUUID()}`,
  ) {}

  start(intervalMs = 1_000): void {
    if (this.timer || this.running) return;
    this.stopping = false;
    const tick = async () => {
      if (this.stopping) return;
      this.running = this.pollOnce();
      try {
        await this.running;
        this.lastSuccessAt = new Date();
        this.lastError = null;
      } catch (error) {
        this.lastError =
          error instanceof Error
            ? error.message.slice(0, 160)
            : "WF_RUNTIME_UNKNOWN";
      } finally {
        this.running = undefined;
        if (!this.stopping)
          this.timer = setTimeout(
            tick,
            this.lastError ? Math.min(intervalMs * 5, 30_000) : intervalMs,
          );
      }
    };
    this.timer = setTimeout(tick, 0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  status() {
    return {
      running: !this.stopping && Boolean(this.timer || this.running),
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
    };
  }

  async pollOnce(): Promise<{ scheduled: number; executed: number }> {
    const scheduled = await this.scheduleDue();
    const executed = await this.runDueTasks();
    return { scheduled, executed };
  }

  async scheduleDue(): Promise<number> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const due = await c.query(
        `SELECT t.*,i.organization_id FROM workflow_timer t JOIN workflow_instance i ON i.tenant_id=t.tenant_id AND i.id=t.instance_id JOIN tenant ten ON ten.id=t.tenant_id AND ten.status='active' JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' WHERE t.status='pending' AND t.due_at<=NOW() ORDER BY t.due_at,t.id LIMIT $1 FOR UPDATE OF t SKIP LOCKED`,
        [WF_RUNTIME_BATCH_SIZE],
      );
      for (const timer of due.rows) {
        const taskId = `wf.timer:${timer.tenant_id}:${timer.id}:${timer.timer_type}`;
        const task = await c.query(
          `INSERT INTO task_execution(tenant_id,task_id,task_type,payload_hash,status,available_at,attempt_count,max_attempts,encrypted_payload) VALUES($1,$2,'govos.workflow.timer',$3,'pending',NOW(),0,$4,$5) ON CONFLICT(tenant_id,task_id) DO UPDATE SET available_at=LEAST(task_execution.available_at,EXCLUDED.available_at) RETURNING id`,
          [
            timer.tenant_id,
            taskId,
            digest({ timerId: timer.id, type: timer.timer_type }),
            WF_RUNTIME_MAX_ATTEMPTS,
            JSON.stringify({ schemaVersion: "wf1", timerId: timer.id }),
          ],
        );
        await c.query(
          `UPDATE workflow_timer SET status='leased',task_execution_id=$1,lease_owner=NULL,lease_expires_at=NULL WHERE tenant_id=$2 AND id=$3 AND status='pending'`,
          [task.rows[0].id, timer.tenant_id, timer.id],
        );
      }
      await c.query("COMMIT");
      return due.rowCount ?? 0;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  async runDueTasks(): Promise<number> {
    const tasks = await this.pool.query(
      `UPDATE task_execution SET status='processing',lease_owner=$1,lease_expires_at=NOW()+($2||' seconds')::interval,last_heartbeat_at=NOW(),attempt_count=attempt_count+1,fencing_token=fencing_token+1,updated_at=NOW() WHERE id IN (SELECT id FROM task_execution WHERE task_type='govos.workflow.timer' AND available_at<=NOW() AND (status IN ('pending','retryable_failed') OR (status='processing' AND lease_expires_at<NOW())) ORDER BY available_at,id LIMIT $3 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [this.owner, String(WF_RUNTIME_LEASE_SECONDS), WF_RUNTIME_BATCH_SIZE],
    );
    const ordered = [...tasks.rows].sort((left, right) => {
      const rank = (task: any) =>
        String(task.task_id).endsWith(":sla_reminder") ? 0 : 1;
      return (
        rank(left) - rank(right) || String(left.id).localeCompare(right.id)
      );
    });
    for (const task of ordered) await this.executeTask(task);
    return tasks.rowCount ?? 0;
  }

  private async executeTask(task: any) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const locked = await c.query(
        `SELECT * FROM task_execution WHERE id=$1 AND status='processing' AND lease_owner=$2 AND fencing_token=$3 AND lease_expires_at>NOW() FOR UPDATE`,
        [task.id, this.owner, task.fencing_token],
      );
      if (!locked.rowCount) throw new Error("WF_STALE_FENCE");
      const timerId = task.encrypted_payload?.timerId;
      const timer = await c.query(
        `SELECT t.*,i.organization_id,i.status instance_status,e.status execution_status FROM workflow_timer t JOIN workflow_instance i ON i.tenant_id=t.tenant_id AND i.id=t.instance_id LEFT JOIN workflow_step_execution e ON e.tenant_id=t.tenant_id AND e.id=t.step_execution_id WHERE t.id=$1 AND t.tenant_id=$2 FOR UPDATE OF t`,
        [timerId, task.tenant_id],
      );
      if (!timer.rowCount) throw new Error("WF_TIMER_MISSING");
      const row = timer.rows[0];
      if (
        ["completed", "cancelled", "failed"].includes(row.instance_status) ||
        ["completed", "cancelled", "skipped", "dead_lettered"].includes(
          row.execution_status,
        )
      ) {
        await c.query(
          `UPDATE workflow_timer SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1`,
          [row.id],
        );
      } else if (row.timer_type === "sla_reminder")
        await this.processReminder(c, row);
      else if (row.timer_type === "sla_breach")
        await this.processBreach(c, row);
      else throw new Error("WF_TIMER_POLICY_INVALID");
      const completed = await c.query(
        `UPDATE task_execution SET status='completed',completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3`,
        [task.id, this.owner, task.fencing_token],
      );
      if (!completed.rowCount) throw new Error("WF_STALE_FENCE");
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "WF_STALE_FENCE") return;
      const terminal =
        task.attempt_count >= task.max_attempts ||
        /MISSING|INVALID|MISCONFIGURED/.test(message);
      await this.pool.query(
        `UPDATE task_execution SET status=$1,lease_owner=NULL,lease_expires_at=NULL,available_at=NOW()+(LEAST(300,10*POWER(2,GREATEST(attempt_count-1,0)))||' seconds')::interval,failure_code=$2,updated_at=NOW() WHERE id=$3 AND lease_owner=$4 AND fencing_token=$5`,
        [
          terminal ? "permanently_failed" : "retryable_failed",
          message.slice(0, 80),
          task.id,
          this.owner,
          task.fencing_token,
        ],
      );
      await this.pool.query(
        `UPDATE workflow_timer SET status=$1,failure_code=$2 WHERE task_execution_id=$3 AND status='leased'`,
        [terminal ? "failed" : "pending", message.slice(0, 80), task.id],
      );
    } finally {
      c.release();
    }
  }

  private async processReminder(c: PoolClient, timer: any) {
    const clock = await c.query(
      `UPDATE workflow_sla_clock SET reminder_sent_at=COALESCE(reminder_sent_at,NOW()),version=version+1 WHERE tenant_id=$1 AND step_execution_id=$2 AND state='running' RETURNING *`,
      [timer.tenant_id, timer.step_execution_id],
    );
    if (!clock.rowCount) throw new Error("WF_SLA_CLOCK_MISSING");
    await this.assertRecipients(
      c,
      timer.tenant_id,
      timer.organization_id,
      clock.rows[0].policy_snapshot,
    );
    await this.enqueueNotification(
      c,
      timer.tenant_id,
      clock.rows[0].id,
      `wf-sla-reminder:${timer.tenant_id}:${clock.rows[0].id}`,
      "workflow.sla.reminder",
      {
        instanceId: timer.instance_id,
        organizationId: timer.organization_id,
        slaClockId: clock.rows[0].id,
      },
    );
    await c.query(
      `UPDATE workflow_timer SET status='fired',fired_at=NOW(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1`,
      [timer.id],
    );
  }

  private async processBreach(c: PoolClient, timer: any) {
    const clock = await c.query(
      `UPDATE workflow_sla_clock SET state='breached',breached_at=COALESCE(breached_at,NOW()),version=version+1 WHERE tenant_id=$1 AND step_execution_id=$2 AND state='running' RETURNING *`,
      [timer.tenant_id, timer.step_execution_id],
    );
    if (!clock.rowCount) throw new Error("WF_SLA_CLOCK_MISSING");
    const policy = clock.rows[0].policy_snapshot ?? {};
    await this.assertRecipients(
      c,
      timer.tenant_id,
      timer.organization_id,
      policy,
    );
    const chain = Array.isArray(policy.escalations)
      ? policy.escalations.slice(0, 10)
      : [];
    for (let index = 0; index < chain.length; index++) {
      const action = chain[index];
      if (!["notify", "reassign"].includes(action.type))
        throw new Error("WF_ESCALATION_POLICY_INVALID");
      const identity = `${clock.rows[0].id}:escalation:${index + 1}:${action.type}`;
      const inserted = await c.query(
        `INSERT INTO workflow_escalation_action(tenant_id,sla_clock_id,level,action_type,idempotency_key,status) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`,
        [timer.tenant_id, clock.rows[0].id, index + 1, action.type, identity],
      );
      if (inserted.rows[0].status === "completed") continue;
      let outboxId: string | null = null;
      if (action.type === "notify") {
        outboxId = await this.enqueueNotification(
          c,
          timer.tenant_id,
          inserted.rows[0].id,
          `wf-escalation:${timer.tenant_id}:${identity}`,
          "workflow.sla.escalated",
          {
            instanceId: timer.instance_id,
            organizationId: timer.organization_id,
            slaClockId: clock.rows[0].id,
            level: index + 1,
            roleId: action.roleId ?? null,
            userId: action.userId ?? null,
          },
        );
      } else {
        const work = await c.query(
          `SELECT w.* FROM workflow_work_item w WHERE w.tenant_id=$1 AND w.step_execution_id=$2 AND w.status IN ('open','claimed','in_progress') FOR UPDATE`,
          [timer.tenant_id, timer.step_execution_id],
        );
        if (!work.rowCount) throw new Error("WF_WORK_ITEM_MISSING");
        const target = await c.query(
          `SELECT m.user_id FROM membership m JOIN user_account u ON u.tenant_id=m.tenant_id AND u.id=m.user_id AND u.status='active' JOIN organization o ON o.tenant_id=m.tenant_id AND o.id=m.organization_id AND o.status='active' WHERE m.tenant_id=$1 AND m.organization_id=$2 AND m.status='active' AND ($3::uuid IS NULL OR m.role_id=$3) AND ($4::uuid IS NULL OR m.user_id=$4) ORDER BY m.user_id LIMIT 1`,
          [
            timer.tenant_id,
            timer.organization_id,
            action.roleId ?? null,
            action.userId ?? null,
          ],
        );
        if (!target.rowCount) throw new Error("WF_QUEUE_MISCONFIGURED");
        await c.query(
          `UPDATE workflow_work_item SET status='open',assignee_user_id=$1,claimed_by=NULL,claimed_at=NULL,version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3`,
          [target.rows[0].user_id, timer.tenant_id, work.rows[0].id],
        );
        await c.query(
          `INSERT INTO workflow_work_item_history(tenant_id,work_item_id,action,actor_id,from_user_id,to_user_id,reason) VALUES($1,$2,'reassign',NULL,$3,$4,$5)`,
          [
            timer.tenant_id,
            work.rows[0].id,
            work.rows[0].assignee_user_id,
            target.rows[0].user_id,
            `SLA escalation level ${index + 1}`,
          ],
        );
      }
      await c.query(
        `UPDATE workflow_escalation_action SET status='completed',outbox_event_id=$1,completed_at=NOW() WHERE tenant_id=$2 AND id=$3 AND status='pending'`,
        [outboxId, timer.tenant_id, inserted.rows[0].id],
      );
    }
    await c.query(
      `UPDATE workflow_timer SET status='fired',fired_at=NOW(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1`,
      [timer.id],
    );
  }

  private async enqueueNotification(
    c: PoolClient,
    tenantId: string,
    aggregateId: string,
    key: string,
    eventType: string,
    payload: unknown,
  ): Promise<string> {
    const event = await c.query(
      `INSERT INTO outbox_event(tenant_id,aggregate_type,aggregate_id,event_type,payload,deduplication_key) VALUES($1,'workflow',$2,$3,$4,$5) ON CONFLICT(deduplication_key) DO UPDATE SET deduplication_key=EXCLUDED.deduplication_key RETURNING id`,
      [tenantId, aggregateId, eventType, JSON.stringify(payload), key],
    );
    return event.rows[0].id;
  }

  private async assertRecipients(
    c: PoolClient,
    tenantId: string,
    organizationId: string,
    policy: any,
  ) {
    const roleIds = (policy.escalations ?? [])
      .map((x: any) => x.roleId)
      .filter(Boolean);
    const users = await c.query(
      `SELECT 1 FROM membership m JOIN user_account u ON u.tenant_id=m.tenant_id AND u.id=m.user_id AND u.status='active' JOIN organization o ON o.tenant_id=m.tenant_id AND o.id=m.organization_id AND o.status='active' WHERE m.tenant_id=$1 AND m.organization_id=$2 AND m.status='active' AND (cardinality($3::uuid[])=0 OR m.role_id=ANY($3::uuid[])) LIMIT 1`,
      [tenantId, organizationId, roleIds],
    );
    if (!users.rowCount) throw new Error("WF_QUEUE_MISCONFIGURED");
  }
}
