export class PlatformManifestBuilder {
    modules = [];
    agents = [];
    tools = [];
    tasks = [];
    workflows = [];
    constructor() {
        // Add default core module
        this.modules.push({ name: "govos-core", version: "1.0.0" });
    }
    registerModule(name, version) {
        this.modules.push({ name, version });
    }
    registerAgent(name, version, category) {
        this.agents.push({ name, version, category });
    }
    registerTool(name, version, category) {
        this.tools.push({ name, version, category });
    }
    registerTask(name, version) {
        this.tasks.push({ name, version });
    }
    registerWorkflow(name, version) {
        this.workflows.push({ name, version });
    }
    build() {
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
//# sourceMappingURL=manifest.js.map