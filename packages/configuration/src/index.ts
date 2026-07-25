import { z } from "zod";

const APP_ENV = z.enum(["local", "test", "staging", "production"]);

const isProductionOrStaging = (env: string) =>
  env === "production" || env === "staging";

const secretValidator = (fieldName: string) => {
  return z.string().superRefine((val, ctx) => {
    const lower = val.toLowerCase();
    if (
      lower.includes("placeholder") ||
      lower.includes("dummy") ||
      lower.includes("key_goes_here") ||
      val === ""
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Secret for ${fieldName} contains invalid placeholder values`,
      });
    }
  });
};

export const DatabaseConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
});

export const ObservabilityConfigSchema = z.object({
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export const BaseConfigSchema = z.object({
  APP_ENV: APP_ENV,
  ENVIRONMENT: APP_ENV.optional(),
  PUBLIC_TENANT_SLUG: z.string().default("anambra-state-ministry-of-environment"),
});

export const AIConfigSchema = z
  .object({
    AI_PROVIDER: z.enum(["deterministic", "gemini-api", "vertex-ai"]),
    GEMINI_MODEL_ID: z.string().default("gemini-1.5-flash"),
    GEMINI_API_KEY: z.string().optional(),
    GCP_PROJECT_ID: z.string().optional(),
    GCP_LOCATION: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const isProd = isProductionOrStaging(process.env["APP_ENV"] || "local");

    if (data.AI_PROVIDER === "gemini-api") {
      if (!data.GEMINI_API_KEY) {
        ctx.addIssue({
          path: ["GEMINI_API_KEY"],
          code: z.ZodIssueCode.custom,
          message: "GEMINI_API_KEY is required when AI_PROVIDER is gemini-api",
        });
      } else if (isProd) {
        const parsed = secretValidator("GEMINI_API_KEY").safeParse(
          data.GEMINI_API_KEY,
        );
        if (!parsed.success) {
          ctx.addIssue({
            path: ["GEMINI_API_KEY"],
            code: z.ZodIssueCode.custom,
            message:
              "GEMINI_API_KEY contains invalid placeholder values in staging/production",
          });
        }
      }
    }

    if (data.AI_PROVIDER === "vertex-ai") {
      if (!data.GCP_PROJECT_ID) {
        ctx.addIssue({
          path: ["GCP_PROJECT_ID"],
          code: z.ZodIssueCode.custom,
          message: "GCP_PROJECT_ID is required when AI_PROVIDER is vertex-ai",
        });
      }
      if (!data.GCP_LOCATION) {
        ctx.addIssue({
          path: ["GCP_LOCATION"],
          code: z.ZodIssueCode.custom,
          message: "GCP_LOCATION is required when AI_PROVIDER is vertex-ai",
        });
      }
    }
  });

export const ApiConfigSchema = z.object({
  PORT: z.coerce.number().min(1).max(65535).default(8080),
});

export const WorkerConfigSchema = z
  .object({
    WORKER_PORT: z.coerce.number().min(1).max(65535).default(8081),
    WORKER_AUTH_MODE: z.enum(["local", "oidc"]).default("local"),
    WORKER_OIDC_AUDIENCE: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    const isProd = isProductionOrStaging(process.env["APP_ENV"] || "local");
    if (
      isProd &&
      data.WORKER_AUTH_MODE === "oidc" &&
      !data.WORKER_OIDC_AUDIENCE
    ) {
      ctx.addIssue({
        path: ["WORKER_OIDC_AUDIENCE"],
        code: z.ZodIssueCode.custom,
        message:
          "WORKER_OIDC_AUDIENCE is required in staging/production with OIDC mode",
      });
    }
  });

export interface Config {
  appEnv: "local" | "test" | "staging" | "production";
  database: z.infer<typeof DatabaseConfigSchema>;
  observability: z.infer<typeof ObservabilityConfigSchema>;
  ai: z.infer<typeof AIConfigSchema>;
  api: z.infer<typeof ApiConfigSchema>;
  worker: z.infer<typeof WorkerConfigSchema>;
  publicTenantSlug?: string;
}

export function loadConfig(
  envSource: Record<string, string | undefined> = process.env,
): Config {
  const baseParse = BaseConfigSchema.safeParse(envSource);
  if (!baseParse.success) {
    throw new Error(`Base configuration error: ${baseParse.error.message}`);
  }

  const appEnv = baseParse.data.APP_ENV;

  const prevAppEnv = process.env["APP_ENV"];
  process.env["APP_ENV"] = appEnv;

  try {
    const dbParse = DatabaseConfigSchema.safeParse(envSource);
    if (!dbParse.success) {
      throw new Error(`Database configuration error: ${dbParse.error.message}`);
    }

    const obsParse = ObservabilityConfigSchema.safeParse(envSource);
    if (!obsParse.success) {
      throw new Error(
        `Observability configuration error: ${obsParse.error.message}`,
      );
    }

    const aiParse = AIConfigSchema.safeParse(envSource);
    if (!aiParse.success) {
      throw new Error(`AI configuration error: ${aiParse.error.message}`);
    }

    const apiParse = ApiConfigSchema.safeParse(envSource);
    if (!apiParse.success) {
      throw new Error(`API configuration error: ${apiParse.error.message}`);
    }

    const workerParse = WorkerConfigSchema.safeParse(envSource);
    if (!workerParse.success) {
      throw new Error(
        `Worker configuration error: ${workerParse.error.message}`,
      );
    }

    return {
      appEnv,
      database: dbParse.data,
      observability: obsParse.data,
      ai: aiParse.data,
      api: apiParse.data,
      worker: workerParse.data,
      publicTenantSlug: baseParse.data.PUBLIC_TENANT_SLUG,
    };
  } finally {
    if (prevAppEnv === undefined) {
      delete process.env["APP_ENV"];
    } else {
      process.env["APP_ENV"] = prevAppEnv;
    }
  }
}
