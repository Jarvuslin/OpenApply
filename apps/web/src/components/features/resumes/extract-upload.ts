import type { ResumeData } from "@jobpilot/contracts/resume";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";

const pending = new Map<string, Promise<ResumeData>>();

/** Share a running extraction across navigation and Strict Mode remounts. */
export function extractUpload(id: string): Promise<ResumeData> {
  const existing = pending.get(id);
  if (existing) return existing;
  const request = (async () => {
    try {
      const { data, error } = await api.resumes({ id }).extract.post();
      if (error) throw new Error(apiErrorMessage(error));
      if (!data)
        throw new Error(
          "No extracted data returned. Your uploaded file is saved; retry reading it.",
        );
      return data.content;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, request);
  return request;
}
