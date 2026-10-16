import assert from "node:assert/strict";
import test from "node:test";
import { fillOwnedPage } from "./preparation-fill.mjs";
import { browserFor, manifestFor, skip } from "./preparation-test-helpers.mjs";

test("blank native optional controls stay omitted without facts or fallback", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(`<form><label>Name<input name=name required></label>
    <label>Text<input name=text></label><label>Email<input name=email type=email></label>
    <label>Number<input name=number type=number></label><label>Date<input name=date type=date></label>
    <label>Choice<select name=choice><option value="">Choose</option><option value=yes>Yes</option></select></label>
    <label>Many<select name=many multiple><option value=a>A</option><option value=b>B</option></select></label>
    <fieldset><legend>Radio</legend><label><input name=radio type=radio value=yes>Yes</label><label><input name=radio type=radio value=no>No</label></fieldset>
    <label>Checkbox<input name=checkbox type=checkbox></label></form>`);
  const manifest = await manifestFor(page, { name: "Synthetic Person" });
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.status, "filled");
  assert.equal(result.fields.find((field) => field.fieldKey === "name").status, "verified");
  const omitted = result.fields.filter((field) => field.fieldKey !== "name");
  assert.equal(omitted.length, 8);
  for (const field of omitted) {
    assert.equal(field.status, "omitted");
    assert.equal("value" in field, false);
    assert.equal("pdfSha256" in field, false);
  }
  assert.equal(await page.locator("input:checked").count(), 0);
});

test("preselected defaults, required, disabled, custom and optional file controls remain blocked", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(`<form><label>Text<input name=text value=unconfirmed></label>
    <label>Whitespace<input name=space value=" "></label><label>Required<input name=required required></label>
    <label>Disabled<input name=disabled disabled></label><label>Custom<input name=custom role=combobox></label>
    <label>File<input name=resume type=file></label><label>Checked<input name=checked type=checkbox checked></label>
    <label>Empty catalog<select name=emptyCatalog><option value="">Choose</option></select></label>
    <label>Select<select name=selected><option value=yes>Yes</option></select></label>
    <fieldset><legend>Radio</legend><label><input name=radio type=radio value=yes checked>Yes</label><label><input name=radio type=radio value=no>No</label></fieldset>
    <label>Password<input name=passwordHint></label></form>`);
  const manifest = await manifestFor(page, {});
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.status, "blocked");
  assert.ok(result.fields.every((field) => field.status === "blocked"));
  assert.equal(await page.locator("[name=selected]").inputValue(), "yes");
  assert.equal(await page.locator("[name=checked]").isChecked(), true);
});

test("later field handlers populate optional controls before omission readback", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(
    "<form><label>Optional<input name=optional></label><label>Name<input name=name required></label></form>",
  );
  const manifest = await manifestFor(page, { name: "Synthetic" });
  await page.locator("[name=name]").evaluate((node) =>
    node.addEventListener("input", () => {
      document.querySelector("[name=optional]").value = "unconfirmed default";
    }),
  );
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.status, "partial");
  assert.equal(result.fields.find((field) => field.fieldKey === "optional").status, "blocked");
  assert.equal(await page.locator("[name=optional]").inputValue(), "unconfirmed default");
});

test("unknown condition and a stale file selection are never silently omitted", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(
    "<form><label>Optional<input name=optional></label><label>Selected<input name=selected></label></form>",
  );
  const manifest = await manifestFor(page, {});
  manifest.questions[0].definition.condition.state = "unknown";
  manifest.documentFields.push({
    questionId: manifest.questions[1].id,
    fieldKey: "selected",
    selection: { current: true, available: false },
  });
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.status, "blocked");
  assert.ok(result.fields.every((field) => field.status === "blocked"));
});
