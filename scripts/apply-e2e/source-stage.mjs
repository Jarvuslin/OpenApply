import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const webStageExclusions = [
  "node_modules",
  ".next",
  ".next-preview",
  "tsconfig.tsbuildinfo",
  "next-env.d.ts",
];

function inside(directory, candidate) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export async function createRuntimeWorkspace(repository, temporaryRoot = os.tmpdir()) {
  if (
    inside(repository, temporaryRoot) ||
    inside(await realpath(repository), await realpath(temporaryRoot))
  )
    throw new Error("The private runtime workspace must be outside the repository.");
  const resolvedRepository = await realpath(repository);
  const parent = runtimeWorkspaceParent(resolvedRepository, await realpath(temporaryRoot));
  if (inside(resolvedRepository, parent))
    throw new Error("The private runtime workspace must be outside the repository.");
  return mkdtemp(path.join(parent, "openapply-e2e-runtime-"));
}

export function runtimeWorkspaceParent(repository, temporaryRoot, paths = path) {
  // Next's webpack entries prepend './' to relative paths, which cannot cross Windows drives.
  return paths.parse(repository).root.toLowerCase() ===
    paths.parse(temporaryRoot).root.toLowerCase()
    ? temporaryRoot
    : paths.dirname(repository);
}

function excludedEntry(name, excluded) {
  return name === ".env" || name.startsWith(".env.") || excluded.includes(name);
}

async function inventory(directory, excluded, prefix = "", rootExcluded = []) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    if (excludedEntry(name, excluded) || (!prefix && rootExcluded.includes(name))) continue;
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const entry = await stat(absolute);
    if (entry.isDirectory())
      files.push(...(await inventory(absolute, excluded, relative, rootExcluded)));
    else if (entry.isFile()) {
      const contents = await readFile(absolute);
      files.push({
        path: relative,
        bytes: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      });
    } else throw new Error(`Unsupported source entry: ${relative}`);
  }
  return files;
}

export async function assertSourceStage(stage) {
  const actual = await inventory(stage.directory, stage.excluded, "", stage.rootExcluded);
  const remaining = new Map(actual.map((file) => [file.path, file]));
  const problems = [];
  for (const expected of stage.files) {
    const file = remaining.get(expected.path);
    if (!file) problems.push(`missing ${expected.path}`);
    else if (file.bytes !== expected.bytes || file.sha256 !== expected.sha256)
      problems.push(`changed ${expected.path}`);
    remaining.delete(expected.path);
  }
  for (const name of remaining.keys()) problems.push(`unexpected ${name}`);
  if (problems.length)
    throw new Error(
      `Staged ${stage.name} source integrity failed (${problems.length} files): ${problems.slice(0, 8).join(", ")}`,
    );
}

export async function stageSourceTree({
  name,
  source,
  directory,
  excluded = [],
  rootExcluded = [],
}) {
  const files = await inventory(source, excluded, "", rootExcluded);
  await cp(source, directory, {
    recursive: true,
    dereference: true,
    filter: (file) =>
      !excludedEntry(path.basename(file), excluded) &&
      !rootExcluded.includes(path.relative(source, file)),
  });
  const stage = {
    name,
    directory,
    excluded: [...excluded],
    rootExcluded: [...rootExcluded],
    excludedEnvironmentFiles: [".env", ".env.*"],
    files,
  };
  await assertSourceStage(stage);
  return stage;
}
