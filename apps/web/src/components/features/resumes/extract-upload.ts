import type { ResumeData } from "@openapply/contracts/resume";
import { extractionSchema, parseExtractedResume } from "@openapply/contracts/resume-extraction";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { getStoredProvider } from "@/lib/agent-storage";
import { runInference } from "@/lib/terminal";

const pending = new Map<string, Promise<ResumeData>>();

/** Share a running extraction across navigation and Strict Mode remounts. */
export function extractUpload(id: string, model = "haiku"): Promise<ResumeData> {
  const provider = getStoredProvider();
  const key = `${provider}:${id}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      const { data, error } = await api.resumes({ id })["source-text"].get();
      if (error) throw new Error(apiErrorMessage(error));
      if (!data)
        throw new Error(
          "No extracted data returned. Your uploaded file is saved; retry reading it.",
        );
      const result = await runInference(provider, data.text, model, extractionSchema(provider));
      let content: ResumeData;
      try {
        content = parseExtractedResume(result.output);
      } catch {
        throw new Error(
          "The agent returned invalid resume data. Your file is saved; retry extraction or fill manually.",
        );
      }
      const saved = await api.resumes({ id }).put({ content });
      if (saved.error) throw new Error(apiErrorMessage(saved.error));
      return content;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}
