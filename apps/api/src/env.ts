import type { z } from "zod/v4";
import { EnvSchema } from "./env.schema";

export type Env = z.infer<typeof EnvSchema>;

function validateEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${messages}`);
  }
  return parsed.data;
}

/** Validated, typed env. Import this everywhere instead of touching process.env. */
export const env: Env = validateEnv();
