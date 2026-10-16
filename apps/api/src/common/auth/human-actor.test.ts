import type { Prisma } from "@/generated/prisma/client";
import { assertHumanActor, isHumanAuthorship } from "./human-actor";
import { describe, expect, it } from "bun:test";

function fixture() {
  const link = { id: "link-a", userId: "user-a", generation: 2, active: true };
  const lookups: unknown[] = [];
  const tx = {
    telegramLink: {
      findFirst: async ({ where }: { where: typeof link }) => {
        lookups.push(where);
        return Object.entries(where).every(
          ([key, value]) => link[key as keyof typeof link] === value,
        )
          ? link
          : null;
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, link, lookups };
}

describe("trusted human actors", () => {
  it("accepts an authenticated web session without a Telegram binding", async () => {
    const { tx, lookups } = fixture();
    expect(await assertHumanActor(tx, "user-a", "session_user")).toBe("session_user");
    expect(lookups).toEqual([]);
  });

  it.each(["agent", "telegram_user"] as const)(
    "rejects unverified %s provenance",
    async (actor) => {
      const { tx, lookups } = fixture();
      await expect(assertHumanActor(tx, "user-a", actor)).rejects.toMatchObject({ status: 403 });
      expect(lookups).toEqual([]);
    },
  );

  it("requires the account, active binding, and exact generation together", async () => {
    const { tx } = fixture();
    const actor = { kind: "telegram_user", linkId: "link-a", generation: 2 } as const;
    expect(await assertHumanActor(tx, "user-a", actor)).toBe("telegram_user");
    await expect(assertHumanActor(tx, "user-b", actor)).rejects.toMatchObject({ status: 403 });
    await expect(
      assertHumanActor(tx, "user-a", { ...actor, linkId: "link-b" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(assertHumanActor(tx, "user-a", { ...actor, generation: 1 })).rejects.toMatchObject(
      { status: 403 },
    );
  });

  it("rejects a previously valid actor after unlink or replacement", async () => {
    const { tx, link } = fixture();
    const actor = { kind: "telegram_user", linkId: "link-a", generation: 2 } as const;
    expect(await assertHumanActor(tx, "user-a", actor)).toBe("telegram_user");
    link.active = false;
    await expect(assertHumanActor(tx, "user-a", actor)).rejects.toMatchObject({ status: 403 });
    link.active = true;
    link.generation = 3;
    await expect(assertHumanActor(tx, "user-a", actor)).rejects.toMatchObject({ status: 403 });
  });

  it("recognizes only stored attested human authorship", () => {
    expect(isHumanAuthorship("session_user")).toBe(true);
    expect(isHumanAuthorship("telegram_user")).toBe(true);
    for (const value of ["agent", "user", "human", "unknown", ""]) {
      expect(isHumanAuthorship(value)).toBe(false);
    }
  });
});
