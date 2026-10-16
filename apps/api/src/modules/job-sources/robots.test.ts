import { parseRobots, robotsAllows, rulesForStatus } from "./robots";
import { expect, it } from "bun:test";

it("reads only the rules for every crawler, with wildcards, end anchors and the longest match", () => {
  const rules = parseRobots(`User-agent: LinkedInBot
Allow: /v1/companies/

User-agent: Googlebot
User-agent: *
Allow: /*.json$
Disallow: /
Crawl-delay: 2

User-agent: AhrefsBot
Disallow: /jobs`);
  expect(rules.crawlDelay).toBe(2);
  expect(robotsAllows(rules, "/v0/item/8863.json")).toBe(true);
  expect(robotsAllows(rules, "/v0/item/8863.json?print=pretty")).toBe(false);
  expect(robotsAllows(rules, "/v1/companies/acme")).toBe(false);
});

it("lets Allow win a tie and matches a site path regardless of case when asked", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /RBCGLOBAL1/\nAllow: /RBCEARLYTALENT1/");
  expect(robotsAllows(rules, "/rbcglobal1/")).toBe(true);
  expect(robotsAllows(rules, "/rbcglobal1/", true)).toBe(false);
  expect(robotsAllows(rules, "/rbcearlytalent1/", true)).toBe(true);
  expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /a\nAllow: /a"), "/a")).toBe(true);
});

it("allows everything when robots.txt is missing and blocks when it cannot be read", () => {
  expect(robotsAllows(rulesForStatus(404, "")!, "/anything")).toBe(true);
  expect(rulesForStatus(503, "")).toBeNull();
});
