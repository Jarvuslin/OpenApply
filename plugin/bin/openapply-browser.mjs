import { spawn } from "node:child_process";
import { currentRuntime, guestCommand, run } from "./runtime.mjs";

try {
  await run(
    guestCommand(currentRuntime(), [
      "sh",
      "-c",
      "mkdir -p /home/pilot/openapply && chown pilot:pilot /home/pilot/openapply",
    ]),
    { capture: true },
  );
  const command = guestCommand(
    currentRuntime(),
    [
      "sh",
      "-c",
      "cd /home/pilot/openapply && exec node /home/pilot/jobpilot-tools/node_modules/@playwright/mcp/cli.js --cdp-endpoint http://127.0.0.1:9222 --output-dir /home/pilot/openapply",
    ],
    "pilot",
  );
  const child = spawn(command[0], command.slice(1), { stdio: "inherit", windowsHide: true });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(`OpenApply browser: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
