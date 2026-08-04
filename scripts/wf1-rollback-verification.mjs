import crypto from "node:crypto";
import pg from "pg";
import { MigrationRunner } from "../packages/database/dist/index.js";
import { EnterpriseWorkflowEngine } from "../modules/govos-core/dist/index.js";
import { WorkflowRuntimeWorker } from "../apps/worker/dist/workflow-runtime.js";

const database = "govos_wf1_verification";
const admin = new pg.Pool({
  connectionString: "postgres://postgres:postgres@127.0.0.1:5433/postgres",
});
const connectionString = `postgres://postgres:postgres@127.0.0.1:5433/${database}`;
async function drop() {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [database],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
}
try {
  await drop();
  await admin.query(`CREATE DATABASE ${database}`);
  let pool = new pg.Pool({ connectionString });
  pool.on("error", () => {});
  const runner = new MigrationRunner(
    new URL(
      "../packages/database/migrations",
      import.meta.url,
    ).pathname.replace(/^\/(.:)/, "$1"),
  );
  const applied = await runner.migrate(pool);
  if (applied !== 33)
    throw new Error(`Expected 33 migrations, applied ${applied}`);
  const tenantId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    entityId = crypto.randomUUID(),
    organizationId = crypto.randomUUID(),
    roleId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO tenant(id,name,slug,type,status) VALUES($1,'WF Verify','wf-verify','ministry','active')`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO organization(id,tenant_id,name,status) VALUES($1,$2,'WF Verification','active')`,
    [organizationId, tenantId],
  );
  await pool.query(
    `INSERT INTO user_account(id,tenant_id,email,password_hash,first_name,last_name,status) VALUES($1,$2,'wf@example.test','x','WF','Verifier','active')`,
    [userId, tenantId],
  );
  await pool.query(
    `INSERT INTO role(id,tenant_id,name,is_system) VALUES($1,$2,'WF Verifier',FALSE)`,
    [roleId, tenantId],
  );
  await pool.query(
    `INSERT INTO membership(tenant_id,user_id,organization_id,role_id,status) VALUES($1,$2,$3,$4,'active')`,
    [tenantId, userId, organizationId, roleId],
  );
  await pool.query(
    `INSERT INTO permission(tenant_id,name,description) SELECT $1,name,'WF verification permission' FROM unnest($2::text[]) name ON CONFLICT(tenant_id,name) DO NOTHING`,
    [
      tenantId,
      [
        "workflow:instance:start",
        "workflow:instance:read",
        "workflow:instance:cancel",
        "workflow:instance:suspend",
        "workflow:instance:resume",
        "workflow:instance:repair",
        "workflow:work-item:claim",
        "workflow:work-item:complete",
      ],
    ],
  );
  await pool.query(
    `INSERT INTO role_permission(role_id,permission_id) SELECT $1,id FROM permission WHERE tenant_id=$2 AND name LIKE 'workflow:%' ON CONFLICT DO NOTHING`,
    [roleId, tenantId],
  );
  const engine = new EnterpriseWorkflowEngine(pool);
  const model = {
    steps: [
      {
        key: "review",
        name: "Review",
        type: "human_review",
        entry: true,
        assignment: { type: "organization_queue" },
        sla: {
          reminderMinutes: 5,
          breachMinutes: 10,
          escalations: [
            { afterMinutes: 10, type: "notify", roleId },
            { afterMinutes: 10, type: "reassign", roleId },
          ],
        },
      },
      { key: "done", name: "Done", type: "domain_command", terminal: true },
    ],
    transitions: [
      { key: "approve", from: "review", to: "done", outcome: "approve" },
    ],
  };
  const definition = await engine.createDefinition(tenantId, userId, {
    key: "verification",
    name: "Verification",
    model,
  });
  await pool.query(
    `INSERT INTO workflow_definition_permission(tenant_id,definition_id,command_type,permission_name) SELECT $1,$2,c.command_type,p.name FROM (VALUES ('start'),('read'),('cancel'),('suspend'),('resume'),('repair')) c(command_type) CROSS JOIN LATERAL (SELECT name FROM permission WHERE tenant_id=$1 AND name='workflow:instance:'||c.command_type LIMIT 1) p`,
    [tenantId, definition.id],
  );
  await engine.validateVersion(tenantId, definition.draftVersion.id);
  await engine.publishVersion(
    tenantId,
    definition.draftVersion.id,
    userId,
    1,
    "publish-1",
  );
  const startPreflight = await pool.query(
    `SELECT d.status definition_status,v.status version_status,v.is_default,dp.command_type,p.name,m.status membership_status,o.status organization_status FROM workflow_definition d JOIN workflow_version v ON v.tenant_id=d.tenant_id AND v.definition_id=d.id LEFT JOIN workflow_definition_permission dp ON dp.tenant_id=d.tenant_id AND dp.definition_id=d.id AND dp.command_type='start' LEFT JOIN permission p ON p.tenant_id=dp.tenant_id AND p.name=dp.permission_name LEFT JOIN role_permission rp ON rp.permission_id=p.id LEFT JOIN membership m ON m.role_id=rp.role_id AND m.user_id=$3 AND m.organization_id=$4 LEFT JOIN organization o ON o.id=m.organization_id WHERE d.tenant_id=$1 AND d.id=$2`,
    [tenantId, definition.id, userId, organizationId],
  );
  if (
    !startPreflight.rows.some(
      (x) =>
        x.definition_status === "active" &&
        x.version_status === "published" &&
        x.is_default &&
        x.command_type === "start" &&
        x.membership_status === "active" &&
        x.organization_status === "active",
    )
  )
    throw new Error(
      `Start authorization preflight failed: ${JSON.stringify(startPreflight.rows)}`,
    );
  const started = await engine.startInstance(tenantId, userId, "start-1", {
    definitionKey: "verification",
    entityType: "verification",
    entityId,
    organizationId,
  });
  const replay = await engine.startInstance(tenantId, userId, "start-1", {
    definitionKey: "verification",
    entityType: "verification",
    entityId,
    organizationId,
  });
  if (replay.instanceId !== started.instanceId)
    throw new Error("Idempotent start replay failed");
  let organizationIsolation = "failed";
  try {
    await engine.transition(tenantId, userId, "foreign-org-transition", {
      instanceId: started.instanceId,
      outcomeCode: "approve",
      expectedVersion: 1,
      organizationId: crypto.randomUUID(),
    });
  } catch (error) {
    if (error?.code === "WF_NOT_FOUND") organizationIsolation = "passed";
    else throw error;
  }
  if (organizationIsolation !== "passed")
    throw new Error("Cross-organization transition unexpectedly succeeded");
  await pool.query(
    `UPDATE workflow_timer SET due_at=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND instance_id=$2`,
    [tenantId, started.instanceId],
  );
  const runtime = new WorkflowRuntimeWorker(pool, "wf-verification");
  const workerResult = await runtime.pollOnce();
  const workerEvidence = await pool.query(
    `SELECT (SELECT count(*)::int FROM workflow_timer WHERE tenant_id=$1 AND instance_id=$2 AND status='fired') fired_timers,(SELECT count(*)::int FROM workflow_escalation_action WHERE tenant_id=$1 AND status='completed') completed_escalations,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND aggregate_type='workflow') workflow_outbox`,
    [tenantId, started.instanceId],
  );
  if (
    workerResult.executed !== 2 ||
    workerEvidence.rows[0].fired_timers !== 2 ||
    workerEvidence.rows[0].completed_escalations !== 2 ||
    workerEvidence.rows[0].workflow_outbox !== 2
  )
    throw new Error(
      `Worker verification failed: ${JSON.stringify({ workerResult, evidence: workerEvidence.rows[0] })}`,
    );
  const work = await pool.query(
    `SELECT id,version FROM workflow_work_item WHERE tenant_id=$1 AND instance_id=$2`,
    [tenantId, started.instanceId],
  );
  const claimed = await engine.claimWorkItem(
    tenantId,
    userId,
    work.rows[0].id,
    work.rows[0].version,
  );
  const transitioned = await engine.transition(
    tenantId,
    userId,
    "transition-1",
    {
      instanceId: started.instanceId,
      outcomeCode: "approve",
      expectedVersion: 1,
      workItemId: claimed.id,
      organizationId,
    },
  );
  if (transitioned.status !== "completed")
    throw new Error("Terminal transition failed");
  const aiInstance = await engine.startInstance(tenantId, userId, "start-ai", {
    definitionKey: "verification",
    entityType: "verification",
    entityId: crypto.randomUUID(),
    organizationId,
  });
  const aiWork = (
    await pool.query(
      `SELECT id,version FROM workflow_work_item WHERE tenant_id=$1 AND instance_id=$2`,
      [tenantId, aiInstance.instanceId],
    )
  ).rows[0];
  const aiClaim = await engine.claimWorkItem(
    tenantId,
    userId,
    aiWork.id,
    aiWork.version,
  );
  const recommendation = await engine.createRecommendation(tenantId, {
    instanceId: aiInstance.instanceId,
    type: "transition",
    recommendation: { outcomeCode: "approve", workItemId: aiClaim.id },
    provider: "deterministic",
    model: "verification",
  });
  const decisions = await Promise.allSettled([
    engine.decideRecommendation(
      tenantId,
      organizationId,
      userId,
      recommendation.id,
      1,
      "accepted",
      "ai-accept-1",
    ),
    engine.decideRecommendation(
      tenantId,
      organizationId,
      userId,
      recommendation.id,
      1,
      "accepted",
      "ai-accept-2",
    ),
  ]);
  if (decisions.filter((x) => x.status === "fulfilled").length !== 1)
    throw new Error(
      `AI concurrency winner mismatch: ${JSON.stringify(decisions)}`,
    );
  const aiState = (
    await pool.query(
      `SELECT r.status recommendation_status,i.status instance_status FROM workflow_ai_recommendation r JOIN workflow_instance i ON i.tenant_id=r.tenant_id AND i.id=r.instance_id WHERE r.tenant_id=$1 AND r.id=$2`,
      [tenantId, recommendation.id],
    )
  ).rows[0];
  if (
    aiState.recommendation_status !== "accepted" ||
    aiState.instance_status !== "completed"
  )
    throw new Error(`AI lifecycle mismatch: ${JSON.stringify(aiState)}`);
  const evidence = await pool.query(
    `SELECT (SELECT count(*)::int FROM workflow_event WHERE tenant_id=$1) events,(SELECT count(*)::int FROM workflow_command WHERE tenant_id=$1 AND status='completed') commands,(SELECT count(*)::int FROM workflow_timer WHERE tenant_id=$1 AND status='cancelled') cancelled_timers`,
    [tenantId],
  );
  await pool.end();
  await drop();
  await admin.query(`CREATE DATABASE ${database}`);
  pool = new pg.Pool({ connectionString });
  pool.on("error", () => {});
  const reapplied = await runner.migrate(pool);
  const highest = await pool.query(
    `SELECT max(version)::int highest FROM schema_migrations`,
  );
  await pool.end();
  console.log(
    JSON.stringify(
      {
        initialApply: applied,
        lifecycle: evidence.rows[0],
        worker: workerEvidence.rows[0],
        organizationIsolation,
        aiConcurrency: { winnerCount: 1, state: aiState },
        rollback: "database dropped",
        forwardReapply: reapplied,
        highest: highest.rows[0].highest,
      },
      null,
      2,
    ),
  );
} finally {
  await drop();
  await admin.end();
}
