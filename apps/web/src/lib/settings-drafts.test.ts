import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { settingsDrafts } from "./settings-drafts";
import { afterEach, expect, test } from "bun:test";

afterEach(() => settingsDrafts.clear());

test("returning to Settings preserves invalid unsaved edits and their saved baseline", () => {
  settingsDrafts.write("first", {
    baseline: USER_DEFAULT_VALUES,
    values: { ...USER_DEFAULT_VALUES, contactEmail: "unfinished@" },
  });
  const restored = settingsDrafts.read("first");
  expect(restored?.values.contactEmail).toBe("unfinished@");
  expect(restored?.baseline.contactEmail).toBe(USER_DEFAULT_VALUES.contactEmail);
  expect(settingsDrafts.read("second")).toBeUndefined();
  if (restored) restored.values.contactEmail = "changed";
  expect(settingsDrafts.read("first")?.values.contactEmail).toBe("unfinished@");
});

test("saving or discarding clears only that account; an auth boundary clears every draft", () => {
  const draft = { baseline: USER_DEFAULT_VALUES, values: USER_DEFAULT_VALUES };
  settingsDrafts.write("first", draft);
  settingsDrafts.write("second", draft);
  settingsDrafts.delete("first");
  expect(settingsDrafts.read("first")).toBeUndefined();
  expect(settingsDrafts.read("second")).toBeDefined();
  settingsDrafts.clear();
  expect(settingsDrafts.read("second")).toBeUndefined();
});

test("a save completed after leaving Settings clears the saved draft before returning", async () => {
  const values = { ...USER_DEFAULT_VALUES, firstName: "Saved" };
  settingsDrafts.write("first", { baseline: USER_DEFAULT_VALUES, values });
  const save = settingsDrafts.beginSave("first", values);
  const response = Promise.withResolvers<void>();
  const completed = response.promise.then(() => settingsDrafts.completeSave(save));
  response.resolve();
  await completed;
  expect(settingsDrafts.read("first")).toBeUndefined();
  expect(settingsDrafts.readSaved("first", 0)).toEqual(values);
});

test("returning before a save completes receives its baseline without losing newer edits", async () => {
  const saved = { ...USER_DEFAULT_VALUES, firstName: "Submitted" };
  settingsDrafts.write("first", { baseline: USER_DEFAULT_VALUES, values: saved });
  const save = settingsDrafts.beginSave("first", saved);
  const response = Promise.withResolvers<void>();
  const completed = response.promise.then(() => settingsDrafts.completeSave(save));
  const newer = { ...saved, firstName: "Edited after returning" };
  settingsDrafts.write("first", { baseline: USER_DEFAULT_VALUES, values: newer });
  let received: string | undefined;
  const unsubscribe = settingsDrafts.subscribe("first", (baseline) => {
    received = baseline.firstName;
  });
  response.resolve();
  await completed;
  expect(received).toBe("Submitted");
  expect(settingsDrafts.read("first")?.baseline).toEqual(saved);
  expect(settingsDrafts.read("first")?.values).toEqual(newer);
  unsubscribe();
});

test("old save completions and form subscriptions cannot change a new authentication session", async () => {
  const oldGeneration = settingsDrafts.generation();
  const oldValues = { ...USER_DEFAULT_VALUES, firstName: "Old session" };
  const save = settingsDrafts.beginSave("first", oldValues);
  const response = Promise.withResolvers<void>();
  const completed = response.promise.then(() => settingsDrafts.completeSave(save));
  let notified = false;
  settingsDrafts.subscribe("first", () => {
    notified = true;
  });
  settingsDrafts.clear();
  const newer = { ...USER_DEFAULT_VALUES, firstName: "New session" };
  settingsDrafts.write("first", { baseline: USER_DEFAULT_VALUES, values: newer });
  settingsDrafts.write(
    "first",
    { baseline: USER_DEFAULT_VALUES, values: oldValues },
    oldGeneration,
  );
  settingsDrafts.delete("first", oldGeneration);
  response.resolve();
  expect(await completed).toBe(false);
  expect(notified).toBe(false);
  expect(settingsDrafts.read("first")?.values).toEqual(newer);
  expect(settingsDrafts.readSaved("first", 0)).toBeUndefined();
});

test("a completed snapshot is isolated from caller edits and only notifies its account", () => {
  const values = { ...USER_DEFAULT_VALUES, firstName: "Submitted" };
  const save = settingsDrafts.beginSave("first", values);
  values.firstName = "Changed later";
  let first: string | undefined;
  let second = false;
  settingsDrafts.subscribe("first", (saved) => {
    first = saved.firstName;
  });
  settingsDrafts.subscribe("second", () => {
    second = true;
  });
  settingsDrafts.completeSave(save);
  expect(first).toBe("Submitted");
  expect(second).toBe(false);
});

test("a fresh server result supersedes the successful snapshot retained during refetch", () => {
  const values = { ...USER_DEFAULT_VALUES, firstName: "Saved while away" };
  settingsDrafts.completeSave(settingsDrafts.beginSave("first", values));
  expect(settingsDrafts.readSaved("first", 0)).toEqual(values);
  expect(settingsDrafts.readSaved("first", Number.MAX_SAFE_INTEGER)).toBeUndefined();
  expect(settingsDrafts.readSaved("second", 0)).toBeUndefined();
  settingsDrafts.clear();
  expect(settingsDrafts.readSaved("first", 0)).toBeUndefined();
});
