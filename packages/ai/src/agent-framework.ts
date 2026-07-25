import { z } from "zod";

export interface AgentDefinition {
  readonly name: string;
  readonly version: string;
  readonly provider: string;
  readonly model: string;
  readonly objective: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  readonly description?: string;
}

export interface AgentResult<T> {
  readonly data: T;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCost: number;
  };
  readonly latencyMs: number;
  readonly modelName: string;
  readonly executionStatus: "succeeded" | "failed";
}

export interface Agent<TInput = unknown, TOutput = unknown> {
  readonly definition: AgentDefinition;
  execute(input: TInput): Promise<AgentResult<TOutput>>;
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  // "Why it exists": Reusable container for module-defined AI agents
  public register(agent: Agent): void {
    const key = `${agent.definition.name}:${agent.definition.version}`;
    if (this.agents.has(key)) {
      throw new Error(`Duplicate agent registration rejected: ${key}`);
    }
    this.agents.set(key, agent);
  }

  public get(name: string, version: string): Agent {
    const key = `${name}:${version}`;
    const agent = this.agents.get(key);
    if (!agent) {
      throw new Error(`Agent not registered: ${key}`);
    }
    return agent;
  }

  public list(): Agent[] {
    return Array.from(this.agents.values());
  }
}
