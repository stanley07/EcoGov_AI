import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { logger } from "@govos/observability";
import { z } from "zod";
import { AgentRegistry, PromptRegistry, ToolRegistry } from "@govos/ai";
import { TaskRegistry } from "@govos/core";
import {
  createApp,
  RegistrationReviewTaskExecutor,
  DeterministicWastePermitLookup,
  FindSimilarComplaintsTool,
  ComplaintTriageTaskExecutor,
} from "./app.js";
import { SendInvitationExecutor } from "./executors/sendInvitationExecutor.js";

export async function startServer(config: Config, pool: Pool): Promise<void> {
  // Construct registries once in composition root (Correction 14)
  const agentRegistry = new AgentRegistry();
  const promptRegistry = new PromptRegistry();
  const toolRegistry = new ToolRegistry();
  const taskRegistry = new TaskRegistry();

  // 1. Register Prompts
  promptRegistry.register({
    templateId: "ecogov.facility-review",
    version: "1.0.0",
    content: "Please review the environmental registration details for the following facility:\n- Business Name: {{businessName}}\n- Category: {{category}}\n- Address: {{address}}\n\nPerform a compliance audit, flag capacity discrepancies, and return structured review parameters.",
    status: "active",
    requiredVariables: ["businessName", "category", "address"],
    optionalVariables: ["tool_output", "schema_error"],
    allowedAgents: ["ecogov.registration-review"],
    dataClassification: "internal",
  });

  promptRegistry.register({
    templateId: "ecogov.complaint-triage-template",
    version: "1.0.0",
    content: "Analyze the environmental complaint:\n- Subject: {{subject}}\n- Description: {{description}}\n- Location: {{location}}\n\nSuggest categories, departments, and potential duplicates.",
    status: "active",
    requiredVariables: ["subject", "description", "location"],
    optionalVariables: ["tool_output", "schema_error"],
    allowedAgents: ["ecogov.complaint-triage"],
    dataClassification: "internal",
  });

  // 2. Register Tools
  const permitTool = new DeterministicWastePermitLookup();
  toolRegistry.register(permitTool);

  const similarityTool = new FindSimilarComplaintsTool(pool);
  toolRegistry.register(similarityTool);

  // 3. Register Agents
  agentRegistry.register({
    definition: {
      name: "ecogov.registration-review",
      version: "1.2.0",
      provider: "deterministic",
      model: "simulator",
      objective: "You are an environmental registration auditor agent.",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
    },
    execute: async (input) => {
      return {
        data: input,
        usage: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.0001 },
        latencyMs: 15,
        modelName: "deterministic-simulator",
        executionStatus: "succeeded",
      };
    },
  });

  agentRegistry.register({
    definition: {
      name: "ecogov.complaint-triage",
      version: "1.0.0",
      provider: "deterministic",
      model: "simulator",
      objective: "You are an environmental complaint triage agent.",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
    },
    execute: async (input) => {
      return {
        data: input,
        usage: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.0001 },
        latencyMs: 15,
        modelName: "deterministic-simulator",
        executionStatus: "succeeded",
      };
    },
  });

  // 4. Register Task Executors with injected registries
  taskRegistry.register(
    { name: "ai_registration_review", version: "1.0.0", inputSchema: z.any() },
    new RegistrationReviewTaskExecutor(
      pool,
      config,
      agentRegistry,
      promptRegistry,
      toolRegistry,
    ),
  );

  taskRegistry.register(
    { name: "complaint_triage_job", version: "1.0.0", inputSchema: z.any() },
    new ComplaintTriageTaskExecutor(
      pool,
      config,
      agentRegistry,
      promptRegistry,
      toolRegistry,
    ),
  );

  taskRegistry.register(
    { name: "govos.notification.invitation.send", version: "1.0.0", inputSchema: z.any() },
    new SendInvitationExecutor(pool)
  );

  // Validate startup mappings (Correction 14 - fail fast)
  try {
    agentRegistry.get("ecogov.registration-review", "1.2.0");
    agentRegistry.get("ecogov.complaint-triage", "1.0.0");
    promptRegistry.get("ecogov.facility-review", "1.0.0");
    promptRegistry.get("ecogov.complaint-triage-template", "1.0.0");
    toolRegistry.get("check_waste_disposal_permit", "1.0.0");
    toolRegistry.get("find_similar_complaints", "1.0.0");
    logger.info("Validated all worker registry startup mappings successfully");
  } catch (err: any) {
    logger.fatal({ err: err.message }, "Registry validation failed at startup");
    throw err;
  }

  const app = createApp(
    config,
    pool,
    agentRegistry,
    promptRegistry,
    toolRegistry,
    taskRegistry,
  );

  try {
    await app.listen({
      port: config.worker.WORKER_PORT,
      host: "0.0.0.0",
    });
    logger.info(
      { port: config.worker.WORKER_PORT },
      "GovOS Worker application successfully started",
    );
  } catch (err) {
    logger.fatal({ err }, "Failed to start GovOS Worker server");
    throw err;
  }

  // Graceful Shutdown Mechanics
  const shutdown = async (signal: string) => {
    logger.warn({ signal }, "Worker process received shutdown notice");

    const timer = setTimeout(() => {
      logger.error(
        "Graceful shutdown exceeded timeout limit. Forcing termination.",
      );
      process.exit(1);
    }, 10000);

    try {
      await app.close();
      logger.info("Worker HTTP listeners closed");

      await pool.end();
      logger.info("Database pools connection client pool ended");

      clearTimeout(timer);
      logger.info("Graceful shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
