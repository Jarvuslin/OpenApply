import { migrateOpenApplyStorage } from "./storage-migration";
import { expect, test } from "bun:test";

function storage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

test("rebrand preserves all account drafts and agent preferences", () => {
  const disk = storage({
    "jobpilot:onboarding:v1:a": "draft-a",
    "jobpilot:onboarding:v1:b": "draft-b",
    "jobpilot:agent": "preferences",
    unrelated: "keep",
  });
  migrateOpenApplyStorage(disk);
  migrateOpenApplyStorage(disk);
  expect(disk.getItem("openapply:onboarding:v1:a")).toBe("draft-a");
  expect(disk.getItem("openapply:onboarding:v1:b")).toBe("draft-b");
  expect(disk.getItem("openapply:agent")).toBe("preferences");
  expect(disk.getItem("jobpilot:agent")).toBeNull();
  expect(disk.getItem("unrelated")).toBe("keep");
});

test("an existing new draft wins without deleting the recovery copy", () => {
  const disk = storage({ "jobpilot:onboarding:v1:a": "old", "openapply:onboarding:v1:a": "new" });
  migrateOpenApplyStorage(disk);
  expect(disk.getItem("openapply:onboarding:v1:a")).toBe("new");
  expect(disk.getItem("jobpilot:onboarding:v1:a")).toBe("old");
});

test("a failed migration write never loses the original draft", () => {
  const disk = storage({ "jobpilot:onboarding:v1:a": "saved" });
  expect(() =>
    migrateOpenApplyStorage({
      ...disk,
      setItem: () => {
        throw new Error("quota");
      },
    }),
  ).toThrow("quota");
  expect(disk.getItem("jobpilot:onboarding:v1:a")).toBe("saved");
});
