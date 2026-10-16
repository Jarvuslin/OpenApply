import { Elysia } from "elysia";
import { signAccessToken } from "@/common/auth/tokens";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { httpErrorResponses } from "@/types/response";
import { assessFit } from "./assessment";
import { CAMPAIGN_ID, JOB_KEY, scoringContext, scoringInput } from "./fakes";
import { scoringController } from "./scoring.controller";
import { ScoringService } from "./scoring.service";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

const userId = "99999999-9999-4999-8999-999999999999";
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .use(scoringController);
const service = container.resolve(ScoringService);
const context = scoringContext();
const assessment = assessFit(context, scoringInput(context));
let contextCall: ReturnType<typeof spyOn<typeof service, "context">>;
let scoreCall: ReturnType<typeof spyOn<typeof service, "scoreJobFit">>;

beforeEach(() => {
  contextCall = spyOn(service, "context").mockResolvedValue(context);
  scoreCall = spyOn(service, "scoreJobFit").mockResolvedValue(assessment);
});
afterEach(() => {
  contextCall.mockRestore();
  scoreCall.mockRestore();
});

async function request(path: string, body: unknown, authenticated = true) {
  const token = await signAccessToken({ id: userId, role: "USER", email: "scoring@example.test" });
  return app.handle(
    new Request(`http://localhost/score-fit${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authenticated && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("original-fit scoring routes", () => {
  it("serializes complete context, including original text, criteria, preferences and saved location/type", async () => {
    const input = { campaignId: CAMPAIGN_ID, jobKey: JOB_KEY };
    const response = await request("/context", input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(context);
    expect(contextCall).toHaveBeenCalledWith(userId, input);
  });

  it("serializes complete evidence and forwards the authenticated principal to scoring", async () => {
    const input = scoringInput(context);
    const response = await request("/", input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(assessment);
    expect(scoreCall).toHaveBeenCalledWith(userId, input);
  });

  it("rejects legacy profile, digest and caller score fields before the service", async () => {
    for (const extra of [
      { profile: { skills: ["invented"] } },
      { digest: { requirements: [] } },
      { score: 100 },
    ]) {
      const response = await request("/", { ...scoringInput(context), ...extra });
      expect(response.status).toBe(422);
    }
    expect(scoreCall).not.toHaveBeenCalled();
  });

  it("requires authentication for both source context and scoring", async () => {
    expect(
      (await request("/context", { campaignId: CAMPAIGN_ID, jobKey: JOB_KEY }, false)).status,
    ).toBe(401);
    expect((await request("/", scoringInput(context), false)).status).toBe(401);
    expect(contextCall).not.toHaveBeenCalled();
    expect(scoreCall).not.toHaveBeenCalled();
  });
});
