import { cleanAgentText } from "./agent-text";
import { describe, expect, it } from "bun:test";

describe("agent text", () => {
  it("strips terminal controls and common credential echoes", () => {
    expect(cleanAgentText("\u001b[31mStatus\u0000 password: hidden Bearer abc.def.xyz")).toBe(
      "Status password: [redacted] Bearer [redacted]",
    );
  });
});
