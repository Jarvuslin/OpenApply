import { spawn, spawnSync } from "node:child_process";

export function detectRuntime(
  platform = process.platform,
  arch = process.arch,
  translated = false,
) {
  if (platform === "darwin" && translated) arch = "arm64";
  if (!["win32", "darwin"].includes(platform) || !["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported host: ${platform}/${arch}. Use Windows x64 or macOS.`);
  if (platform === "win32" && arch !== "x64") throw new Error("Windows ARM is not validated.");
  return {
    platform,
    arch,
    backend: platform === "win32" ? "wsl" : "lima",
    beta: platform === "darwin",
  };
}

export function currentRuntime() {
  const translated =
    process.platform === "darwin" &&
    process.arch === "x64" &&
    spawnSync("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"], {
      encoding: "utf8",
    }).stdout?.trim() === "1";
  return detectRuntime(process.platform, process.arch, translated);
}

export function guestCommand(runtime, args, user = "root") {
  if (runtime.backend === "wsl")
    return ["wsl.exe", "-d", "JobPilot-MVP", "-u", user, "--exec", ...args];
  if (runtime.backend === "lima")
    return [
      "limactl",
      "shell",
      "--workdir=/tmp",
      "openapply",
      "--",
      "sudo",
      "-n",
      "-u",
      user,
      "--",
      ...args,
    ];
  throw new Error("Unknown browser runtime.");
}

export function run(command, { input, capture = false, cwd, env, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      windowsHide: true,
      stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command[0]} timed out`));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command[0]} exited with ${code ?? "a signal"}`));
    });
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}
