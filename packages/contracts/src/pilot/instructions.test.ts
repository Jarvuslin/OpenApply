import { resolvePilotInstructionsConfig, updatePilotInstructionsSchema } from "./instructions";
import { describe, expect, it } from "bun:test";

describe("Pilot minimum inheritance", () => {
  it("inherits the profile without turning an omitted request value into 60", () => {
    const input = updatePilotInstructionsSchema.parse({
      goals: "Entry-level software",
      config: {},
    });
    expect(input.config).not.toHaveProperty("minScore");
    expect(resolvePilotInstructionsConfig(input.config, 20)).toMatchObject({
      config: { minScore: 20 },
      minScoreInherited: true,
    });
  });

  it("honors explicit overrides, including zero and the former default", () => {
    for (const minimum of [0, 20, 60, 80]) {
      expect(resolvePilotInstructionsConfig({ minScore: minimum }, 35)).toMatchObject({
        config: { minScore: minimum },
        minScoreInherited: false,
      });
    }
  });

  it("uses the product default only without either preference and rejects out-of-range values", () => {
    expect(resolvePilotInstructionsConfig({}).config.minScore).toBe(60);
    expect(() => resolvePilotInstructionsConfig({ minScore: -1 }, 20)).toThrow();
    expect(() => resolvePilotInstructionsConfig({ minScore: 101 }, 20)).toThrow();
  });
});
