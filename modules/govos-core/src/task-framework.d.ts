import { z } from "zod";
export interface TaskDefinition {
    readonly name: string;
    readonly version: string;
    readonly inputSchema: z.ZodTypeAny;
}
export interface TaskExecutor {
    execute(payload: Record<string, unknown>): Promise<Record<string, unknown> | void>;
}
export interface RegisteredTask {
    readonly definition: TaskDefinition;
    readonly executor: TaskExecutor;
}
export declare class TaskRegistry {
    private readonly tasks;
    register(definition: TaskDefinition, executor: TaskExecutor): void;
    get(name: string, version: string): RegisteredTask;
    list(): RegisteredTask[];
}
//# sourceMappingURL=task-framework.d.ts.map