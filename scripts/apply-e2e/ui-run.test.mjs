import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { environmentRequirements } from "./environment-preflight.mjs";
import { uiFailureRouteAllowed, uiRequestAllowed } from "./observe-ui.mjs";
import { assertSeparateUiOutput, uiOptions } from "./ui-run.mjs";

test("model-free capabilities never request a provider or .NET command", () => {
  const capabilities = environmentRequirements("ui");
  assert.deepEqual(capabilities.commands, ["node", "bun"]);
  assert.equal(capabilities.provider, false);
  assert.deepEqual(capabilities.ports, [14100, 14101, 15433, 19222]);
  assert.throws(() => environmentRequirements("typo"));
});

test("UI runner requires explicit preserved input and a separate output, with no model launch options", () => {
  assert.throws(() => uiOptions([]), /source-dir/);
  assert.equal(uiOptions(["--check"]).check, true);
  assert.equal(uiOptions(["--source-dir", "source", "--infra-only"]).infraOnly, true);
  assert.throws(
    () => uiOptions(["--source-dir", "source", "--evidence-dir", "source/replay"]),
    /must not overlap/,
  );
  assert.throws(
    () => uiOptions(["--source-dir", "output/source", "--evidence-dir", "output"]),
    /must not overlap/,
  );
  assert.throws(() => uiOptions(["--source-dir", "source", "--provider", "claude"]), /Unknown/);
  assert.throws(() => uiOptions(["--source-dir", "source", "--run-id", "../outside"]), /Invalid/);
});

test("UI browser permits local reads and normal login while rejecting model, submission and external traffic", () => {
  const config = { webUrl: "http://127.0.0.1:14100", apiUrl: "http://127.0.0.1:14101" };
  for (const [method, address] of [
    ["GET", `${config.webUrl}/applications`],
    ["GET", `${config.apiUrl}/api/applied/`],
    ["POST", `${config.apiUrl}/api/auth/login`],
    ["POST", `${config.apiUrl}/api/auth/refresh`],
  ])
    assert.equal(uiRequestAllowed(method, address, config), true);
  for (const [method, address] of [
    ["POST", `${config.apiUrl}/api/applied/`],
    ["PATCH", `${config.apiUrl}/api/profile/`],
    ["POST", `${config.webUrl}/api/auth/login`],
    ["POST", "http://127.0.0.1:14102/inference"],
    ["GET", "http://127.0.0.1:14110/runs/preserved-unit/greenhouse"],
    ["GET", "https://employer.example/apply"],
    ["GET", "http://login:password@127.0.0.1:14101/api/applied/"],
  ])
    assert.equal(uiRequestAllowed(method, address, config), false);
});

test("physical output validation rejects junction aliases of preserved evidence before writes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "openapply-ui-overlap-"));
  const source = path.join(temporary, "source");
  const alias = path.join(temporary, "alias");
  await mkdir(source);
  await symlink(source, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(assertSeparateUiOutput(source, alias), /physically overlap/);
  await assert.rejects(
    assertSeparateUiOutput(source, path.join(alias, "new-output")),
    /physically overlap/,
  );
  await assert.rejects(assertSeparateUiOutput(source, temporary), /physically overlap/);
  await assertSeparateUiOutput(source, path.join(temporary, "new", "separate-output"));
});

test("failure diagnostics are limited to authenticated observation pages, excluding credentials and external pages", () => {
  const webUrl = "http://127.0.0.1:14100";
  for (const route of [
    "/dashboard",
    "/applications",
    "/analytics",
    "/applications/00000000-1111-2222-3333-444444444444",
  ])
    assert.equal(uiFailureRouteAllowed(`${webUrl}${route}`, webUrl), true);
  for (const route of ["/login", "/register", "/settings", "/applications/unrelated"])
    assert.equal(uiFailureRouteAllowed(`${webUrl}${route}`, webUrl), false);
  assert.equal(uiFailureRouteAllowed("https://employer.example/applications", webUrl), false);
});
