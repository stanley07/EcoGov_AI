import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

export interface LogContext {
  correlationId: string;
  requestId?: string;
  taskId?: string;
  tenantId?: string;
}

export const correlationStorage = new AsyncLocalStorage<LogContext>();

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "req.headers['x-api-key']",
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apiKey",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "privateKey",
  "DATABASE_URL",
];

export const logger = pino({
  level: process.env["LOG_LEVEL"] || "info",
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
    log: (object) => {
      const context = correlationStorage.getStore();
      if (context) {
        return {
          ...object,
          correlationId: context.correlationId,
          requestId: context.requestId,
          taskId: context.taskId,
          tenantId: context.tenantId,
        };
      }
      return object;
    },
  },
});

export function runWithContext<T>(context: LogContext, fn: () => T): T {
  const cleanCorrelationId = context.correlationId
    .replace(/[^a-zA-Z0-9-]/g, "")
    .substring(0, 36);
  const cleanRequestId = context.requestId
    ?.replace(/[^a-zA-Z0-9-]/g, "")
    .substring(0, 36);

  const cleanContext: LogContext = {
    ...context,
    correlationId:
      cleanCorrelationId ||
      "gen-" + Math.random().toString(36).substring(2, 15),
    requestId: cleanRequestId,
  };

  return correlationStorage.run(cleanContext, fn);
}

export function getContext(): LogContext | undefined {
  return correlationStorage.getStore();
}
