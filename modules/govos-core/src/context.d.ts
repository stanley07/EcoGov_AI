import { AsyncLocalStorage } from "node:async_hooks";
export interface IdentityContext {
    readonly tenantId: string;
    readonly organizationId?: string;
    readonly userId?: string;
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
}
export interface TraceContext {
    readonly requestId: string;
    readonly correlationId: string;
    readonly causationId?: string;
    readonly traceId: string;
}
export interface ExecutionContext {
    readonly workflowInstanceId?: string;
    readonly workflowStepExecutionId?: string;
    readonly taskId?: string;
    readonly aiExecutionId?: string;
}
export interface RequestContext {
    readonly identity?: IdentityContext;
    readonly trace?: TraceContext;
    readonly execution?: ExecutionContext;
}
export declare const requestContextStorage: AsyncLocalStorage<RequestContext>;
export declare function runWithRequestContext<T>(context: RequestContext, callback: () => T): T;
export declare function getRequestContext(): RequestContext | undefined;
/**
 * Derives a new context from the current active request context, allowing controlled enrichment.
 */
export declare function deriveRequestContext(enrichment: {
    identity?: Partial<IdentityContext>;
    trace?: Partial<TraceContext>;
    execution?: Partial<ExecutionContext>;
}): RequestContext;
export interface TenantContext {
    tenantId: string;
    userId: string;
    roles: string[];
}
export declare function runWithTenantContext<T>(context: TenantContext, callback: () => T): T;
export declare function getTenantContext(): TenantContext | undefined;
//# sourceMappingURL=context.d.ts.map