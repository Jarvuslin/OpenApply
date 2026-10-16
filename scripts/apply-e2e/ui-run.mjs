import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectEnvironment } from "./environment-preflight.mjs";
import { assertEvidenceUnchanged, evidenceHash, loadEvidenceInput } from "./evidence-input.mjs";
import { observeUi } from "./observe-ui.mjs";
import { provisionUiEnvironment } from "./ui-environment.mjs";

function outside(value) {
  return value === ".." || value.startsWith(`..${path.sep}`) || path.isAbsolute(value);
}

export async function assertSeparateUiOutput(sourceDirectory, outputDirectory) {
  const source = await realpath(sourceDirectory);
  let parent = path.resolve(outputDirectory);
  const suffix = [];
  while (true) {
    try {
      const output = path.join(await realpath(parent), ...suffix);
      if (!outside(path.relative(source, output)) || !outside(path.relative(output, source)))
        throw new Error("UI output and preserved evidence physically overlap.");
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      suffix.unshift(path.basename(parent));
      parent = next;
    }
  }
}

export function uiOptions(args) {
  const result = {
    check: false,
    infraOnly: false,
    runId: `ui-${Date.now()}-${randomUUID().slice(0, 8)}`,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--check") result.check = true;
    else if (flag === "--infra-only") result.infraOnly = true;
    else if (["--run-id", "--source-dir", "--evidence-dir"].includes(flag) && args[index + 1]) {
      const value = args[++index];
      if (flag === "--run-id") result.runId = value;
      if (flag === "--source-dir") result.sourceDir = path.resolve(value);
      if (flag === "--evidence-dir") result.evidenceDir = path.resolve(value);
    } else throw new Error(`Unknown or incomplete UI regression flag: ${flag}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(result.runId))
    throw new Error("Invalid UI regression run ID.");
  if (!result.sourceDir && !result.check)
    throw new Error("Supply --source-dir with preserved passing application evidence.");
  result.evidenceDir ??= path.resolve(".temp/apply-e2e", result.runId);
  if (result.sourceDir) {
    const relative = path.relative(result.sourceDir, result.evidenceDir);
    const inverse = path.relative(result.evidenceDir, result.sourceDir);
    if (!outside(relative) || !outside(inverse))
      throw new Error("UI output and preserved evidence directories must not overlap.");
  }
  return result;
}

export async function runUi(args = process.argv.slice(2)) {
  const config = uiOptions(args);
  const input = config.sourceDir ? await loadEvidenceInput(config.sourceDir) : null;
  if (config.check) {
    const inspection = await inspectEnvironment({ mode: "ui" });
    console.log(
      JSON.stringify(
        {
          mode: "ui-preflight",
          realAgent: "not-run",
          modelCalls: 0,
          inspection,
          sourceReportSha256: input?.reportSha256,
        },
        null,
        2,
      ),
    );
    return inspection.ready ? 0 : 1;
  }
  await assertSeparateUiOutput(input.evidenceDir, config.evidenceDir);
  await mkdir(config.evidenceDir, { recursive: true });
  const reportPath = path.join(config.evidenceDir, "report.json");
  const report = {
    version: 1,
    mode: "ui-regression",
    runId: config.runId,
    startedAt: new Date().toISOString(),
    status: "running",
    realAgent: "not-run",
    modelCalls: 0,
    newApplications: 0,
    source: {
      runId: input.report.runId,
      reportPath: path.join(input.evidenceDir, "report.json"),
      reportSha256: input.reportSha256,
      metadataFiles: input.metadataFiles,
      applicationBehavior: "previously-passed",
      originalOverallStatus: input.report.status,
      originalUiStatus: input.report.ui.status,
      applicationChecks: input.report.cases.reduce((sum, item) => sum + item.checks.length, 0),
      aggregateChecks: input.report.aggregates.checks.length,
      storage: input.storage,
      storageSha256: evidenceHash(JSON.stringify(input.storage)),
      historicalAgentSource: "not-reconstructed",
    },
    infrastructure: [],
    ui: { status: "not-run" },
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  const save = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  let environment;
  try {
    environment = await provisionUiEnvironment({
      runId: config.runId,
      evidenceDir: config.evidenceDir,
      input,
      onStage: async (stage) => {
        report.infrastructure.push({ ...stage, observedAt: new Date().toISOString() });
        await save();
        console.log(
          JSON.stringify({
            mode: "ui-regression",
            modelCalls: 0,
            stage: stage.stage,
            status: stage.status,
          }),
        );
      },
    });
    report.databaseBefore = environment.databaseBefore;
    await environment.assertHealthy();
    if (config.infraOnly)
      report.ui = { status: "not-run", reason: "Infrastructure-only verification requested." };
    else
      report.ui = await observeUi(
        environment,
        environment.applicant,
        input.account.applications,
        config.evidenceDir,
      );
    await environment.assertHealthy();
    report.status = config.infraOnly || report.ui.status === "passed" ? "passed" : "failed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
  } finally {
    if (environment) {
      try {
        report.cleanup = await environment.cleanup();
      } catch (error) {
        report.status = "failed";
        report.cleanup = { status: "failed", reason: error.message };
      }
      try {
        report.evidenceIntegrity = await environment.verifyEvidence();
      } catch (error) {
        report.status = "failed";
        report.evidenceIntegrity = { status: "failed", reason: error.message };
      }
    } else {
      try {
        report.sourceIntegrity = await assertEvidenceUnchanged(input);
      } catch (error) {
        report.status = "failed";
        report.sourceIntegrity = { status: "failed", reason: error.message };
      }
    }
    report.finishedAt = new Date().toISOString();
    await save();
  }
  console.log(
    JSON.stringify({
      status: report.status,
      mode: report.mode,
      realAgent: report.realAgent,
      modelCalls: 0,
      ui: report.ui.status,
      reportPath,
    }),
  );
  return report.status === "passed" ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runUi()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`UI regression refused or failed: ${error.message}`);
      process.exitCode = 1;
    });
}
