import { AsyncLocalStorage } from "node:async_hooks";
export const requestContextStorage = new AsyncLocalStorage();
export function runWithRequestContext(context, callback) {
    // Enforce runtime immutability using deep freeze
    const frozenContext = Object.freeze({
        identity: context.identity
            ? Object.freeze({
                ...context.identity,
                roles: Object.freeze([...(context.identity.roles || [])]),
                permissions: Object.freeze([...(context.identity.permissions || [])]),
            })
            : undefined,
        trace: context.trace ? Object.freeze({ ...context.trace }) : undefined,
        execution: context.execution
            ? Object.freeze({ ...context.execution })
            : undefined,
    });
    return requestContextStorage.run(frozenContext, callback);
}
export function getRequestContext() {
    return requestContextStorage.getStore();
}
/**
 * Derives a new context from the current active request context, allowing controlled enrichment.
 */
export function deriveRequestContext(enrichment) {
    const current = getRequestContext() || {};
    const identity = current.identity || enrichment.identity
        ? Object.freeze({
            tenantId: enrichment.identity?.tenantId ?? current.identity?.tenantId ?? "",
            organizationId: enrichment.identity?.organizationId ??
                current.identity?.organizationId,
            userId: enrichment.identity?.userId ?? current.identity?.userId,
            roles: Object.freeze([
                ...(enrichment.identity?.roles ?? current.identity?.roles ?? []),
            ]),
            permissions: Object.freeze([
                ...(enrichment.identity?.permissions ??
                    current.identity?.permissions ??
                    []),
            ]),
        })
        : undefined;
    const trace = current.trace || enrichment.trace
        ? Object.freeze({
            requestId: enrichment.trace?.requestId ?? current.trace?.requestId ?? "",
            correlationId: enrichment.trace?.correlationId ??
                current.trace?.correlationId ??
                "",
            causationId: enrichment.trace?.causationId ?? current.trace?.causationId,
            traceId: enrichment.trace?.traceId ?? current.trace?.traceId ?? "",
        })
        : undefined;
    const execution = current.execution || enrichment.execution
        ? Object.freeze({
            workflowInstanceId: enrichment.execution?.workflowInstanceId ??
                current.execution?.workflowInstanceId,
            workflowStepExecutionId: enrichment.execution?.workflowStepExecutionId ??
                current.execution?.workflowStepExecutionId,
            taskId: enrichment.execution?.taskId ?? current.execution?.taskId,
            aiExecutionId: enrichment.execution?.aiExecutionId ??
                current.execution?.aiExecutionId,
        })
        : undefined;
    return Object.freeze({ identity, trace, execution });
}
export function runWithTenantContext(context, callback) {
    const requestCtx = {
        identity: {
            tenantId: context.tenantId,
            userId: context.userId,
            roles: context.roles,
            permissions: [],
        },
    };
    return runWithRequestContext(requestCtx, callback);
}
export function getTenantContext() {
    const ctx = getRequestContext();
    if (!ctx?.identity)
        return undefined;
    return {
        tenantId: ctx.identity.tenantId,
        userId: ctx.identity.userId || "",
        roles: [...ctx.identity.roles],
    };
}
//# sourceMappingURL=context.js.map