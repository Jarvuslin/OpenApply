import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDisposableDatabase,
  assertEvidenceUnchanged,
  assertLocalEvidence,
  copyEvidenceStorage,
  evidenceHash,
  storageInventory,
} from "./evidence-input.mjs";
import { preservedEvidence } from "./ui-test-helpers.mjs";

test("a failed overall run with passed application evidence remains reusable for UI only", () => {
  const input = preservedEvidence();
  const account = assertLocalEvidence(input.report, input.environment, input.verification);
  assert.equal(account.loginEmail, "apply-e2e-preserved-unit@example.test");
  assert.equal(account.applications.length, 4);
  input.report.mode = "application-acceptance";
  assertLocalEvidence(input.report, input.environment, input.verification);
  input.report.mode = "ui-regression";
  assert.throws(
    () => assertLocalEvidence(input.report, input.environment, input.verification),
    /already have passed/,
  );
});

test("incomplete or failed application assertions and conflicting identities cannot be reused", () => {
  const mutations = [
    (input) => {
      input.report.realAgent = "incomplete";
    },
    (input) => {
      input.report.cases[0].checks[0].passed = false;
    },
    (input) => {
      input.report.cases[1].checks.pop();
    },
    (input) => {
      input.report.aggregates.checks[0].passed = false;
    },
    (input) => {
      input.report.records[0].application.company = "Another company";
    },
    (input) => {
      input.report.records[0].attempt.applicationId = input.report.records[1].application.id;
    },
    (input) => {
      input.report.syntheticAccount.userId = "another-user";
    },
    (input) => {
      input.verification.connectionVerified = false;
    },
    (input) => {
      input.verification.database = "apply_e2e_ffffffffffff";
    },
    (input) => {
      input.report.manifest.cases[0].url = "https://employer.example/apply";
    },
    (input) => {
      input.environment.apiUrl = "http://remote.example:14101";
    },
  ];
  for (const mutate of mutations) {
    const input = preservedEvidence();
    mutate(input);
    assert.throws(() => assertLocalEvidence(input.report, input.environment, input.verification));
  }
  for (const name of [
    "postgres",
    "openapply",
    "apply_e2e_bad;DROP DATABASE openapply",
    "apply_e2e_012345678abc-other",
  ])
    assert.throws(() => assertDisposableDatabase(name));
});

test("storage clone preserves bytes and detects changes without rewriting source evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openapply-ui-evidence-"));
  const storageRoot = path.join(directory, "source");
  await mkdir(path.join(storageRoot, "pdfs"), { recursive: true });
  const pdf = Buffer.from([0, 255, 13, 10, 128]);
  await writeFile(path.join(storageRoot, "pdfs/archive.pdf"), pdf);
  await writeFile(path.join(directory, "report.json"), '{"status":"failed"}\n');
  const input = {
    storageRoot,
    evidenceDir: directory,
    reportSha256: evidenceHash(await readFile(path.join(directory, "report.json"))),
    metadataFiles: [
      {
        path: "report.json",
        sha256: evidenceHash(await readFile(path.join(directory, "report.json"))),
      },
    ],
    storage: await storageInventory(storageRoot),
  };
  const clone = path.join(directory, "clone");
  await copyEvidenceStorage(input, clone);
  assert.deepEqual(await readFile(path.join(clone, "pdfs/archive.pdf")), pdf);
  assert.deepEqual(await storageInventory(clone), input.storage);
  await assertEvidenceUnchanged(input);
  await writeFile(path.join(storageRoot, "pdfs/archive.pdf"), "changed");
  await assert.rejects(assertEvidenceUnchanged(input), /source evidence changed/);
  assert.deepEqual(await readFile(path.join(clone, "pdfs/archive.pdf")), pdf);
});

test("source environment and database-verification metadata changes are detected", async () => {
  for (const changed of ["environment.json", "database-verification.json"]) {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "openapply-ui-metadata-"));
    const storageRoot = path.join(evidenceDir, "storage");
    await mkdir(storageRoot);
    const metadataFiles = [];
    for (const filename of ["report.json", "environment.json", "database-verification.json"]) {
      await writeFile(path.join(evidenceDir, filename), "{}");
      metadataFiles.push({ path: filename, sha256: evidenceHash("{}") });
    }
    const input = {
      evidenceDir,
      storageRoot,
      storage: [],
      reportSha256: evidenceHash("{}"),
      metadataFiles,
    };
    await assertEvidenceUnchanged(input);
    await writeFile(path.join(evidenceDir, changed), '{"changed":true}');
    await assert.rejects(assertEvidenceUnchanged(input), /source metadata changed/);
  }
});

test("storage inventory refuses links instead of copying files outside evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openapply-ui-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "openapply-ui-outside-"));
  await writeFile(path.join(outside, "private.txt"), "must not copy");
  await symlink(
    outside,
    path.join(directory, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(storageInventory(directory), /links are forbidden/);
});
