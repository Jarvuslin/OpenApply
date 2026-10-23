import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { collectionUrlAllowed, guestCollectionProgram } from "./question-collector.mjs";
import { currentRuntime, guestCommand } from "./runtime.mjs";

try {
  const lines = createInterface({ input: process.stdin });
  const input = await new Promise((resolve, reject) => {
    lines.once("line", resolve);
    lines.once("close", () => reject(new Error("Interrupted")));
  });
  if (input.length > 8000) throw new Error("Question collector input exceeded its bound.");
  const config = JSON.parse(input);
  if (
    Object.keys(config).some((key) => !["url", "allowLoopback"].includes(key)) ||
    !collectionUrlAllowed(config.url, config.allowLoopback === true)
  )
    throw new Error("Unsupported question collection request.");
  const command = guestCommand(
    currentRuntime(),
    ["node", "--input-type=module", "-e", guestCollectionProgram()],
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
    if (output.length + chunk.length > 2_000_000) {
      overflow = true;
      stop();
    } else output += chunk;
  });
  child.stdin.write(`${JSON.stringify(config)}\n`);
  const timer = setTimeout(stop, 40_000);
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  clearTimeout(timer);
  lines.close();
  process.stdin.destroy();
  if (code !== 0 || overflow)
    throw new Error("Question collector ended without complete observations.");
  console.log(output);
} catch {
  console.error(
    "Question collection failed. Check the installed browser runtime and supported job URL.",
  );
  process.exitCode = 1;
}
