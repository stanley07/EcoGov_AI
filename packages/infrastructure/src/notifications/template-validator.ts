/**
 * Simple JSON schema validator for template variables.
 */
export function validateTemplateVariables(
  schema: any,
  variables: any,
): { valid: boolean; errors?: string[] } {
  if (!schema || schema.type !== "object" || !schema.properties) {
    return { valid: true }; // No validation schema available
  }

  const errors: string[] = [];

  // Check required
  if (Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (variables[req] === undefined) {
        errors.push(`Missing required variable: ${req}`);
      }
    }
  }

  // Check types
  if (variables) {
    for (const [key, val] of Object.entries(variables)) {
      const propSchema = schema.properties[key];
      if (propSchema) {
        const type = typeof val;
        if (propSchema.type === "string" && type !== "string") {
          errors.push(`Variable ${key} must be a string`);
        } else if (propSchema.type === "number" && type !== "number") {
          errors.push(`Variable ${key} must be a number`);
        } else if (propSchema.type === "boolean" && type !== "boolean") {
          errors.push(`Variable ${key} must be a boolean`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
