import { spawn } from "node:child_process";
import { accountBrowserProgram } from "./account-browser-core.mjs";
import { currentRuntime, guestCommand } from "./runtime.mjs";

const bootstrap = `const{createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});lines.once('line',async line=>{try{if(line.length>200000)throw Error();const code=JSON.parse(line).code;const module=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));await module.default(lines);}catch{process.exitCode=1;lines.close();process.stdin.destroy();}});`;
const command = guestCommand(
  currentRuntime(),
  ["node", "--input-type=module", "-e", bootstrap],
  "pilot",
);
const child = spawn(command[0], command.slice(1), {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
child.stdin.write(JSON.stringify({ code: accountBrowserProgram() }) + "\n");
let ready = false,
  buffer = "";
child.stdout.on("data", (chunk) => {
  if (ready) {
    process.stdout.write(chunk);
    return;
  }
  buffer += chunk;
  if (buffer.length > 4096) {
    child.kill();
    return;
  }
  if (buffer.includes("\n")) {
    if (buffer !== '{"ready":true}\n') {
      child.kill();
      return;
    }
    ready = true;
    process.stdout.write(buffer);
    process.stdin.pipe(child.stdin);
  }
});
child.stderr.resume();
child.stdin.on("error", () => {});
process.stdin.once("end", () => child.stdin.end());
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.stdin.end());
child.on("error", () => {
  process.exitCode = 1;
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
  process.stdin.destroy();
});
