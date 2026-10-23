import assert from "node:assert/strict";
import { test } from "node:test";
import { guestScreenshotPath } from "./screenshot.mjs";

test("accepts a PNG the browser saved under its output folder", () => {
  const path = "/home/pilot/openapply/queue-workers/abc/page-2026.png";
  assert.equal(guestScreenshotPath(path), path);
});

test("rejects paths outside the browser output folder", () => {
  for (const path of [
    "/etc/shadow",
    "/home/pilot/openapply/../.ssh/id.png",
    "/home/pilot/openapply/a.jpg",
    "relative.png",
    undefined,
  ])
    assert.throws(() => guestScreenshotPath(path));
});
