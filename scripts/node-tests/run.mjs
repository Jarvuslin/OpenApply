import { spawn } from "node:child_process";
import {
  assertNodeTestInventory,
  discoverNodeTests,
  repositoryRoot,
  selectNodeTests,
} from "./inventory.mjs";
import { NODE_TEST_GROUPS } from "./manifest.mjs";

assertNodeTestInventory(discoverNodeTests());
const selected = selectNodeTests(process.argv.slice(2));
process.stdout.write(
  `${selected.group}: ${selected.files.length} files. ${NODE_TEST_GROUPS[selected.group].description}\n`,
);
if (selected.list) process.stdout.write(`${selected.files.join("\n")}\n`);
else {
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...selected.files], {
    cwd: repositoryRoot,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      OPENAPPLY_RUN_WORKER_BROWSER_TEST: selected.group === "guest-host" ? "1" : "",
    },
  });
  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
