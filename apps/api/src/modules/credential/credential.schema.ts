import { z } from "zod/v4";

/** The job login resolved for an agent (mirrors `ResolvedCredential`), or null. */
export const resolvedCredentialSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    password: z.string(),
  })
  .nullable();
