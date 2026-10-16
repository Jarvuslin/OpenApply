import { execFile, spawn } from "node:child_process";
import net from "node:net";
import readline from "node:readline";

export function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Local endpoint returned HTTP ${response.status}.`);
  return response.json();
}

export function runCommand(command, { cwd, env, input, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const owned = managedProcess(command, { cwd, env, protocol: true });
    const { child } = owned;
    let output = "";
    let stopping = false;
    const stop = async (message) => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      try {
        await owned.stop({ force: true });
        reject(new Error(message));
      } catch {
        reject(
          new Error("Environment command cleanup was not confirmed; command output was withheld."),
        );
      }
    };
    const timer = setTimeout(() => {
      void stop("Environment command timed out; command output was withheld.");
    }, timeout);
    child.stdout.on("data", (chunk) => {
      if (stopping) return;
      output += chunk;
      if (output.length > 8_000_000)
        void stop("Environment command exceeded its output limit; command output was withheld.");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Environment command could not start."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (stopping) return;
      if (code === 0) resolve(output.trim());
      else
        reject(new Error(`Environment command exited with ${code}; command output was withheld.`));
    });
    child.stdin.end(input);
  });
}

async function terminateOwnedTree(child, waitForClose) {
  // This PID and POSIX process group come only from our spawn, never a name or port lookup.
  if (process.platform === "win32") {
    try {
      await new Promise((resolve, reject) => {
        execFile(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          {
            timeout: 5000,
            windowsHide: true,
            maxBuffer: 65_536,
          },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    } catch {
      throw new Error("The owned process tree could not confirm termination.");
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await waitForClose(1000);
    // A descendant can ignore SIGTERM even after its parent closes, so finish the owned group.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (!(await waitForClose(5000))) throw new Error("The dedicated process did not confirm exit.");
}

export function managedProcess(command, options = {}) {
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let failure = null;
  const record = (event, code = null, signal = null) => {
    try {
      options.onLifecycle?.({
        role: options.role ?? "process",
        pid: child.pid ?? null,
        parent: process.pid,
        event,
        code,
        signal,
        time: new Date().toISOString(),
      });
    } catch {
      failure = "The process lifecycle journal could not be written.";
    }
  };
  child.once("spawn", () => record("spawn"));
  child.once("exit", (code, signal) => record("exit", code, signal));
  child.on("error", () => {
    failure = "A dedicated process could not start.";
    record("error");
  });
  child.stdin.on("error", () => {});
  child.stderr.resume();
  if (!options.protocol) child.stdout.resume();
  let didClose = false;
  const closed = new Promise((resolve) =>
    child.once("close", (code) => {
      didClose = true;
      resolve(code);
    }),
  );
  let stopping;
  const waitForClose = (milliseconds) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), milliseconds);
      closed.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  const stop = async ({ force = false } = {}) => {
    if (didClose || !child.pid) {
      if (options.requireCleanExit && (child.exitCode !== 0 || child.signalCode !== null))
        throw new Error("The dedicated guest process exited without confirming a clean shutdown.");
      return;
    }
    child.stdin.end();
    if (!force && (await waitForClose(10_000))) {
      if (options.requireCleanExit && child.exitCode !== 0)
        throw new Error("The dedicated guest process failed during graceful shutdown.");
      return;
    }
    await terminateOwnedTree(child, waitForClose);
    if (options.requireCleanExit)
      throw new Error(
        "The dedicated guest process required forced shutdown; evidence flush is unverified.",
      );
  };
  return {
    child,
    assertRunning() {
      if (failure || child.exitCode !== null || child.signalCode !== null)
        throw new Error(failure ?? "A dedicated process exited before acceptance completed.");
    },
    stop(settings) {
      stopping ??= stop(settings);
      return stopping;
    },
  };
}

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitFor(check, timeout = 60_000, assertRunning = () => {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assertRunning();
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await delay(500);
  }
  throw new Error("A dedicated service did not become ready before its deadline.");
}

export async function hostToGuestBridge(port, guestPort, commandFor) {
  const sockets = new Set();
  const children = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const child = spawn(
      ...splitCommand(
        commandFor([
          "node",
          "-e",
          "const s=require('node:net').connect({host:'127.0.0.1',port:Number(process.argv[1])});process.stdin.pipe(s);s.pipe(process.stdout);s.on('error',()=>process.exit(1));s.on('close',()=>process.exit());process.stdin.on('end',()=>s.destroy());",
          String(guestPort),
        ]),
      ),
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
    );
    children.add(child);
    child.on("error", () => socket.destroy());
    child.stdin.on("error", () => socket.destroy());
    socket.on("error", () => {});
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.on("close", () => {
      children.delete(child);
      socket.destroy();
    });
    socket.on("close", () => {
      sockets.delete(socket);
      child.stdin.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    async stop() {
      for (const socket of sockets) socket.destroy();
      for (const child of children) {
        child.stdin.end();
        child.kill();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function splitCommand(command) {
  return [command[0], command.slice(1)];
}

export function guestToHostBridge(command, ports, options = {}) {
  const managed = managedProcess(command, { ...options, protocol: true, requireCleanExit: true });
  const sockets = new Map();
  const allowed = new Set(ports);
  let ready = false;
  let broken = false;
  const send = (message) => {
    if (!managed.child.stdin.destroyed) managed.child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const lines = readline.createInterface({ input: managed.child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      broken = true;
      return;
    }
    if (message.type === "ready") {
      ready = true;
      return;
    }
    if (message.type === "open") {
      if (!allowed.has(message.port) || sockets.has(message.id)) {
        broken = true;
        return;
      }
      const socket = net.connect({ host: "127.0.0.1", port: message.port });
      sockets.set(message.id, socket);
      socket.on("data", (data) =>
        send({ type: "data", id: message.id, data: data.toString("base64") }),
      );
      socket.on("end", () => send({ type: "end", id: message.id }));
      socket.on("error", () => send({ type: "close", id: message.id }));
      socket.on("close", () => {
        sockets.delete(message.id);
        send({ type: "close", id: message.id });
      });
      return;
    }
    const socket = sockets.get(message.id);
    if (!socket) return;
    if (message.type === "data") socket.write(Buffer.from(message.data, "base64"));
    if (message.type === "end") socket.end();
    if (message.type === "close") socket.destroy();
  });
  return {
    ready() {
      managed.assertRunning();
      if (broken) throw new Error("Loopback forwarding protocol failed.");
      return ready;
    },
    assertRunning() {
      managed.assertRunning();
      if (broken) throw new Error("Loopback forwarding protocol failed.");
    },
    async stop() {
      for (const socket of sockets.values()) socket.destroy();
      lines.close();
      await managed.stop();
    },
  };
}
