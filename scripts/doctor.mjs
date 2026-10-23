import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { findDotnet } from "./dotnet.mjs";

const VM_NAME = { wsl: "OpenApply-MVP", lima: "openapply" };

function probe(command, { cwd, timeout = 20_000, shell = false } = {}) {
  return new Promise((resolve) => {
    // A Windows .cmd shim (npm installs codex that way) only starts through a shell.
    const child = shell
      ? spawn(command.join(" "), { cwd, shell: true, windowsHide: true })
      : spawn(command[0], command.slice(1), { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

function firstLine(text) {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

export function nodeCheck(version) {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  return {
    id: "node",
    label: "Node.js 22+",
    status: major >= 22 ? "ok" : "fail",
    required: true,
    detail: version,
    fix: "Install Node.js 22 or newer (LTS) from https://nodejs.org/.",
  };
}

/** Result of findDotnet() from dotnet.mjs, which every OpenApply command uses to run dotnet. */
export function dotnetCheck(found) {
  const base = {
    id: "dotnet",
    label: ".NET 10 SDK",
    required: true,
    fix: "Install the .NET 10 SDK from https://dotnet.microsoft.com/download/dotnet/10.0.",
  };
  if (!found.path) {
    const detail = found.checked ? "No 10.x SDK in any dotnet found" : "dotnet not found";
    return { ...base, status: "fail", detail };
  }
  if (found.firstOnPath && found.firstOnPath !== found.path)
    return {
      ...base,
      status: "warn",
      detail: `OpenApply uses ${found.version} at ${found.path}. A plain dotnet command runs ${found.firstOnPath}, which has no 10.x SDK`,
      fix: "Nothing needed for OpenApply. To run dotnet yourself, use node scripts/dotnet.mjs.",
    };
  return { ...base, status: "ok", detail: `${found.version} at ${found.path}` };
}

/** Output of `claude auth status`, which prints JSON with `loggedIn`. */
export function claudeAuthCheck(stdout) {
  const base = {
    id: "claude-auth",
    label: "Claude Code signed in",
    required: true,
    fix: "Run claude auth login (or run claude once) and finish signing in.",
  };
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ...base,
      status: "unknown",
      detail: "This Claude Code version cannot report sign-in status",
    };
  }
  if (parsed?.loggedIn === true)
    return {
      ...base,
      status: "ok",
      detail: `Signed in (${parsed.authMethod ?? "unknown method"})`,
    };
  return { ...base, status: "fail", detail: "Not signed in" };
}

/** Output of `prisma migrate status`. */
export function migrationCheck(output) {
  const base = { id: "database", label: "Database reachable and migrated", required: true };
  if (/Database schema is up to date/i.test(output))
    return {
      ...base,
      status: "ok",
      detail: firstLine(output.match(/\d+ migrations? found.*/)?.[0] ?? "Up to date"),
      fix: "",
    };
  if (/not yet been applied/i.test(output))
    return {
      ...base,
      status: "fail",
      detail: "Migrations are waiting to be applied",
      fix: "Run bun --cwd=apps/api run db:migrate:apply.",
    };
  if (/DATABASE_URL/.test(output) && /not found|missing/i.test(output))
    return {
      ...base,
      status: "fail",
      detail: "DATABASE_URL is not set",
      fix: "Run node scripts/openapply.mjs env.",
    };
  if (/P1001|Can't reach database server/i.test(output))
    return {
      ...base,
      status: "warn",
      detail: "PostgreSQL on 127.0.0.1:5433 is not running",
      fix: "Start the VM with node scripts/openapply.mjs start --vm-only.",
    };
  return {
    ...base,
    status: "fail",
    detail:
      firstLine(output.split(/\r?\n/).filter(Boolean).at(-1) ?? "") ||
      "prisma migrate status failed",
    fix: "Run bun --cwd=apps/api x prisma migrate status to see the full error.",
  };
}

export function vmCheck(backend, listing) {
  const name = VM_NAME[backend];
  const found =
    backend === "wsl"
      ? listing
          .replaceAll("\0", "")
          .split(/\r?\n/)
          .some((line) => line.trim() === name)
      : listing
          .split(/\r?\n/)
          .filter(Boolean)
          .some((line) => {
            try {
              return JSON.parse(line).name === name;
            } catch {
              return false;
            }
          });
  let fix = "Run node scripts/openapply.mjs setup.";
  if (backend === "wsl")
    fix =
      "Run scripts/install.ps1, or node scripts/openapply.mjs setup --rootfs <alpine-minirootfs.tar.gz>.";
  return {
    id: "vm",
    label: backend === "wsl" ? `WSL distribution ${name}` : `Lima VM ${name}`,
    status: found ? "ok" : "fail",
    required: true,
    detail: found ? "Present" : "Not created yet",
    fix,
  };
}

export function terminalCheck(result) {
  const base = {
    id: "terminal",
    label: "Terminal companion (:4102)",
    required: false,
    fix: "Start OpenApply with node scripts/openapply.mjs start.",
  };
  if (!result.ok) return { ...base, status: "warn", detail: "Not running" };
  if (result.body?.status === "degraded")
    return {
      ...base,
      status: "warn",
      detail: result.body.detail ?? "Degraded",
      fix: "Rebuild with dotnet build apps/terminal, then restart.",
    };
  return {
    ...base,
    status: "ok",
    detail: `Version ${result.body?.hostVersion ?? "unknown"}`,
    fix: "",
  };
}

export function doctorFailed(checks) {
  return checks.some((check) => check.required && check.status === "fail");
}

const MARK = { ok: "[ok]  ", warn: "[warn]", fail: "[FAIL]", unknown: "[?]   " };

export function formatChecks(checks) {
  const lines = [];
  for (const check of checks) {
    lines.push(`${MARK[check.status]} ${check.label}: ${check.detail}`);
    if (check.status !== "ok" && check.fix) lines.push(`       Fix: ${check.fix}`);
  }
  const count = (status) => checks.filter((check) => check.status === status).length;
  const failed = checks.filter((check) => check.required && check.status === "fail").length;
  lines.push(
    "",
    `${count("ok")} ok, ${count("warn")} warnings, ${count("unknown")} unknown, ${count("fail")} failed.`,
    failed ? `${failed} required check(s) failed.` : "All required checks passed.",
  );
  return lines.join("\n");
}

function versionCheck(id, label, result, { required = true, fix }) {
  const found = result.code === 0;
  let status = "ok";
  if (!found) status = required ? "fail" : "warn";
  return {
    id,
    label,
    status,
    required,
    detail: found ? firstLine(result.stdout) : "Not found on PATH",
    fix: found ? "" : fix,
  };
}

async function databaseCheck(root) {
  const result = await probe(["bun", "x", "prisma", "migrate", "status"], {
    cwd: path.join(root, "apps/api"),
    timeout: 45_000,
  });
  if (result.error)
    return {
      id: "database",
      label: "Database reachable and migrated",
      status: "unknown",
      required: true,
      detail: "Needs Bun to check",
      fix: "Install Bun first.",
    };
  return migrationCheck(`${result.stdout}\n${result.stderr}`);
}

async function envCheck(root) {
  const missing = [];
  for (const file of ["apps/api/.env", "apps/web/.env.local"]) {
    try {
      await access(path.join(root, file));
    } catch {
      missing.push(file);
    }
  }
  return {
    id: "env",
    label: "Local configuration files",
    status: missing.length ? "fail" : "ok",
    required: true,
    detail: missing.length
      ? `Missing ${missing.join(", ")}`
      : "apps/api/.env and apps/web/.env.local",
    fix: missing.length ? "Run node scripts/openapply.mjs env." : "",
  };
}

async function serviceCheck(id, label, url) {
  const result = await fetchJson(url);
  return {
    id,
    label,
    status: result.ok ? "ok" : "warn",
    required: false,
    detail: result.ok ? "Running" : "Not running",
    fix: result.ok ? "" : "Start OpenApply with node scripts/openapply.mjs start.",
  };
}

export async function runDoctor(root, runtime) {
  const windows = runtime.platform === "win32";
  const dotnet = findDotnet();
  const [git, bun, claude, codex, vmListing] = await Promise.all([
    probe(["git", "--version"]),
    probe(["bun", "--version"]),
    probe(["claude", "--version"]),
    probe(["codex", "--version"], { shell: windows }),
    probe(windows ? ["wsl.exe", "--list", "--quiet"] : ["limactl", "list", "--json"]),
  ]);
  const claudeAuth =
    claude.code === 0
      ? claudeAuthCheck((await probe(["claude", "auth", "status"])).stdout)
      : { ...claudeAuthCheck(""), detail: "Claude Code is not installed" };
  let vm = vmCheck(runtime.backend, vmListing.stdout);
  if (vmListing.error)
    vm = {
      ...vm,
      detail: windows ? "WSL is not installed" : "Lima is not installed",
      fix: windows
        ? "Run wsl --install in an administrator PowerShell, then reboot."
        : "Run brew install lima.",
    };
  const [env, database, api, terminal, browser] = await Promise.all([
    envCheck(root),
    databaseCheck(root),
    serviceCheck("api", "API (:4101)", "http://127.0.0.1:4101/api/health"),
    fetchJson("http://127.0.0.1:4102/healthz").then(terminalCheck),
    serviceCheck("browser", "VM browser (:9222)", "http://127.0.0.1:9222/json/version"),
  ]);
  const checks = [
    versionCheck("git", "Git", git, { fix: "Install Git from https://git-scm.com/downloads." }),
    nodeCheck(process.version),
    versionCheck("bun", "Bun", bun, { fix: "Install Bun from https://bun.sh/docs/installation." }),
    dotnetCheck(dotnet),
    versionCheck("claude", "Claude Code", claude, {
      fix: "Install Claude Code from https://code.claude.com/docs/en/setup.",
    }),
    claudeAuth,
    versionCheck("codex", "Codex (optional)", codex, {
      required: false,
      fix: "Optional. Install with npm install -g @openai/codex.",
    }),
    vm,
    env,
    database,
    api,
    terminal,
    browser,
  ];
  return checks.map((check) => (check.status === "ok" ? { ...check, fix: "" } : check));
}
