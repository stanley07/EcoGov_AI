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
export declare class PlatformManifestBuilder {
    private readonly modules;
    private readonly agents;
    private readonly tools;
    private readonly tasks;
    private readonly workflows;
    constructor();
    registerModule(name: string, version: string): void;
    registerAgent(name: string, version: string, category?: string): void;
    registerTool(name: string, version: string, category: string): void;
    registerTask(name: string, version: string): void;
    registerWorkflow(name: string, version: string): void;
    build(): PlatformManifest;
}
//# sourceMappingURL=manifest.d.ts.map