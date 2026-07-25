import { z } from "zod";

export class OutputValidationService {
  public validateZodSchema(data: unknown, schema: z.ZodTypeAny): { valid: boolean; errors?: string[] } {
    const res = schema.safeParse(data);
    if (res.success) {
      return { valid: true };
    } else {
      return {
        valid: false,
        errors: res.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      };
    }
  }

  public validateJsonSchema(data: unknown, schema: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    try {
      if (schema.type === "object" && (data === null || typeof data !== "object")) {
        return { valid: false, errors: ["Expected object format"] };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, errors: [err.message] };
    }
  }
}
