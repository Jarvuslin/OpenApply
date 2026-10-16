import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const [mode, ...args] = process.argv.slice(2);
const timeout = setTimeout(() => stop(), 90 * 60_000);
timeout.unref();
const resources = [];
let browser;
let browserClosed;
let stopping;
const sockets = new Map();
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = readline.createInterface({ input: process.stdin });
const shutdown = async () => {
  clearTimeout(timeout);
  const deadline = setTimeout(() => process.exit(2), 8000);
  for (const socket of sockets.values()) socket.destroy();
  await Promise.all(resources.map((resource) => resource.close()));
  if (browser?.pid) {
    try {
      process.kill(-browser.pid, "SIGTERM");
    } catch {}
    await browserClosed;
  }
  clearTimeout(deadline);
  process.exit(0);
};
const stop = () => {
  stopping ??= shutdown().catch(() => process.exit(1));
  return stopping;
};
lines.on("close", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

if (mode === "forward") {
  let nextId = 0;
  const ports = args.map(Number);
  if (!ports.length || ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535))
    throw new Error("Invalid scoped forwarding port.");
  for (const port of ports) {
    const server = net.createServer((socket) => {
      const id = ++nextId;
      sockets.set(id, socket);
      send({ type: "open", id, port });
      socket.on("data", (data) => send({ type: "data", id, data: data.toString("base64") }));
      socket.on("end", () => send({ type: "end", id }));
      socket.on("error", () => send({ type: "close", id }));
      socket.on("close", () => {
        sockets.delete(id);
        send({ type: "close", id });
      });
    });
    resources.push({
      close: () =>
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  }
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const socket = sockets.get(message.id);
    if (!socket) return;
    if (message.type === "data") socket.write(Buffer.from(message.data, "base64"));
    if (message.type === "end") socket.end();
    if (message.type === "close") socket.destroy();
  });
  send({ type: "ready" });
} else if (mode === "fixture") {
  const [modulePath, runId, outputDir, port] = args;
  const { startFixtureServer } = await import(pathToFileURL(modulePath).href);
  const server = await startFixtureServer({ port: Number(port), runId, outputDir });
  resources.push(server);
  send({ type: "ready" });
} else if (mode === "browser") {
  const [profile, port] = args;
  if (
    !/^\/home\/pilot\/openapply\/apply-e2e\/[a-zA-Z0-9_-]+\/profile$/.test(profile) ||
    port !== "19222"
  )
    throw new Error("Invalid dedicated browser configuration.");
  const uid = Number(execFileSync("id", ["-u", "pilot"], { encoding: "utf8" }).trim());
  const gid = Number(execFileSync("id", ["-g", "pilot"], { encoding: "utf8" }).trim());
  browser = spawn(
    "chromium",
    [
      "--ozone-platform=x11",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--disable-dev-shm-usage",
      "--new-window",
      "--window-size=1366,900",
      "about:blank",
    ],
    {
      uid,
      gid,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        HOME: "/home/pilot",
        DISPLAY: ":99",
        WAYLAND_DISPLAY: "",
        XDG_SESSION_TYPE: "x11",
      },
    },
  );
  browser.on("error", () => process.exit(1));
  browserClosed = new Promise((resolve) =>
    browser.on("close", (code) => {
      resolve();
      if (!stopping) process.exit(code ?? 1);
    }),
  );
  send({ type: "ready" });
} else {
  throw new Error("Unknown guest process mode.");
}
