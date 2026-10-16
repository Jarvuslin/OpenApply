export function extractQuestions() {
  const definitions = [];
  const reasons = new Set();
  const dynamic = Boolean(document.querySelector("script"));
  const boundedKey = (value) => {
    if (value.length <= 190) return value;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++)
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return `${value.slice(0, 175)}-${(hash >>> 0).toString(16)}`;
  };
  const text = (value, max = 4000) => {
    const result = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (result.length > max) reasons.add("Some source text exceeded collection bounds.");
    return result.slice(0, max);
  };
  const labelText = (node) => {
    if (!node || node.matches("input,select,textarea,script,style,[contenteditable=true]"))
      return "";
    const copy = node.cloneNode(true);
    for (const child of copy.querySelectorAll(
      "input,select,textarea,script,style,[contenteditable=true]",
    ))
      child.remove();
    return copy.textContent;
  };
  const referenced = (node, attribute) =>
    text(
      (node.getAttribute(attribute) ?? "")
        .split(/\s+/)
        .map((id) => labelText(document.getElementById(id)))
        .join(" "),
    );
  const label = (node) =>
    referenced(node, "aria-labelledby") ||
    text(node.getAttribute("aria-label")) ||
    text(
      Array.from(node.labels ?? [])
        .map(labelText)
        .join(" "),
    );
  const visible = (node) => {
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (
        parent.hidden ||
        parent.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        return false;
    }
    return true;
  };
  const all = Array.from(
    document.querySelectorAll(
      "input,select,textarea,[role=combobox],[role=textbox],[role=checkbox],[role=radio],[role=listbox],[contenteditable=true]",
    ),
  );
  const seen = new Set();
  const keyCounts = new Map();
  for (const node of all.slice(0, 1000)) {
    if (seen.has(node)) continue;
    seen.add(node);
    const native = ["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName);
    const inputType = node.tagName === "INPUT" ? node.type : "";
    if (["hidden", "submit", "reset", "button", "image"].includes(inputType)) continue;
    if (
      inputType === "password" ||
      /one-time-code|current-password|new-password/.test(node.autocomplete ?? "")
    ) {
      reasons.add("Authentication controls were excluded.");
      continue;
    }
    const group =
      (inputType === "radio" || inputType === "checkbox") && node.name
        ? all.filter(
            (item) =>
              item.tagName === "INPUT" &&
              item.type === inputType &&
              item.name === node.name &&
              item.form === node.form,
          )
        : [node];
    for (const member of group) seen.add(member);
    const fieldset = node.closest("fieldset");
    const groupLabel = fieldset ? text(labelText(fieldset.querySelector(":scope > legend"))) : "";
    const prompt = group.length > 1 ? groupLabel || label(node) : label(node) || groupLabel;
    const rawKey = node.getAttribute("name") || node.id || `unidentified-${all.indexOf(node)}`;
    const occurrence = keyCounts.get(rawKey) ?? 0;
    keyCounts.set(rawKey, occurrence + 1);
    const key = boundedKey(occurrence ? `${rawKey}#${occurrence + 1}` : rawKey);
    if (rawKey.length > 190 || occurrence || !node.getAttribute("name"))
      reasons.add("Some controls lack unique native field names.");
    const isVisible = group.some(visible);
    const partiallyHidden = group.some((item) => !visible(item));
    const disabled = group.some(
      (item) => item.disabled || item.getAttribute("aria-disabled") === "true",
    );
    const unknown = !native || !prompt || disabled || partiallyHidden;
    if (!native) reasons.add("Custom controls need a verified ATS adapter.");
    if (!prompt) reasons.add("Some controls have no accessible question label.");
    if (partiallyHidden || disabled)
      reasons.add(
        "Conditional or disabled controls were retained without assuming their activation rules.",
      );
    let type = "unknown";
    let options = [];
    if (native) {
      if (node.tagName === "SELECT") {
        type = node.multiple ? "multi_choice" : "single_choice";
        options = Array.from(node.options)
          .filter((option) => option.value !== "")
          .map((option) => ({ value: option.value, label: text(option.label, 2000) }));
      } else if (inputType === "radio" || (inputType === "checkbox" && group.length > 1)) {
        type = inputType === "radio" ? "single_choice" : "multi_choice";
        options = group.map((item) => ({
          value: item.value,
          label: label(item) || text(item.value, 2000),
        }));
      } else
        type =
          {
            email: "email",
            tel: "phone",
            number: "number",
            date: "date",
            file: "file",
            checkbox: "boolean",
          }[inputType] ?? "text";
    }
    if (options.some((option) => option.value.length > 2000)) {
      reasons.add("An option value exceeded its bound; its control remains unknown.");
      options = [];
      type = "unknown";
    }
    if (options.length > 200) reasons.add("The option bound was reached.");
    if (definitions.length >= 200) {
      reasons.add("The question bound was reached.");
      break;
    }
    let required = "optional";
    if (unknown) required = "unknown";
    else if (group.some((item) => item.required || item.getAttribute("aria-required") === "true"))
      required = "required";
    definitions.push({
      stableKey: `fields:${key}`,
      prompt: prompt || "Unlabeled form control (requires review)",
      ...(referenced(node, "aria-describedby")
        ? { description: referenced(node, "aria-describedby") }
        : {}),
      required,
      visibility: isVisible ? "visible" : "hidden",
      condition: { state: unknown || dynamic ? "unknown" : "unconditional", rules: [] },
      groupMode: "all",
      fields: [{ key, label: prompt, type, options: options.slice(0, 200) }],
    });
  }
  if (all.length > 1000) reasons.add("The control inspection bound was reached.");
  if (dynamic) reasons.add("Dynamic or conditional branches were not exercised.");
  if (
    Array.from(document.querySelectorAll("button,input[type=submit]")).some((node) =>
      /next|continue|step|page\s*\d/i.test(text(node.textContent || node.getAttribute("value"))),
    )
  )
    reasons.add("Additional form steps were not traversed.");
  if (document.querySelector("iframe")) reasons.add("Embedded frames were not inspected.");
  if (!definitions.length) reasons.add("No supported question controls were observed.");
  let coverage = "complete";
  if (reasons.size) coverage = "partial";
  if (!definitions.length) coverage = "blocked";
  return {
    definitions,
    coverage,
    reason: [...reasons].join(" ").slice(0, 1000) || null,
  };
}
