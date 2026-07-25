import * as crypto from "node:crypto";

export type DataClassification = "public" | "internal" | "confidential" | "restricted" | "secret";

export interface PromptTemplate {
  readonly templateId: string;
  readonly version: string;
  readonly content: string;
  readonly contentHash: string;
  readonly status: "draft" | "active" | "deprecated";
  readonly requiredVariables: readonly string[];
  readonly optionalVariables: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly dataClassification: DataClassification;
  readonly createdAt: Date;
}

export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>();

  public register(template: Omit<PromptTemplate, "contentHash" | "createdAt">): void {
    const key = `${template.templateId}@${template.version}`;
    if (this.templates.has(key)) {
      throw new Error(`Duplicate prompt template registration rejected: ${key}`);
    }

    const contentHash = crypto.createHash("sha256").update(template.content).digest("hex");

    const fullTemplate: PromptTemplate = {
      ...template,
      contentHash,
      createdAt: new Date(),
    };

    Object.freeze(fullTemplate);
    this.templates.set(key, fullTemplate);
  }

  public get(templateId: string, version: string): PromptTemplate {
    const key = `${templateId}@${version}`;
    const tmpl = this.templates.get(key);
    if (!tmpl) {
      throw new Error(`Prompt template not found: ${key}`);
    }
    return tmpl;
  }

  /**
   * Renders the template securely, performing validation and structural separation.
   */
  public render(
    template: PromptTemplate,
    variables: Record<string, unknown>
  ): string {
    // 1. Validate variables inputs
    for (const reqVar of template.requiredVariables) {
      if (variables[reqVar] === undefined || variables[reqVar] === null) {
        throw new Error(`Missing required template variable: ${reqVar}`);
      }
    }

    // 2. Reject unknown variables to prevent injection leak
    const allowed = new Set([...template.requiredVariables, ...template.optionalVariables]);
    for (const key of Object.keys(variables)) {
      if (!allowed.has(key)) {
        throw new Error(`Rejected unregistered template variable parameter: ${key}`);
      }
    }

    // 3. Render securely. Use strict variables mapping and structural separation delimiters
    let rendered = template.content;
    for (const [key, val] of Object.entries(variables)) {
      const stringValue = typeof val === "object" ? JSON.stringify(val) : String(val);
      
      // Enforce max length constraint (50KB to avoid excessive context sizes)
      if (stringValue.length > 50000) {
        throw new Error(`Template variable payload size limit exceeded for key: ${key}`);
      }

      // Structure untrusted content inside tags to prevent instructions escape
      const secureValue = `\n<UNTRUSTED_CONTENT_${key.toUpperCase()}>\n${stringValue}\n</UNTRUSTED_CONTENT_${key.toUpperCase()}>\n`;
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), secureValue);
    }

    return rendered;
  }
}
export * from "./prompt-registry.js";
