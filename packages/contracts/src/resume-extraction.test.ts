import { extractionSchema, parseExtractedResume } from "./resume-extraction";
import { expect, test } from "bun:test";

test("Codex schemas require every property and allow null for omitted source facts", () => {
  const schema = extractionSchema("codex") as {
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(schema.required).toEqual(Object.keys(schema.properties));
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.summary).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
});

test("provider nulls are omitted, missing required identity still fails", () => {
  const result = parseExtractedResume(
    JSON.stringify({
      basics: { name: "Morgan Example", headline: null },
      summary: null,
      experience: [],
      skills: [],
    }),
  );
  expect(result.basics.name).toBe("Morgan Example");
  expect(result.basics.headline).toBeUndefined();
  expect(() => parseExtractedResume('{"basics":{"name":null}}')).toThrow();
  expect(() => parseExtractedResume("not json")).toThrow();
});
