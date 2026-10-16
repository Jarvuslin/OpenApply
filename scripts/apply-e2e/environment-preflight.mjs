import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import { fetchJson, portOpen, runCommand } from "./processes.mjs";

export const ports = Object.freeze({
  web: 14100,
  api: 14101,
  companion: 14102,
  fixture: 14110,
  database: 15433,
  browser: 19222,
});

export function sharedRuntimeBusy(health, queue) {
  if (health?.status !== "ok" || !["running", "stopped"].includes(health.session)) return true;
  if (
    typeof health.pilot?.running !== "boolean" ||
    typeof queue?.connected !== "boolean" ||
    typeof queue?.running !== "boolean"
  )
    return true;
  return health.session === "running" || health.pilot.running || queue.running;
}

export async function assertSharedRuntimeIdle() {
  if (!(await portOpen(4102))) return;
  const [health, queue] = await Promise.all([
    fetchJson("http://127.0.0.1:4102/healthz"),
    fetchJson("http://127.0.0.1:4102/queue/status"),
  ]);
  if (sharedRuntimeBusy(health, queue))
    throw new Error(
      "A shared companion session, Pilot, or queue run is active. Finish it before starting the fixture run.",
    );
}

const guestProbe = `
const fs = require('node:fs');
const net = require('node:net');
const open = port => new Promise(resolve => {
 const s = net.connect({host:'127.0.0.1',port});
 const done = value => {s.destroy(); resolve(value);};
 s.setTimeout(1000,()=>done(false)); s.on('connect',()=>done(true)); s.on('error',()=>done(false));
});
(async()=>{
 let busy = false;
 for (const name of fs.readdirSync('/proc').filter(name=>/^\\d+$/.test(name))) {
  if ([process.pid,process.ppid].includes(Number(name))) continue;
  try { const cmd=fs.readFileSync('/proc/'+name+'/cmdline','utf8'); if(cmd.includes('@playwright/mcp')&&cmd.includes('cli.js')) busy=true; } catch {}
 }
 const browser=await open(9222), viewer=await open(6080), database=await open(5433);
 const reserved=await Promise.all(JSON.parse(process.argv[1]).map(open));
 const tools=fs.existsSync('/home/pilot/openapply-tools/node_modules/@playwright/mcp/cli.js');
 process.stdout.write(JSON.stringify({node:process.versions.node,browser,viewer,database,tools,browserMcpInUse:busy,portsAvailable:reserved.every(value=>!value)}));
})();`;

export function environmentRequirements(mode = "agent", provider = "claude") {
  if (!["agent", "ui"].includes(mode)) throw new Error("Unknown environment capability mode.");
  return {
    commands: mode === "ui" ? ["node", "bun"] : ["node", "bun", "dotnet", provider],
    ports:
      mode === "ui" ? [ports.web, ports.api, ports.database, ports.browser] : Object.values(ports),
    provider: mode === "agent",
  };
}

export async function inspectEnvironment({ provider = "claude", mode = "agent" } = {}) {
  const requirements = environmentRequirements(mode, provider);
  const checks = {};
  const blockers = [];
  let runtime;
  try {
    runtime = currentRuntime();
  } catch {
    blockers.push("Use the supported Windows/WSL or macOS/Lima runtime.");
  }
  if (!runtime) return { ready: false, checks, blockers };
  checks.runtime = runtime.backend;
  for (const name of requirements.commands) {
    try {
      const executable = name === "dotnet" ? (process.env.OPENAPPLY_E2E_DOTNET ?? name) : name;
      const version = await runCommand([executable, "--version"]);
      checks[`${name}Version`] = version.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? "available";
    } catch {
      checks[`${name}Version`] = null;
      blockers.push(`Install or repair the ${name} command.`);
    }
  }
  if (requirements.provider) {
    try {
      if (provider !== "claude") throw new Error("Unsupported provider.");
      const auth = JSON.parse(await runCommand(["claude", "auth", "status", "--json"]));
      checks.providerSignedIn = auth.loggedIn === true;
    } catch {
      checks.providerSignedIn = false;
    }
    if (!checks.providerSignedIn)
      blockers.push("Claude must be signed in; this metadata check does not establish quota.");
  }
  try {
    await assertSharedRuntimeIdle();
    checks.sharedRuntimeIdle = true;
  } catch {
    checks.sharedRuntimeIdle = false;
    blockers.push("The shared companion is active or its status cannot be verified.");
  }
  checks.hostPortsAvailable = (
    await Promise.all(requirements.ports.map((port) => portOpen(port)))
  ).every((open) => !open);
  if (!checks.hostPortsAvailable)
    blockers.push(
      `One of the dedicated loopback ports ${requirements.ports.join(", ")} is occupied.`,
    );
  try {
    if (runtime.backend === "wsl") {
      const running = (await runCommand(["wsl.exe", "--list", "--running", "--quiet"])).replaceAll(
        "\0",
        "",
      );
      checks.vmAlreadyRunning = running
        .split(/\r?\n/)
        .some((name) => name.trim() === "OpenApply-MVP");
    } else {
      const rows = (await runCommand(["limactl", "list", "--json"]))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((row) => JSON.parse(row));
      checks.vmAlreadyRunning = rows.some(
        (row) => row.name === "openapply" && row.status === "Running",
      );
    }
    if (!checks.vmAlreadyRunning) throw new Error("VM is not running.");
    const guestPorts = requirements.ports.filter((port) => port !== ports.database);
    const probe = JSON.parse(
      await runCommand(
        guestCommand(runtime, ["node", "-e", guestProbe, JSON.stringify(guestPorts)]),
      ),
    );
    checks.guest = probe;
    if (!probe.browser || !probe.viewer || !probe.tools)
      blockers.push(
        "The existing guest headed browser, viewer, or Playwright installation is unavailable.",
      );
    if (!probe.database)
      blockers.push("The guest PostgreSQL service on loopback 5433 is unavailable.");
    if (!probe.portsAvailable)
      blockers.push("A dedicated guest fixture or forwarding port is already occupied.");
    if (probe.browserMcpInUse)
      blockers.push("A guest Playwright MCP process is already using the shared browser.");
    const postgres = await runCommand(
      guestCommand(runtime, [
        "psql",
        "-h",
        "127.0.0.1",
        "-p",
        "5433",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-At",
        "-c",
        "SELECT current_setting('server_version'), current_setting('data_directory');",
      ]),
    );
    const [version, dataDirectory] = postgres.split("|");
    checks.guestPostgresVersion = version.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
    checks.guestDatabaseIdentity = dataDirectory?.trim() === "/var/lib/postgresql/mvp";
    if (!checks.guestDatabaseIdentity)
      blockers.push(
        "Guest PostgreSQL is not the expected local MVP cluster; no database will be created.",
      );
  } catch {
    blockers.push(
      "The already-running guest runtime and local PostgreSQL could not be verified; setup is never run automatically.",
    );
  }
  return { ready: blockers.length === 0, checks, blockers };
}
