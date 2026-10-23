import assert from "node:assert/strict";
import test from "node:test";
import { createRedactor, sha256 } from "./api.mjs";
import { seedApplicant, syntheticApplicant } from "./applicant.mjs";
import { CASES } from "./cases.mjs";

function seedApi({ badHash = false, badSignature = false, compilerFails = false } = {}) {
  const calls = [];
  const bytes = Buffer.from(
    badSignature ? "This is not a PDF" : "%PDF-1.7\nSynthetic unit-test bytes",
  );
  return {
    calls,
    bytes,
    setSession() {},
    async request(path, options = {}) {
      calls.push({ path, method: options.method ?? "GET" });
      if (path === "/api/auth/register") return { user: { id: "user", emailVerified: true } };
      if (path === "/api/resumes/upload") return { id: "resume" };
      if (path === "/api/resumes/resume/artifacts") {
        if (compilerFails) throw new Error("Compiler failed");
        return {
          resumeId: "resume",
          variantId: null,
          revision: "a".repeat(64),
          pdfSha256: badHash ? "b".repeat(64) : sha256(bytes),
          validation: { valid: true },
        };
      }
      if (path === "/api/resumes/resume/pdf") return bytes;
      return {};
    },
  };
}

test("synthetic seeding compiles and checks a base artifact before any agent dispatch", async () => {
  const api = seedApi();
  const seeded = await seedApplicant(api, syntheticApplicant("unit"), createRedactor());
  assert.equal(seeded.baseArtifact.pdfSha256, sha256(api.bytes));
  assert.equal(seeded.baseArtifact.resumeId, seeded.resumeId);
  assert.deepEqual(api.calls.slice(-2), [
    { path: "/api/resumes/resume/artifacts", method: "POST" },
    { path: "/api/resumes/resume/pdf", method: "GET" },
  ]);
  assert.equal(
    api.calls.some((call) => /variants|score|submission|result/.test(call.path)),
    false,
  );
});

test("compiler failure, wrong bytes and non-PDF output fail synthetic seeding", async () => {
  for (const options of [{ compilerFails: true }, { badHash: true }, { badSignature: true }]) {
    await assert.rejects(
      seedApplicant(seedApi(options), syntheticApplicant("unit"), createRedactor()),
    );
  }
});

test("synthetic account application limit covers the complete canonical fixture manifest", () => {
  assert.equal(
    syntheticApplicant("unit").profile.autoApply.maxApplicationsPerCampaign,
    CASES.length,
  );
  assert.equal(syntheticApplicant("unit", 4).profile.autoApply.maxApplicationsPerCampaign, 4);
});
