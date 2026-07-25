import { PoolClient } from "pg";
export interface WorkflowStepValidation {
    readonly stepName: string;
    readonly isEntryStep: boolean;
    readonly isTerminalStep: boolean;
}
export interface WorkflowTransitionValidation {
    readonly fromStep?: string;
    readonly outcomeCode: string;
    readonly toStep: string;
}
/**
 * Validates graph completeness for workflow version publications.
 */
export declare function validateWorkflowGraph(steps: readonly WorkflowStepValidation[], transitions: readonly WorkflowTransitionValidation[]): void;
/**
 * Creates a new runtime workflow instance mapping to the active version.
 */
export declare function createWorkflowInstance(client: PoolClient, tenantId: string, workflowName: string, entityType: string, entityId: string): Promise<{
    instanceId: string;
    initialStepExecutionId: string;
}>;
/**
 * Transitions an active workflow instance to the next step.
 */
export declare function transitionWorkflowInstance(client: PoolClient, tenantId: string, instanceId: string, currentStepExecutionId: string, outcomeCode: string, actorType: "user" | "agent" | "system" | "service", actorId?: string, notes?: string): Promise<string | null>;
//# sourceMappingURL=workflow.d.ts.map