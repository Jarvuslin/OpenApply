import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SYNTHETIC_APPLICANT } from "./cases.mjs";
import { setupFixture } from "./fixture-test-helpers.mjs";

const playwrightModule =
  process.env.OPENAPPLY_E2E_BROWSER_TEST_MODULE ??
  "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs";
const browserExecutable = process.env.OPENAPPLY_E2E_BROWSER_TEST_EXECUTABLE ?? "/usr/bin/chromium";
const browserUnavailable =
  !existsSync(playwrightModule) || !existsSync(browserExecutable)
    ? "Run in the browser guest with its installed Playwright and Chromium."
    : false;

test("Chromium form POST preserves the fixture origin; no-referrer reproduces the rejected null origin", {
  skip: browserUnavailable,
  timeout: 30_000,
}, async (t) => {
  const fixture = await setupFixture(t);
  const { chromium } = await import(pathToFileURL(playwrightModule).href);
  const browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
    args: ["--no-sandbox"],
    timeout: 15_000,
  });
  t.after(() => browser.close());
  const job = fixture.manifest.cases.find((item) => item.id === "unfamiliar");
  for (const legacyPolicy of [false, true]) {
    const page = await browser.newPage();
    if (legacyPolicy) {
      await page.route(`${job.url}/start`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: { ...response.headers(), "referrer-policy": "no-referrer" },
        });
      });
    }
    await page.goto(`${job.url}/start`);
    // Empty identity fields reach validation without recording any application.
    await page.locator("form").evaluate((form) => {
      form.noValidate = true;
    });
    const pending = page.waitForResponse(
      (response) =>
        response.url() === `${job.url}/step/1` && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "Continue to eligibility", exact: true }).click();
    const response = await pending;
    const headers = await response.request().allHeaders();
    assert.equal(headers.origin, legacyPolicy ? "null" : fixture.origin);
    assert.equal(response.status(), legacyPolicy ? 403 : 422);
    await page.close();
  }
  const result = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.deepEqual(result.submissions, []);
  assert.deepEqual(result.submissionRequests, {});
});

test("Chromium renders all four layouts and keeps authorization independent of conditional sponsorship", {
  skip: browserUnavailable,
  timeout: 45_000,
}, async (t) => {
  const fixture = await setupFixture(t);
  const { chromium } = await import(pathToFileURL(playwrightModule).href);
  const browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
    args: ["--no-sandbox"],
    timeout: 15_000,
  });
  t.after(() => browser.close());
  for (const job of fixture.manifest.cases) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${job.url}${job.entryPath}`);
    assert.equal(await page.locator("body").getAttribute("data-layout"), job.id);
    for (const name of job.nameFields)
      await page.locator(`[name="${name}"]`).fill(SYNTHETIC_APPLICANT[name]);
    await page.locator('[name="email"]').fill(SYNTHETIC_APPLICANT.email);
    if (job.id === "unfamiliar") {
      await Promise.all([
        page.waitForURL(`${job.url}/step/1`),
        page.getByRole("button", { name: "Continue to eligibility" }).click(),
      ]);
      await page.getByText("Page 2 of 3", { exact: true }).waitFor();
    }
    const details = page.locator('[name="sponsorshipDetails"]');
    assert.equal(await details.isVisible(), false);
    const answer = async (name, value) => {
      if (job.id === "greenhouse") await page.locator(`select[name="${name}"]`).selectOption(value);
      else await page.locator(`input[name="${name}"][value="${value}"]`).check();
    };
    await answer("workAuthorization", "yes");
    await answer(job.sponsorshipField, job.expectedSponsorship);
    assert.equal(await details.isVisible(), true);
    assert.equal(await details.isEnabled(), true);
    assert.equal(await details.evaluate((input) => input.required), true);
    await details.fill(SYNTHETIC_APPLICANT.sponsorshipDetails);
    await answer(job.sponsorshipField, job.expectedSponsorship === "yes" ? "no" : "yes");
    assert.equal(await details.isVisible(), false);
    assert.equal(await details.isEnabled(), false);
    await answer(job.sponsorshipField, job.expectedSponsorship);
    const authorizationSelector =
      job.id === "greenhouse"
        ? 'select[name="workAuthorization"]'
        : 'input[name="workAuthorization"]:checked';
    assert.equal(await page.locator(authorizationSelector).inputValue(), "yes");
    if (job.id === "unfamiliar") {
      await Promise.all([
        page.waitForURL(`${job.url}/step/2`),
        page.getByRole("button", { name: "Continue to documents" }).click(),
      ]);
      await page.getByText("Page 3 of 3", { exact: true }).waitFor();
      assert.equal(
        await page.locator('input[type="hidden"][name="workAuthorization"]').inputValue(),
        "yes",
      );
      assert.equal(
        await page.locator('input[type="hidden"][name="needsSponsorship"]').inputValue(),
        "yes",
      );
    }
    assert.equal(await page.locator('[name="resume"]').isVisible(), true);
    assert.equal(await page.locator('[name="whyUs"]').isVisible(), true);
    await page.close();
  }
  const result = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.deepEqual(result.submissions, []);
  assert.deepEqual(result.submissionRequests, {});
});
