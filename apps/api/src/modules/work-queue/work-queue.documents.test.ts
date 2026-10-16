import { preparationFixture } from "@/modules/application-question/preparation-fakes";
import { describe, expect, it } from "bun:test";

describe("preclaim document integrity", () => {
  it("makes disk corruption a durable visible blocker before any execution reservation", async () => {
    const f = await preparationFixture();
    const question = f.snapshot.questions[0];
    await f.preparation.selectDocument(f.userId, question.id, f.select(), "session_user");
    expect(f.workItems[0].state).toBe("queued");
    f.integrity.corrupt = true;
    expect(await f.queue.claim(f.userId)).toBeNull();
    expect(f.workExecutions).toHaveLength(0);
    expect(f.documentSelections[0].invalidatedAt).toBeInstanceOf(Date);
    expect(f.workItems[0].state).toBe("needs_user");
    expect(f.applicationQuestions[0].blocking).toBe(true);
    f.integrity.corrupt = false;
    await expect(
      f.queue.control(f.userId, String(f.workItems[0].id), "resume"),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.documentSelections).toHaveLength(1);
  });
});
