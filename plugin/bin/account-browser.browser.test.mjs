import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { accountBrokerFor } from "./account-browser-test-helpers.mjs";

const email = "synthetic@example.test";
const password = "synthetic-only";
const signup = `<form id="account"><label>Email Address<input aria-label="Email Address" type="email"></label><label>Password<input type="password"></label><label>Confirm Password<input type="password"></label><label><input type="checkbox" required>I agree to the Terms</label><button>Create Account</button></form>`;
const verification = `<label>Verification Code<input id="code"></label><button id="verify">Verify</button>`;
const authenticated = `<h1>Candidate Home</h1><button>Sign Out</button><button onclick="fetch('/api/applications',{method:'POST'})">Submit Application</button>`;
const script = `<script>document.addEventListener('submit',async e=>{e.preventDefault();const passwords=[...document.querySelectorAll('input[type=password]')].map(input=>input.value);const terms=document.querySelector('input[type=checkbox]').checked;await fetch('/account/signup',{method:'POST',body:JSON.stringify({email:document.querySelector('input[type=email]').value,passwords,terms})});document.body.innerHTML=${JSON.stringify(verification)};});document.addEventListener('click',async e=>{if(e.target.id==='verify'){await fetch('/account/verify',{method:'POST',body:JSON.stringify({code:document.querySelector('#code').value})});document.body.innerHTML=${JSON.stringify(authenticated.replace(/<button onclick=.*?<\/button>/, ""))};}});</script>`;

async function fixture(t) {
  const counts = { signup: 0, verify: 0, application: 0, arbitrary: 0 };
  const sent = {};
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    if (request.method === "POST") {
      if (request.url === "/account/signup") {
        counts.signup++;
        sent.signup = JSON.parse(body);
      } else if (request.url === "/account/verify") counts.verify++;
      else if (request.url === "/api/applications") counts.application++;
      else counts.arbitrary++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><body>${signup}${script}</body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { origin: `http://127.0.0.1:${server.address().port}`, counts, sent };
}
function owner(origin) {
  const workItemId = randomUUID();
  return {
    action: "start",
    mode: "account_setup",
    runtimeId: randomUUID(),
    workerId: randomUUID(),
    executionId: randomUUID(),
    browserSessionId: randomUUID(),
    workItemId,
    ttlMs: 60000,
    headless: true,
    allowLoopback: true,
    snapshot: {
      version: 2,
      revision: 1,
      operation: "signup",
      purpose: "account_setup",
      provider: "claude",
      workItemId,
      signupUrl: `${origin}/Careers`,
      tenantOrigin: origin,
      credentialId: randomUUID(),
      credentialRevision: "d".repeat(64),
      email,
      submissionAllowed: false,
      maxSignupAttempts: 1,
      snapshotHash: "a".repeat(64),
    },
  };
}
function context(start, change = {}) {
  return {
    snapshot: start.snapshot,
    attempt: {
      signupAttempts: 0,
      begunAt: null,
      mailbox: { email, basis: "user_confirmed" },
      mailboxBlocked: false,
      verification: null,
      ...change,
    },
  };
}
const operate = (broker, current, operation, input = {}) =>
  broker.send({ action: "account", operation, input, context: current });
const credentialFor = (start) => ({ credentialId: start.snapshot.credentialId, email, password });
const signupWith = (broker, current, credential) =>
  broker.send({ action: "account", operation: "signup", input: {}, context: current, credential });

test("account browser denies arbitrary automation and application controls before and during handoff", async (t) => {
  const { origin, counts } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  assert.equal((await broker.send(start)).port, 0);
  assert.equal((await operate(broker, context(start), "inspect")).observation.event, "signup_form");
  for (const action of ["evaluate", "click", "fill", "release", "handoff", "apply", "upload"])
    await assert.rejects(broker.send({ action }));
  await assert.rejects(broker.send({ action: "park", ttlMs: 10000 }));
  await assert.rejects(signupWith(broker, context(start), credentialFor(start)));
  const begun = context(start, { signupAttempts: 1, begunAt: new Date().toISOString() });
  await assert.rejects(operate(broker, begun, "signup"));
  await assert.rejects(
    signupWith(broker, begun, { ...credentialFor(start), credentialId: randomUUID() }),
  );
  assert.equal(await broker.evaluate(`document.querySelector('input[type=password]').value`), "");
  assert.equal(
    await broker.evaluate(`Object.keys(window).filter(key=>key.startsWith('account_')).length`),
    0,
  );
  await operate(broker, begun, "request_help", { reason: "captcha" });
  await broker.send({ action: "park", ttlMs: 30000 });
  for (const path of [
    "/account/signup",
    "/account/login",
    "/account/verify",
    "/api/applications",
    "/arbitrary",
  ]) {
    assert.equal(
      await broker.evaluate(
        `fetch(${JSON.stringify(path)},{method:'POST',body:'{}'}).then(()=>true,()=>false)`,
      ),
      false,
    );
  }
  await broker.evaluate(
    `document.querySelector('input[type=email]').value=${JSON.stringify(email)};document.querySelectorAll('input[type=password]').forEach(input=>input.value='synthetic-only');document.querySelector('input[type=checkbox]').checked=true;document.querySelector('button').click();true`,
  );
  assert.equal(counts.signup, 0);
  assert.deepEqual(counts, { signup: 0, verify: 0, application: 0, arbitrary: 0 });
  await assert.rejects(operate(broker, begun, "inspect"));
});

test("signup fills the saved credential, accepts terms and is sent once", async (t) => {
  const { origin, counts, sent } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  await broker.send(start);
  const begun = context(start, { signupAttempts: 1, begunAt: new Date().toISOString() });
  const result = await signupWith(broker, begun, credentialFor(start));
  assert.equal(result.observation?.event, "verification_pending");
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.deepEqual(sent.signup, { email, passwords: [password, password], terms: true });
  assert.equal(counts.signup, 1);
  assert.equal(
    await broker.evaluate(
      `fetch('/account/signup',{method:'POST',body:'{}'}).then(()=>true,()=>false)`,
    ),
    false,
  );
  await assert.rejects(signupWith(broker, begun, credentialFor(start)));
  assert.equal(counts.signup, 1);
  assert.equal(counts.application, 0);
});

test("a parked human can still finish signup once; no application submission escapes", async (t) => {
  const { origin, counts } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  await broker.send(start);
  const begun = context(start, { signupAttempts: 1, begunAt: new Date().toISOString() });
  await operate(broker, begun, "request_help", { reason: "captcha" });
  await broker.send({ action: "park", ttlMs: 30000 });
  await broker.evaluate(
    `document.querySelector('input[type=email]').value=${JSON.stringify(email)};document.querySelectorAll('input[type=password]').forEach(input=>input.value='synthetic-only');document.querySelector('input[type=checkbox]').checked=true;true`,
  );
  await broker.click("Create Account");
  assert.equal(
    await broker.evaluate(
      `new Promise(resolve=>{let tries=0;const timer=setInterval(()=>{if(document.querySelector('#code')||++tries>50){clearInterval(timer);resolve(Boolean(document.querySelector('#code')))}},20)})`,
    ),
    true,
  );
  assert.equal(counts.signup, 1);
  assert.equal(
    await broker.evaluate(
      `fetch('/account/signup',{method:'POST',body:'{}'}).then(()=>true,()=>false)`,
    ),
    false,
  );
  assert.equal(counts.signup, 1);
  assert.equal(counts.application, 0);
});

test("verification uses fresh scoped evidence and requires observed authentication", async (t) => {
  const { origin, counts } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  await broker.send(start);
  const requestedAt = new Date(Date.now() - 1000).toISOString();
  const current = context(start, {
    signupAttempts: 1,
    begunAt: requestedAt,
    verification: {
      requestedAt,
      recipient: email,
      tenantOrigin: origin,
      senderDomains: ["fixture.example"],
    },
  });
  await broker.evaluate(`document.body.innerHTML=${JSON.stringify(verification)};true`);
  const info = await operate(broker, current, "verification_context");
  assert.equal(
    info.gmailQuery,
    `deliveredto:"${email}" after:${Math.floor(Date.parse(requestedAt) / 1000)} {from:fixture.example}`,
  );
  const evidence = {
    recipient: email,
    tenantOrigin: origin,
    sender: "notice@fixture.example",
    receivedAt: new Date().toISOString(),
    code: "123456",
  };
  await assert.rejects(
    operate(broker, current, "verify", { ...evidence, receivedAt: "2000-01-01T00:00:00Z" }),
  );
  await assert.rejects(
    operate(
      broker,
      { ...current, attempt: { ...current.attempt, mailboxBlocked: true } },
      "verify",
      evidence,
    ),
  );
  const result = await operate(broker, current, "verify", evidence);
  assert.equal(result.observation?.event, "authenticated");
  assert.equal(JSON.stringify(result).includes(evidence.code), false);
  assert.equal(counts.verify, 1);
  assert.equal(counts.signup, 0);
  assert.equal(counts.application, 0);
});

test("application UI is detected and cannot be submitted even in retained human browser", async (t) => {
  const { origin, counts } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  await broker.send(start);
  await broker.evaluate(`document.body.innerHTML=${JSON.stringify(authenticated)};true`);
  assert.equal((await operate(broker, context(start), "inspect")).phase, "application_blocked");
  await operate(broker, context(start), "request_help", { reason: "verification" });
  await broker.send({ action: "park", ttlMs: 30000 });
  await broker.click("Submit Application");
  assert.equal(counts.application, 0);
});

test("terms during verification are accepted before the code is submitted once", async (t) => {
  const { origin, counts } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  await broker.send(start);
  const requestedAt = new Date(Date.now() - 1000).toISOString();
  const current = context(start, {
    signupAttempts: 1,
    begunAt: requestedAt,
    verification: {
      requestedAt,
      recipient: email,
      tenantOrigin: origin,
      senderDomains: ["fixture.example"],
    },
  });
  await broker.evaluate(
    `document.body.innerHTML=${JSON.stringify(verification + '<label><input type="checkbox" required>I accept the Terms</label>')};true`,
  );
  const result = await operate(broker, current, "verify", {
    recipient: email,
    tenantOrigin: origin,
    sender: "notice@fixture.example",
    receivedAt: new Date().toISOString(),
    code: "123456",
  });
  assert.equal(result.observation?.event, "authenticated");
  assert.equal(counts.verify, 1);
  assert.equal(counts.application, 0);
});

test("existing-login operation rejects signup defaults and never exposes a credential", async (t) => {
  const { origin, counts } = await fixture(t);
  const broker = await accountBrokerFor(t);
  const start = owner(origin);
  await broker.send(start);
  await broker.evaluate(
    `document.body.innerHTML='<label>Email Address<input aria-label="Email Address" type="email"></label><input type="password"><button>Sign In</button>';true`,
  );
  await assert.rejects(
    broker.send({
      action: "account",
      operation: "login",
      context: context(start, { credentialPurpose: "signup" }),
      credential: { credentialId: start.snapshot.credentialId, email, password: "synthetic-only" },
    }),
  );
  assert.equal(await broker.evaluate(`document.querySelector('input[type=password]').value`), "");
  assert.equal(counts.signup, 0);
});

test("versioned assets can redirect while an application redirect remains blocked", async (t) => {
  let applicationReads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/assets/app.js") {
      response.writeHead(307, { location: "/assets/v1/app.js" });
      response.end();
      return;
    }
    if (request.url === "/assets/unsafe.js") {
      response.writeHead(307, { location: "/api/applications" });
      response.end();
      return;
    }
    if (request.url === "/api/applications") applicationReads++;
    if (request.url === "/assets/v1/app.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(`document.body.innerHTML=${JSON.stringify(signup)}`);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<!doctype html><body><script src="/assets/app.js"></script><script src="/assets/unsafe.js"></script></body>',
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
  const broker = await accountBrokerFor(t);
  const start = owner(`http://127.0.0.1:${server.address().port}`);
  await broker.send(start);
  assert.equal((await operate(broker, context(start), "inspect")).phase, "signup");
  assert.equal(applicationReads, 0);
});
