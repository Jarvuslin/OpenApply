import { workerControl } from "./worker-control.mjs";

try {
  const action = process.argv[2];
  if (process.argv.length !== 3 || !["prepare", "handoff"].includes(action))
    throw new Error(
      "Use openapply-prepare prepare or openapply-prepare handoff inside the current leased worker.",
    );
  process.stdout.write(JSON.stringify(await workerControl(action)) + "\n");
} catch {
  console.error(
    "Owned form preparation refused or stopped. Inspect the current work item before continuing.",
  );
  process.exitCode = 1;
}
