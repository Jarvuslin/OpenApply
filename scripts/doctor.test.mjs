import assert from "node:assert/strict";
import test from "node:test";
import {
  claudeAuthCheck,
  doctorFailed,
  dotnetCheck,
  formatChecks,
  migrationCheck,
  nodeCheck,
  terminalCheck,
  vmCheck,
} from "./doctor.mjs";

const STATUSES = new Set(["ok", "fail", "warn", "unknown"]);

function assertShape(check) {
  assert.deepEqual(Object.keys(check).sort(), [
    "detail",
    "fix",
    "id",
    "label",
    "required",
    "status",
  ]);
  assert.ok(STATUSES.has(check.status));
  assert.equal(typeof check.required, "boolean");
}

test("Node below 22 fails and 22 or newer passes", () => {
  assert.equal(nodeCheck("v20.11.0").status, "fail");
  assert.equal(nodeCheck("v22.0.0").status, "ok");
  assertShape(nodeCheck("v24.1.0"));
});

test(".NET passes wherever the SDK is, warns when a bare dotnet differs, fails with none", () => {
  assert.equal(
    dotnetCheck({ path: null, version: null, firstOnPath: null, checked: 0 }).status,
    "fail",
  );
  const same = { path: "/a/dotnet", version: "10.0.401", firstOnPath: "/a/dotnet", checked: 1 };
  assert.equal(dotnetCheck(same).status, "ok");
  assert.equal(dotnetCheck({ ...same, firstOnPath: null }).status, "ok");
  const shadowed = dotnetCheck({ ...same, firstOnPath: "/runtime/dotnet", checked: 2 });
  assert.equal(shadowed.status, "warn");
  assert.match(shadowed.detail, /\/runtime\/dotnet/);
  assertShape(shadowed);
});

test("Claude sign-in reads auth status JSON and is unknown when it cannot", () => {
  assert.equal(claudeAuthCheck('{"loggedIn":true,"authMethod":"claude.ai"}').status, "ok");
  assert.equal(claudeAuthCheck('{"loggedIn":false}').status, "fail");
  assert.equal(claudeAuthCheck("error: unknown command 'auth'").status, "unknown");
});

test("migration status separates up to date, pending, unset and stopped databases", () => {
  assert.equal(migrationCheck("103 migrations found\nDatabase schema is up to date!").status, "ok");
  assert.equal(
    migrationCheck("Following migration have not yet been applied:\n2026_x").status,
    "fail",
  );
  assert.equal(migrationCheck("Environment variable not found: DATABASE_URL.").status, "fail");
  assert.equal(migrationCheck("Error: P1001: Can't reach database server").status, "warn");
  const other = migrationCheck("something broke\nfinal error line");
  assert.equal(other.status, "fail");
  assert.equal(other.detail, "final error line");
});

test("VM listing finds the WSL distro through UTF-16 nulls and the Lima VM in NDJSON", () => {
  const wsl = "d\0o\0c\0k\0e\0r\0\r\0\n\0O\0p\0e\0n\0A\0p\0p\0l\0y\0-\0M\0V\0P\0\r\0\n\0";
  assert.equal(vmCheck("wsl", wsl).status, "ok");
  assert.equal(vmCheck("wsl", "Ubuntu\r\n").status, "fail");
  assert.equal(vmCheck("lima", '{"name":"default"}\n{"name":"openapply"}\n').status, "ok");
  assert.equal(vmCheck("lima", "not json\n").status, "fail");
});

test("terminal health reports degraded hosts with their detail", () => {
  assert.equal(terminalCheck({ ok: false }).status, "warn");
  const degraded = terminalCheck({
    ok: true,
    body: { status: "degraded", detail: "plugin missing" },
  });
  assert.equal(degraded.status, "warn");
  assert.equal(degraded.detail, "plugin missing");
  assert.equal(
    terminalCheck({ ok: true, body: { status: "ok", hostVersion: "2.1.38" } }).status,
    "ok",
  );
});

test("only a failed required check fails the doctor, and the text shows each fix", () => {
  const checks = [
    { id: "a", label: "A", status: "ok", required: true, detail: "fine", fix: "" },
    { id: "b", label: "B", status: "fail", required: false, detail: "missing", fix: "Install B." },
    { id: "c", label: "C", status: "unknown", required: true, detail: "?", fix: "Check C." },
  ];
  assert.equal(doctorFailed(checks), false);
  assert.equal(doctorFailed([...checks, { ...checks[0], status: "fail" }]), true);
  const text = formatChecks(checks);
  assert.match(text, /\[FAIL\] B: missing\n\s+Fix: Install B\./);
  assert.match(text, /All required checks passed\./);
});
