// The public job index is built from the digest, so a garbled or empty one silently loses the job.

import { addCampaignJobSchema, createCampaignSchema, patchCampaignJobSchema } from "./campaign";
import { describe, expect, it } from "bun:test";

const job = (digest?: string) => ({
  key: "acme-engineer-1",
  title: "Engineer",
  company: "Acme",
  url: "https://acme.example/jobs/1",
  ...(digest !== undefined && { digest }),
});

const digest = JSON.stringify({ skills: ["Go"] });

describe("job digest contract", () => {
  it("accepts a JSON object", () => {
    expect(addCampaignJobSchema.parse(job(digest)).digest).toBe(digest);
  });

  // A skill templating `"digest":"$DIGEST"` renders an unset digest as "".
  it("drops an empty digest instead of storing it", () => {
    expect(addCampaignJobSchema.parse(job("")).digest).toBeUndefined();
    expect(addCampaignJobSchema.parse(job("   ")).digest).toBeUndefined();
  });

  it("rejects a digest that is not a JSON object", () => {
    expect(addCampaignJobSchema.safeParse(job("{truncated")).success).toBe(false);
    expect(addCampaignJobSchema.safeParse(job('["Go"]')).success).toBe(false);
    expect(addCampaignJobSchema.safeParse(job('"Go"')).success).toBe(false);
  });

  // Undefined leaves the stored digest alone; an explicit null is the caller clearing it.
  it("distinguishes an omitted digest from an explicit null on patch", () => {
    expect(patchCampaignJobSchema.parse({}).digest).toBeUndefined();
    expect(patchCampaignJobSchema.parse({ digest: null }).digest).toBeNull();
    expect(patchCampaignJobSchema.parse({ digest: "" }).digest).toBeUndefined();
  });
});

it("rejects the retired campaign source", () => {
  expect(
    createCampaignSchema.safeParse({ query: "Engineer", source: "networking", config: {} }).success,
  ).toBe(false);
});
