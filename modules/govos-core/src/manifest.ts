export interface ModuleManifest {
  readonly name: string;
  readonly version: string;
}

export interface AgentManifest {
  readonly name: string;
  readonly version: string;
  readonly category?: string;
}

export interface ToolManifest {
  readonly name: string;
  readonly version: string;
  readonly category: string;
}

export interface TaskManifest {
  readonly name: string;
  readonly version: string;
}

export interface WorkflowManifest {
  readonly name: string;
  readonly version: string;
}

export interface PlatformManifest {
  readonly buildVersion: string;
  readonly buildCommit: string;
  readonly modules: readonly ModuleManifest[];
  readonly agents: readonly AgentManifest[];
  readonly tools: readonly ToolManifest[];
  readonly tasks: readonly TaskManifest[];
  readonly workflows: readonly WorkflowManifest[];
}

export class PlatformManifestBuilder {
  private readonly modules: ModuleManifest[] = [];
  private readonly agents: AgentManifest[] = [];
  private readonly tools: ToolManifest[] = [];
  private readonly tasks: TaskManifest[] = [];
  private readonly workflows: WorkflowManifest[] = [];

  constructor() {
    // Add default core module
    this.modules.push({ name: "govos-core", version: "1.0.0" });
  }

  public registerModule(name: string, version: string): void {
    this.modules.push({ name, version });
  }

  public registerAgent(name: string, version: string, category?: string): void {
    this.agents.push({ name, version, category });
  }

  public registerTool(name: string, version: string, category: string): void {
    this.tools.push({ name, version, category });
  }

  public registerTask(name: string, version: string): void {
    this.tasks.push({ name, version });
  }

  public registerWorkflow(name: string, version: string): void {
    this.workflows.push({ name, version });
  }

  public build(): PlatformManifest {
    return {
      buildVersion: process.env.BUILD_VERSION || "0.1.0",
      buildCommit: process.env.BUILD_COMMIT || "local-dev",
      modules: Object.freeze([...this.modules]),
      agents: Object.freeze([...this.agents]),
      tools: Object.freeze([...this.tools]),
      tasks: Object.freeze([...this.tasks]),
      workflows: Object.freeze([...this.workflows]),
    };
  }
}
