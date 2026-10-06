import { applyBasicsToForm } from "./map-basics-to-profile";
import { expect, test } from "bun:test";

test("resume import recognizes country and preserves existing profile answers", () => {
  const fields: Record<string, string> = { firstName: "Confirmed", city: "" };
  const form = {
    getFieldValue: (name: string) => fields[name],
    setFieldValue: (name: string, value: string) => {
      fields[name] = value;
    },
  };
  applyBasicsToForm(form, {
    name: "Morgan Example",
    location: "Toronto, Ontario, Canada",
    phone: "(416) 555-2671",
  });
  expect(fields.firstName).toBe("Confirmed");
  expect(fields.city).toBe("Toronto");
  expect(fields.state).toBe("Ontario");
  expect(fields.country).toBe("Canada");
  expect(fields.phone).toBe("+14165552671");
});
