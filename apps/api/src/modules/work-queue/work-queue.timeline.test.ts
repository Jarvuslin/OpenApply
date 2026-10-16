import { buildTimeline } from "./work-queue.timeline";
import { describe, expect, it } from "bun:test";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 10, 12, minute));

describe("application timeline", () => {
  it("tells a submitted application's story in order", () => {
    const entries = buildTimeline({
      item: {
        createdAt: at(5),
        updatedAt: at(40),
        state: "submitted",
        reason: null,
        source: "user",
      },
      job: { title: "Engineer", company: "Acme", board: "ashby", createdAt: at(0), score: 61 },
      runs: [
        { startedAt: at(10), finishedAt: at(12), summary: "Needs your street address." },
        { startedAt: at(30), finishedAt: at(40), summary: "Done." },
      ],
      asked: [{ at: at(12), count: 2 }],
      answered: [{ at: at(20), count: 2 }],
      attempt: {
        createdAt: at(35),
        startedAt: at(36),
        receiptStoredAt: at(37),
        confirmation: "Your application has been submitted!",
      },
    });
    expect(entries.map((entry) => entry.kind)).toEqual([
      "found",
      "scored",
      "queued",
      "started",
      "stopped",
      "asked",
      "answered",
      "started",
      "reviewed",
      "submitting",
      "confirmed",
    ]);
    expect(entries.find((entry) => entry.kind === "stopped")?.detail).toBe(
      "Needs your street address.",
    );
    expect(entries.find((entry) => entry.kind === "queued")?.automated).toBe(false);
  });

  it("ends with what it waits on", () => {
    const entries = buildTimeline({
      item: {
        createdAt: at(0),
        updatedAt: at(9),
        state: "needs_user",
        reason: "Answer two questions",
        source: "discovery",
      },
      job: null,
      runs: [],
      asked: [],
      answered: [],
      attempt: null,
    });
    expect(entries.at(-1)).toMatchObject({ kind: "waiting", detail: "Answer two questions" });
    expect(entries[0]).toMatchObject({ kind: "queued", automated: true });
  });
});
