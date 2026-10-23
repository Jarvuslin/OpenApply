import { ingestMessagesSchema, registerConnectorAccountSchema } from "./email";
import { describe, expect, it } from "bun:test";

describe("mailbox registration contract", () => {
  it("normalizes case and whitespace without equating Gmail dots or aliases", () => {
    expect(
      registerConnectorAccountSchema.parse({
        mailbox: " Some.Name+jobs@Example.com ",
        runtimeProvider: "claude",
      }),
    ).toEqual({
      mailbox: "some.name+jobs@example.com",
      runtimeProvider: "claude",
      identityVerified: false,
    });
  });

  it("requires explicit boolean identity evidence before recording verified status", () => {
    const input = { mailbox: "owner@example.com", runtimeProvider: "codex" };

    expect(registerConnectorAccountSchema.parse(input).identityVerified).toBe(false);
    expect(
      registerConnectorAccountSchema.parse({ ...input, identityVerified: true }).identityVerified,
    ).toBe(true);
    expect(
      registerConnectorAccountSchema.parse({ ...input, identityVerified: false }).identityVerified,
    ).toBe(false);
    expect(
      registerConnectorAccountSchema.safeParse({ ...input, identityVerified: "true" }).success,
    ).toBe(false);
  });

  it("requires an actual email and a supported agent provider", () => {
    expect(
      registerConnectorAccountSchema.safeParse({ mailbox: "broken", runtimeProvider: "codex" })
        .success,
    ).toBe(false);
    expect(
      registerConnectorAccountSchema.safeParse({
        mailbox: "owner@example.com",
        runtimeProvider: "unknown",
      }).success,
    ).toBe(false);
    expect(registerConnectorAccountSchema.safeParse({ mailbox: "owner@example.com" }).success).toBe(
      false,
    );
  });

  it("ingestion accepts an explicit mailbox id while rejecting arbitrary identifiers", () => {
    const input = {
      mailbox: "owner@example.com",
      messages: [],
      accountId: "63a5e0e4-1fb2-49f3-974f-96a42347c3ad",
      runtimeProvider: "codex",
    };
    expect(ingestMessagesSchema.parse(input).accountId).toBe(input.accountId);
    expect(ingestMessagesSchema.safeParse({ ...input, accountId: "other" }).success).toBe(false);
    expect(ingestMessagesSchema.parse({ ...input, identityVerified: true })).not.toHaveProperty(
      "identityVerified",
    );
  });
});
