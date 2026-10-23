import { workspaceDestination } from "./workspace-destination";
import { describe, expect, test } from "bun:test";

describe("existing workspace links", () => {
  test("application bookmarks retain filters and keep their filters", () => {
    expect(
      workspaceDestination({
        tab: "applications",
        group: "interviewing",
        board: "Greenhouse",
        page: "2",
      }),
    ).toBe("/applications?group=interviewing&board=Greenhouse&page=2");
  });

  test("old conversation links open the queue", () => {
    expect(workspaceDestination({})).toBe("/queue");
  });

  test("the former overview opens the dashboard", () => {
    expect(workspaceDestination({ tab: "overview" })).toBe("/dashboard");
  });
});
