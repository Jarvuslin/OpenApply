import { isNavEntryActive, visibleNavGroups } from "./shell-config";
import { describe, expect, test } from "bun:test";

describe("shared application navigation", () => {
  const items = visibleNavGroups("USER").flatMap((group) => group.items);

  test.each([
    ["/dashboard", "Dashboard"],
    ["/queue", "Queue"],
    ["/needs-you", "Needs you"],
    ["/applications", "Applications"],
    ["/applications/saved-record", "Applications"],
    ["/discover", "Jobs"],
    ["/applications/searches", "Applications"],
    ["/campaigns/search-one", "Applications"],
    ["/analytics/scoring", "Dashboard"],
    ["/documents/resumes", "Profile"],
    ["/resumes/some-id", "Profile"],
  ])("%s selects only %s", (pathname, label) => {
    expect(
      items.filter((item) => isNavEntryActive(pathname, item)).map((item) => item.label),
    ).toEqual([label]);
  });

  test("primary navigation exposes Queue alongside the existing destinations", () => {
    expect(items.map((item) => item.label)).toEqual([
      "Dashboard",
      "Queue",
      "Needs you",
      "Jobs",
      "Pilots",
      "Applications",
      "Profile",
    ]);
  });

  test("similarly prefixed URLs do not select an unrelated destination", () => {
    expect(items.some((item) => isNavEntryActive("/queues", item))).toBe(false);
  });

  test("Queue shows its badge", () => {
    expect(items.find((item) => item.href === "/queue")?.badge).toBe("queue");
  });
});
