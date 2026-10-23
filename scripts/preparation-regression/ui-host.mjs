import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fetchJson, managedProcess, portOpen, waitFor } from "../apply-e2e/processes.mjs";

export async function startPreparationHost({
  root,
  evidenceDir,
  commandFor,
  companionPort,
  webUrl,
  fixtureUrl,
}) {
  assert.equal(fixtureUrl, "http://127.0.0.1:14640/form");
  assert.equal(companionPort, 14102);
  if (await portOpen(companionPort))
    throw new Error("Dedicated preparation companion port is occupied.");
  const events = (event) =>
    appendFileSync(
      path.join(evidenceDir, "preparation-processes.jsonl"),
      `${JSON.stringify(event)}\n`,
    );
  const owned = [];
  const requests = [];
  const sources = [];
  for (const relative of [
    "apps/terminal/bin/Release/net10.0/openapply.dll",
    "plugin/bin/prepare-application.mjs",
    "plugin/bin/preparation-fill.mjs",
    "plugin/bin/preparation-preview.mjs",
    "plugin/bin/question-dom.mjs",
    "plugin/bin/question-collector.mjs",
    "plugin/bin/runtime.mjs",
  ]) {
    const bytes = await readFile(path.join(root, relative));
    sources.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const stop = async () => {
    const results = await Promise.allSettled(owned.reverse().map((resource) => resource.stop()));
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Dedicated preparation resource did not stop.");
  };
  const assertSources = async () => {
    for (const source of sources)
      assert.equal(
        createHash("sha256")
          .update(await readFile(path.join(root, source.path)))
          .digest("hex"),
        source.sha256,
        "Preparation runtime changed during UI verification.",
      );
  };
  try {
    const program = `const h=require('node:http');const s=h.createServer((q,r)=>{console.log(JSON.stringify({method:q.method,path:q.url}));if(q.method!=='GET'||q.url!=='/form'){r.writeHead(405);r.end();return;}r.setHeader('content-type','text/html');r.end('<!doctype html><html><body><form><label for="email">Email</label><input id="email" name="email" type="email" required><label for="resume">Resume</label><input id="resume" name="resume" type="file" required accept="application/pdf"><button type="submit">Submit</button></form></body></html>');});s.once('error',()=>process.exit(1));s.listen(14640,'127.0.0.1',()=>console.log(JSON.stringify({ready:true})));process.stdin.resume();process.stdin.once('end',()=>{s.closeAllConnections();s.close(()=>process.exit());});`;
    const fixture = managedProcess(commandFor(["node", "-e", program]), {
      protocol: true,
      requireCleanExit: true,
      role: "preparation-ui-fixture",
      onLifecycle: events,
    });
    owned.push(fixture);
    let ready = false;
    const lines = createInterface({ input: fixture.child.stdout });
    lines.on("line", (line) => {
      const entry = JSON.parse(line);
      if (entry.ready) ready = true;
      else requests.push(entry);
    });
    await waitFor(() => ready, 10000, fixture.assertRunning);
    const companionUrl = `http://127.0.0.1:${companionPort}`;
    const host = managedProcess(
      [
        process.env.OPENAPPLY_TEST_DOTNET_PATH ?? "D:/Dev/tools/dotnet/dotnet.exe",
        path.join(root, "apps/terminal/bin/Release/net10.0/openapply.dll"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          OPENAPPLY_MODEL_BUDGET: '{"maxRequests":0}',
          OPENAPPLY_QUESTION_ALLOW_LOOPBACK: "1",
          Kestrel__Endpoints__Http__Url: companionUrl,
          Terminal__AllowedOrigins__0: webUrl,
        },
        role: "preparation-ui-host",
        onLifecycle: events,
      },
    );
    owned.push(host);
    await waitFor(() => fetchJson(`${companionUrl}/healthz`), 30000, host.assertRunning);
    const assertIdle = async () => {
      const status = await fetchJson(`${companionUrl}/queue/status`);
      assert.equal(status.running, false);
      assert.equal(status.connected, false);
      assert.match(status.blockingReason, /disabled.*budget/);
    };
    await assertIdle();
    return {
      companionUrl,
      stop,
      assertSources,
      async verify() {
        await assertIdle();
        await assertSources();
        assert.equal(requests.length, 1, "Preview must visit the synthetic form once.");
        assert.deepEqual(requests, [{ method: "GET", path: "/form" }]);
        return {
          status: "passed",
          requests,
          sources,
          modelCalls: 0,
          providerCommands: 0,
          employerSubmissions: 0,
        };
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
