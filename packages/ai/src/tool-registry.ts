/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";

export type ToolCategory =
  | "read_only"
  | "internal_write"
  | "external_write"
  | "financial"
  | "notification"
  | "identity_or_access";

export interface ToolDefinition<TInput = any, TOutput = any> {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly requiredPermissions: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface Tool<TInput = any, TOutput = any> {
  readonly definition: ToolDefinition<TInput, TOutput>;
  execute(input: TInput, tenantId: string): Promise<TOutput>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    const key = `${tool.definition.name}:${tool.definition.version}`;
    if (this.tools.has(key)) {
      throw new Error(`Duplicate tool registration rejected: ${key}`);
    }
    this.tools.set(key, tool);
  }

  public get(name: string, version: string): Tool {
    const key = `${name}:${version}`;
    const tool = this.tools.get(key);
    if (!tool) {
      throw new Error(`Tool not registered: ${key}`);
    }
    return tool;
  }

  public list(): Tool[] {
    return Array.from(this.tools.values());
  }
}
