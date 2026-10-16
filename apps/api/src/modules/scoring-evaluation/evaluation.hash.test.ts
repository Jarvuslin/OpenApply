import { createHash } from "node:crypto";
import { evaluationHash } from "./evaluation.hash";
import { describe, expect, it } from "bun:test";

describe("evaluation context hashing", () => {
  it("canonicalizes object order but preserves array order, Unicode and exact source text", () => {
    const wire = '{"a":["é","<x>","line\\nquote\\""],"z":1}';
    const value = { z: 1, a: ["é", "<x>", 'line\nquote"'] };
    expect(evaluationHash(value)).toBe(createHash("sha256").update(wire, "utf8").digest("hex"));
    expect(evaluationHash(value)).toBe(evaluationHash({ a: value.a, z: 1 }));
    expect(evaluationHash(value)).not.toBe(evaluationHash({ a: value.a.toReversed(), z: 1 }));
    expect(evaluationHash({ text: "No  sponsorship" })).not.toBe(
      evaluationHash({ text: "No sponsorship" }),
    );
  });
});
