import { checkAndAssertActiveTenant } from "./platform-admin/tenant-guards.js";
/**
 * Validates graph completeness for workflow version publications.
 */
export function validateWorkflowGraph(steps, transitions) {
    // 1. Enforce exactly one entry step
    const entrySteps = steps.filter((s) => s.isEntryStep);
    if (entrySteps.length !== 1) {
        throw new Error(`Workflow definition must have exactly one entry step. Found: ${entrySteps.length}`);
    }
    // 2. Require at least one terminal step
    const terminalSteps = steps.filter((s) => s.isTerminalStep);
    if (terminalSteps.length === 0) {
        throw new Error("Workflow definition must have at least one terminal step.");
    }
    // 3. Reject transitions leaving terminal steps
    const terminalNames = new Set(terminalSteps.map((s) => s.stepName));
    for (const trans of transitions) {
        if (trans.fromStep && terminalNames.has(trans.fromStep)) {
            throw new Error(`Workflow transition leaving terminal step is prohibited: ${trans.fromStep} -> ${trans.toStep}`);
        }
    }
    // 4. Validate that all steps can reach a terminal step using depth-first search
    const stepMap = new Map();
    for (const trans of transitions) {
        const from = trans.fromStep || "";
        const list = stepMap.get(from) || [];
        list.push(trans.toStep);
        stepMap.set(from, list);
    }
    for (const step of steps) {
        if (!step.isTerminalStep) {
            let reachesTerminal = false;
            const visited = new Set();
            const checkReach = (curr) => {
                if (terminalNames.has(curr)) {
                    reachesTerminal = true;
                    return;
                }
                if (visited.has(curr))
                    return;
                visited.add(curr);
                const nextSteps = stepMap.get(curr) || [];
                for (const next of nextSteps) {
                    checkReach(next);
                    if (reachesTerminal)
                        return;
                }
            };
            checkReach(step.stepName);
            if (!reachesTerminal) {
                throw new Error(`Dead-end step detected: step "${step.stepName}" cannot reach any terminal step.`);
            }
        }
    }
}
/**
 * Creates a new runtime workflow instance mapping to the active version.
 */
export async function createWorkflowInstance(client, tenantId, workflowName, entityType, entityId) {
    await checkAndAssertActiveTenant(client, tenantId);
    // 1. Resolve active version of workflow definition
    const versionQuery = `
    SELECT v.id as version_id, s.id as step_def_id, s.step_name
    FROM workflow_version v
    JOIN workflow_definition d ON d.tenant_id = v.tenant_id AND d.id = v.definition_id
    JOIN workflow_step_definition s ON s.tenant_id = v.tenant_id AND s.version_id = v.id
    WHERE v.tenant_id = $1 AND d.name = $2 AND v.status = 'active' AND s.is_entry_step = TRUE
    LIMIT 1
  `;
    const versionRes = await client.query(versionQuery, [tenantId, workflowName]);
    if (versionRes.rows.length === 0) {
        throw new Error(`Active workflow version and entry step not found for name: ${workflowName}`);
    }
    const { version_id, step_def_id, step_name } = versionRes.rows[0];
    // 2. Create Instance
    const instanceRes = await client.query(`INSERT INTO workflow_instance (tenant_id, version_id, entity_type, entity_id, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id`, [tenantId, version_id, entityType, entityId]);
    const instanceId = instanceRes.rows[0].id;
    // 3. Create initial step execution
    const stepExecRes = await client.query(`INSERT INTO workflow_step_execution (tenant_id, workflow_instance_id, step_definition_id, status, actor_type, notes)
     VALUES ($1, $2, $3, 'pending', 'system', 'Workflow instance initialized')
     RETURNING id`, [tenantId, instanceId, step_def_id]);
    const initialStepExecutionId = stepExecRes.rows[0].id;
    // 4. Log audit event
    await client.query(`INSERT INTO workflow_audit (tenant_id, workflow_instance_id, action, details)
     VALUES ($1, $2, 'initialize', $3)`, [tenantId, instanceId, JSON.stringify({ entityType, entityId, step_name })]);
    return { instanceId, initialStepExecutionId };
}
/**
 * Transitions an active workflow instance to the next step.
 */
export async function transitionWorkflowInstance(client, tenantId, instanceId, currentStepExecutionId, outcomeCode, actorType, actorId, notes) {
    await checkAndAssertActiveTenant(client, tenantId);
    // 1. Fetch current execution and step details
    const execQuery = `
    SELECT e.step_definition_id, s.step_name, i.version_id
    FROM workflow_step_execution e
    JOIN workflow_instance i ON i.tenant_id = e.tenant_id AND i.id = e.workflow_instance_id
    JOIN workflow_step_definition s ON s.tenant_id = e.tenant_id AND s.id = e.step_definition_id
    WHERE e.tenant_id = $1 AND e.workflow_instance_id = $2 AND e.id = $3 AND e.status = 'pending'
  `;
    const execRes = await client.query(execQuery, [
        tenantId,
        instanceId,
        currentStepExecutionId,
    ]);
    if (execRes.rows.length === 0) {
        throw new Error(`Active pending step execution not found for id: ${currentStepExecutionId}`);
    }
    const { step_definition_id, step_name, version_id } = execRes.rows[0];
    // 2. Lookup transition matching the outcome
    const transQuery = `
    SELECT to_step_definition_id, s.step_name as to_step_name, s.is_terminal_step
    FROM workflow_transition t
    JOIN workflow_step_definition s ON s.tenant_id = t.tenant_id AND s.id = t.to_step_definition_id
    WHERE t.tenant_id = $1 AND t.version_id = $2 AND t.from_step_definition_id = $3 AND t.outcome_code = $4
    ORDER BY t.priority DESC
    LIMIT 1
  `;
    const transRes = await client.query(transQuery, [
        tenantId,
        version_id,
        step_definition_id,
        outcomeCode,
    ]);
    if (transRes.rows.length === 0) {
        throw new Error(`No transition defined for step "${step_name}" under outcome "${outcomeCode}"`);
    }
    const { to_step_definition_id, to_step_name, is_terminal_step } = transRes.rows[0];
    // 3. Mark current step as completed (with CAS validation)
    const updateRes = await client.query(`UPDATE workflow_step_execution
     SET status = 'completed', completed_at = NOW(), notes = COALESCE($1, notes)
     WHERE tenant_id = $2 AND id = $3 AND status IN ('pending', 'processing')
     RETURNING id`, [
        notes || `Transitioned via ${outcomeCode}`,
        tenantId,
        currentStepExecutionId,
    ]);
    if (updateRes.rows.length === 0) {
        throw new Error("Failed to transition workflow step: Step execution is no longer active.");
    }
    // 4. Create new step execution
    let nextStepExecutionId = "";
    if (!is_terminal_step) {
        const nextStepRes = await client.query(`INSERT INTO workflow_step_execution (tenant_id, workflow_instance_id, step_definition_id, status, actor_type, actor_id, notes)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6)
       RETURNING id`, [
            tenantId,
            instanceId,
            to_step_definition_id,
            actorType,
            actorId || null,
            `Entering step ${to_step_name}`,
        ]);
        nextStepExecutionId = nextStepRes.rows[0].id;
    }
    else {
        // Complete the instance since we hit a terminal step
        await client.query(`UPDATE workflow_instance
       SET status = 'completed', updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`, [tenantId, instanceId]);
    }
    // 5. Log audit event
    await client.query(`INSERT INTO workflow_audit (tenant_id, workflow_instance_id, action, details)
     VALUES ($1, $2, 'transition', $3)`, [
        tenantId,
        instanceId,
        JSON.stringify({
            from: step_name,
            to: to_step_name,
            outcome: outcomeCode,
            actorType,
        }),
    ]);
    return nextStepExecutionId || null;
}
//# sourceMappingURL=workflow.js.map