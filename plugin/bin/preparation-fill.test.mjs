import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import {
  fillOwnedPage,
  preparationFieldProblem,
  preparationValueValid,
} from "./preparation-fill.mjs";
import { previewPreparation } from "./preparation-preview.mjs";
import { browserFor, manifestFor, skip } from "./preparation-test-helpers.mjs";

const field = {
  key: "eligibility",
  label: "Will you need sponsorship?",
  type: "single_choice",
  options: [
    { value: "Y", label: "Yes" },
    { value: "N", label: "No" },
  ],
};
const definition = { prompt: field.label, required: "required", fields: [field] };
test("native adapter requires exact question semantics and option identities", () => {
  assert.equal(preparationFieldProblem(definition, definition, field), null);
  for (const changed of [
    { ...definition, prompt: "Will you NOT need sponsorship?" },
    { ...definition, description: "in the next 12 months" },
    {
      ...definition,
      fields: [
        {
          ...field,
          options: [
            { value: "Y", label: "No" },
            { value: "N", label: "Yes" },
          ],
        },
      ],
    },
    {
      ...definition,
      fields: [
        {
          ...field,
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
        },
      ],
    },
  ])
    assert.ok(preparationFieldProblem(definition, changed, field));
  assert.equal(preparationValueValid(field, true), false);
  assert.equal(preparationValueValid(field, "yes"), false);
  assert.equal(preparationValueValid(field, "Y"), true);
});

test("control characters in a field identity cannot redirect filling to a different name", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(
    '<form><label>First<input name="a&#10;b"></label><label>Second<input name="a b"></label></form>',
  );
  const manifest = await manifestFor(page, { "a\nb": "Confirmed first" });
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.fields.find((field) => field.fieldKey === "a\nb").status, "blocked");
  assert.equal(result.fields.find((field) => field.fieldKey === "a b").status, "omitted");
  assert.equal(await page.locator('[name="a b"]').inputValue(), "");
});

test("native typed values and PDF readback remain exact, and later resets are detected", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(
    "<form><label>Name<input name=name></label><label>Count<input name=count type=number></label><label>Agree<input name=agree type=checkbox></label><label>Resume<input name=resume type=file></label></form>",
  );
  const manifest = await manifestFor(page, { name: "Synthetic Person", count: 3, agree: false });
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF");
  const fileQuestion = manifest.questions.find(
    (question) => question.definition.fields[0].key === "resume",
  );
  const documents = [
    {
      questionId: fileQuestion.id,
      fieldKey: "resume",
      base64: pdf.toString("base64"),
      sizeBytes: pdf.length,
      pdfSha256: createHash("sha256").update(pdf).digest("hex"),
    },
  ];
  const result = await fillOwnedPage(page, manifest, documents, { networkIsolated: true });
  assert.equal(result.status, "filled");
  assert.equal(result.fields.find((field) => field.fieldKey === "count").value, 3);
  assert.equal(result.fields.find((field) => field.fieldKey === "agree").value, false);
  assert.equal(
    result.fields.find((field) => field.fieldKey === "resume").pdfSha256,
    documents[0].pdfSha256,
  );
  await page.locator("[name=count]").evaluate((node) =>
    node.addEventListener("input", () => {
      document.querySelector("[name=name]").value = "changed";
    }),
  );
  const reset = await fillOwnedPage(page, manifest, documents, { networkIsolated: true });
  assert.equal(reset.fields.find((field) => field.fieldKey === "name").status, "mismatch");
});

test("same-name controls in distinct unnamed forms are never filled as one group", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  const form =
    "<form><fieldset><legend>Choice</legend><label><input name=choice type=radio value=yes>Yes</label><label><input name=choice type=radio value=no>No</label></fieldset></form>";
  await page.setContent(form + form);
  const manifest = await manifestFor(page, { choice: "yes" });
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.fields[0].status, "blocked");
  assert.equal(await page.locator("input:checked").count(), 0);
});

test("hidden conditional facts are filled only after activation while unknown branches remain partial", {
  skip,
}, async (t) => {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(
    '<form><label>Explain<textarea name=explain hidden disabled></textarea></label><label>Sponsorship<select name=sponsor><option value="">Choose</option><option value=yes>Yes</option><option value=no>No</option></select></label></form><script>document.querySelector("select").addEventListener("change",()=>{const n=document.querySelector("textarea");n.hidden=false;n.disabled=false;});</script>',
  );
  const manifest = await manifestFor(page, {
    explain: "Confirmed synthetic answer",
    sponsor: "yes",
  });
  const result = await fillOwnedPage(page, manifest, [], { networkIsolated: true });
  assert.equal(result.status, "partial");
  assert.ok(result.fields.every((field) => field.status === "verified"));
  assert.equal(await page.locator("textarea").inputValue(), "Confirmed synthetic answer");
});

test("preview blocks input-triggered network, submit, unfamiliar steps and unconfirmed controls", {
  skip,
}, async (t) => {
  let requests = 0;
  const html =
    "<form method=post><label>Name<input name=name oninput=\"fetch('/leak?value='+this.value);this.form.requestSubmit()\"></label><label>Unknown<input name=unknown required></label><button type=submit>Continue to next step</button></form>";
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/form`;
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.setContent(html);
  const manifest = await manifestFor(page, { name: "Synthetic" }, url);
  const result = await previewPreparation(browser, {
    manifest,
    documents: [],
    allowLoopback: true,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.fields.find((field) => field.fieldKey === "unknown").status, "blocked");
  assert.equal(requests, 1);
  assert.equal(browser.contexts().length, 1);
});
