import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSourceStage, stageSourceTree } from "./source-stage.mjs";

export async function stageBudgetedPlugin(
  config,
  maxWorkerTurns,
  { denyFixtureMail = false } = {},
) {
  if (!Number.isSafeInteger(maxWorkerTurns) || maxWorkerTurns < 1 || maxWorkerTurns > 200)
    throw new Error("A finite worker-turn limit is required before staging an agent.");
  const stage = await stageSourceTree({ ...config, name: "plugin" });
  const changes = [];
  for (const entry of stage.files.filter((file) => /^agents\/[^/]+\.md$/.test(file.path))) {
    const filename = path.join(stage.directory, entry.path);
    const original = await readFile(filename, "utf8");
    const match = original.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error("Cannot bound an agent without valid frontmatter.");
    const header = match[1].replace(/^maxTurns:.*(?:\r?\n|$)/gm, "").trimEnd();
    const content = Buffer.from(
      `---\n${header}\nmaxTurns: ${maxWorkerTurns}\n---\n${original.slice(match[0].length)}`,
    );
    const originalSha256 = entry.sha256;
    await writeFile(filename, content);
    entry.bytes = content.length;
    entry.sha256 = createHash("sha256").update(content).digest("hex");
    changes.push({ path: entry.path, originalSha256, stagedSha256: entry.sha256, maxWorkerTurns });
  }
  if (changes.length === 0) throw new Error("No bounded agent definitions were staged.");
  if (denyFixtureMail) {
    const entry = stage.files.find((file) => file.path === "settings/claude.json");
    if (!entry) throw new Error("Fixture mail isolation requires explicit staged Claude settings.");
    const filename = path.join(stage.directory, entry.path);
    const settings = JSON.parse(await readFile(filename, "utf8"));
    if (
      !Array.isArray(settings.permissions?.deny) ||
      settings.permissions.deny.some((item) => typeof item !== "string")
    )
      throw new Error("Fixture mail isolation cannot replace invalid permission settings.");
    const deniedTools = ["mcp__*gmail*", "mcp__*Gmail*"];
    settings.permissions.deny = [...new Set([...settings.permissions.deny, ...deniedTools])];
    const originalSha256 = entry.sha256;
    const content = Buffer.from(`${JSON.stringify(settings, null, 2)}\n`);
    await writeFile(filename, content);
    entry.bytes = content.length;
    entry.sha256 = createHash("sha256").update(content).digest("hex");
    changes.push({
      path: entry.path,
      originalSha256,
      stagedSha256: entry.sha256,
      purpose: "synthetic-fixture-deny-mail-connectors",
      deniedTools,
    });
  }
  stage.transforms = changes;
  await assertSourceStage(stage);
  return stage;
}
