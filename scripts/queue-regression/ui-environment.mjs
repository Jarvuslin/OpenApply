import { appendFileSync } from "node:fs";
import { cp, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ports } from "../apply-e2e/environment-preflight.mjs";
import {
  fetchJson,
  guestToHostBridge,
  managedProcess,
  portOpen,
  waitFor,
} from "../apply-e2e/processes.mjs";
import {
  assertSourceStage,
  createRuntimeWorkspace,
  stageSourceTree,
  webStageExclusions,
} from "../apply-e2e/source-stage.mjs";

export async function startQueueUi({
  root,
  evidenceDir,
  identity,
  runId,
  env,
  commandFor,
  inGuest,
  additionalHostPorts = [],
}) {
  for (const port of [ports.api, ports.web])
    if (await portOpen(port)) throw new Error("A queue UI regression port is occupied.");
  const workspace = await createRuntimeWorkspace(root);
  const sources = [];
  const owned = [];
  const apiUrl = `http://127.0.0.1:${ports.api}`;
  const webUrl = `http://127.0.0.1:${ports.web}`;
  const cdpUrl = `http://127.0.0.1:${ports.browser}`;
  const onLifecycle = (event) =>
    appendFileSync(path.join(evidenceDir, "owned-processes.jsonl"), `${JSON.stringify(event)}\n`, {
      mode: 0o600,
    });
  const start = (role, command, options) => {
    const process = managedProcess(command, { ...options, role, onLifecycle });
    owned.push(process);
    return process;
  };
  const cleanup = async () => {
    const results = await Promise.allSettled(owned.reverse().map((process) => process.stop()));
    if (results.some((result) => result.status === "rejected"))
      throw new Error("A dedicated UI process did not confirm shutdown.");
  };
  try {
    for (const [name, relative, excluded, rootExcluded] of [
      ["web", "apps/web", webStageExclusions, []],
      [
        "api",
        "apps/api",
        ["node_modules", "dist", "coverage", "tsconfig.tsbuildinfo"],
        [".temp", "storage"],
      ],
      ["packages", "packages", ["node_modules", "dist", "tsconfig.tsbuildinfo"], []],
    ])
      sources.push(
        await stageSourceTree({
          name,
          source: path.join(root, relative),
          directory: path.join(workspace, relative),
          excluded,
          rootExcluded,
        }),
      );
    for (const relative of ["node_modules", "apps/api/node_modules", "apps/web/node_modules"])
      await symlink(
        path.join(root, relative),
        path.join(workspace, relative),
        process.platform === "win32" ? "junction" : "dir",
      );
    await cp(path.join(root, "package.json"), path.join(workspace, "package.json"));
    await writeFile(
      path.join(evidenceDir, "source-inventories.json"),
      JSON.stringify(sources, null, 2),
    );
    const api = start("queue-ui-api", ["bun", "run", "src/app.ts"], {
      cwd: path.join(workspace, "apps/api"),
      env,
    });
    await waitFor(() => fetchJson(`${apiUrl}/health`), 60_000, api.assertRunning);
    const web = start(
      "queue-ui-web",
      [
        "bun",
        "run",
        "next",
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(ports.web),
      ],
      {
        cwd: path.join(workspace, "apps/web"),
        env: {
          ...process.env,
          NEXT_PUBLIC_API_URL: apiUrl,
          INTERNAL_API_URL: apiUrl,
          NEXT_PUBLIC_TERMINAL_URL: `http://127.0.0.1:${ports.companion}`,
          OPENAPPLY_WEB_DIST_DIR: ".next",
          PUBLIC_SITE_ENABLED: "false",
        },
      },
    );
    await waitFor(
      async () => (await fetch(`${webUrl}/login`, { signal: AbortSignal.timeout(5000) })).ok,
      120_000,
      web.assertRunning,
    );
    const guestFree = await inGuest([
      "node",
      "-e",
      "const net=require('node:net');const s=net.createServer();s.once('error',()=>process.exit(1));s.listen(Number(process.argv[1]),'127.0.0.1',()=>s.close());",
      String(ports.browser),
    ]);
    if (guestFree) throw new Error("Unexpected browser preflight response.");
    await inGuest(["mkdir", "-m", "700", identity.guestDir]);
    const guestProcessPath = `${identity.guestDir}/processes-guest.mjs`;
    await inGuest(
      [
        "node",
        "-e",
        "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{mode:0o600,flag:'wx'})",
        guestProcessPath,
      ],
      { input: await readFile(path.join(root, "scripts/apply-e2e/processes-guest.mjs"), "utf8") },
    );
    const browserDir = `/home/pilot/openapply/apply-e2e/${runId}-${identity.database.slice(10)}`;
    await inGuest(["mkdir", "-p", `${browserDir}/profile`]);
    await inGuest(["chown", "-R", "pilot:pilot", browserDir]);
    await inGuest(["chmod", "700", browserDir]);
    const browser = start(
      "queue-ui-browser",
      commandFor([
        "node",
        guestProcessPath,
        "browser",
        `${browserDir}/profile`,
        String(ports.browser),
      ]),
      { requireCleanExit: true },
    );
    await waitFor(
      async () =>
        JSON.parse(
          await inGuest([
            "node",
            "-e",
            "fetch(process.argv[1]+'/json/version').then(r=>r.json()).then(v=>process.stdout.write(JSON.stringify({ready:!!v.webSocketDebuggerUrl}))).catch(()=>process.exit(1))",
            cdpUrl,
          ]),
        ).ready,
      60_000,
      browser.assertRunning,
    );
    const forwardedPorts = [...new Set([ports.web, ports.api, ...additionalHostPorts])];
    if (forwardedPorts.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535))
      throw new Error("Invalid isolated UI forwarding port.");
    const forwarding = guestToHostBridge(
      commandFor(["node", guestProcessPath, "forward", ...forwardedPorts.map(String)]),
      forwardedPorts,
      { role: "queue-ui-forwarder", onLifecycle },
    );
    owned.push(forwarding);
    await waitFor(() => forwarding.ready(), 60_000, forwarding.assertRunning);
    return {
      apiUrl,
      webUrl,
      cdpUrl,
      guestDir: identity.guestDir,
      guestCommand: inGuest,
      cleanup,
      assertSources: async () => {
        for (const source of sources) await assertSourceStage(source);
      },
    };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new Error(`${error.message} Cleanup: ${cleanupError.message}`);
    }
    throw error;
  }
}
