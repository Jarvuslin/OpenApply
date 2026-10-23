import { applyItem } from "@/modules/pilot/agenda/items";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";
import { schedulerFixture, schedulerUserId as userId } from "./work-queue.scheduler.fakes";
import { describe, expect, test } from "bun:test";

function fixture() {
  const f = schedulerFixture([]);
  const rules: { userId: string; companyKey: string; active: boolean }[] = [];
  const controls = { failRuleRead: false };
  const originalQuery = f.db.$queryRaw.bind(f.db);
  Object.assign(f.db, {
    $queryRaw: async (template: TemplateStringsArray, ...values: unknown[]) => {
      const result = await originalQuery(template, ...values);
      if (!template.join("?").includes("FROM application_rules")) return result;
      expect(f.locks[0]?.slice(1)).toEqual([userId]);
      expect((f.locks[0][0] as TemplateStringsArray).join("?")).toContain("FOR UPDATE");
      if (controls.failRuleRead) throw new Error("Rule storage unavailable");
      const [owner, companyKey] = values;
      return rules
        .filter((rule) => rule.userId === owner && rule.companyKey === companyKey && rule.active)
        .slice(0, 1)
        .map(() => ({ id: "persisted-exclusion" }));
    },
  });
  const addJob = (company: string, owner = userId, campaignStatus = "in_progress") => {
    const campaign = { campaignId: crypto.randomUUID(), userId: owner, status: campaignStatus };
    const job = {
      id: crypto.randomUUID(),
      key: crypto.randomUUID(),
      campaignId: campaign.campaignId,
      campaign,
      status: "approved",
      intakeDecisionRequired: false,
      title: "Synthetic application candidate",
      company,
      url: `https://queue.example.test/jobs/${crypto.randomUUID()}`,
      matchScore: 90,
      board: null,
      digest: null,
    };
    f.campaigns.push(campaign);
    f.jobs.push(job);
    f.agenda.items.push(applyItem(job));
    return job;
  };
  const exclude = (company: string, owner = userId, active = true) =>
    rules.push({ userId: owner, companyKey: normalizeCompanyName(company), active });
  return { ...f, addJob, exclude, rules, policyControls: controls };
}

describe("Pilot application admission with company exclusions", () => {
  for (const excludedFirst of [true, false]) {
    test(`an excluded approved job does not roll back healthy admission (excluded first: ${excludedFirst})`, async () => {
      const f = fixture();
      const companies = excludedFirst
        ? ["Excluded Co", "Healthy Co"]
        : ["Healthy Co", "Excluded Co"];
      const jobs = companies.map((company) => f.addJob(company));
      f.exclude("Excluded Co");
      const excluded = jobs.find((job) => job.company === "Excluded Co")!;
      const healthy = jobs.find((job) => job.company === "Healthy Co")!;

      expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 1 });
      expect(f.workItems).toHaveLength(1);
      expect(f.workItems[0]).toMatchObject({
        userId,
        jobId: healthy.id,
        kind: "application",
        source: "pilot",
        provider: "codex",
        state: "queued",
      });
      expect(f.workRequests).toHaveLength(1);
      expect(excluded.status).toBe("approved");
      expect(f.applications).toHaveLength(0);
      expect(f.submissions).toHaveLength(0);
      expect(f.workExecutions).toHaveLength(0);
      f.nextCycle();
      expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 0 });
      expect(f.workItems).toHaveLength(1);
    });
  }

  test("rechecks a rule saved after the agenda was prepared under the user lock", async () => {
    const f = fixture();
    f.addJob("Excluded Co");
    const healthy = f.addJob("Healthy Co");
    f.controls.onRefresh = () => f.exclude("Excluded Co");
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 1 });
    expect(f.workItems[0].jobId).toBe(healthy.id);
  });

  test("only active rules owned by this user exclude an exact normalized company", async () => {
    const f = fixture();
    f.addJob("Example Corporation");
    f.addJob("Inactive Company");
    f.addJob("Foreign Company");
    f.addJob("Similar Company Labs");
    f.exclude("Example Corp.");
    f.exclude("Inactive Company", userId, false);
    f.exclude("Foreign Company", crypto.randomUUID());
    f.exclude("Similar Company");
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 3 });
    expect(f.workItems.map((item) => item.company)).toEqual([
      "Inactive Company",
      "Foreign Company",
      "Similar Company Labs",
    ]);
  });

  test("Undo permits later admission while existing failed work is never automatically retried", async () => {
    const f = fixture();
    const excluded = f.addJob("Excluded Co");
    f.exclude(excluded.company);
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 0 });
    f.rules[0].active = false;
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 1 });
    f.workItems[0].state = "failed";
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 0 });
    expect(f.workItems[0].state).toBe("failed");
  });

  test("retains ownership, campaign and cap filters", async () => {
    const f = fixture();
    f.addJob("Foreign", crypto.randomUUID());
    f.addJob("Paused", userId, "paused");
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 0 });
    f.addJob("Healthy");
    f.agenda.budget.capReached = true;
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "claude")).toEqual({ enqueued: 0 });
    expect(f.workItems).toHaveLength(0);
  });

  test("manual enqueue still rejects excluded companies", async () => {
    const f = fixture();
    const job = f.addJob("Excluded Co");
    f.exclude(job.company);
    await expect(
      f.queue.enqueue(userId, {
        idempotencyKey: crypto.randomUUID(),
        jobIds: [job.id],
        source: "user",
        provider: "claude",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.workItems).toHaveLength(0);
  });

  test("does not swallow unrelated enqueue errors or retain earlier partial admission", async () => {
    const f = fixture();
    f.addJob("Healthy");
    f.addJob("Pending user decision").intakeDecisionRequired = true;
    await expect(f.scheduler.schedule(userId, "claude")).rejects.toMatchObject({ status: 409 });
    expect(f.workItems).toHaveLength(0);
    expect(f.workRequests).toHaveLength(0);
  });

  test("policy storage failures propagate instead of being treated as an allowed or excluded job", async () => {
    const f = fixture();
    f.addJob("Healthy");
    f.policyControls.failRuleRead = true;
    await expect(f.scheduler.schedule(userId, "claude")).rejects.toThrow(
      "Rule storage unavailable",
    );
    expect(f.workItems).toHaveLength(0);
  });
});
