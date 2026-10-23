import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNavigationAllowed,
  accountRequestKind,
  accountTarget,
  accountVerificationInput,
} from "./account-browser-policy.mjs";

const snapshot = {
  version: 2,
  purpose: "account_setup",
  provider: "claude",
  submissionAllowed: false,
  maxSignupAttempts: 1,
  signupUrl: "https://fixture.wd5.myworkdayjobs.com/Careers",
  tenantOrigin: "https://fixture.wd5.myworkdayjobs.com",
};
const target = accountTarget(snapshot);
test("only reviewed account tenants and explicit local fixtures are accepted", () => {
  for (const change of [
    { version: 1 },
    { submissionAllowed: true },
    { maxSignupAttempts: 2 },
    { signupUrl: `${snapshot.signupUrl}/job/123` },
    { signupUrl: "https://evil.example/Careers" },
    { signupUrl: `${snapshot.signupUrl}?token=hidden` },
  ])
    assert.throws(() => accountTarget({ ...snapshot, ...change }));
  const local = {
    ...snapshot,
    signupUrl: "http://localhost:1234/Careers",
    tenantOrigin: "http://localhost:1234",
  };
  assert.throws(() => accountTarget(local));
  assert.equal(accountTarget(local, true).fixture, true);
});
test("account HTTP allowlist denies application, arbitrary writes, and off-tenant requests", () => {
  assert.equal(
    accountRequestKind(target, `${target.origin}/wday/authgwy/fixture/createAccount`, "POST", "{}"),
    "signup",
  );
  assert.equal(
    accountRequestKind(target, `${target.origin}/wday/authgwy/fixture/login`, "POST", "{}"),
    "login",
  );
  assert.equal(
    accountRequestKind(target, `${target.origin}/wday/authgwy/fixture/verifyEmail`, "POST", "{}"),
    "verify",
  );
  assert.equal(
    accountRequestKind(
      target,
      `${target.origin}/en-US/Careers/register`,
      "POST",
      "username=fixture",
    ),
    "signup",
  );
  assert.equal(
    accountRequestKind(target, `${target.origin}/en-US/Careers/login`, "POST", "username=fixture"),
    "login",
  );
  assert.equal(
    accountRequestKind(target, `${target.origin}/en-US/OtherSite/register`, "POST", "{}"),
    "deny",
  );
  for (const path of [
    "/api/applications",
    "/wday/cxs/fixture/Careers/apply",
    "/upload",
    "/resumes",
    "/arbitrary",
    "/wday/authgwy/another-tenant/createAccount",
    "/wday/authgwy/another-tenant/login",
  ])
    assert.equal(accountRequestKind(target, target.origin + path, "POST", "{}"), "deny");
  assert.equal(
    accountRequestKind(target, "https://elsewhere.example/signup", "POST", "{}"),
    "deny",
  );
  assert.equal(
    accountRequestKind(target, `${target.origin}/wday/authgwy/fixture/login`, "PUT", "{}"),
    "deny",
  );
  assert.equal(
    accountRequestKind(
      target,
      `${target.origin}/wday/authgwy/fixture/login`,
      "POST",
      "x".repeat(16001),
    ),
    "deny",
  );
});
test("navigation and verification-bearing reads stay in account routes", () => {
  assert.equal(accountNavigationAllowed(target, `${target.origin}/en-US/Careers/login`), true);
  for (const path of [
    "/Careers/job/123",
    "/Careers/apply",
    "/Careers/arbitrary",
    "/OtherSite/login",
  ])
    assert.equal(accountNavigationAllowed(target, target.origin + path), false);
  assert.equal(
    accountRequestKind(target, `${target.origin}/Careers/verifyEmail?token=fixture`, "GET"),
    "verification_link",
  );
});
test("only the job-list read POST has an explicit non-account exception", () => {
  const url = `${target.origin}/wday/cxs/fixture/Careers/jobs`;
  assert.equal(accountRequestKind(target, url, "POST", '{"limit":20,"offset":0}'), "read");
  assert.equal(accountRequestKind(target, url, "POST", '{"submitApplication":true}'), "deny");
  assert.equal(
    accountRequestKind(
      target,
      `${target.origin}/wday/cxs/another-tenant/Careers/jobs`,
      "POST",
      "{}",
    ),
    "deny",
  );
  assert.equal(
    accountRequestKind(target, `${target.origin}/wday/cxs/fixture/OtherSite/jobs`, "POST", "{}"),
    "deny",
  );
});
test("Workday static assets are readable without allowing CDN writes or arbitrary cross-origin reads", () => {
  for (const host of ["wd5.myworkday.com", "wd5.myworkdaycdn.com"]) {
    const asset = `https://${host}/wday/asset/candidate-experience-jobs/cx-jobs.min.js`;
    assert.equal(accountRequestKind(target, asset, "GET"), "asset");
    assert.equal(
      accountRequestKind(
        target,
        `https://${host}/wday/asset/candidate-experience-jobs/compiled-lang/cxs_account_creation/en-US.json`,
        "GET",
      ),
      "asset",
    );
    assert.equal(accountRequestKind(target, asset, "POST", "{}"), "deny");
    assert.equal(accountRequestKind(target, `${asset}?secret=fixture`, "GET"), "deny");
    assert.equal(
      accountRequestKind(
        target,
        `https://${host}/wday/authgwy/fixture/createAccount`,
        "POST",
        "{}",
      ),
      "deny",
    );
    assert.equal(accountNavigationAllowed(target, asset), false);
  }
  assert.equal(
    accountRequestKind(
      target,
      "https://wd2.myworkdaycdn.com/wday/asset/candidate-experience-jobs/cx-jobs.min.js",
      "GET",
    ),
    "deny",
  );
});
test("fresh verification evidence must match mailbox, tenant, sender and request", () => {
  const request = {
    email: "synthetic@example.test",
    tenantOrigin: target.origin,
    requestedAt: "2026-10-09T10:00:00Z",
    senderDomains: ["myworkday.com"],
    linkOrigin: target.origin,
    linkPathPrefix: target.path,
  };
  const input = {
    recipient: request.email,
    tenantOrigin: target.origin,
    sender: "notice@myworkday.com",
    receivedAt: "2026-10-09T10:00:01Z",
    code: "123456",
  };
  const now = Date.parse("2026-10-09T10:01:00Z");
  assert.equal(accountVerificationInput(request, input, now), true);
  for (const change of [
    { recipient: "someone@example.test" },
    { sender: "notice@evilmyworkday.com" },
    { tenantOrigin: "https://elsewhere.example" },
    { receivedAt: "2026-10-09T09:59:59Z" },
    { receivedAt: "2026-10-10T10:00:00Z" },
    { link: `${target.origin}/Careers/verifyEmail?token=fixture` },
  ])
    assert.equal(accountVerificationInput(request, { ...input, ...change }, now), false);
  assert.equal(
    accountVerificationInput(
      request,
      { ...input, code: undefined, link: `${target.origin}/Careers/verifyEmail?token=fixture` },
      now,
    ),
    true,
  );
  assert.equal(
    accountVerificationInput(
      request,
      { ...input, code: undefined, link: "https://elsewhere.example/verify" },
      now,
    ),
    false,
  );
  assert.equal(
    accountVerificationInput(
      { ...request, linkPathPrefix: "/en-US/Careers" },
      { ...input, code: undefined, link: `${target.origin}/Careers/activate/fixture` },
      now,
    ),
    true,
  );
});
