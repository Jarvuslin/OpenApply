import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./api.mjs", import.meta.url));

export async function runHelper(base, args, env = {}) {
  const child = spawn(process.execPath, [helper, ...args], {
    env: {
      ...process.env,
      OPENAPPLY_API: base,
      OPENAPPLY_API_TOKEN: "test-token",
      OPENAPPLY_WORK_ITEM_ID: "",
      OPENAPPLY_WORK_LEASE_TOKEN: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

export async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "openapply-api-test-"));
  const requests = [];
  const reply = {
    status: 200,
    beforeResponse: async () => {},
    disconnect: false,
    headers: {},
    body: '{"ok":true}',
  };
  const server = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    requests.push({ headers: incoming.headers, bytes: Buffer.concat(chunks), url: incoming.url });
    await reply.beforeResponse();
    if (reply.disconnect) {
      incoming.socket.destroy();
      return;
    }
    response.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
    response.end(reply.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, requests, reply, base: `http://127.0.0.1:${server.address().port}` };
}
