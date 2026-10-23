import { z } from "zod/v4";
import { resumeDataSchema } from "./resume";

function strictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== "default" && key !== "$schema")
      .map(([key, child]) => [key, strictSchema(child)]),
  );
  if (node.type === "object" && node.properties) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    result.properties = Object.fromEntries(
      Object.entries(node.properties as Record<string, unknown>).map(([name, property]) => [
        name,
        required.has(name)
          ? strictSchema(property)
          : { anyOf: [strictSchema(property), { type: "null" }] },
      ]),
    );
    result.required = Object.keys(node.properties);
    result.additionalProperties = false;
  }
  return result;
}

export function extractionSchema(provider: "claude" | "codex") {
  const schema = z.toJSONSchema(resumeDataSchema, { io: "input", target: "draft-07" });
  return provider === "codex" ? strictSchema(schema) : schema;
}

function omitNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, omitNulls(child)]),
  );
}

export function parseExtractedResume(output: string) {
  const value: unknown = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  return resumeDataSchema.parse(omitNulls(value));
}
