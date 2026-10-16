import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveSubmissionPdf, submissionPdfPath, verifySubmissionPdf } from "./submission-files";
import { afterEach, describe, expect, it } from "bun:test";

const jobId = "11111111-1111-4111-8111-111111111111";
const otherJobId = "22222222-2222-4222-8222-222222222222";
const bytes = Buffer.from("%PDF-1.4\nretained exact test bytes\n%%EOF");
const roots: string[] = [];
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), "openapply-submission-test-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true });
});

describe("immutable submitted PDF", () => {
  it("retains exact bytes, reports their hash and reuses identical uploads", async () => {
    const dir = await root();
    const file = new File([bytes], "original.pdf", { type: "application/pdf" });
    const resume = await saveSubmissionPdf(dir, "owner", jobId, file);
    expect(resume.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await readFile(submissionPdfPath(dir, "owner", resume))).toEqual(bytes);
    expect(await saveSubmissionPdf(dir, "owner", jobId, file)).toEqual(resume);
    await verifySubmissionPdf(dir, "owner", jobId, resume);
  });

  it("isolates artifacts by owner and job", async () => {
    const dir = await root();
    const resume = await saveSubmissionPdf(dir, "owner", jobId, new File([bytes], "resume.pdf"));
    await expect(verifySubmissionPdf(dir, "other-user", jobId, resume)).rejects.toMatchObject({
      status: 404,
    });
    await expect(verifySubmissionPdf(dir, "owner", otherJobId, resume)).rejects.toMatchObject({
      status: 422,
    });
  });

  it("rejects non-PDF, oversized files and corrupted retained bytes", async () => {
    const dir = await root();
    await expect(
      saveSubmissionPdf(dir, "owner", jobId, new File(["not a PDF"], "fake.pdf")),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveSubmissionPdf(
        dir,
        "owner",
        jobId,
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.pdf"),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const resume = await saveSubmissionPdf(dir, "owner", jobId, new File([bytes], "resume.pdf"));
    await writeFile(submissionPdfPath(dir, "owner", resume), "corrupt");
    await expect(verifySubmissionPdf(dir, "owner", jobId, resume)).rejects.toMatchObject({
      status: 422,
    });
  });
});
