import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fetchJson,
  hostToGuestBridge,
  managedProcess,
  portOpen,
  runCommand,
  waitFor,
} from "./processes.mjs";

test("process failures and timeouts withhold sensitive command output", async () => {
  await assert.rejects(
    runCommand([
      process.execPath,
      "-e",
      "console.error('secret-output'); console.log('secret-output'); process.exit(7)",
    ]),
    (error) => {
      assert.doesNotMatch(error.message, /secret-output/);
      assert.match(error.message, /exited with 7/);
      return true;
    },
  );
  await assert.rejects(
    runCommand([process.execPath, "-e", "setInterval(()=>{},1000)"], { timeout: 50 }),
    /timed out/,
  );
});

test("captured commands accept stdin without exposing it as an argument", async () => {
  const result = await runCommand([process.execPath, "-e", "process.stdin.pipe(process.stdout)"], {
    input: "synthetic-input",
  });
  assert.equal(result, "synthetic-input");
});

test("command timeout awaits its child and grandchild tree while preserving an unrelated process", {
  timeout: 20_000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openapply-command-tree-"));
  const marker = path.join(directory, "pids.jsonl");
  const unrelated = managedProcess([
    process.execPath,
    "-e",
    "process.stdin.resume();process.stdin.on('end',()=>process.exit());",
  ]);
  let pids = [];
  try {
    const record =
      "require('node:fs').appendFileSync(process.argv[1],JSON.stringify({pid:process.pid})+'\\n');";
    const grandchild = `${record}process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    const child = `${record}require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)},process.argv[1]],{stdio:'inherit',windowsHide:true});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    const parent = `${record}require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)},process.argv[1]],{stdio:'inherit',windowsHide:true});console.log('private-command-output');setInterval(()=>{},1000);`;
    const started = Date.now();
    await assert.rejects(
      runCommand([process.execPath, "-e", parent, marker], { timeout: 1500 }),
      (error) => {
        assert.match(error.message, /timed out/);
        assert.doesNotMatch(error.message, /private-command-output/);
        return true;
      },
    );
    assert.ok(Date.now() - started < 13_000, "Owned cleanup must remain bounded.");
    pids = (await readFile(marker, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).pid);
    assert.equal(pids.length, 3, "The fixture must start both descendant generations.");
    for (const pid of pids)
      assert.throws(
        () => process.kill(pid, 0),
        (error) => error.code === "ESRCH",
        "Timeout must not acknowledge while a descendant remains alive.",
      );
    unrelated.assertRunning();
  } finally {
    if (!pids.length) {
      try {
        pids = (await readFile(marker, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).pid);
      } catch {}
    }
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await unrelated.stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("openapply-command-tree-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("output overflow fails after owned cleanup and never returns a partial successful capture", async () => {
  await assert.rejects(
    runCommand(
      [
        process.execPath,
        "-e",
        "process.stdout.write('x'.repeat(8_100_000));setInterval(()=>{},1000)",
      ],
      { timeout: 5000 },
    ),
    /output limit/,
  );
});

test("readiness fails immediately when its service exits instead of consuming the timeout", async () => {
  let probes = 0;
  await assert.rejects(
    waitFor(
      async () => {
        probes++;
        return false;
      },
      30_000,
      () => {
        throw new Error("Service has exited.");
      },
    ),
    /Service has exited/,
  );
  assert.equal(probes, 0);
});

test("managed stop ends only its own process and is safe to repeat", async () => {
  const own = managedProcess([
    process.execPath,
    "-e",
    "process.stdin.resume();process.stdin.on('end',()=>process.exit());",
  ]);
  own.assertRunning();
  await own.stop();
  await own.stop();
  assert.throws(() => own.assertRunning(), /exited/);
});

test("guest shutdown awaits delayed fixture persistence and closes only once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openapply-guest-shutdown-"));
  const modulePath = path.join(directory, "fixture.mjs");
  const marker = path.join(directory, "closed.json");
  await writeFile(
    modulePath,
    `import {writeFile} from 'node:fs/promises'; export async function startFixtureServer({outputDir}) { let closes=0; return { async close(){ closes++; await new Promise(resolve=>setTimeout(resolve,250)); await writeFile(outputDir,JSON.stringify({closes})); } }; }`,
  );
  const guest = managedProcess(
    [
      process.execPath,
      fileURLToPath(new URL("./processes-guest.mjs", import.meta.url)),
      "fixture",
      modulePath,
      "shutdown-test",
      marker,
      "14110",
    ],
    { protocol: true },
  );
  await once(guest.child.stdout, "data");
  await Promise.all([guest.stop(), guest.stop()]);
  assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), { closes: 1 });
  assert.equal(guest.child.exitCode, 0);
});

test("an already exited guest still reports an unclean shutdown", async () => {
  const guest = managedProcess([process.execPath, "-e", "process.exit(3)"], {
    requireCleanExit: true,
  });
  await once(guest.child, "close");
  await assert.rejects(guest.stop(), /without confirming a clean shutdown/);
});

test("owned process journal records lifecycle metadata without commands or environment", async () => {
  const records = [];
  const child = managedProcess(
    [process.execPath, "-e", "console.log('private-output');process.exit(4)", "private-argument"],
    {
      env: { ...process.env, PRIVATE_TEST_TOKEN: "private-token" },
      role: "fixture-test",
      onLifecycle: (record) => records.push(record),
    },
  );
  await once(child.child, "close");
  assert.deepEqual(
    records.map((record) => record.event),
    ["spawn", "exit"],
  );
  assert.equal(records[1].code, 4);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), [
      "code",
      "event",
      "parent",
      "pid",
      "role",
      "signal",
      "time",
    ]);
    assert.equal(record.pid, child.child.pid);
    assert.equal(record.parent, process.pid);
    assert.equal(record.role, "fixture-test");
    assert.ok(Number.isFinite(Date.parse(record.time)));
  }
  assert.doesNotMatch(JSON.stringify(records), /private-(?:output|argument|token)/);
});

test("host to guest transport forwards through its explicit command and closes cleanly", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ fixture: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const guestPort = server.address().port;
  const reserved = createServer();
  await new Promise((resolve) => reserved.listen(0, "127.0.0.1", resolve));
  const hostPort = reserved.address().port;
  await new Promise((resolve) => reserved.close(resolve));
  const bridge = await hostToGuestBridge(hostPort, guestPort, (args) => [
    process.execPath,
    ...args.slice(1),
  ]);
  try {
    assert.equal(await portOpen(hostPort), true);
    assert.deepEqual(await fetchJson(`http://127.0.0.1:${hostPort}`), { fixture: true });
  } finally {
    await bridge.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await portOpen(hostPort), false);
});
