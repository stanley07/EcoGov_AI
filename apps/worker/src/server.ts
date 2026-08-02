import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { logger } from "@govos/observability";
import { z } from "zod";
import { AgentRegistry, PromptRegistry, ToolRegistry, OutboxEventDispatcher, DeterministicModelProvider, PolicyEngine, AIExecutionOrchestrator } from "@govos/ai";
import { TaskRegistry, ScreenSubcontractorApplicationHandler, LicenceIssuanceService } from "@govos/core";
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

  promptRegistry.register({
    templateId: "ecogov.subcontractor-screening-template",
    version: "1.0.0",
    content: "Verify subcontractor details:\n- Business Name: {{businessName}}\n- Licence Type: {{licenseType}}\n- Experience Years: {{experienceYears}}\n\nDetermine recommendation, score, criteria, and risk flags.",
    status: "active",
    requiredVariables: ["businessName", "licenseType", "experienceYears"],
    optionalVariables: ["documents", "tool_output", "schema_error"],
    allowedAgents: ["ecogov.subcontractor-screening"],
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
    execute: async (input: any) => {
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
    execute: async (input: any) => {
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
      name: "ecogov.subcontractor-screening",
      version: "1.0.0",
      provider: "deterministic",
      model: "simulator",
      objective: "Verify subcontractor qualifications and assess compliance risk.",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
    },
    execute: async (input: any) => {
      const vars = input.variables || {};
      const businessName = vars.businessName || "";
      const isHighRisk = businessName.toLowerCase().includes("fail") || businessName.toLowerCase().includes("high_risk");
      const recommendation = isHighRisk ? "high_risk" : "recommended";
      const score = isHighRisk ? 30 : 90;
      return {
        data: {
          schemaVersion: "1",
          recommendation,
          score,
          criteria: [
            { code: "experience", score, weight: 0.5, explanation: "Proven active operation history" },
            { code: "credentials", score, weight: 0.5, explanation: "Standard regulatory documentation matches" }
          ],
          riskFlags: isHighRisk ? [{ code: "CRIT-FAIL", severity: "high", explanation: "Discovered critical compliance history flag" }] : [],
          summary: isHighRisk ? "Critical compliance risk discovered." : "Subcontractor satisfies baseline criteria."
        },
        usage: { inputTokens: 100, outputTokens: 80, estimatedCost: 0.0001 },
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
    agentRegistry.get("ecogov.subcontractor-screening", "1.0.0");
    promptRegistry.get("ecogov.facility-review", "1.0.0");
    promptRegistry.get("ecogov.complaint-triage-template", "1.0.0");
    promptRegistry.get("ecogov.subcontractor-screening-template", "1.0.0");
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

  const dispatcher = new OutboxEventDispatcher(pool);
  const provider = new DeterministicModelProvider();
  const policyEngine = new PolicyEngine();
  const orchestrator = new AIExecutionOrchestrator(pool, provider, policyEngine);
  const screeningHandler = new ScreenSubcontractorApplicationHandler(
    pool,
    orchestrator,
    agentRegistry,
    promptRegistry
  );

  dispatcher.setDispatchCallback(async (event: any) => {
    if (event.event_type === "subcontractor_application.submitted") {
      await screeningHandler.handleScreening(event.payload, event.id);
    } else if (event.event_type === "subcontractor_application.payment_confirmed") {
      const { tenantId, applicationId, invoiceId, paymentId, applicationVersion } = event.payload;
      const issuanceService = new LicenceIssuanceService(pool);
      await issuanceService.issueLicence(tenantId, applicationId, invoiceId, paymentId, event.id, applicationVersion);
    }
  });
  dispatcher.start();

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
      dispatcher.stop();
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
