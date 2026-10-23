import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNodeTestInventory, discoverNodeTests, selectNodeTests } from "./inventory.mjs";
import { NODE_TEST_GROUPS } from "./manifest.mjs";

test("every repository Node test has one explicit execution classification", () => {
  const files = discoverNodeTests();
  assertNodeTestInventory(files);
  assert.throws(() => assertNodeTestInventory([...files, "scripts/new.test.mjs"].sort()));
  assert.throws(() => assertNodeTestInventory(files.slice(1)));
  assert.throws(() =>
    assertNodeTestInventory(files, { ...NODE_TEST_GROUPS, duplicate: NODE_TEST_GROUPS.local }),
  );
});

test("default selection cannot import guest or browser tests even on a configured host", () => {
  const selected = selectNodeTests([]);
  assert.equal(selected.group, "local");
  for (const file of [...NODE_TEST_GROUPS.browser.files, ...NODE_TEST_GROUPS["guest-host"].files])
    assert.equal(selected.files.includes(file), false);
  assert.deepEqual(
    selectNodeTests(["--group=browser"]).files,
    [...NODE_TEST_GROUPS.browser.files].sort(),
  );
  assert.deepEqual(
    selectNodeTests(["--group=guest-host"]).files,
    [...NODE_TEST_GROUPS["guest-host"].files].sort(),
  );
  assert.throws(() => selectNodeTests(["--group=all"]));
  assert.throws(() => selectNodeTests(["--prefix=../outside"]));
  assert.throws(() => selectNodeTests(["--prefix=plugin/bin/worker-browser"]));
  assert.equal(selectNodeTests(["--list", "--prefix=scripts/node-tests/"]).list, true);
});
