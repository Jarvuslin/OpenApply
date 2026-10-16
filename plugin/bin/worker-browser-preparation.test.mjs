import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { skip } from "./preparation-test-helpers.mjs";
import { brokerFor } from "./worker-browser-test-helpers.mjs";

test("owned intake browser has no CDP port, inspects once, blocks writes and cannot hand off", {
  skip,
  timeout: 30000,
}, async (t) => {
  let gets = 0,
    posts = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") posts++;
    else gets++;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      `<main>${"Synthetic posting evidence. ".repeat(30)}</main><form><label for="name">Full name</label><input id="name" name="full_name" required><input type="hidden" name="conditional" disabled><button type="submit">Next</button></form><script>fetch('/forbidden',{method:'POST'}).catch(()=>{});try{document.forms[0].requestSubmit()}catch{}</script>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const owner = {
    mode: "intake_prepare",
    runtimeId: randomUUID(),
    workerId: randomUUID(),
    executionId: randomUUID(),
    browserSessionId: randomUUID(),
    workItemId: randomUUID(),
    jobId: randomUUID(),
    url: `http://127.0.0.1:${server.address().port}/job`,
    allowLoopback: true,
    ttlMs: 30000,
  };
  const broker = await brokerFor(t);
  const start = await broker.send({ action: "start", ...owner });
  assert.equal(start.port, 0);
  await assert.rejects(access(`${start.outputDir}/profile/DevToolsActivePort`));
  const observation = await broker.send({ action: "inspect" });
  assert.equal(observation.submissionAllowed, false);
  assert.equal(observation.truncated, false);
  assert.match(observation.description, /Synthetic posting evidence/);
  assert.equal(observation.sourceUrl, owner.url);
  assert.equal(observation.coverage, "partial");
  assert.ok(
    observation.definitions.some((question) =>
      question.fields.some((field) => field.key === "full_name"),
    ),
  );
  assert.equal(posts, 0);
  assert.ok(gets >= 1);
  for (const command of [
    { action: "inspect" },
    { action: "prepare", config: {} },
    { action: "handoff", manifestHash: "a".repeat(64) },
  ])
    await assert.rejects(broker.send(command));
  await assert.rejects(broker.send({ action: "frame", ...owner, executionId: randomUUID() }));
  const frame = await broker.send({
    action: "frame",
    workItemId: owner.workItemId,
    executionId: owner.executionId,
    browserSessionId: owner.browserSessionId,
  });
  assert.equal(frame.mimeType, "image/jpeg");
  assert.equal(frame.width, 1280);
  assert.equal(frame.height, 720);
  const bytes = Buffer.from(frame.imageBase64, "base64");
  assert.ok(bytes.length > 100 && bytes.length <= 640000);
  assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]);
  assert.deepEqual([...bytes.subarray(-2)], [255, 217]);
  assert.equal(posts, 0);
});
