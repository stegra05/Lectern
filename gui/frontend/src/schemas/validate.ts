/**
 * Zod validation utilities for API boundary validation.
 *
 * CRITICAL: Validation failures throw hard errors. Never return "safe defaults"
 * that mask problems and poison the Zustand store.
 */
import { ZodType } from 'zod';

/**
 * Custom error class for validation failures.
 * Thrown when API response doesn't match expected schema.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate data against a Zod schema, throwing on failure.
 *
 * @param schema - Zod schema to validate against
 * @param data - Unknown data to validate
 * @returns Validated and typed data
 * @throws ValidationError if validation fails
 *
 * @example
 * const user = validateOrThrow(UserSchema, response);
 */
export function validateOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      `API response validation failed: ${result.error.message}`
    );
  }
  return result.data;
}

