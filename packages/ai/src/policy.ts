import { DataClassification } from "./prompt-registry.js";
import { ToolCategory } from "./tool-registry.js";

export type PolicyDecisionOutcome = "allowed" | "allowed_after_redaction" | "blocked" | "human_review_required";

export interface PolicyContext {
  readonly tenantId: string;
  readonly actorRoles: readonly string[];
  readonly agentName: string;
  readonly dataClassification: DataClassification;
  readonly destinationProvider: string;
  readonly toolCategory?: ToolCategory;
}

export class PolicyEngine {
  public evaluate(context: PolicyContext): PolicyDecisionOutcome {
    // 1. Enforce strict restrictions on high classification levels
    if (context.dataClassification === "secret") {
      return "blocked"; // Secret data is never allowed to be processed by public AI models
    }

    if (context.dataClassification === "restricted") {
      return "human_review_required";
    }

    // 2. Validate tool permissions
    if (context.toolCategory) {
      if (context.toolCategory === "financial" || context.toolCategory === "identity_or_access") {
        return "blocked"; // Block autonomous execution of high-risk tools in Milestone 3
      }
      if (context.toolCategory === "external_write") {
        return "human_review_required"; // External writes require human officer approval
      }
    }

    // 3. Confidential data is allowed after redaction
    if (context.dataClassification === "confidential") {
      return "allowed_after_redaction";
    }

    return "allowed";
  }

  /**
   * Sanitizes/Redacts text parameters.
   */
  public redactSensitiveContent(content: string): string {
    let redacted = content;
    redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]");
    redacted = redacted.replace(/\b(?:\d[ -]*?){13,16}\b/g, "[REDACTED_IDENTIFIER]");
    return redacted;
  }
}
