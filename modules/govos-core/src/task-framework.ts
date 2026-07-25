import { z } from "zod";

export interface TaskDefinition {
  readonly name: string;
  readonly version: string;
  readonly inputSchema: z.ZodTypeAny;
}

export interface TaskExecutor {
  execute(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | void>;
}

export interface RegisteredTask {
  readonly definition: TaskDefinition;
  readonly executor: TaskExecutor;
}

export class TaskRegistry {
  private readonly tasks = new Map<string, RegisteredTask>();

  // "Why it exists": Reusable task catalog decoupling task definitions from API & worker loops
  public register(definition: TaskDefinition, executor: TaskExecutor): void {
    const key = `${definition.name}:${definition.version}`;
    if (this.tasks.has(key)) {
      throw new Error(`Duplicate task registration rejected: ${key}`);
    }
    this.tasks.set(key, { definition, executor });
  }

  public get(name: string, version: string): RegisteredTask {
    const key = `${name}:${version}`;
    const task = this.tasks.get(key);
    if (!task) {
      throw new Error(`Task type not registered: ${key}`);
    }
    return task;
  }

  public list(): RegisteredTask[] {
    return Array.from(this.tasks.values());
  }
}
