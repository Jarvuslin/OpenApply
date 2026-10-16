import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { applicationForm, setupFixture } from "./fixture-test-helpers.mjs";

function contactOnly(form, job) {
  for (const name of [...form.keys()]) {
    if (![...job.nameFields, "email", "idempotencyKey"].includes(name)) form.delete(name);
  }
  return form;
}

test("ATS fixtures have distinct researched DOM structures and control identifiers", async (t) => {
  const fixture = await setupFixture(t);
  const pages = {};
  for (const job of fixture.manifest.cases)
    pages[job.id] = await (await fetch(`${job.url}${job.entryPath}`)).text();
  assert.match(pages.greenhouse, /id="application-form"/);
  assert.match(pages.greenhouse, /id="first_name" name="firstName"/);
  assert.match(pages.greenhouse, /id="last_name" name="lastName"/);
  assert.match(pages.greenhouse, /id="question_1001"/);
  assert.match(pages.lever, /class="application-list"/);
  assert.match(pages.lever, /id="btn-submit"/);
  assert.ok(pages.lever.indexOf('id="resume-upload-input"') < pages.lever.indexOf('id="name"'));
  assert.match(pages.ashby, /role="tab" aria-selected="true"[^>]*>Application/);
  assert.match(pages.ashby, /id="_systemfield_name" name="name"/);
  assert.match(pages.ashby, /id="_systemfield_resume" name="resume"/);
  assert.match(pages.ashby, /class="answer-buttons"/);
  for (const section of ["Foundations", "Qualifications", "Logistics"])
    assert.ok(pages.ashby.includes(`<h2>${section}</h2>`));
  assert.match(pages.unfamiliar, /class="wizard-progress"/);
  assert.match(pages.unfamiliar, /Page 1 of 3/);
  assert.doesNotMatch(pages.unfamiliar, /type="file"/);
  for (const job of fixture.manifest.cases) {
    for (const field of job.fields)
      assert.equal(field.controlId, job.controlIds[field.id] ?? field.id);
  }
});

test("unfamiliar wizard validates three distinct pages and retains previous answers", async (t) => {
  const fixture = await setupFixture(t);
  const job = fixture.manifest.cases.find((entry) => entry.id === "unfamiliar");
  const form = contactOnly(await applicationForm(job), job);
  const response = await fetch(`${job.url}/step/1`, {
    method: "POST",
    body: form,
    headers: { Origin: fixture.origin },
  });
  assert.equal(response.status, 200);
  const next = await response.text();
  assert.match(next, /Page 2 of 3/);
  assert.match(next, /name="name" value="Morgan Fixture"/);
  assert.match(next, /type="radio" name="workAuthorization"/);
  assert.doesNotMatch(next, /type="file"/);
  const invalid = await fetch(`${job.url}/step/2`, {
    method: "POST",
    body: form,
    headers: { Origin: fixture.origin },
  });
  assert.equal(invalid.status, 422);
  const answers = await applicationForm(job);
  answers.delete("whyUs");
  answers.delete("resume");
  const final = await fetch(`${job.url}/step/2`, {
    method: "POST",
    body: answers,
    headers: { Origin: fixture.origin },
  });
  assert.equal(final.status, 200);
  const last = await final.text();
  assert.match(last, /Page 3 of 3/);
  assert.match(last, /name="workAuthorization" value="yes"/);
  assert.match(last, /name="needsSponsorship" value="yes"/);
  assert.match(last, /name="resume" type="file"/);
  answers.delete("sponsorshipDetails");
  const missingConditional = await fetch(`${job.url}/step/2`, {
    method: "POST",
    body: answers,
    headers: { Origin: fixture.origin },
  });
  assert.equal(missingConditional.status, 422);
  const records = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.equal(records.submissions.length, 0);
});

test("conditional select and radio scripts interpret positive and inverse sponsorship correctly", async (t) => {
  const fixture = await setupFixture(t);
  for (const job of fixture.manifest.cases) {
    let html;
    if (job.steps === 1) html = await (await fetch(`${job.url}${job.entryPath}`)).text();
    else {
      const form = contactOnly(await applicationForm(job), job);
      html = await (
        await fetch(`${job.url}/step/1`, {
          method: "POST",
          body: form,
          headers: { Origin: fixture.origin },
        })
      ).text();
    }
    assert.match(html, /id="sponsorship-details"[^>]* hidden/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const textarea = { disabled: true, required: false };
    const details = { hidden: true, querySelector: () => textarea };
    let onChange;
    const addEventListener = (_name, handler) => {
      onChange = handler;
    };
    const controls =
      job.id === "greenhouse"
        ? [{ tagName: "SELECT", value: "", addEventListener }]
        : ["yes", "no"].map((value) => ({
            tagName: "INPUT",
            value,
            checked: false,
            addEventListener,
          }));
    runInNewContext(script, {
      document: { querySelectorAll: () => controls, getElementById: () => details },
      window: { addEventListener: () => {} },
    });
    assert.equal(details.hidden, true);
    for (const value of ["yes", "no", ""]) {
      if (controls.length === 1) controls[0].value = value;
      else for (const control of controls) control.checked = control.value === value;
      onChange();
      const required = value === job.expectedSponsorship;
      assert.equal(details.hidden, !required);
      assert.equal(textarea.disabled, !required);
      assert.equal(textarea.required, required);
    }
  }
});
