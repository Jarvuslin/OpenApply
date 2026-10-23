import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateManifest } from "./assertions.mjs";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const evidenceHash = (value) => createHash("sha256").update(value).digest("hex");

export function assertDisposableDatabase(name) {
  if (!/^apply_e2e_[a-f0-9]{12}$/.test(name))
    throw new Error("UI evidence requires a verified disposable fixture database.");
}

export function assertLocalEvidence(report, environment, verification) {
  const runId = report.runId;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error("Invalid evidence run ID.");
  assertDisposableDatabase(environment.database);
  if (
    environment.runId !== runId ||
    verification.database !== environment.database ||
    verification.guestClusterVerified !== true ||
    verification.connectionVerified !== true
  )
    throw new Error("Evidence database identity is not verified.");
  for (const [key, expected] of Object.entries({
    apiUrl: "http://127.0.0.1:14101",
    webUrl: "http://127.0.0.1:14100",
    fixtureBaseUrl: "http://127.0.0.1:14110",
    cdpUrl: "http://127.0.0.1:19222",
  }))
    if (environment[key] !== expected) throw new Error("Evidence transport must be loopback-only.");
  validateManifest(report.manifest, runId);
  const caseIds = ["greenhouse", "lever", "ashby", "unfamiliar"];
  if (
    !["real-agent", "application-acceptance"].includes(report.mode) ||
    report.realAgent !== "completed" ||
    !report.finishedAt ||
    report.manifest.cases.length !== caseIds.length ||
    report.cases?.length !== caseIds.length ||
    report.records?.length !== caseIds.length ||
    report.aggregates?.passed !== true ||
    report.aggregates.checks?.length !== 8 ||
    !report.aggregates.checks.every((check) => check.passed === true)
  )
    throw new Error("Preserved application behavior must already have passed every assertion.");
  for (const id of caseIds) {
    const checked = report.cases.filter((item) => item.caseId === id);
    const records = report.records.filter((item) => item.caseId === id);
    if (
      checked.length !== 1 ||
      records.length !== 1 ||
      checked[0].passed !== true ||
      checked[0].checks?.length !== (id === "greenhouse" ? 50 : 47) ||
      !checked[0].checks.every((check) => check.passed === true)
    )
      throw new Error("Preserved application evidence is incomplete or failed.");
    const record = records[0];
    const fixture = report.manifest.cases.find((item) => item.id === id);
    if (
      !fixture ||
      !uuid.test(record.application?.id) ||
      record.application.company !== fixture.company ||
      record.application.status !== "applied" ||
      record.attempt?.applicationId !== record.application.id ||
      !record.attempt?.receipt?.confirmation?.reference?.startsWith(`fixture-${id}-`)
    )
      throw new Error("Preserved application identity does not match its fixture.");
  }
  if (!uuid.test(report.syntheticAccount?.userId) || !uuid.test(report.syntheticAccount?.resumeId))
    throw new Error("Missing exact synthetic account identity.");
  return {
    userId: report.syntheticAccount.userId,
    loginEmail: `apply-e2e-${runId}@example.test`,
    applications: report.records.map(({ application, attempt }) => ({
      id: application.id,
      company: application.company,
      receiptId: attempt.receipt.confirmation.reference,
    })),
  };
}

export async function storageInventory(directory, prefix = "") {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Storage links are forbidden.");
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const entry = await lstat(absolute);
    if (entry.isSymbolicLink()) throw new Error("Storage links are forbidden.");
    if (entry.isDirectory()) files.push(...(await storageInventory(absolute, relative)));
    else if (entry.isFile()) {
      const contents = await readFile(absolute);
      files.push({ path: relative, bytes: contents.length, sha256: evidenceHash(contents) });
    } else throw new Error("Unsupported preserved storage entry.");
  }
  return files;
}

export async function loadEvidenceInput(directory) {
  const evidenceDir = await realpath(directory);
  const metadataFiles = [];
  const metadata = {};
  for (const name of ["report.json", "environment.json", "database-verification.json"]) {
    const filename = path.join(evidenceDir, name);
    if ((await lstat(filename)).isSymbolicLink())
      throw new Error("Evidence metadata links are forbidden.");
    const contents = await readFile(filename);
    metadataFiles.push({ path: name, sha256: evidenceHash(contents) });
    metadata[name] = contents;
  }
  const reportBytes = metadata["report.json"];
  const report = JSON.parse(reportBytes);
  const environment = JSON.parse(metadata["environment.json"]);
  const verification = JSON.parse(metadata["database-verification.json"]);
  const account = assertLocalEvidence(report, environment, verification);
  const storageRoot = path.join(evidenceDir, "environment/storage");
  if ((await realpath(storageRoot)) !== storageRoot)
    throw new Error("Preserved storage must not traverse directory links.");
  const storage = await storageInventory(storageRoot);
  for (const record of report.records) {
    const resume = record.application.submission?.resume;
    if (!uuid.test(resume?.jobId) || !/^[a-f0-9]{64}$/.test(resume?.sha256))
      throw new Error("Missing archived submitted PDF identity.");
    const archived = storage.find(
      (file) =>
        file.path ===
        `application-submissions/${account.userId}/${resume.jobId}/${resume.sha256}.pdf`,
    );
    if (!archived || archived.sha256 !== resume.sha256)
      throw new Error("Preserved submitted PDF bytes do not match their recorded hash.");
  }
  return {
    evidenceDir,
    report,
    environment,
    account,
    reportSha256: evidenceHash(reportBytes),
    metadataFiles,
    storageRoot,
    storage,
  };
}

export async function copyEvidenceStorage(input, destination) {
  await mkdir(destination, { recursive: false });
  for (const file of input.storage) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(input.storageRoot, file.path), target);
  }
  const actual = await storageInventory(destination);
  if (JSON.stringify(actual) !== JSON.stringify(input.storage))
    throw new Error("Cloned storage differs from the preserved evidence.");
  return actual;
}

export async function assertEvidenceUnchanged(input) {
  for (const file of input.metadataFiles) {
    const filename = path.join(input.evidenceDir, file.path);
    if (
      (await lstat(filename)).isSymbolicLink() ||
      evidenceHash(await readFile(filename)) !== file.sha256
    )
      throw new Error("Preserved source metadata changed during UI verification.");
  }
  const reportSha256 = evidenceHash(await readFile(path.join(input.evidenceDir, "report.json")));
  const storage = await storageInventory(input.storageRoot);
  if (
    reportSha256 !== input.reportSha256 ||
    JSON.stringify(storage) !== JSON.stringify(input.storage)
  )
    throw new Error("Preserved source evidence changed during UI verification.");
  return {
    reportSha256,
    metadataSha256: evidenceHash(JSON.stringify(input.metadataFiles)),
    storageSha256: evidenceHash(JSON.stringify(storage)),
    files: storage.length,
  };
}
