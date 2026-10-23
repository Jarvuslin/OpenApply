import { workerControl } from "./worker-control.mjs";

try {
  if (process.argv.length !== 2) throw new Error("Usage: openapply-login");
  process.stdout.write(`${JSON.stringify(await workerControl("login"))}\n`);
} catch {
  console.error(
    "Sign-in could not run in this worker's browser. Check that a sign-in form is open, then report the blocker.",
  );
  process.exitCode = 1;
}
