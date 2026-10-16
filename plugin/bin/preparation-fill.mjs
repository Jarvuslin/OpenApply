import { extractQuestions } from "./question-dom.mjs";

export function preparationFieldProblem(expected, observed, field) {
  const text = (value) =>
    String(value ?? "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/gu, " ");
  if (!observed || expected.fields.length !== 1 || observed.fields.length !== 1)
    return "The exact native question group was not found.";
  const live = observed.fields[0];
  if (
    text(expected.prompt) !== text(observed.prompt) ||
    text(expected.description) !== text(observed.description) ||
    text(field.label ?? expected.prompt) !== text(live.label ?? observed.prompt) ||
    field.key !== live.key ||
    field.type !== live.type
  )
    return "The question wording, help, label or control type changed.";
  if (expected.required !== "unknown" && expected.required !== observed.required)
    return "The required-field context changed.";
  const options = (entries) =>
    entries
      .map((option) => [option.value, text(option.label), option.freeText ?? "none"])
      .sort((a, b) => (a[0] < b[0] ? -1 : Number(a[0] > b[0])));
  if (
    JSON.stringify(options(field.options)) !== JSON.stringify(options(live.options)) ||
    new Set(field.options.map((option) => option.value)).size !== field.options.length ||
    new Set(field.options.map((option) => text(option.label))).size !== field.options.length ||
    field.options.some((option) => option.freeText && option.freeText !== "none")
  )
    return "The exact option identifiers or labels changed or are ambiguous.";
  return null;
}

export function preparationValueValid(field, value) {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.type === "multi_choice")
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((item) => field.options.some((option) => option.value === item))
    );
  if (field.type === "single_choice")
    return typeof value === "string" && field.options.some((option) => option.value === value);
  return (
    ["text", "email", "phone", "date"].includes(field.type) &&
    typeof value === "string" &&
    value.trim().length > 0
  );
}

export async function readNativePreparationValue(nodes) {
  return nodes.evaluateAll(async (controls) => {
    const first = controls[0];
    if (!first) throw new Error("Missing control");
    if (first.type === "file") {
      const file = first.files?.[0];
      if (!file || first.files.length !== 1) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { name: file.name, type: file.type, size: file.size, bytes: Array.from(bytes) };
    }
    if (first.type === "radio") return controls.find((control) => control.checked)?.value ?? null;
    if (first.type === "checkbox")
      return controls.length === 1
        ? first.checked
        : controls
            .filter((control) => control.checked)
            .map((control) => control.value)
            .sort();
    if (first.tagName === "SELECT" && first.multiple)
      return Array.from(first.selectedOptions)
        .map((option) => option.value)
        .sort();
    if (first.type === "number") return first.value === "" ? null : first.valueAsNumber;
    return first.value;
  });
}

// Caller must own this page and block every network request before passing confirmed facts or PDF bytes.
export async function fillOwnedPage(page, manifest, documents, options = {}) {
  if (options.networkIsolated !== true)
    throw new Error("Preparation requires an isolated network.");
  const { createHash } = await import("node:crypto");
  const fields = new Map();
  const key = (questionId, fieldKey) => `${questionId}:${fieldKey}`;
  const reasons = new Set();
  if (manifest.coverage !== "complete" || manifest.questions.some((question) => question.blocking))
    reasons.add("The stored manifest still has incomplete coverage or unresolved questions.");
  const pending = [];
  const omissions = [];
  const names = new Set();
  const locate = (fieldKey) => {
    const escaped = fieldKey
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/[\n\r\f]/g, " ");
    return page.locator(
      `input[name="${escaped}"],select[name="${escaped}"],textarea[name="${escaped}"]`,
    );
  };
  const controlsFor = (nodes) =>
    nodes.evaluateAll((nodes) =>
      nodes.map((node) => ({
        type: node.type,
        tag: node.tagName,
        role: node.getAttribute("role"),
        disabled: node.disabled,
        readOnly: node.readOnly,
        required: node.required,
        form: Array.from(document.forms).indexOf(node.form),
      })),
    );
  const safeControls = (controls) =>
    controls.length > 0 &&
    !controls.some(
      (control) =>
        control.disabled ||
        control.readOnly ||
        ["combobox", "listbox", "option"].includes(control.role),
    ) &&
    (controls.length === 1 ||
      controls.every(
        (control) =>
          ["radio", "checkbox"].includes(control.type) &&
          control.type === controls[0].type &&
          control.form === controls[0].form,
      ));
  const optionalContext = (definition) =>
    definition.required === "optional" &&
    definition.visibility === "visible" &&
    definition.condition?.state === "unconditional" &&
    definition.condition.rules.length === 0;
  for (const question of manifest.questions) {
    for (const field of question.definition.fields) {
      const record = {
        questionId: question.id,
        fieldKey: field.key,
        status: "blocked",
        reason: "No current human-confirmed answer or document is available.",
      };
      fields.set(key(question.id, field.key), record);
      if (names.has(field.key)) throw new Error("Duplicate field identity");
      names.add(field.key);
      if (
        !question.current ||
        question.jobId !== manifest.job.id ||
        field.key.length > 190 ||
        [...field.key].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        field.type === "unknown"
      )
        continue;
      if (
        /captcha|password|passphrase|\b(?:otp|2fa|mfa)\b|one[\s-]?time.*(?:code|password)|(?:verification|security|authentication|access)[\s_-]*code/i.test(
          `${field.key} ${field.label ?? ""} ${question.definition.prompt} ${question.definition.description ?? ""}`,
        )
      )
        continue;
      const value =
        question.answer?.confirmedAt &&
        question.answer.values.find((value) => value.fieldKey === field.key);
      const document = documents.find(
        (document) => document.questionId === question.id && document.fieldKey === field.key,
      );
      const selected = manifest.documentFields?.some(
        (document) =>
          document.questionId === question.id &&
          document.fieldKey === field.key &&
          document.selection,
      );
      if (
        !value &&
        !document &&
        !selected &&
        field.type !== "file" &&
        (!["single_choice", "multi_choice"].includes(field.type) || field.options.length > 0) &&
        optionalContext(question.definition)
      )
        omissions.push({ question, field });
      if (field.type === "file" ? !document : !value || !preparationValueValid(field, value.value))
        continue;
      pending.push({ question, field, value: value?.value, document });
    }
  }
  let inventory = await page.evaluate(extractQuestions);
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    let changed = false;
    for (const item of [...pending]) {
      const { question, field, value, document } = item;
      inventory = await page.evaluate(extractQuestions);
      const observed = inventory.definitions.find((definition) =>
        definition.fields.some((candidate) => candidate.key === field.key),
      );
      const record = fields.get(key(question.id, field.key));
      if (observed?.visibility !== "visible") {
        record.reason = "The field is hidden or absent; its branch was not entered.";
        continue;
      }
      const problem = preparationFieldProblem(question.definition, observed, field);
      if (problem) {
        record.reason = problem;
        pending.splice(pending.indexOf(item), 1);
        continue;
      }
      const nodes = locate(field.key);
      const controls = await controlsFor(nodes);
      if (!safeControls(controls)) {
        record.reason = "The native field is disabled, read-only or ambiguous.";
        continue;
      }
      pending.splice(pending.indexOf(item), 1);
      try {
        if (document) {
          const bytes = Buffer.from(document.base64, "base64");
          if (
            bytes.length !== document.sizeBytes ||
            createHash("sha256").update(bytes).digest("hex") !== document.pdfSha256 ||
            !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
          )
            throw new Error("PDF identity mismatch");
          await nodes.setInputFiles({
            name: "resume.pdf",
            mimeType: "application/pdf",
            buffer: bytes,
          });
        } else if (controls[0].tag === "SELECT")
          await nodes.selectOption(Array.isArray(value) ? value : String(value));
        else if (controls[0].type === "radio" || controls[0].type === "checkbox") {
          for (let index = 0; index < controls.length; index++) {
            const node = nodes.nth(index);
            const option = await node.inputValue();
            const checked =
              typeof value === "boolean"
                ? value
                : Array.isArray(value)
                  ? value.includes(option)
                  : value === option;
            if (controls[0].type === "radio" && !checked) continue;
            await node.setChecked(checked);
          }
        } else await nodes.fill(String(value));
        const readback = await readNativePreparationValue(nodes);
        if (document) {
          const hash =
            readback && createHash("sha256").update(Buffer.from(readback.bytes)).digest("hex");
          if (
            hash !== document.pdfSha256 ||
            readback.size !== document.sizeBytes ||
            readback.name !== "resume.pdf" ||
            readback.type !== "application/pdf"
          )
            throw new Error("PDF readback mismatch");
          record.pdfSha256 = hash;
        } else {
          const expected = Array.isArray(value) ? [...value].sort() : value;
          if (JSON.stringify(readback) !== JSON.stringify(expected))
            throw new Error("Readback mismatch");
          record.value = readback;
        }
        record.status = "verified";
        delete record.reason;
        changed = true;
      } catch {
        record.status = "mismatch";
        record.reason = "The control could not retain the exact confirmed value or document.";
      }
    }
    if (!changed) break;
  }
  inventory = await page.evaluate(extractQuestions);
  if (inventory.coverage !== "complete")
    reasons.add(inventory.reason ?? "Some form branches remain unverified.");
  for (const definition of inventory.definitions)
    if (definition.fields.some((field) => !names.has(field.key)))
      reasons.add("New fields need collection and current human confirmation.");
  // Omission is an observation of a blank optional control, never a factual false/empty answer.
  for (const { question, field } of omissions) {
    const record = fields.get(key(question.id, field.key));
    const observed = inventory.definitions.find((definition) =>
      definition.fields.some((candidate) => candidate.key === field.key),
    );
    if (
      !observed ||
      !optionalContext(observed) ||
      preparationFieldProblem(question.definition, observed, field)
    )
      continue;
    try {
      const nodes = locate(field.key);
      const controls = await controlsFor(nodes);
      if (!safeControls(controls) || controls.some((control) => control.required)) continue;
      const actual = await readNativePreparationValue(nodes);
      let blank = actual === "";
      if (["number", "single_choice"].includes(field.type) && actual === null) blank = true;
      if (field.type === "multi_choice" && Array.isArray(actual) && actual.length === 0)
        blank = true;
      if (field.type === "boolean" && controls[0].type === "checkbox" && actual === false)
        blank = true;
      if (!blank) {
        record.reason =
          "This optional field contains an unconfirmed default; review it explicitly.";
        continue;
      }
      record.status = "omitted";
      record.reason =
        "Optional field observed blank after preparation; no factual answer was inferred.";
    } catch {
      record.reason = "The optional field could not be confirmed blank.";
    }
  }
  // Later conditional handlers can reset earlier values; validate every filled field again.
  for (const record of fields.values()) {
    if (record.status !== "verified") continue;
    const question = manifest.questions.find((question) => question.id === record.questionId);
    const field = question?.definition.fields.find((field) => field.key === record.fieldKey);
    const observed = inventory.definitions.find((definition) =>
      definition.fields.some((candidate) => candidate.key === record.fieldKey),
    );
    try {
      if (
        !field ||
        !observed ||
        observed.visibility !== "visible" ||
        preparationFieldProblem(question.definition, observed, field)
      )
        throw new Error("Changed definition");
      const actual = await readNativePreparationValue(locate(record.fieldKey));
      if (record.pdfSha256) {
        if (
          !actual ||
          createHash("sha256").update(Buffer.from(actual.bytes)).digest("hex") !== record.pdfSha256
        )
          throw new Error("Changed PDF");
      } else if (JSON.stringify(actual) !== JSON.stringify(record.value))
        throw new Error("Changed value");
    } catch {
      record.status = "mismatch";
      record.reason = "The verified field changed after conditional updates.";
      delete record.value;
      delete record.pdfSha256;
    }
  }
  const result = [...fields.values()];
  if (result.some((field) => !["verified", "omitted"].includes(field.status)))
    reasons.add("Some fields require explicit browser review or additional confirmed facts.");
  const status = !result.some((field) => ["verified", "omitted"].includes(field.status))
    ? "blocked"
    : reasons.size
      ? "partial"
      : "filled";
  return {
    status,
    fields: result,
    ...(reasons.size ? { reason: [...reasons].join(" ").slice(0, 1000) } : {}),
  };
}
