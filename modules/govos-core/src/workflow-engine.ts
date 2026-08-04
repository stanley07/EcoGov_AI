import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { validateWorkflowGraph } from "./workflow.js";

export const WORKFLOW_PERMISSIONS = [
  "workflow:definition:read",
  "workflow:definition:create",
  "workflow:definition:update",
  "workflow:definition:validate",
  "workflow:definition:publish",
  "workflow:instance:read",
  "workflow:instance:start",
  "workflow:instance:suspend",
  "workflow:instance:resume",
  "workflow:instance:cancel",
  "workflow:instance:repair",
  "workflow:work-item:read",
  "workflow:work-item:claim",
  "workflow:work-item:assign",
  "workflow:work-item:complete",
  "workflow:policy:read",
  "workflow:policy:write",
  "workflow:policy:publish",
  "workflow:audit:read",
  "workflow:operations:read",
] as const;

export type WorkflowModel = {
  steps: Array<{
    key: string;
    name?: string;
    type: string;
    entry?: boolean;
    terminal?: boolean;
    configuration?: Record<string, unknown>;
    requiredPermission?: string;
    assignment?: {
      type: "direct_user" | "role_queue" | "organization_queue";
      userId?: string;
      roleId?: string;
      organizationId?: string;
    };
    sla?: {
      reminderMinutes?: number;
      breachMinutes: number;
      escalations?: Array<{
        afterMinutes: number;
        type: "notify" | "reassign";
        roleId?: string;
        userId?: string;
      }>;
    };
  }>;
  transitions: Array<{
    key: string;
    from: string;
    to: string;
    outcome: string;
    requiredPermission?: string;
    condition?: unknown;
  }>;
};

export class WorkflowError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizedKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const CONDITION_MAX_BYTES = 16 * 1024,
  CONDITION_MAX_DEPTH = 8,
  CONDITION_MAX_NODES = 128;
const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);
const pathAllowed = (path: string) => {
  const parts = path.split(".");
  if (
    parts.some(
      (p) =>
        !p || forbiddenSegments.has(p) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(p),
    )
  )
    return false;
  if (
    parts[0] === "variables" ||
    (parts[0] === "step" && parts[1] === "output")
  )
    return parts.length > 1;
  return [
    "instance.entityType",
    "instance.organizationId",
    "instance.status",
  ].includes(path);
};
type ConditionNode = {
  operator?: string;
  left?: unknown;
  right?: unknown;
  conditions?: unknown[];
  condition?: unknown;
  path?: string;
  value?: unknown;
};
export function validateTransitionCondition(condition: unknown) {
  const serialized = JSON.stringify(condition);
  if (
    !serialized ||
    Buffer.byteLength(serialized, "utf8") > CONDITION_MAX_BYTES
  )
    throw new WorkflowError(
      "WF_CONDITION_TOO_LARGE",
      422,
      "Condition exceeds approved size",
    );
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > CONDITION_MAX_NODES || depth > CONDITION_MAX_DEPTH)
      throw new WorkflowError(
        "WF_CONDITION_TOO_COMPLEX",
        422,
        "Condition exceeds approved bounds",
      );
    if (value === null || ["string", "boolean"].includes(typeof value)) return;
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new WorkflowError(
          "WF_CONDITION_TYPE",
          422,
          "Condition number must be finite",
        );
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 50)
        throw new WorkflowError(
          "WF_CONDITION_TOO_COMPLEX",
          422,
          "Condition list is too large",
        );
      value.forEach((v) => visit(v, depth + 1));
      return;
    }
    if (typeof value !== "object")
      throw new WorkflowError(
        "WF_CONDITION_TYPE",
        422,
        "Condition contains an unsupported value",
      );
    const node = value as ConditionNode;
    const op = node.operator;
    if (
      !op ||
      ![
        "literal",
        "var",
        "exists",
        "not",
        "all",
        "any",
        "eq",
        "neq",
        "lt",
        "lte",
        "gt",
        "gte",
        "in",
      ].includes(op)
    )
      throw new WorkflowError(
        "WF_CONDITION_OPERATOR",
        422,
        "Condition operator is not approved",
      );
    const allowedKeys: Record<string, string[]> = {
      literal: ["operator", "value"],
      var: ["operator", "path"],
      exists: ["operator", "path"],
      not: ["operator", "condition"],
      all: ["operator", "conditions"],
      any: ["operator", "conditions"],
      eq: ["operator", "left", "right"],
      neq: ["operator", "left", "right"],
      lt: ["operator", "left", "right"],
      lte: ["operator", "left", "right"],
      gt: ["operator", "left", "right"],
      gte: ["operator", "left", "right"],
      in: ["operator", "left", "right"],
    };
    if (Object.keys(node).some((key) => !allowedKeys[op]!.includes(key)))
      throw new WorkflowError(
        "WF_CONDITION_SHAPE",
        422,
        "Condition node contains unapproved fields",
      );
    if (op === "literal") {
      if (!Object.prototype.hasOwnProperty.call(node, "value"))
        throw new WorkflowError(
          "WF_CONDITION_SHAPE",
          422,
          "Literal value is required",
        );
      if (Array.isArray(node.value)) {
        if (node.value.length > 50)
          throw new WorkflowError(
            "WF_CONDITION_TOO_COMPLEX",
            422,
            "Condition list is too large",
          );
        const types = new Set(
          node.value.map((item) => (item === null ? "null" : typeof item)),
        );
        if (
          node.value.some(
            (item) =>
              item !== null &&
              !["string", "number", "boolean"].includes(typeof item),
          ) ||
          types.size > 1
        )
          throw new WorkflowError(
            "WF_CONDITION_TYPE",
            422,
            "Condition lists must contain compatible scalar values",
          );
      } else if (
        node.value !== null &&
        !["string", "number", "boolean"].includes(typeof node.value)
      )
        throw new WorkflowError(
          "WF_CONDITION_TYPE",
          422,
          "Literal must be an approved scalar or bounded scalar list",
        );
      visit(node.value, depth + 1);
      return;
    }
    if (op === "var" || op === "exists") {
      if (typeof node.path !== "string" || !pathAllowed(node.path))
        throw new WorkflowError(
          "WF_CONDITION_PATH",
          422,
          "Condition variable path is not approved",
        );
      return;
    }
    const children =
      op === "not"
        ? [node.condition]
        : op === "all" || op === "any"
          ? node.conditions
          : [node.left, node.right];
    if (
      !Array.isArray(children) ||
      children.some((v) => v === undefined) ||
      (op === "all" || op === "any"
        ? children.length === 0
        : children.length !== (op === "not" ? 1 : 2))
    )
      throw new WorkflowError(
        "WF_CONDITION_SHAPE",
        422,
        "Condition operator has invalid operands",
      );
    if (op === "in" && Array.isArray(node.right) && node.right.length > 50)
      throw new WorkflowError(
        "WF_CONDITION_TOO_COMPLEX",
        422,
        "Condition list is too large",
      );
    children.forEach((v) => visit(v, depth + 1));
  };
  visit(condition, 1);
  return true;
}
const MISSING = Symbol("missing");
export function evaluateTransitionCondition(
  condition: unknown,
  context: Record<string, unknown>,
): boolean {
  validateTransitionCondition(condition);
  const read = (path: string): unknown => {
    let current: unknown = context;
    for (const part of path.split(".")) {
      if (
        !current ||
        typeof current !== "object" ||
        !Object.prototype.hasOwnProperty.call(current, part)
      )
        return MISSING;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };
  const run = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return value;
    const n = value as ConditionNode,
      op = n.operator!;
    if (op === "literal") return n.value;
    if (op === "var") return read(n.path!);
    if (op === "exists") return read(n.path!) !== MISSING;
    if (op === "not") return !Boolean(run(n.condition));
    if (op === "all") return n.conditions!.every((v) => Boolean(run(v)));
    if (op === "any") return n.conditions!.some((v) => Boolean(run(v)));
    const left = run(n.left),
      right = run(n.right);
    if (left === MISSING || right === MISSING) return false;
    if (op === "eq" || op === "neq") {
      const equal = typeof left === typeof right && Object.is(left, right);
      return op === "eq" ? equal : !equal;
    }
    if (op === "in") {
      if (!Array.isArray(right)) return false;
      return right.some(
        (candidate) =>
          typeof candidate === typeof left && Object.is(candidate, left),
      );
    }
    if (
      (typeof left !== "number" && typeof left !== "string") ||
      typeof left !== typeof right
    )
      return false;
    if (
      typeof left === "number" &&
      (!Number.isFinite(left) || !Number.isFinite(right as number))
    )
      return false;
    if (typeof left === "number" && typeof right === "number") {
      if (op === "lt") return left < right;
      if (op === "lte") return left <= right;
      if (op === "gt") return left > right;
      return left >= right;
    }
    const leftText = left as string,
      rightText = right as string;
    if (op === "lt") return leftText < rightText;
    if (op === "lte") return leftText <= rightText;
    if (op === "gt") return leftText > rightText;
    return leftText >= rightText;
  };
  return Boolean(run(condition));
}

export function validateEnterpriseWorkflowModel(model: WorkflowModel) {
  if (
    !model ||
    !Array.isArray(model.steps) ||
    !Array.isArray(model.transitions)
  )
    throw new WorkflowError(
      "WF_INVALID_MODEL",
      422,
      "Steps and transitions are required",
    );
  if (model.steps.length > 200 || model.transitions.length > 500)
    throw new WorkflowError(
      "WF_GRAPH_TOO_LARGE",
      422,
      "Workflow graph exceeds approved bounds",
    );
  const keys = new Set<string>();
  for (const step of model.steps) {
    if (!/^[a-z][a-z0-9-]{0,99}$/.test(step.key) || keys.has(step.key))
      throw new WorkflowError(
        "WF_INVALID_STEP",
        422,
        "Step keys must be unique normalized identifiers",
      );
    if (
      ![
        "human_review",
        "agent_execution",
        "notification",
        "document_validation",
        "domain_command",
        "wait_until",
        "conditional_branch",
      ].includes(step.type)
    )
      throw new WorkflowError(
        "WF_UNSAFE_STEP_TYPE",
        422,
        "Unregistered step type",
      );
    keys.add(step.key);
  }
  const transitionKeys = new Set<string>();
  for (const transition of model.transitions) {
    if (
      transitionKeys.has(transition.key) ||
      !keys.has(transition.from) ||
      !keys.has(transition.to)
    )
      throw new WorkflowError(
        "WF_INVALID_TRANSITION",
        422,
        "Transition identity or endpoint is invalid",
      );
    if (transition.condition) validateTransitionCondition(transition.condition);
    transitionKeys.add(transition.key);
  }
  validateWorkflowGraph(
    model.steps.map((s) => ({
      stepName: s.key,
      isEntryStep: !!s.entry,
      isTerminalStep: !!s.terminal,
    })),
    model.transitions.map((t) => ({
      fromStep: t.from,
      outcomeCode: t.outcome,
      toStep: t.to,
    })),
  );
  const entry = model.steps.find((s) => s.entry)!;
  const reachable = new Set([entry.key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of model.transitions)
      if (reachable.has(t.from) && !reachable.has(t.to)) {
        reachable.add(t.to);
        changed = true;
      }
  }
  if (reachable.size !== model.steps.length)
    throw new WorkflowError(
      "WF_UNREACHABLE_STATE",
      422,
      "All states must be reachable from the start state",
    );
  return {
    valid: true,
    hash: hash(model),
    stepCount: model.steps.length,
    transitionCount: model.transitions.length,
  };
}

export class EnterpriseWorkflowEngine {
  constructor(private pool: Pool) {}
  static async runLegacyAdapter<T>(
    client: PoolClient,
    tenantId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const tenant = await client.query(
      `SELECT 1 FROM tenant WHERE id=$1 AND status='active'`,
      [tenantId],
    );
    if (!tenant.rowCount)
      throw new WorkflowError(
        "WF_TENANT_INACTIVE",
        403,
        "Tenant is not active",
      );
    return operation();
  }
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      if ((e as { code?: string }).code === "40001")
        throw new WorkflowError(
          "WF_CONCURRENT_COMMAND",
          409,
          "Workflow state changed concurrently",
        );
      throw e;
    } finally {
      c.release();
    }
  }
  async createDefinition(
    tenantId: string,
    actorId: string,
    input: {
      key: string;
      name: string;
      description?: string;
      model: WorkflowModel;
    },
  ) {
    const key = normalizedKey(input.key);
    if (!key)
      throw new WorkflowError(
        "WF_INVALID_KEY",
        400,
        "Definition key is invalid",
      );
    return this.tx(async (c) => {
      const d = await c.query(
        `INSERT INTO workflow_definition(tenant_id,key,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING id,key,name,status,version`,
        [tenantId, key, input.name, input.description ?? null, actorId],
      );
      const v = await c.query(
        `INSERT INTO workflow_version(tenant_id,definition_id,version_number,status,configuration,version) VALUES($1,$2,1,'draft',$3,1) RETURNING id,version_number,status,version`,
        [tenantId, d.rows[0].id, JSON.stringify(input.model)],
      );
      return { ...d.rows[0], draftVersion: v.rows[0] };
    });
  }
  async listDefinitions(tenantId: string, limit = 50, offset = 0) {
    return (
      await this.pool.query(
        `SELECT d.id,d.key,d.name,d.description,d.status,d.version,COUNT(v.id)::int version_count FROM workflow_definition d LEFT JOIN workflow_version v ON v.tenant_id=d.tenant_id AND v.definition_id=d.id WHERE d.tenant_id=$1 GROUP BY d.id ORDER BY d.updated_at DESC LIMIT $2 OFFSET $3`,
        [tenantId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
      )
    ).rows;
  }
  async getDefinition(tenantId: string, id: string) {
    const d = await this.pool.query(
      `SELECT * FROM workflow_definition WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id],
    );
    if (!d.rowCount)
      throw new WorkflowError("WF_NOT_FOUND", 404, "Workflow not found");
    const versions = await this.pool.query(
      `SELECT id,version_number,status,version,is_default,configuration_hash,published_at FROM workflow_version WHERE tenant_id=$1 AND definition_id=$2 ORDER BY version_number DESC`,
      [tenantId, id],
    );
    return { ...d.rows[0], versions: versions.rows };
  }
  async replaceDraft(
    tenantId: string,
    versionId: string,
    expectedVersion: number,
    model: WorkflowModel,
  ) {
    return this.tx(async (c) => {
      const v = await c.query(
        `UPDATE workflow_version SET configuration=$1,validation_report=NULL,configuration_hash=NULL,version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND status='draft' AND version=$4 RETURNING id,version`,
        [JSON.stringify(model), tenantId, versionId, expectedVersion],
      );
      if (!v.rowCount)
        throw new WorkflowError(
          "WF_VERSION_CONFLICT",
          409,
          "Draft version is stale or immutable",
        );
      await c.query(
        `DELETE FROM workflow_transition WHERE tenant_id=$1 AND version_id=$2`,
        [tenantId, versionId],
      );
      await c.query(
        `DELETE FROM workflow_step_definition WHERE tenant_id=$1 AND version_id=$2`,
        [tenantId, versionId],
      );
      return v.rows[0];
    });
  }
  async validateVersion(tenantId: string, versionId: string) {
    return this.tx(async (c) => {
      const v = await c.query(
        `SELECT configuration,status FROM workflow_version WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, versionId],
      );
      if (!v.rowCount)
        throw new WorkflowError("WF_NOT_FOUND", 404, "Version not found");
      if (v.rows[0].status !== "draft")
        throw new WorkflowError(
          "WF_IMMUTABLE",
          409,
          "Only drafts can be validated",
        );
      try {
        const report = validateEnterpriseWorkflowModel(v.rows[0].configuration);
        await c.query(
          `UPDATE workflow_version SET status='validating',validation_report=$1,configuration_hash=$2 WHERE tenant_id=$3 AND id=$4 AND status='draft'`,
          [JSON.stringify(report), report.hash, tenantId, versionId],
        );
        return report;
      } catch (error) {
        if (!(error instanceof WorkflowError)) throw error;
        const failure = {
          valid: false,
          code: error.code,
          message: error.message.slice(0, 500),
        };
        await c.query(
          `UPDATE workflow_version SET validation_report=$1,configuration_hash=NULL WHERE tenant_id=$2 AND id=$3 AND status='draft'`,
          [JSON.stringify(failure), tenantId, versionId],
        );
        return failure;
      }
    });
  }
  async publishVersion(
    tenantId: string,
    versionId: string,
    actorId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.tx(async (c) => {
      const v = await c.query(
        `SELECT * FROM workflow_version WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, versionId],
      );
      if (!v.rowCount)
        throw new WorkflowError("WF_NOT_FOUND", 404, "Version not found");
      const row = v.rows[0];
      await c.query(
        `SELECT id FROM workflow_version WHERE tenant_id=$1 AND definition_id=$2 FOR UPDATE`,
        [tenantId, row.definition_id],
      );
      if (row.status === "published")
        return {
          id: row.id,
          status: row.status,
          hash: row.configuration_hash,
          replay: true,
        };
      if (row.status !== "validating" || row.version !== expectedVersion)
        throw new WorkflowError(
          "WF_VERSION_CONFLICT",
          409,
          "Validated version is stale or immutable",
        );
      const report = validateEnterpriseWorkflowModel(row.configuration);
      if (row.configuration_hash !== report.hash)
        throw new WorkflowError(
          "WF_VALIDATION_STALE",
          409,
          "Validate the current draft before publishing",
        );
      const command = await this.beginCommand(
        c,
        tenantId,
        null,
        idempotencyKey,
        "publish",
        hash({ versionId, expectedVersion }),
        actorId,
      );
      if (command.replay) return command.response;
      const model: WorkflowModel = row.configuration;
      const stepIds = new Map<string, string>();
      for (const s of model.steps) {
        const r = await c.query(
          `INSERT INTO workflow_step_definition(tenant_id,version_id,step_name,step_key,step_type,configuration,configuration_schema_version,is_entry_step,is_terminal_step,required_permission,assignment,sla) VALUES($1,$2,$3,$4,$5,$6,'1.0',$7,$8,$9,$10,$11) RETURNING id`,
          [
            tenantId,
            versionId,
            s.name ?? s.key,
            s.key,
            s.type,
            JSON.stringify(s.configuration ?? {}),
            !!s.entry,
            !!s.terminal,
            s.requiredPermission ?? null,
            s.assignment ? JSON.stringify(s.assignment) : null,
            s.sla ? JSON.stringify(s.sla) : null,
          ],
        );
        stepIds.set(s.key, r.rows[0].id);
      }
      for (const t of model.transitions)
        await c.query(
          `INSERT INTO workflow_transition(tenant_id,version_id,transition_key,from_step_definition_id,to_step_definition_id,outcome_code,condition_expression,required_permission) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            tenantId,
            versionId,
            t.key,
            stepIds.get(t.from),
            stepIds.get(t.to),
            t.outcome,
            t.condition ? JSON.stringify(t.condition) : null,
            t.requiredPermission ?? null,
          ],
        );
      await c.query(
        `UPDATE workflow_version SET is_default=FALSE WHERE tenant_id=$1 AND definition_id=$2 AND status='published' AND is_default`,
        [tenantId, row.definition_id],
      );
      await c.query(
        `UPDATE workflow_version SET status='published',is_default=TRUE,published_at=NOW(),published_by=$1 WHERE tenant_id=$2 AND id=$3 AND status='validating'`,
        [actorId, tenantId, versionId],
      );
      await c.query(
        `UPDATE workflow_definition SET status='active',updated_at=NOW(),updated_by=$1,version=version+1 WHERE tenant_id=$2 AND id=$3 AND status='draft'`,
        [actorId, tenantId, row.definition_id],
      );
      const response = {
        id: versionId,
        status: "published",
        hash: report.hash,
      };
      await this.completeCommand(c, tenantId, command.id, response);
      return response;
    });
  }
  async cloneVersion(
    tenantId: string,
    definitionId: string,
    sourceId?: string,
  ) {
    return this.tx(async (c) => {
      const source = await c.query(
        `SELECT * FROM workflow_version WHERE tenant_id=$1 AND definition_id=$2 ${sourceId ? "AND id=$3" : "ORDER BY version_number DESC"} LIMIT 1`,
        sourceId
          ? [tenantId, definitionId, sourceId]
          : [tenantId, definitionId],
      );
      if (!source.rowCount)
        throw new WorkflowError(
          "WF_NOT_FOUND",
          404,
          "Source version not found",
        );
      const n = await c.query(
        `SELECT COALESCE(MAX(version_number),0)+1 n FROM workflow_version WHERE tenant_id=$1 AND definition_id=$2`,
        [tenantId, definitionId],
      );
      return (
        await c.query(
          `INSERT INTO workflow_version(tenant_id,definition_id,version_number,status,configuration,published_from_version_id) VALUES($1,$2,$3,'draft',$4,$5) RETURNING id,version_number,status,version`,
          [
            tenantId,
            definitionId,
            n.rows[0].n,
            JSON.stringify(source.rows[0].configuration),
            source.rows[0].id,
          ],
        )
      ).rows[0];
    });
  }
  async startInstance(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    input: {
      definitionKey: string;
      entityType: string;
      entityId: string;
      organizationId?: string;
      businessKey?: string;
      variables?: Record<string, unknown>;
    },
  ) {
    return this.tx(async (c) => {
      const requestHash = hash(input);
      const existing = await c.query(
        `SELECT response_payload,request_hash FROM workflow_command WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [tenantId, idempotencyKey],
      );
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== requestHash)
          throw new WorkflowError(
            "WF_IDEMPOTENCY_CONFLICT",
            409,
            "Idempotency key payload mismatch",
          );
        return existing.rows[0].response_payload;
      }
      if (!input.organizationId)
        throw new WorkflowError(
          "WF_ORGANIZATION_REQUIRED",
          422,
          "Organization is required",
        );
      const v = await c.query(
        `SELECT DISTINCT v.*,d.id definition_id FROM workflow_definition d JOIN workflow_version v ON v.tenant_id=d.tenant_id AND v.definition_id=d.id JOIN workflow_definition_permission dp ON dp.tenant_id=d.tenant_id AND dp.definition_id=d.id AND dp.command_type='start' JOIN permission p ON p.tenant_id=dp.tenant_id AND p.name=dp.permission_name JOIN role_permission rp ON rp.permission_id=p.id JOIN membership m ON m.tenant_id=d.tenant_id AND m.role_id=rp.role_id AND m.user_id=$3 AND m.organization_id=$4 AND m.status='active' JOIN organization o ON o.tenant_id=m.tenant_id AND o.id=m.organization_id AND o.status='active' WHERE d.tenant_id=$1 AND d.key=$2 AND d.status='active' AND v.status='published' AND v.is_default`,
        [tenantId, input.definitionKey, actorId, input.organizationId],
      );
      if (v.rowCount !== 1)
        throw new WorkflowError(
          "WF_NOT_FOUND",
          404,
          "Exactly one published default workflow is required",
        );
      const cmd = await this.beginCommand(
        c,
        tenantId,
        null,
        idempotencyKey,
        "start",
        requestHash,
        actorId,
      );
      const entry = await c.query(
        `SELECT * FROM workflow_step_definition WHERE tenant_id=$1 AND version_id=$2 AND is_entry_step`,
        [tenantId, v.rows[0].id],
      );
      const instance = await c.query(
        `INSERT INTO workflow_instance(tenant_id,version_id,definition_id,current_step_definition_id,organization_id,entity_type,entity_id,business_key,idempotency_key,status,started_by,variables) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'running',$10,$11) RETURNING id,version,status`,
        [
          tenantId,
          v.rows[0].id,
          v.rows[0].definition_id,
          entry.rows[0].id,
          input.organizationId ?? null,
          input.entityType,
          input.entityId,
          input.businessKey ?? null,
          idempotencyKey,
          actorId,
          JSON.stringify(input.variables ?? {}),
        ],
      );
      const step = await c.query(
        `INSERT INTO workflow_step_execution(tenant_id,workflow_instance_id,step_definition_id,status,actor_type,actor_id) VALUES($1,$2,$3,'created','user',$4) RETURNING id`,
        [tenantId, instance.rows[0].id, entry.rows[0].id, actorId],
      );
      await this.initializeStep(
        c,
        tenantId,
        instance.rows[0].id,
        step.rows[0].id,
        entry.rows[0],
        input.organizationId,
      );
      await this.appendEvent(
        c,
        tenantId,
        instance.rows[0].id,
        "instance.started",
        "user",
        actorId,
        cmd.id,
        { versionId: v.rows[0].id, stepKey: entry.rows[0].step_key },
      );
      const response = {
        instanceId: instance.rows[0].id,
        workflowVersionId: v.rows[0].id,
        instanceVersion: 1,
        currentStepExecutionId: step.rows[0].id,
      };
      await c.query(
        `UPDATE workflow_command SET instance_id=$1 WHERE tenant_id=$2 AND id=$3`,
        [instance.rows[0].id, tenantId, cmd.id],
      );
      await this.completeCommand(c, tenantId, cmd.id, response);
      return response;
    });
  }
  async transition(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    input: {
      instanceId: string;
      outcomeCode: string;
      expectedVersion: number;
      workItemId?: string;
      organizationId: string;
    },
  ) {
    return this.tx((c) =>
      this.transitionWithClient(c, tenantId, actorId, idempotencyKey, input),
    );
  }
  private async transitionWithClient(
    c: PoolClient,
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    input: {
      instanceId: string;
      outcomeCode: string;
      expectedVersion: number;
      workItemId?: string;
      organizationId: string;
    },
    acceptedRecommendationId?: string,
  ) {
    const requestHash = hash(input);
    const cmd = await this.beginCommand(
      c,
      tenantId,
      input.instanceId,
      idempotencyKey,
      "transition",
      requestHash,
      actorId,
    );
    if (cmd.replay) return cmd.response;
    const i = await c.query(
      `SELECT i.* FROM workflow_instance i JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$3 AND m.status='active' WHERE i.tenant_id=$1 AND i.id=$2 AND i.organization_id=$4 FOR UPDATE OF i`,
      [tenantId, input.instanceId, actorId, input.organizationId],
    );
    if (!i.rowCount)
      throw new WorkflowError(
        "WF_NOT_FOUND",
        404,
        "Workflow instance not found",
      );
    const instance = i.rows[0];
    if (instance.version !== input.expectedVersion)
      throw new WorkflowError(
        "WF_VERSION_CONFLICT",
        409,
        "Instance version conflict",
      );
    if (!["running", "waiting", "active"].includes(instance.status))
      throw new WorkflowError(
        "WF_INVALID_STATE",
        409,
        "Instance is not transitionable",
      );
    const current = await c.query(
      `SELECT e.*,s.step_key FROM workflow_step_execution e JOIN workflow_step_definition s ON s.tenant_id=e.tenant_id AND s.id=e.step_definition_id WHERE e.tenant_id=$1 AND e.workflow_instance_id=$2 AND e.step_definition_id=$3 AND e.status=ANY($4) FOR UPDATE OF e`,
      [
        tenantId,
        input.instanceId,
        instance.current_step_definition_id,
        ["created", "ready", "claimed", "running", "waiting"],
      ],
    );
    if (!current.rowCount)
      throw new WorkflowError("WF_INVALID_STATE", 409, "No active step");
    if (input.workItemId) {
      const w = await c.query(
        `SELECT w.* FROM workflow_work_item w JOIN organization o ON o.tenant_id=w.tenant_id AND o.id=w.organization_id JOIN membership m ON m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$4 AND m.status='active' WHERE w.tenant_id=$1 AND w.id=$2 AND w.step_execution_id=$3 AND o.status='active' FOR UPDATE OF w`,
        [tenantId, input.workItemId, current.rows[0].id, actorId],
      );
      if (
        !w.rowCount ||
        !["claimed", "in_progress"].includes(w.rows[0].status) ||
        w.rows[0].claimed_by !== actorId
      )
        throw new WorkflowError(
          "WF_WORK_ITEM_STALE",
          409,
          "Work item is stale or not owned",
        );
      await c.query(
        `UPDATE workflow_work_item SET status='completed',completed_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, input.workItemId],
      );
      await c.query(
        `INSERT INTO workflow_work_item_history(tenant_id,work_item_id,action,actor_id) VALUES($1,$2,'completed',$3)`,
        [tenantId, input.workItemId, actorId],
      );
    }
    const choices = await c.query(
      `SELECT t.*,s.is_terminal_step,s.step_key,s.assignment,s.sla,s.step_type FROM workflow_transition t JOIN workflow_step_definition s ON s.tenant_id=t.tenant_id AND s.id=t.to_step_definition_id WHERE t.tenant_id=$1 AND t.version_id=$2 AND t.from_step_definition_id=$3 AND t.outcome_code=$4 ORDER BY t.priority DESC,t.transition_key`,
      [
        tenantId,
        instance.version_id,
        instance.current_step_definition_id,
        input.outcomeCode,
      ],
    );
    const next = choices.rows.find(
      (t) =>
        !t.condition_expression ||
        evaluateTransitionCondition(t.condition_expression, {
          variables: instance.variables,
          instance: {
            entityType: instance.entity_type,
            organizationId: instance.organization_id,
            status: instance.status,
          },
          step: { output: current.rows[0].output ?? {} },
        }),
    );
    if (!next)
      throw new WorkflowError(
        "WF_INVALID_TRANSITION",
        422,
        "Transition is not available",
      );
    await c.query(
      `UPDATE workflow_step_execution SET status='running',started_at=COALESCE(started_at,NOW()),version=version+1 WHERE tenant_id=$1 AND id=$2 AND status IN ('ready','claimed')`,
      [tenantId, current.rows[0].id],
    );
    const completed = await c.query(
      `UPDATE workflow_step_execution SET status='completed',completed_at=NOW(),outcome_code=$1,version=version+1 WHERE tenant_id=$2 AND id=$3 AND status=ANY($4) RETURNING id`,
      [input.outcomeCode, tenantId, current.rows[0].id, ["running", "waiting"]],
    );
    if (!completed.rowCount)
      throw new WorkflowError(
        "WF_INVALID_STATE",
        409,
        "Step execution is no longer active",
      );
    let nextStepExecutionId: null | string = null;
    const terminal = next.is_terminal_step;
    if (!terminal) {
      const s = await c.query(
        `INSERT INTO workflow_step_execution(tenant_id,workflow_instance_id,step_definition_id,status,actor_type,actor_id) VALUES($1,$2,$3,'created','user',$4) RETURNING id`,
        [tenantId, input.instanceId, next.to_step_definition_id, actorId],
      );
      nextStepExecutionId = s.rows[0].id;
      await this.initializeStep(
        c,
        tenantId,
        input.instanceId,
        s.rows[0].id,
        next,
        instance.organization_id,
      );
    }
    await c.query(
      `UPDATE workflow_instance SET current_step_definition_id=$1,status=$2,version=version+1,updated_at=NOW(),completed_at=CASE WHEN $3 THEN NOW() ELSE completed_at END,terminal_outcome=CASE WHEN $3 THEN $4 ELSE terminal_outcome END WHERE tenant_id=$5 AND id=$6`,
      [
        next.to_step_definition_id,
        terminal ? "completed" : "running",
        terminal,
        input.outcomeCode,
        tenantId,
        input.instanceId,
      ],
    );
    await c.query(
      `UPDATE workflow_timer SET status='cancelled' WHERE tenant_id=$1 AND instance_id=$2 AND step_execution_id=$3 AND status IN ('pending','leased')`,
      [tenantId, input.instanceId, current.rows[0].id],
    );
    await c.query(
      `UPDATE workflow_ai_recommendation SET status='stale',decided_at=NOW() WHERE tenant_id=$1 AND instance_id=$2 AND status='active' AND ($3::uuid IS NULL OR id<>$3)`,
      [tenantId, input.instanceId, acceptedRecommendationId ?? null],
    );
    await this.appendEvent(
      c,
      tenantId,
      input.instanceId,
      "instance.transitioned",
      "user",
      actorId,
      cmd.id,
      {
        from: current.rows[0].step_key,
        to: next.step_key,
        outcome: input.outcomeCode,
      },
    );
    const response = {
      instanceId: input.instanceId,
      instanceVersion: input.expectedVersion + 1,
      status: terminal ? "completed" : "running",
      currentStepExecutionId: nextStepExecutionId,
    };
    await this.completeCommand(c, tenantId, cmd.id, response);
    return response;
  }
  async claimWorkItem(
    tenantId: string,
    actorId: string,
    id: string,
    expectedVersion: number,
  ) {
    return this.tx(async (c) => {
      const w = await c.query(
        `UPDATE workflow_work_item w SET status='claimed',claimed_by=$1,claimed_at=NOW(),version=w.version+1,updated_at=NOW() FROM organization o,membership m WHERE w.tenant_id=$2 AND w.id=$3 AND w.status='open' AND w.version=$4 AND (w.assignee_user_id IS NULL OR w.assignee_user_id=$1) AND o.tenant_id=w.tenant_id AND o.id=w.organization_id AND o.status='active' AND m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$1 AND m.status='active' RETURNING w.*`,
        [actorId, tenantId, id, expectedVersion],
      );
      if (!w.rowCount)
        throw new WorkflowError(
          "WF_WORK_ITEM_STALE",
          409,
          "Work item is no longer claimable",
        );
      await c.query(
        `UPDATE workflow_step_execution SET status='claimed',claimed_by=$1,claimed_at=NOW(),version=version+1 WHERE tenant_id=$2 AND id=$3 AND status='ready'`,
        [actorId, tenantId, w.rows[0].step_execution_id],
      );
      await c.query(
        `INSERT INTO workflow_work_item_history(tenant_id,work_item_id,action,actor_id,to_user_id) VALUES($1,$2,'claimed',$3,$3)`,
        [tenantId, id, actorId],
      );
      return w.rows[0];
    });
  }
  async createRecommendation(
    tenantId: string,
    input: {
      instanceId: string;
      type: "transition" | "assignee" | "priority" | "risk";
      recommendation: unknown;
      confidence?: number;
      explanation?: string;
      provider: string;
      model: string;
      modelVersion?: string;
    },
  ) {
    const i = await this.pool.query(
      `SELECT version,version_id FROM workflow_instance WHERE tenant_id=$1 AND id=$2`,
      [tenantId, input.instanceId],
    );
    if (!i.rowCount)
      throw new WorkflowError(
        "WF_NOT_FOUND",
        404,
        "Workflow instance not found",
      );
    return (
      await this.pool.query(
        `INSERT INTO workflow_ai_recommendation(tenant_id,instance_id,workflow_version_id,instance_version,recommendation_type,recommendation,confidence,explanation,model_provider,model_name,model_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status,instance_version`,
        [
          tenantId,
          input.instanceId,
          i.rows[0].version_id,
          i.rows[0].version,
          input.type,
          JSON.stringify(input.recommendation),
          input.confidence ?? null,
          input.explanation ?? null,
          input.provider,
          input.model,
          input.modelVersion ?? null,
        ],
      )
    ).rows[0];
  }
  async decideRecommendation(
    tenantId: string,
    organizationId: string,
    actorId: string,
    id: string,
    expectedVersion: number,
    decision: "accepted" | "rejected",
    idempotencyKey: string,
    reason?: string,
  ) {
    return this.tx(async (c) => {
      const r = await c.query(
        `SELECT r.*,i.id instance_id,i.organization_id,i.version current_instance_version FROM workflow_ai_recommendation r JOIN workflow_instance i ON i.tenant_id=r.tenant_id AND i.id=r.instance_id JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$3 AND m.status='active' JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' WHERE r.tenant_id=$1 AND r.id=$2 AND i.organization_id=$4 FOR UPDATE OF r,i`,
        [tenantId, id, actorId, organizationId],
      );
      if (
        !r.rowCount ||
        r.rows[0].status !== "active" ||
        r.rows[0].instance_version !== expectedVersion ||
        r.rows[0].current_instance_version !== expectedVersion
      )
        throw new WorkflowError(
          "WF_RECOMMENDATION_STALE",
          409,
          "Recommendation is stale or inaccessible",
        );
      if (decision === "rejected") {
        const command = await this.beginCommand(
          c,
          tenantId,
          r.rows[0].instance_id,
          idempotencyKey,
          "recommendation.reject",
          hash({ id, expectedVersion, reason: reason ?? null }),
          actorId,
        );
        if (command.replay) return command.response;
        await c.query(
          `UPDATE workflow_ai_recommendation SET status='rejected',decided_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='active'`,
          [tenantId, id],
        );
        await this.appendEvent(
          c,
          tenantId,
          r.rows[0].instance_id,
          "recommendation.rejected",
          "user",
          actorId,
          command.id,
          { recommendationId: id, reason: reason ?? null },
        );
        const response = { id, status: "rejected" as const };
        await this.completeCommand(c, tenantId, command.id, response);
        return response;
      }
      const rec = r.rows[0].recommendation as any;
      if (!rec?.outcomeCode)
        throw new WorkflowError(
          "WF_RECOMMENDATION_INVALID",
          422,
          "Recommendation cannot be executed",
        );
      const result = await this.transitionWithClient(
        c,
        tenantId,
        actorId,
        idempotencyKey,
        {
          instanceId: r.rows[0].instance_id,
          outcomeCode: rec.outcomeCode,
          expectedVersion,
          workItemId: rec.workItemId,
          organizationId,
        },
        id,
      );
      const accepted = await c.query(
        `UPDATE workflow_ai_recommendation SET status='accepted',decided_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='active' RETURNING id`,
        [tenantId, id],
      );
      if (!accepted.rowCount)
        throw new WorkflowError(
          "WF_RECOMMENDATION_STALE",
          409,
          "Recommendation is stale or inaccessible",
        );
      return { id, status: "accepted" as const, result };
    });
  }
  private async initializeStep(
    c: PoolClient,
    tenantId: string,
    instanceId: string,
    executionId: string,
    step: any,
    organizationId?: string,
  ) {
    if (step.sla?.escalations?.length > 10)
      throw new WorkflowError(
        "WF_ESCALATION_TOO_DEEP",
        422,
        "Escalation chain exceeds approved bound",
      );
    if (step.step_type === "human_review") {
      const a = step.assignment ?? { type: "organization_queue" };
      const org = a.organizationId ?? organizationId ?? null;
      if (!org)
        throw new WorkflowError(
          "WF_QUEUE_MISCONFIGURED",
          422,
          "Human work item requires an organization",
        );
      await c.query(
        `INSERT INTO workflow_work_item(tenant_id,organization_id,instance_id,step_execution_id,assignment_type,assignee_user_id,assignee_role_id,due_at) SELECT $1,o.id,$3,$4,$5,$6,$7,$8 FROM organization o WHERE o.tenant_id=$1 AND o.id=$2 AND o.status='active' ON CONFLICT DO NOTHING`,
        [
          tenantId,
          org,
          instanceId,
          executionId,
          a.type,
          a.userId ?? null,
          a.roleId ?? null,
          step.sla?.breachMinutes
            ? new Date(Date.now() + step.sla.breachMinutes * 60000)
            : null,
        ],
      );
      await c.query(
        `UPDATE workflow_step_execution SET status='ready',version=version+1 WHERE tenant_id=$1 AND id=$2 AND status='created'`,
        [tenantId, executionId],
      );
    }
    if (step.sla?.breachMinutes) {
      const due = new Date(Date.now() + step.sla.breachMinutes * 60000);
      const reminder = step.sla.reminderMinutes
        ? new Date(Date.now() + step.sla.reminderMinutes * 60000)
        : null;
      const clock = await c.query(
        `INSERT INTO workflow_sla_clock(tenant_id,instance_id,step_execution_id,reminder_at,due_at,policy_snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          tenantId,
          instanceId,
          executionId,
          reminder,
          due,
          JSON.stringify(step.sla),
        ],
      );
      if (reminder)
        await c.query(
          `INSERT INTO workflow_timer(tenant_id,instance_id,step_execution_id,timer_type,due_at,idempotency_key) VALUES($1,$2,$3,'sla_reminder',$4,$5) ON CONFLICT DO NOTHING`,
          [
            tenantId,
            instanceId,
            executionId,
            reminder,
            `${clock.rows[0].id}:reminder:${step.sla.reminderMinutes}`,
          ],
        );
      await c.query(
        `INSERT INTO workflow_timer(tenant_id,instance_id,step_execution_id,timer_type,due_at,idempotency_key) VALUES($1,$2,$3,'sla_breach',$4,$5) ON CONFLICT DO NOTHING`,
        [tenantId, instanceId, executionId, due, `${clock.rows[0].id}:breach`],
      );
    }
    if (step.step_type !== "human_review" && !step.is_terminal_step) {
      const waiting = step.step_type === "wait_until";
      await c.query(
        `UPDATE workflow_step_execution SET status=$1,started_at=CASE WHEN $1='running' THEN NOW() ELSE started_at END,version=version+1 WHERE tenant_id=$2 AND id=$3 AND status='created'`,
        [waiting ? "waiting" : "running", tenantId, executionId],
      );
      if (!waiting)
        await c.query(
          `INSERT INTO task_execution(tenant_id,task_id,task_type,payload_hash,status,max_attempts,encrypted_payload) VALUES($1,$2,$3,$4,'pending',5,$5) ON CONFLICT(tenant_id,task_id) DO NOTHING`,
          [
            tenantId,
            `workflow:${executionId}`,
            step.handler_name ?? "govos.workflow.step",
            hash({ instanceId, executionId }),
            JSON.stringify({ schemaVersion: "wf1", instanceId, executionId }),
          ],
        );
    }
  }
  private async beginCommand(
    c: PoolClient,
    tenantId: string,
    instanceId: string | null,
    key: string,
    type: string,
    requestHash: string,
    actorId: string,
  ) {
    try {
      const r = await c.query(
        `INSERT INTO workflow_command(tenant_id,instance_id,idempotency_key,command_type,request_hash,actor_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, instanceId, key, type, requestHash, actorId],
      );
      return { id: r.rows[0].id, replay: false, response: null as any };
    } catch (e: any) {
      if (e.code !== "23505") throw e;
      const r = await c.query(
        `SELECT id,request_hash,status,response_payload FROM workflow_command WHERE tenant_id=$1 AND idempotency_key=$2`,
        [tenantId, key],
      );
      if (r.rows[0].request_hash !== requestHash)
        throw new WorkflowError(
          "WF_IDEMPOTENCY_CONFLICT",
          409,
          "Idempotency key payload mismatch",
        );
      if (r.rows[0].status !== "completed")
        throw new WorkflowError(
          "WF_COMMAND_IN_PROGRESS",
          409,
          "Command is already processing",
        );
      return {
        id: r.rows[0].id,
        replay: true,
        response: r.rows[0].response_payload,
      };
    }
  }
  private async completeCommand(
    c: PoolClient,
    tenantId: string,
    id: string,
    response: unknown,
  ) {
    await c.query(
      `UPDATE workflow_command SET status='completed',response_payload=$1,completed_at=NOW() WHERE tenant_id=$2 AND id=$3`,
      [JSON.stringify(response), tenantId, id],
    );
  }
  private async appendEvent(
    c: PoolClient,
    tenantId: string,
    instanceId: string,
    type: string,
    actorType: string,
    actorId: string | null,
    commandId: string | null,
    metadata: unknown,
  ) {
    await c.query(
      `INSERT INTO workflow_event(tenant_id,instance_id,sequence_number,event_type,actor_type,actor_id,command_id,metadata) SELECT $1,$2,COALESCE(MAX(sequence_number),0)+1,$3,$4,$5,$6,$7 FROM workflow_event WHERE tenant_id=$1 AND instance_id=$2`,
      [
        tenantId,
        instanceId,
        type,
        actorType,
        actorId,
        commandId,
        JSON.stringify(metadata),
      ],
    );
  }
}
