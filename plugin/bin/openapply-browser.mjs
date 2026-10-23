import { spawn } from "node:child_process";
import { browserCommands } from "./browser-options.mjs";
import { currentRuntime, guestCommand, run } from "./runtime.mjs";
import { workerControl } from "./worker-control.mjs";

try {
  let environment = process.env;
  if (environment.OPENAPPLY_WORK_ITEM_ID || environment.OPENAPPLY_BROWSER_SESSION_ID) {
    const owned = await workerControl("attach");
    environment = {
      ...environment,
      OPENAPPLY_BROWSER_CDP_PORT: String(owned.port),
      OPENAPPLY_BROWSER_OUTPUT_DIR: owned.outputDir,
    };
  }
  const options = browserCommands(environment);
  const runtime = currentRuntime();
  for (const args of options.prepare) {
    await run(guestCommand(runtime, args), { capture: true });
  }
  const command = guestCommand(runtime, options.launch, "pilot");
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
