import assert from "node:assert/strict";
import { db } from "../src/common/database/prisma.client";
import type { ApplicationQuestionService } from "../src/modules/application-question/application-question.service";
import {
  answerInput,
  definition,
  fixture,
  observation,
  queue,
  uuid,
} from "./question-regression-fixtures";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;

export async function verifyQuestionConditions(service: ApplicationQuestionService, check: Check) {
  await check("conditional sponsorship remains independent of authorization", async () => {
    const f = await fixture("Conditional sponsorship");
    const item = (await f.enqueue()).items[0];
    assert.ok(item);
    const child = definition("sponsorshipDetails", "Explain your sponsorship requirement");
    child.fields = [{ key: "sponsorshipDetails", type: "text", options: [] }];
    child.visibility = "hidden";
    child.condition = {
      state: "known",
      rules: [{ fieldKey: "sponsorship", operator: "equals", values: ["yes"] }],
    };
    await service.observe(
      f.user.id,
      f.job.id,
      observation(f, [
        definition(),
        definition("sponsorship", "Will you need employer sponsorship in Canada?"),
        child,
      ]),
      "agent",
    );
    const questions = (await service.get(f.user.id, f.job.id)).questions;
    const authorization = questions.find((q) => q.definition.stableKey === "authorization");
    const sponsorship = questions.find((q) => q.definition.stableKey === "sponsorship");
    const details = questions.find((q) => q.definition.stableKey === "sponsorshipDetails");
    assert.ok(authorization && sponsorship && details);
    await service.answer(
      f.user.id,
      authorization.id,
      answerInput(authorization, "yes"),
      "session_user",
    );
    assert.equal((await service.count(f.user.id)).application, 2);
    await service.answer(f.user.id, sponsorship.id, answerInput(sponsorship, "no"), "session_user");
    assert.equal((await service.count(f.user.id)).application, 0);
    assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state, "queued");
    await service.answer(
      f.user.id,
      sponsorship.id,
      answerInput(sponsorship, "yes"),
      "session_user",
    );
    assert.equal((await service.count(f.user.id)).application, 1);
    assert.equal(
      (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
      "needs_user",
    );
    assert.equal(await queue.claim(f.user.id), null);
    await service.answer(
      f.user.id,
      details.id,
      answerInput(details, "Synthetic confirmed sponsorship requirement"),
      "session_user",
    );
    assert.equal((await service.count(f.user.id)).application, 0);
    assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state, "queued");
  });
  await check("manual resume cannot bypass unresolved factual questions", async () => {
    const f = await fixture("Manual resume blockers");
    const item = (await f.enqueue()).items[0];
    assert.ok(item);
    await service.observe(f.user.id, f.job.id, observation(f), "agent");
    await assert.rejects(queue.control(f.user.id, item.id, "resume"));
    assert.equal(await queue.claim(f.user.id), null);
  });
  await check(
    "Needs-you counts are exact beyond one page and exclude expired or linked copies",
    async () => {
      const f = await fixture("Attention count");
      await service.observe(f.user.id, f.job.id, observation(f), "agent");
      const q = (await service.get(f.user.id, f.job.id)).questions[0];
      assert.ok(q);
      await db.pilotQuestion.createMany({
        data: Array.from({ length: 205 }, (_, index) => ({
          id: uuid(),
          userId: f.user.id,
          kind: "approval" as const,
          prompt: `Synthetic approval ${index}`,
          options: ["Approve"],
        })),
      });
      await db.pilotQuestion.createMany({
        data: [
          {
            userId: f.user.id,
            kind: "two_factor",
            prompt: "Expired code",
            expiresAt: new Date(0),
            options: [],
          },
          {
            userId: f.user.id,
            kind: "question",
            prompt: q.definition.prompt,
            applicationQuestionId: q.id,
            options: ["Yes", "No"],
          },
        ],
      });
      assert.deepEqual(await service.count(f.user.id), {
        total: 206,
        application: 1,
        operational: 205,
        collection: 0,
      });
      const pages = await Promise.all(
        [1, 2, 3].map((page) => service.list(f.user.id, { page, limit: 100, kind: "all" })),
      );
      assert.ok(pages.every((page) => page.pagination.total === 206));
      assert.equal(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size, 206);
      const applications = await service.list(f.user.id, {
        page: 1,
        limit: 10,
        kind: "application",
      });
      assert.equal(applications.items.length, 1);
      assert.equal(applications.pagination.total, 1);
    },
  );
}
