import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { accountBrowserProgram } from "./account-browser-core.mjs";

export async function accountBrokerFor(t) {
  // This separate test IPC is absent from the production bootstrap and MCP transport.
  const bootstrap = `const {createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});lines.once('line',async line=>{const module=await import('data:text/javascript;base64,'+Buffer.from(JSON.parse(line).code).toString('base64'));await module.default(lines,({page})=>{const failures=[];page.on('requestfailed',r=>failures.push({url:r.url().split('?')[0],error:r.failure()?.errorText}));page.on('pageerror',e=>failures.push({error:e.message.slice(0,160)}));process.on('message',async message=>{if(message.diagnostics)return process.send({id:message.id,value:failures.slice(0,20)});if(!message.script)return;try{const value=await page.evaluate(message.script);process.send({id:message.id,value});}catch{process.send({id:message.id,error:true});}});process.on('message',async message=>{if(!message.click)return;await page.getByRole('button',{name:message.click,exact:true}).click();process.send({id:message.id,value:true});});});});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (value) => {
    stderr = (stderr + value).slice(-1000);
  });
  const closed = new Promise((resolve) => child.once("exit", resolve));
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve) =>
    lines.once("line", (line) => {
      assert.deepEqual(JSON.parse(line), { ready: true });
      resolve();
    }),
  );
  const complete = (id, value, error) => {
    const request = pending.get(id);
    if (request) {
      pending.delete(id);
      clearTimeout(request.timer);
      error ? request.reject(Error("Account command refused")) : request.resolve(value);
    }
  };
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.requestId) complete(message.requestId, message.result, !message.ok);
  });
  child.on("message", (message) => complete(message.id, message.value, message.error));
  t.after(async () => {
    if (child.connected) child.disconnect();
    child.stdin.end();
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill();
            reject(Error("Browser cleanup timeout: " + stderr));
          }, 10000);
        }),
      ]);
      assert.equal(child.exitCode, 0, stderr);
    } finally {
      clearTimeout(timer);
      for (const item of pending.values()) clearTimeout(item.timer);
    }
  });
  child.stdin.write(JSON.stringify({ code: accountBrowserProgram() }) + "\n");
  await ready;
  const call = (body, ipc = false) =>
    new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error("Account test timeout"));
      }, 25000);
      pending.set(requestId, { resolve, reject, timer });
      if (ipc) child.send({ ...body, id: requestId });
      else child.stdin.write(JSON.stringify({ ...body, requestId }) + "\n");
    });
  return {
    send: (body) => call(body),
    evaluate: (script) => call({ script }, true),
    click: (click) => call({ click }, true),
    diagnostics: () => call({ diagnostics: true }, true),
  };
}
