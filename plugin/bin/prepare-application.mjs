import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { guestPreparationProgram } from "./preparation-preview.mjs";
import { currentRuntime, guestCommand } from "./runtime.mjs";

let lines;
try {
  lines = createInterface({ input: process.stdin });
  const input = await new Promise((resolve, reject) => {
    lines.once("line", resolve);
    lines.once("close", () => reject(new Error("Interrupted")));
  });
  if (input.length > 16_000_000) throw new Error("Input bound");
  const config = JSON.parse(input);
  if (Object.keys(config).some((key) => !["manifest", "documents", "allowLoopback"].includes(key)))
    throw new Error("Unexpected input");
  const command = guestCommand(
    currentRuntime(),
    ["node", "--input-type=module", "-e", guestPreparationProgram()],
    "pilot",
  );
  const child = spawn(command[0], command.slice(1), {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const stop = () => child.stdin.end();
  process.stdin.once("end", stop);
  child.stdin.on("error", () => {});
  let output = "";
  let overflow = false;
  child.stdout.on("data", (chunk) => {
    if (output.length + chunk.length > 1_000_000) {
      overflow = true;
      stop();
    } else output += chunk;
  });
  child.stdin.write(`${JSON.stringify(config)}\n`);
  const timer = setTimeout(stop, 60000);
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  clearTimeout(timer);
  lines.close();
  process.stdin.destroy();
  if (code !== 0 || overflow) throw new Error("Browser failed");
  console.log(output);
} catch {
  lines?.close();
  process.stdin.destroy();
  console.error(
    "Preparation preview failed. Check the installed browser and current owned job manifest.",
  );
  process.exitCode = 1;
}
