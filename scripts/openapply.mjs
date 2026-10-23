import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand, run } from "../plugin/bin/runtime.mjs";
import { doctorFailed, formatChecks, runDoctor } from "./doctor.mjs";
import { findDotnet } from "./dotnet.mjs";
import { setupEnv } from "./setup-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = currentRuntime();
const command = process.argv[2] ?? "doctor";
const vmOnly = process.argv.includes("--vm-only");
const development = process.argv.includes("--dev");
const json = process.argv.includes("--json");
const openSetup = process.argv.includes("--open");
const shell = ["powershell.exe", "-NoProfile", "-File"];
const services = [5433, 9222, 6080];
const apps = [4100, 4101, 4102];

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

const APP_HEALTH = [
  ["website", "http://127.0.0.1:4100"],
  ["API", "http://127.0.0.1:4101/api/health"],
  ["companion", "http://127.0.0.1:4102/healthz"],
];

async function answers(url) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Waits for the three apps to answer, says which did not, and optionally opens the Setup page. */
async function confirmConnection(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let missing = APP_HEALTH;
  while (missing.length && Date.now() < deadline) {
    const results = await Promise.all(missing.map(([, url]) => answers(url)));
    missing = missing.filter((_, index) => !results[index]);
    if (missing.length) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (missing.length) {
    console.error(
      `Not reachable after ${timeoutMs / 1000}s: ${missing.map(([name]) => name).join(", ")}. Logs are in .temp/mvp.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "Connected: the website, API and companion all answer. Open http://localhost:4100/setup to check this browser and link this computer.",
  );
  if (!openSetup) return;
  const opener = { win32: ["cmd.exe", "/c", "start", ""], darwin: ["open"] }[runtime.platform];
  if (opener)
    spawn(opener[0], [...opener.slice(1), "http://localhost:4100/setup"], {
      stdio: "ignore",
      detached: true,
    }).unref();
}

async function checkDependencies() {
  if (!findDotnet().path) throw new Error("No .NET 10 SDK found. See README prerequisites.");
  const commands = ["bun", "claude", runtime.backend === "lima" ? "limactl" : "wsl.exe"];
  for (const name of commands) {
    try {
      await run([name, "--version"], { capture: true, timeout: 15_000 });
    } catch {
      throw new Error(`Missing or unusable ${name}. See README prerequisites.`);
    }
  }
  if (runtime.platform === "darwin") {
    const version = await run(["sw_vers", "-productVersion"], { capture: true });
    if (Number(version.split(".")[0]) < 14)
      throw new Error("The Mac beta requires macOS 14 or newer.");
  }
}

async function limaVm(create = false) {
  const listed = await run(["limactl", "list", "--json"], { capture: true });
  const instances = listed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const existing = instances.find((instance) => instance.name === "openapply");
  if (!existing && !create) throw new Error("Run node scripts/openapply.mjs setup first.");
  if (existing?.status !== "Running") {
    for (const port of services)
      if (await portOpen(port))
        throw new Error(
          `Port ${port} is occupied before the VM starts. Stop the conflicting service first.`,
        );
  }
  if (!existing) {
    const config = (await readFile(path.join(root, "scripts/lima.yaml"), "utf8")).replace(
      "arch: default",
      `arch: ${runtime.arch === "arm64" ? "aarch64" : "x86_64"}`,
    );
    const configPath = path.join(root, ".temp/mvp/lima.yaml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, config);
    await run(["limactl", "start", "--tty=false", "--name=openapply", configPath], {
      timeout: 900_000,
    });
  } else if (existing.status !== "Running") {
    await run(["limactl", "start", "--tty=false", "openapply"], { timeout: 300_000 });
  }
  const identity = await run(guestCommand(runtime, ["cat", "/etc/openapply-runtime"]), {
    capture: true,
  });
  if (identity !== "openapply-lima-v1")
    throw new Error("The openapply VM was not provisioned by this setup. It was not modified.");
  // Copy the service script through stdin; the VM never needs a mount of the user's home.
  const script = (await readFile(path.join(root, "scripts/mvp-vm-start.sh"), "utf8")).replaceAll(
    "\r\n",
    "\n",
  );
  await run(
    guestCommand(runtime, [
      "sh",
      "-c",
      "set -eu; mkdir -p /opt/openapply; cat > /opt/openapply/start.sh; chmod 700 /opt/openapply/start.sh",
    ]),
    { input: script },
  );
  await run(
    guestCommand(runtime, [
      "sh",
      "-c",
      "if ! pgrep -f '^sh /opt/openapply/start.sh$' >/dev/null; then nohup sh /opt/openapply/start.sh >/tmp/openapply-start.log 2>&1 </dev/null & fi",
    ]),
  );
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if ((await Promise.all(services.map(portOpen))).every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "VM services did not become ready. Inspect /tmp/openapply-start.log using limactl shell openapply.",
  );
}

async function startApps() {
  for (const port of apps)
    if (await portOpen(port))
      throw new Error(`Port ${port} is already in use. Stop that instance first.`);
  const appEnvironment = { ...process.env };
  if (development) {
    delete appEnvironment.OPENAPPLY_WEB_DIST_DIR;
  } else {
    appEnvironment.OPENAPPLY_WEB_DIST_DIR = ".next-preview";
    console.log("Building the web app once for fast navigation. Use start --dev for hot reload.");
    await run(["bun", "run", "build:web"], { cwd: root, env: appEnvironment, timeout: 600_000 });
  }
  console.log(
    "OpenApply: http://localhost:4100/mvp — Ctrl+C stops the app; stop command shuts down the VM.",
  );
  void confirmConnection();
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", development ? "dev" : "start"], {
      cwd: root,
      env: appEnvironment,
      stdio: "inherit",
      detached: true,
    });
    let stopping = false;
    const stop = () => {
      stopping = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", reject);
    child.once("exit", (code) => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (code === 0 || stopping) resolve();
      else reject(new Error(`App launcher exited with ${code}`));
    });
  });
}

async function main() {
  if (command === "doctor" && json) {
    const checks = await runDoctor(root, runtime);
    console.log(JSON.stringify({ checks }));
    if (doctorFailed(checks)) process.exitCode = 1;
    return;
  }
  console.log(
    `OpenApply · ${runtime.platform}/${runtime.arch} · ${runtime.backend}${runtime.beta ? " · Mac beta (real-device validation pending)" : ""}`,
  );
  if (command === "doctor") {
    const checks = await runDoctor(root, runtime);
    console.log(`${formatChecks(checks)}\n`);
    for (const port of [...services, ...apps])
      console.log(
        `Port ${port}: ${(await portOpen(port)) ? "listening (ownership not verified)" : "not listening"}`,
      );
    if (doctorFailed(checks)) process.exitCode = 1;
    return;
  }
  if (command === "env") return setupEnv(root);
  if (command === "stop") {
    if (runtime.backend === "wsl")
      return run([...shell, path.join(root, "scripts/stop-mvp.ps1")], { cwd: root });
    for (const port of apps)
      if (await portOpen(port))
        throw new Error("Stop OpenApply with Ctrl+C in its terminal before stopping the VM.");
    return run(["limactl", "stop", "openapply"], { timeout: 120_000 });
  }
  if (!["setup", "start"].includes(command))
    throw new Error(
      "Commands: env, setup [--rootfs <file>], start [--vm-only] [--dev] [--open], doctor [--json], stop",
    );
  await checkDependencies();
  if (command === "setup") await setupEnv(root);
  if (runtime.backend === "lima") await limaVm(command === "setup");
  else {
    const index = process.argv.indexOf("--rootfs");
    if (command === "setup" && index !== -1) {
      if (!process.argv[index + 1]) throw new Error("--rootfs requires a file path");
      await run(
        [
          ...shell,
          path.join(root, "scripts/setup-vm.ps1"),
          "-RootfsPath",
          path.resolve(process.argv[index + 1]),
        ],
        { timeout: 900_000 },
      );
    }
    await run([...shell, path.join(root, "scripts/start-mvp.ps1"), "-VmOnly"], {
      cwd: root,
      timeout: 240_000,
    });
  }
  if (command === "setup") {
    for (const task of ["db:generate", "db:migrate:apply", "db:seed"])
      await run(["bun", "--cwd=apps/api", "run", task], { cwd: root, timeout: 180_000 });
    await run([findDotnet().path, "build", "apps/terminal"], { cwd: root, timeout: 180_000 });
    console.log("Setup complete. Run node scripts/openapply.mjs start.");
    return;
  }
  if (vmOnly) return;
  if (runtime.backend === "wsl") {
    await run(
      [...shell, path.join(root, "scripts/start-mvp.ps1"), ...(development ? ["-Dev"] : [])],
      { cwd: root, timeout: 600_000 },
    );
    return confirmConnection();
  }
  await startApps();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
