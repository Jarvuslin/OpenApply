import { Elysia } from "elysia";
import { signAccessToken } from "@/common/auth/tokens";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { campaignJobController } from "@/modules/campaign/jobs/job.controller";
import { httpErrorResponses } from "@/types/response";
import { SubmissionAttemptService } from "./submission-attempt.service";
import {
  ATTEMPT_CAMPAIGN,
  ATTEMPT_LEASE,
  ATTEMPT_USER,
  ATTEMPT_WORK,
  attemptFixture,
  checkpointInput,
} from "./submission-attempt-fakes";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .use(campaignJobController);
const service = container.resolve(SubmissionAttemptService);
let f = attemptFixture();
let restore: (() => void)[] = [];
beforeEach(() => {
  f = attemptFixture();
  for (const method of [
    "read",
    "checkpoint",
    "begin",
    "receipt",
    "pdf",
    "checkWorkerResult",
  ] as const) {
    const mocked = spyOn(service, method).mockImplementation(
      f.service[method].bind(f.service) as never,
    );
    restore.push(() => mocked.mockRestore());
  }
});
afterEach(() => {
  for (const revert of restore) revert();
  restore = [];
});

async function request(path: string, body?: unknown, authenticated = true) {
  const token = await signAccessToken({
    id: ATTEMPT_USER,
    role: "USER",
    email: "checkpoint@example.test",
  });
  return app.handle(
    new Request(`http://localhost/campaigns/${ATTEMPT_CAMPAIGN}/jobs/job/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-openapply-work-item": ATTEMPT_WORK,
        "x-openapply-work-lease": ATTEMPT_LEASE,
        ...(authenticated && { authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  );
}

describe("shipped submission state routes", () => {
  it("serializes full durable checkpoint and receipt and streams the prepared PDF", async () => {
    const saved = await request("submission-checkpoint", checkpointInput());
    expect(saved.status).toBe(200);
    const { attempt } = (await saved.json()) as { attempt: { checkpointId: string } };
    expect(attempt).toMatchObject({
      state: "prepared",
      checkpoint: {
        fields: [{ id: "name" }],
        review: { checks: { factualClaims: true } },
        job: { title: "Engineer" },
      },
    });
    const begin = await request("submission-begin", { checkpointId: attempt.checkpointId });
    expect(begin.status).toBe(200);
    expect(await begin.json()).toMatchObject({ began: true });
    const receipt = {
      checkpointId: attempt.checkpointId,
      confirmation: {
        url: "https://employer.test/thanks",
        text: "Application received",
        observedAt: new Date().toISOString(),
      },
    };
    const response = await request("submission-receipt", receipt);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      attempt: { state: "recording_pending", receipt },
    });
    expect((await request("submission-attempt")).status).toBe(200);
    expect(await (await request(`submission-checkpoints/${attempt.checkpointId}/pdf`)).text()).toBe(
      "%PDF-retained",
    );
  });

  it("authenticates all new routes before disclosing checkpoint or receipt data", async () => {
    for (const [path, body] of [
      ["submission-attempt", undefined],
      ["submission-checkpoint", checkpointInput()],
      ["submission-begin", { checkpointId: crypto.randomUUID() }],
      [
        "submission-receipt",
        {
          checkpointId: crypto.randomUUID(),
          confirmation: {
            url: "https://employer.test/thanks",
            text: "Received",
            observedAt: new Date().toISOString(),
          },
        },
      ],
      ["worker-result-check", { outcome: "failed", failReason: "Stopped before submit" }],
      [`submission-checkpoints/${crypto.randomUUID()}/pdf`, undefined],
    ] as const)
      expect((await request(path, body, false)).status).toBe(401);
    expect(f.state.attempts).toHaveLength(0);
  });

  it("rejects guessed success and unknown keys, and checks durable worker state", async () => {
    expect(
      (await request("worker-result-check", { outcome: "applied", submitted: true })).status,
    ).toBe(422);
    expect(
      (
        await request("worker-result-check", {
          outcome: "recorded",
          checkpointId: crypto.randomUUID(),
          applicationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("submission-checkpoint", {
          ...checkpointInput(),
          confirmation: { text: "Already received" },
        })
      ).status,
    ).toBe(422);
    const stopped = await request("worker-result-check", {
      outcome: "failed",
      failReason: "Stopped before Submit",
    });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ valid: true, outcome: "failed", attempt: null });
  });
});
