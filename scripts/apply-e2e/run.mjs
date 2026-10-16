import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectEnvironment } from "./environment-preflight.mjs";

export async function run(args = process.argv.slice(2)) {
  // The dispatch path this runner drove was removed; only the read-only preflight is left.
  if (!args.includes("--check"))
    throw new Error(
      "Model execution is disabled: the historical acceptance runner must be adapted to common-queue dispatch and campaign-wide budgets before a new explicitly approved run. The approval was not consumed; no environment or provider was started.",
    );
  const inspection = await inspectEnvironment({ provider: "claude" });
  console.log(
    JSON.stringify({ mode: "preflight-only", realAgent: "not-run", inspection }, null, 2),
  );
  return inspection.ready === false || inspection.ok === false ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
