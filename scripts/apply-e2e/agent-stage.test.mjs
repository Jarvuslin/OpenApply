import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageBudgetedPlugin } from "./agent-stage.mjs";
import { assertSourceStage } from "./source-stage.mjs";

test("only copied agent definitions gain bounded turns with retained source provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bounded-plugin-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "agents"), { recursive: true });
  const original = "---\nname: job-worker\nmaxTurns: 100\nmodel: sonnet\n---\nKeep every review.\n";
  await writeFile(path.join(source, "agents/job-worker.md"), original);
  const stage = await stageBudgetedPlugin({ source, directory: path.join(root, "copy") }, 20);
  assert.equal(await readFile(path.join(source, "agents/job-worker.md"), "utf8"), original);
  const copy = await readFile(path.join(root, "copy/agents/job-worker.md"), "utf8");
  assert.equal((copy.match(/maxTurns:/g) ?? []).length, 1);
  assert.match(copy, /maxTurns: 20/);
  assert.match(copy, /Keep every review/);
  assert.notEqual(stage.transforms[0].originalSha256, stage.transforms[0].stagedSha256);
  await assertSourceStage(stage);
});

test("queue fixture staging denies mail connectors while retaining installed settings and source inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mail-isolated-plugin-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "agents"), { recursive: true });
  await mkdir(path.join(source, "settings"));
  await writeFile(
    path.join(source, "agents/job-worker.md"),
    "---\nname: job-worker\nmodel: sonnet\n---\nUse the owned browser.\n",
  );
  const original = JSON.stringify({
    model: "sonnet",
    permissions: { deny: ["Read(~/.ssh/**)"] },
    autoMode: { environment: ["Keep existing policy"] },
  });
  await writeFile(path.join(source, "settings/claude.json"), original);
  const stage = await stageBudgetedPlugin({ source, directory: path.join(root, "copy") }, 20, {
    denyFixtureMail: true,
  });
  assert.equal(await readFile(path.join(source, "settings/claude.json"), "utf8"), original);
  const settings = JSON.parse(
    await readFile(path.join(stage.directory, "settings/claude.json"), "utf8"),
  );
  assert.deepEqual(settings.permissions.deny, ["Read(~/.ssh/**)", "mcp__*gmail*", "mcp__*Gmail*"]);
  assert.equal(settings.model, "sonnet");
  assert.deepEqual(settings.autoMode.environment, ["Keep existing policy"]);
  const transform = stage.transforms.find((item) => item.path === "settings/claude.json");
  assert.equal(transform.purpose, "synthetic-fixture-deny-mail-connectors");
  assert.notEqual(transform.originalSha256, transform.stagedSha256);
  await assertSourceStage(stage);
});
