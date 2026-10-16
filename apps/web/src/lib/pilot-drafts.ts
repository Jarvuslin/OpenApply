import { pilotRulesSchema } from "@openapply/contracts/pilots";
import { z } from "zod/v4";

const PREFIX = "openapply:pilot-draft:";

// Unfinished values are allowed (an empty name, no resume yet); only the shape is checked.
const draftSchema = z.object({
  step: z.number().int().min(0),
  values: z.object({
    name: z.string(),
    rules: pilotRulesSchema,
    resumeId: z.string(),
    minScore: z.number(),
    autoRun: z.boolean(),
    intervalMinutes: z.number(),
    mode: z.enum(["review", "queue"]),
    maxJobsPerRun: z.number(),
  }),
});

type PilotDraft = z.infer<typeof draftSchema>;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Unsaved pilot wizard progress, kept per browser tab so leaving the page and coming back resumes
 * it. `key` is the pilot id, or "new" for one not created yet.
 */
export const pilotDrafts = {
  read(key: string): PilotDraft | null {
    try {
      const raw = storage()?.getItem(PREFIX + key);
      const parsed = raw ? draftSchema.safeParse(JSON.parse(raw)) : null;
      return parsed?.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  write(key: string, draft: PilotDraft): void {
    try {
      storage()?.setItem(PREFIX + key, JSON.stringify(draft));
    } catch {
      // A full or blocked store only means the draft is not kept.
    }
  },
  delete(key: string): void {
    storage()?.removeItem(PREFIX + key);
  },
  /** Forget every draft, as when the signed-in account changes. */
  clear(): void {
    const store = storage();
    if (!store) return;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
    for (const key of keys) if (key?.startsWith(PREFIX)) store.removeItem(key);
  },
};
