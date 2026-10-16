import { createAutosaveWriter } from "./autosave-writer";
import { expect, test } from "bun:test";

test("retry writes the same failed draft without requiring another edit", async () => {
  const writes: string[] = [];
  const states: string[] = [];
  const writer = createAutosaveWriter(
    async (value: string) => {
      writes.push(value);
      if (writes.length === 1) throw new Error("Offline");
    },
    (state) => states.push(state),
  );
  writer.change("latest draft");
  await writer.flush();
  expect(states.at(-1)).toBe("error");
  await writer.flush();
  expect(writes).toEqual(["latest draft", "latest draft"]);
  expect(states.at(-1)).toBe("saved");
});

test("an older failed request never replaces a newer unsaved draft", async () => {
  let rejectFirst: (error: Error) => void = () => {};
  const writes: string[] = [];
  const writer = createAutosaveWriter(
    (value: string) => {
      writes.push(value);
      if (writes.length === 1)
        return new Promise<void>((_, reject) => {
          rejectFirst = reject;
        });
      return Promise.resolve();
    },
    () => {},
  );
  writer.change("old draft");
  const first = writer.flush();
  writer.change("new draft");
  rejectFirst(new Error("Offline"));
  await first;
  await writer.flush();
  expect(writes).toEqual(["old draft", "new draft"]);
});

test("a flush during a save waits and writes the newer draft last", async () => {
  let finishFirst = () => {};
  const writes: string[] = [];
  const writer = createAutosaveWriter(
    (value: string) => {
      writes.push(value);
      if (writes.length === 1)
        return new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      return Promise.resolve();
    },
    () => {},
  );
  writer.change("first");
  const first = writer.flush();
  writer.change("second");
  const second = writer.flush();
  expect(writes).toEqual(["first"]);
  finishFirst();
  await Promise.all([first, second]);
  expect(writes).toEqual(["first", "second"]);
});
