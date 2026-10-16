import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { questionDefinition, questionFixture } from "@/modules/application-question/fakes";
import { AnswerBankService } from "./answer-bank.service";
import { describe, expect, it } from "bun:test";

async function fixture() {
  const f = questionFixture();
  const bank = new AnswerBankService(f.db);
  const observed = await f.questionsService.observe(f.userId, f.job.id, f.observe(), "agent");
  const source = observed.questions[0];
  const save = {
    ...f.answer(source),
    saveToProfile: {
      consent: true as const,
      scope: "account" as const,
      countryCode: "CA",
      countryConfirmed: true as const,
    },
  };
  async function target(definition: QuestionDefinition = questionDefinition()) {
    const job = { ...f.job, id: crypto.randomUUID(), key: crypto.randomUUID() };
    f.jobs.push(job);
    const next = structuredClone(definition);
    next.stableKey = "new-field";
    next.fields[0].key = "new-field";
    next.fields[0].options = [
      { value: "N", label: "No" },
      { value: "Y", label: "Yes" },
    ];
    const result = await f.questionsService.observe(
      f.userId,
      job.id,
      { ...f.observe(0, [next]), sourceUrl: job.url },
      "agent",
    );
    return result.questions[0];
  }
  const matchInput = (question = source) => ({
    expectedRevision: question.revision,
    expectedDefinitionHash: question.definitionHash,
    countryCode: "CA",
    countryConfirmed: true as const,
  });
  return { ...f, bank, source, save, target, matchInput };
}

describe("confirmed answer bank", () => {
  it("atomically saves consent with a human answer, deduplicates retries and imports no defaults", async () => {
    const f = await fixture();
    expect((await f.bank.list(f.userId, { page: 1, limit: 25, status: "all" })).items).toEqual([]);
    await expect(
      f.questionsService.answer(f.userId, f.source.id, f.save, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    const first = await f.questionsService.answer(f.userId, f.source.id, f.save, "session_user");
    expect(await f.questionsService.answer(f.userId, f.source.id, f.save, "session_user")).toEqual(
      first,
    );
    expect(f.bankEntries).toHaveLength(1);
    expect(f.bankRevisions).toHaveLength(1);
    expect(f.questionAnswers).toHaveLength(1);
    const row = (await f.bank.list(f.userId, { page: 1, limit: 25, status: "active" })).items[0];
    expect(row).toMatchObject({
      available: true,
      countryCode: "CA",
      requiresConfirmation: true,
      sourceAnswerId: first.answer?.id,
    });
    expect(row.sourceConfirmedAt).toBeInstanceOf(Date);
  });
  it("rolls back the answer and bank together when save country/context is invalid", async () => {
    const f = await fixture();
    await expect(
      f.questionsService.answer(
        f.userId,
        f.source.id,
        { ...f.save, saveToProfile: { ...f.save.saveToProfile, countryCode: "ZZ" } },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.bankEntries).toHaveLength(0);
    expect(f.questionAnswers).toHaveLength(0);
    expect((await f.questionsService.get(f.userId, f.job.id)).questions[0].blocking).toBe(true);
  });
  it("maps exact option labels to new IDs but leaves the target unanswered until current human confirmation", async () => {
    const f = await fixture();
    await f.questionsService.answer(f.userId, f.source.id, f.save, "session_user");
    const target = await f.target();
    const result = await f.bank.matches(f.userId, target.id, f.matchInput(target), "session_user");
    expect(result.status).toBe("matched");
    expect(result.matches[0].mappedValues).toEqual([{ fieldKey: "new-field", value: "Y" }]);
    expect(f.questionAnswers).toHaveLength(1);
    const match = result.matches[0];
    const answer = {
      ...f.answer(target, "Y"),
      useSavedAnswer: {
        entryId: match.entryId,
        revision: match.revision,
        countryCode: "CA",
        countryConfirmed: true as const,
      },
    };
    await expect(
      f.questionsService.answer(
        f.userId,
        target.id,
        { ...answer, values: [{ fieldKey: "new-field", value: "N" }] },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 409 });
    const confirmed = await f.questionsService.answer(f.userId, target.id, answer, "session_user");
    expect(confirmed.answer?.confirmedAt).toBeInstanceOf(Date);
    expect(f.questionAnswers[1].usedBankRevisionId).toBe(f.bankRevisions[0].id);
    expect(f.questionAnswers[1].authorship).toBe("session_user");
  });
  it("rejects foreign/agent matching and uncertain countries or opposite questions", async () => {
    const f = await fixture();
    await f.questionsService.answer(f.userId, f.source.id, f.save, "session_user");
    const target = await f.target();
    await expect(
      f.bank.matches(crypto.randomUUID(), target.id, f.matchInput(target), "session_user"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.bank.matches(f.userId, target.id, f.matchInput(target), "agent"),
    ).rejects.toMatchObject({ status: 403 });
    for (const countryCode of [undefined, "US", "ZZ"])
      expect(
        (
          await f.bank.matches(
            f.userId,
            target.id,
            { ...f.matchInput(target), countryCode },
            "session_user",
          )
        ).matches,
      ).toEqual([]);
    const sponsor = questionDefinition();
    sponsor.prompt = "Will you require sponsorship in Canada?";
    const opposite = await f.target(sponsor);
    expect(
      (await f.bank.matches(f.userId, opposite.id, f.matchInput(opposite), "session_user")).matches,
    ).toEqual([]);
  });
  it("rechecks revocation when a loaded draft is confirmed and preserves paginated history", async () => {
    const f = await fixture();
    await f.questionsService.answer(f.userId, f.source.id, f.save, "session_user");
    const target = await f.target();
    const match = (await f.bank.matches(f.userId, target.id, f.matchInput(target), "session_user"))
      .matches[0];
    const revoke = { requestId: crypto.randomUUID(), expectedRevision: match.revision };
    const revoked = await f.bank.revoke(f.userId, match.entryId, revoke, "session_user");
    expect(await f.bank.revoke(f.userId, match.entryId, revoke, "session_user")).toEqual(revoked);
    await expect(
      f.questionsService.answer(
        f.userId,
        target.id,
        {
          ...f.answer(target, "Y"),
          useSavedAnswer: {
            entryId: match.entryId,
            revision: match.revision,
            countryCode: "CA",
            countryConfirmed: true,
          },
        },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.questionAnswers).toHaveLength(1);
    const history = await f.bank.detail(f.userId, match.entryId, { page: 1, limit: 1 });
    expect(history.revisions.pagination.total).toBe(2);
    expect(history.revisions.items).toHaveLength(1);
    expect(history.entry.action).toBe("revoke");
  });
  it("excludes superseded and same-timestamp ambiguous sources until an explicit confirmed correction", async () => {
    const f = await fixture();
    await f.questionsService.answer(f.userId, f.source.id, f.save, "session_user");
    const target = await f.target();
    const entryId = String(f.bankEntries[0].id);
    const correction = await f.questionsService.answer(
      f.userId,
      f.source.id,
      f.answer(f.source, "no"),
      "session_user",
    );
    expect(
      (await f.bank.matches(f.userId, target.id, f.matchInput(target), "session_user")).matches,
    ).toEqual([]);
    const revised = await f.bank.revise(
      f.userId,
      entryId,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        sourceAnswerId: correction.answer!.id,
        consent: true,
        countryConfirmed: true,
      },
      "session_user",
    );
    expect(revised.revision).toBe(2);
    expect(
      (await f.bank.matches(f.userId, target.id, f.matchInput(target), "session_user")).matches[0]
        .mappedValues[0].value,
    ).toBe("N");
    f.questionAnswers[0].createdAt = f.questionAnswers[1].createdAt;
    expect(
      (await f.bank.matches(f.userId, target.id, f.matchInput(target), "session_user")).matches,
    ).toEqual([]);
    expect(
      (await f.bank.list(f.userId, { page: 1, limit: 25, status: "active" })).items[0]
        .unavailableReason,
    ).toContain("ambiguous");
  });
});
