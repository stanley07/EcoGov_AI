export class TaskRegistry {
    tasks = new Map();
    // "Why it exists": Reusable task catalog decoupling task definitions from API & worker loops
    register(definition, executor) {
        const key = `${definition.name}:${definition.version}`;
        if (this.tasks.has(key)) {
            throw new Error(`Duplicate task registration rejected: ${key}`);
        }
        this.tasks.set(key, { definition, executor });
    }
    get(name, version) {
        const key = `${name}:${version}`;
        const task = this.tasks.get(key);
        if (!task) {
            throw new Error(`Task type not registered: ${key}`);
        }
        return task;
    }
    list() {
        return Array.from(this.tasks.values());
    }
}
//# sourceMappingURL=task-framework.js.map