import crypto from "node:crypto";
import pg from "pg";
import { MigrationRunner } from "../packages/database/dist/index.js";
import { EnterpriseWorkflowEngine } from "../modules/govos-core/dist/index.js";

const database = "govos_wf1_verification";
const admin = new pg.Pool({ connectionString: "postgres://postgres:postgres@127.0.0.1:5433/postgres" });
const connectionString = `postgres://postgres:postgres@127.0.0.1:5433/${database}`;
async function drop(){await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,[database]);await admin.query(`DROP DATABASE IF EXISTS ${database}`);}
try {
  await drop();
  await admin.query(`CREATE DATABASE ${database}`);
  let pool=new pg.Pool({connectionString});
  const runner=new MigrationRunner(new URL('../packages/database/migrations',import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
  const applied=await runner.migrate(pool);
  if(applied!==32)throw new Error(`Expected 32 migrations, applied ${applied}`);
  const tenantId=crypto.randomUUID(),userId=crypto.randomUUID(),entityId=crypto.randomUUID();
  await pool.query(`INSERT INTO tenant(id,name,slug,type,status) VALUES($1,'WF Verify','wf-verify','ministry','active')`,[tenantId]);
  await pool.query(`INSERT INTO user_account(id,tenant_id,email,password_hash,first_name,last_name,status) VALUES($1,$2,'wf@example.test','x','WF','Verifier','active')`,[userId,tenantId]);
  const engine=new EnterpriseWorkflowEngine(pool);
  const model={steps:[{key:'review',name:'Review',type:'human_review',entry:true,assignment:{type:'organization_queue'},sla:{reminderMinutes:5,breachMinutes:10}},{key:'done',name:'Done',type:'domain_command',terminal:true}],transitions:[{key:'approve',from:'review',to:'done',outcome:'approve'}]};
  const definition=await engine.createDefinition(tenantId,userId,{key:'verification',name:'Verification',model});
  await engine.validateVersion(tenantId,definition.draftVersion.id);
  await engine.publishVersion(tenantId,definition.draftVersion.id,userId,1,'publish-1');
  const started=await engine.startInstance(tenantId,userId,'start-1',{definitionKey:'verification',entityType:'verification',entityId});
  const replay=await engine.startInstance(tenantId,userId,'start-1',{definitionKey:'verification',entityType:'verification',entityId});
  if(replay.instanceId!==started.instanceId)throw new Error('Idempotent start replay failed');
  const work=await pool.query(`SELECT id,version FROM workflow_work_item WHERE tenant_id=$1 AND instance_id=$2`,[tenantId,started.instanceId]);
  const claimed=await engine.claimWorkItem(tenantId,userId,work.rows[0].id,work.rows[0].version);
  const transitioned=await engine.transition(tenantId,userId,'transition-1',{instanceId:started.instanceId,outcomeCode:'approve',expectedVersion:1,workItemId:claimed.id});
  if(transitioned.status!=='completed')throw new Error('Terminal transition failed');
  const evidence=await pool.query(`SELECT (SELECT count(*)::int FROM workflow_event WHERE tenant_id=$1) events,(SELECT count(*)::int FROM workflow_command WHERE tenant_id=$1 AND status='completed') commands,(SELECT count(*)::int FROM workflow_timer WHERE tenant_id=$1 AND status='cancelled') cancelled_timers`,[tenantId]);
  await pool.end();
  await drop();
  await admin.query(`CREATE DATABASE ${database}`);
  pool=new pg.Pool({connectionString});
  const reapplied=await runner.migrate(pool);
  const highest=await pool.query(`SELECT max(version)::int highest FROM schema_migrations`);
  await pool.end();
  console.log(JSON.stringify({initialApply:applied,lifecycle:evidence.rows[0],rollback:'database dropped',forwardReapply:reapplied,highest:highest.rows[0].highest},null,2));
} finally { await drop(); await admin.end(); }
