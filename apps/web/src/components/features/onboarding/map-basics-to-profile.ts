import { normalizePhone } from "@openapply/contracts/phone";
import type { ResumeBasics } from "@openapply/contracts/resume";
import { normalizeLinkUrl } from "@openapply/contracts/utils/url";
import { getCountries } from "libphonenumber-js";

type ProfileTextFieldName =
  | "firstName"
  | "lastName"
  | "contactEmail"
  | "phone"
  | "website"
  | "linkedin"
  | "github"
  | "city"
  | "country"
  | "state";

// Minimal slice of a TanStack form this helper needs - accepts the typed
// `useAppForm` instance without dragging in its full generic signature.
interface ProfileFieldWriter {
  getFieldValue: (name: ProfileTextFieldName) => unknown;
  setFieldValue: (name: ProfileTextFieldName, value: string) => void;
}

export function applyBasicsToForm(form: ProfileFieldWriter, basics: ResumeBasics): void {
  const [firstName, lastName] = splitName(basics.name);

  setIfEmpty(form, "firstName", firstName);
  setIfEmpty(form, "lastName", lastName);
  setIfEmpty(form, "contactEmail", basics.email);
  const { city, state, country } = parseLocation(basics.location);
  setIfEmpty(form, "country", country);
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const code = getCountries().find(
    (c) => c === form.getFieldValue("country") || names.of(c) === form.getFieldValue("country"),
  );
  setIfEmpty(form, "phone", basics.phone && normalizePhone(basics.phone, code));
  setIfEmpty(form, "website", basics.website && normalizeLinkUrl(basics.website));
  setIfEmpty(form, "linkedin", basics.linkedin && normalizeLinkUrl(basics.linkedin));
  setIfEmpty(form, "github", basics.github && normalizeLinkUrl(basics.github));

  setIfEmpty(form, "city", city);
  setIfEmpty(form, "state", state);
}

function setIfEmpty(
  form: ProfileFieldWriter,
  name: ProfileTextFieldName,
  next?: string | null,
): void {
  if (!next) {
    return;
  }

  const current = form.getFieldValue(name);
  if (typeof current === "string" && current.trim() !== "") {
    return;
  }
  form.setFieldValue(name, next);
}

function splitName(name: string): [string, string] {
  const trimmed = name.trim();
  if (!trimmed) {
    return ["", ""];
  }

  const idx = trimmed.indexOf(" ");
  if (idx === -1) {
    return [trimmed, ""];
  }
  return [trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim()];
}

function parseLocation(location?: string): { city: string; state: string; country: string } {
  if (!location) {
    return { city: "", state: "", country: "" };
  }

  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const last = parts.at(-1);
  const code = getCountries().find(
    (c) => names.of(c) === last || (parts.length >= 3 && c === last),
  );
  const country = code ? (names.of(code) ?? code) : "";
  if (country) parts.pop();
  const state = parts.length > 1 ? parts.pop()! : "";
  return { city: parts.join(", "), state, country };
}
