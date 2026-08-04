import fs from "node:fs";
import path from "node:path";
import { describe,expect,test } from "vitest";
import { evaluateTransitionCondition,validateTransitionCondition,validateEnterpriseWorkflowModel } from "@govos/core";

const root=path.resolve(__dirname,"../../..");
const migration=fs.readFileSync(path.join(root,"packages/database/migrations/000033_wf1_remediation.sql"),"utf8");
const engine=fs.readFileSync(path.join(root,"modules/govos-core/src/workflow-engine.ts"),"utf8");
const routes=fs.readFileSync(path.join(root,"apps/api/src/routes/workflows.ts"),"utf8");
const worker=fs.readFileSync(path.join(root,"apps/worker/src/workflow-runtime.ts"),"utf8");

describe("WF-1 remediation",()=>{
  test("migration installs the canonical ten-state lifecycle",()=>{for(const state of ['created','ready','claimed','running','waiting','completed','failed','cancelled','skipped','dead_lettered'])expect(migration).toContain(`'${state}'`);expect(migration).toContain('enforce_workflow_step_execution_lifecycle');});
  test("migration removes legacy runtime values",()=>{expect(migration).toContain("SET status = 'ready' WHERE status = 'pending'");expect(migration).toContain("SET status = 'running' WHERE status = 'processing'");});
  test("version lifecycle is restricted and defaults require published versions",()=>{expect(migration).toContain('WF_INVALID_VERSION_TRANSITION');expect(migration).toContain('WF_DEFAULT_REQUIRES_PUBLISHED_VERSION');expect(routes).toContain('WF_DEFAULT_REPLACEMENT_REQUIRED');});
  test("equals evaluates without coercion",()=>{expect(evaluateTransitionCondition({operator:'equals',left:{variable:'variables.score'},right:3},{variables:{score:3}})).toBe(true);expect(evaluateTransitionCondition({operator:'equals',left:{variable:'variables.score'},right:'3'},{variables:{score:3}})).toBe(false);});
  test("all, any and not are deterministic",()=>{const context={variables:{a:true,b:false}};expect(evaluateTransitionCondition({operator:'all',conditions:[{operator:'equals',left:{variable:'variables.a'},right:true},{operator:'not',condition:{operator:'equals',left:{variable:'variables.b'},right:true}}]},context)).toBe(true);expect(evaluateTransitionCondition({operator:'any',conditions:[{operator:'equals',left:{variable:'variables.b'},right:true},{operator:'equals',left:{variable:'variables.a'},right:true}]},context)).toBe(true);});
  test("missing variables fail closed",()=>{expect(evaluateTransitionCondition({operator:'equals',left:{variable:'variables.missing'},right:null},{variables:{}})).toBe(false);});
  test("forbidden paths and operators are rejected",()=>{expect(()=>validateTransitionCondition({operator:'equals',left:{variable:'variables.__proto__.x'},right:true})).toThrow();expect(()=>validateTransitionCondition({operator:'eval',args:['true']})).toThrow();});
  test("depth, node count and size are bounded",()=>{let condition:any={operator:'equals',left:true,right:true};for(let i=0;i<9;i++)condition={operator:'not',condition};expect(()=>validateTransitionCondition(condition)).toThrow();expect(()=>validateTransitionCondition({operator:'equals',left:'x'.repeat(17000),right:'x'})).toThrow();});
  test("publication validation invokes condition validation",()=>{expect(()=>validateEnterpriseWorkflowModel({steps:[{key:'start',type:'human_review',entry:true},{key:'done',type:'domain_command',terminal:true}],transitions:[{key:'finish',from:'start',to:'done',outcome:'ok',condition:{operator:'eval'}}]})).toThrow();});
  test("all work-item surfaces enforce organization scope",()=>{for(const op of ['/v1/work-items','/:id/claim','/:id/history','"accept"','"assign"','"reassign"','"cancel"'])expect(routes).toContain(op);expect((routes.match(/m\.organization_id=w\.organization_id/g)||[]).length).toBeGreaterThanOrEqual(4);expect(engine).toContain('m.organization_id=w.organization_id');});
  test("timer and SLA worker uses bounded leased fencing",()=>{expect(worker).toContain('WF_RUNTIME_BATCH_SIZE=100');expect(worker).toContain('WF_RUNTIME_LEASE_SECONDS=60');expect(worker).toContain('fencing_token=fencing_token+1');expect(worker).toContain('FOR UPDATE SKIP LOCKED');});
  test("escalation is bounded and empty queues fail closed",()=>{expect(worker).toContain('.slice(0,10)');expect(worker).toContain('WF_QUEUE_MISCONFIGURED');expect(engine).toContain('WF_ESCALATION_TOO_DEEP');});
  test("recommendations use expected versions and terminal decisions",()=>{expect(engine).toContain('decideRecommendation');expect(engine).toMatch(/["']accepted["']\s*\|\s*["']rejected["']/);expect(engine).toContain('r.instance_version=i.version');expect(routes).toContain('/v1/workflows/recommendations/:id/accept');expect(routes).toContain('/v1/workflows/recommendations/:id/reject');});
  test("dynamic execution primitives are absent",()=>{for(const source of [engine,worker])expect(source).not.toMatch(/\beval\s*\(|new Function|child_process|dynamic import/);});
});
