// Exercises the shipped Elysia route; only the storage service is replaced, so no DB or files are written.
import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { signAccessToken } from "@/common/auth/tokens";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { SubmissionService } from "@/modules/application/submission.service";
import { httpErrorResponses } from "@/types/response";
import { campaignJobController } from "./job.controller";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

const userId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const bytes = Buffer.from("%PDF-1.4\nexact submitted bytes\n%%EOF");
const metadata = {
  jobId,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  filename: "resume.pdf",
};
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(campaignJobController));
const submissions = container.resolve(SubmissionService);
let upload: ReturnType<typeof spyOn<typeof submissions, "uploadResume">>;

beforeEach(() => {
  upload = spyOn(submissions, "uploadResume").mockResolvedValue(metadata);
});
afterEach(() => upload.mockRestore());

async function request(form: FormData, authenticated = true) {
  const token = await signAccessToken({
    id: userId,
    role: "USER",
    email: "applicant@example.test",
  });
  return app.handle(
    new Request(`http://localhost/api/campaigns/${campaignId}/jobs/test-job/submission-resume`, {
      method: "POST",
      headers: authenticated ? { authorization: `Bearer ${token}` } : {},
      body: form,
    }),
  );
}

describe("submission resume multipart route", () => {
  it("parses the multipart body once and passes unchanged PDF bytes to owned storage", async () => {
    const form = new FormData();
    form.set("file", new File([bytes], metadata.filename, { type: "application/pdf" }));
    const response = await request(form);
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: metadata,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    const [owner, campaign, key, file] = upload.mock.calls[0]!;
    expect({ owner, campaign, key, filename: file.name }).toEqual({
      owner: userId,
      campaign: campaignId,
      key: "test-job",
      filename: metadata.filename,
    });
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a missing file without calling storage", async () => {
    const form = new FormData();
    form.set("file", "not a file");
    const response = await request(form);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "file field is required" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("requires authentication before invoking storage", async () => {
    const form = new FormData();
    form.set("file", new File([bytes], metadata.filename));
    const response = await request(form, false);
    expect(response.status).toBe(401);
    expect(upload).not.toHaveBeenCalled();
  });
});
