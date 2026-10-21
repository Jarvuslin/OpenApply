import assert from "node:assert/strict";
import test from "node:test";
import { scorePagesValid, scoreSiteAllowed } from "./score-pages.mjs";

const pages = ["https://jobs.lever.co/acme/123", "https://careers.example.com/jobs/9?src=feed"];

test("a scoring run lists one to fifty distinct https job pages", () => {
  assert.equal(scorePagesValid(pages), true);
  assert.equal(scorePagesValid([]), false);
  assert.equal(scorePagesValid([pages[0], pages[0]]), false);
  assert.equal(scorePagesValid(["http://careers.example.com/jobs/9"]), false);
  assert.equal(scorePagesValid(["https://user:pass@careers.example.com/jobs/9"]), false);
  assert.equal(scorePagesValid(["https://careers.example.com:8443/jobs/9"]), false);
  assert.equal(
    scorePagesValid(Array.from({ length: 51 }, (_, index) => `https://a.example/jobs/${index}`)),
    false,
  );
});

test("pages and redirects stay on a listed posting's site", () => {
  assert.equal(scoreSiteAllowed(pages, "https://jobs.lever.co/acme/123/"), true);
  assert.equal(scoreSiteAllowed(pages, "https://careers.example.com/jobs/9?utm=x#top"), true);
  assert.equal(scoreSiteAllowed(pages, "https://careers.example.com/apply/9"), true);
  assert.equal(scoreSiteAllowed(pages, "https://careers.example.com/jobs/9/moved"), true);
  assert.equal(scoreSiteAllowed(pages, "https://login.example.com/sso"), false);
  assert.equal(scoreSiteAllowed(pages, "https://evil.example/jobs/9"), false);
  assert.equal(scoreSiteAllowed(pages, "http://jobs.lever.co/acme/123"), false);
});

test("loopback pages are allowed only for local test fixtures", () => {
  const local = ["http://127.0.0.1:4555/job"];
  assert.equal(scorePagesValid(local), false);
  assert.equal(scorePagesValid(local, true), true);
  assert.equal(scoreSiteAllowed(local, "http://127.0.0.1:4555/job", true), true);
});
