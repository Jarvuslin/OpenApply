import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSourceStage,
  createRuntimeWorkspace,
  runtimeWorkspaceParent,
  stageSourceTree,
  webStageExclusions,
} from "./source-stage.mjs";

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "openapply-source-stage-"));
  const source = path.join(temporary, "source");
  const directory = path.join(temporary, "runtime");
  await mkdir(path.join(source, "src/components/workspace"), { recursive: true });
  await writeFile(
    path.join(source, "src/components/workspace/application-history.tsx"),
    "export const history = 'synthetic';\n",
  );
  await writeFile(path.join(source, "tsconfig.json"), '{"compilerOptions":{"strict":true}}\n');
  return { source, directory };
}

test("private source staging preserves every included file and byte hash", async () => {
  const config = await fixture();
  await mkdir(path.join(config.source, ".next"));
  await writeFile(path.join(config.source, ".next/build.log"), "generated");
  await writeFile(path.join(config.source, "next-env.d.ts"), "generated declarations");
  await writeFile(path.join(config.source, ".env"), "PRIVATE_TOKEN=must-not-copy");
  const stage = await stageSourceTree({ name: "web", ...config, excluded: webStageExclusions });
  assert.deepEqual(
    stage.files.map((file) => file.path),
    ["src/components/workspace/application-history.tsx", "tsconfig.json"],
  );
  for (const file of stage.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await readFile(path.join(config.directory, file.path))).length, file.bytes);
  }
  await assert.rejects(readFile(path.join(config.directory, ".env")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(config.directory, ".next/build.log")), {
    code: "ENOENT",
  });
  await assertSourceStage(stage);
});

test("integrity check detects later source deletion, changes, and injected files", async () => {
  for (const corruption of ["missing", "changed", "unexpected"]) {
    const config = await fixture();
    const stage = await stageSourceTree({ name: "web", ...config });
    const target = path.join(config.directory, "src/components/workspace/application-history.tsx");
    if (corruption === "missing") await unlink(target);
    if (corruption === "changed") await writeFile(target, "modified staged code");
    if (corruption === "unexpected")
      await writeFile(path.join(config.directory, "injected.js"), "new code");
    await assert.rejects(
      assertSourceStage(stage),
      new RegExp(`source integrity failed.*${corruption}`),
    );
  }
});

test("root data exclusions preserve nested source modules with the same directory name", async () => {
  const config = await fixture();
  await mkdir(path.join(config.source, "src/common/storage"), { recursive: true });
  await mkdir(path.join(config.source, "storage"));
  await mkdir(path.join(config.source, ".temp"));
  await writeFile(
    path.join(config.source, "src/common/storage/storage.ts"),
    "export const storage = 'source';",
  );
  await writeFile(path.join(config.source, "storage/private.pdf"), "must not copy runtime storage");
  await writeFile(
    path.join(config.source, ".temp/private.log"),
    "must not copy temporary evidence",
  );
  const stage = await stageSourceTree({
    name: "api",
    ...config,
    rootExcluded: ["storage", ".temp"],
  });
  assert.ok(stage.files.some((file) => file.path === "src/common/storage/storage.ts"));
  assert.equal(
    stage.files.some((file) => file.path.startsWith("storage/") || file.path.startsWith(".temp/")),
    false,
  );
  await assertSourceStage(stage);
  await assert.rejects(readFile(path.join(config.directory, "storage/private.pdf")), {
    code: "ENOENT",
  });
});

test("both web and plugin staging exclude every environment file without recording its bytes", async () => {
  for (const name of ["web", "plugin"]) {
    const config = await fixture();
    const environmentFiles = [".env", ".env.local", ".env.production", ".env.production.local"];
    for (const file of environmentFiles)
      await writeFile(path.join(config.source, file), "SECRET=private-value");
    await writeFile(
      path.join(config.source, "src/.env.development"),
      "SECRET=nested-private-value",
    );
    const stage = await stageSourceTree({ name, ...config });
    assert.deepEqual(stage.excludedEnvironmentFiles, [".env", ".env.*"]);
    assert.ok(stage.files.every((file) => !file.path.includes(".env")));
    for (const file of [...environmentFiles, "src/.env.development"])
      await assert.rejects(readFile(path.join(config.directory, file)), { code: "ENOENT" });
  }
});

test("staged inventory stays bound to copied bytes and never repairs from changed source", async () => {
  const config = await fixture();
  const stage = await stageSourceTree({ name: "plugin", ...config });
  await writeFile(path.join(config.source, "tsconfig.json"), "source changed after staging");
  await assertSourceStage(stage);
  await unlink(path.join(config.directory, "tsconfig.json"));
  await assert.rejects(assertSourceStage(stage), /missing tsconfig.json/);
  await assert.rejects(readFile(path.join(config.directory, "tsconfig.json")), { code: "ENOENT" });
});

test("legitimate Next cache and generated type declarations do not change source integrity", async () => {
  const config = await fixture();
  const stage = await stageSourceTree({ name: "web", ...config, excluded: webStageExclusions });
  await mkdir(path.join(config.directory, ".next"));
  await writeFile(path.join(config.directory, ".next/build.log"), "runtime build");
  await writeFile(path.join(config.directory, "next-env.d.ts"), "runtime declarations");
  await assertSourceStage(stage);
  await writeFile(path.join(config.directory, "tsconfig.json"), "unexpected config change");
  await assert.rejects(assertSourceStage(stage), /changed tsconfig.json/);
});

test("owned runtime directories are unique and cannot be created inside the repository", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "openapply-runtime-root-"));
  const repository = path.join(temporary, "repo");
  await mkdir(repository);
  await assert.rejects(createRuntimeWorkspace(repository, repository), /outside the repository/);
  await assert.rejects(
    createRuntimeWorkspace(repository, path.join(repository, ".temp")),
    /outside the repository/,
  );
  const first = await createRuntimeWorkspace(repository, temporary);
  const second = await createRuntimeWorkspace(repository, temporary);
  assert.notEqual(first, second);
  assert.equal(path.dirname(first), temporary);
  assert.match(path.basename(first), /^openapply-e2e-runtime-/);
});

test("Windows runtime workspace stays on the repository volume for Next's relative webpack entries", () => {
  assert.equal(
    runtimeWorkspaceParent("D:\\Dev\\OpenApply", "C:\\Users\\fixture\\Temp", path.win32),
    "D:\\Dev",
  );
  assert.equal(runtimeWorkspaceParent("D:\\Dev\\OpenApply", "d:\\Temp", path.win32), "d:\\Temp");
  assert.equal(runtimeWorkspaceParent("/workspace/openapply", "/tmp", path.posix), "/tmp");
});
