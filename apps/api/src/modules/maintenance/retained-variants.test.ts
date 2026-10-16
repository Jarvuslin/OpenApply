import { prismaFixture } from "@/common/testing/prisma-fakes";
import { deleteUnselectedVariants } from "./retained-variants";
import { cutoffs } from "./retention";
import { expect, it } from "bun:test";

it("retains current human-selected variants while removing only eligible unused owned variants", async () => {
  const f = prismaFixture();
  const userId = crypto.randomUUID();
  const selected = crypto.randomUUID();
  for (const [id, label, applicationId] of [
    [selected, "Selected", null],
    [crypto.randomUUID(), "Unused", null],
    [crypto.randomUUID(), "Suggested rewrite", null],
    [crypto.randomUUID(), "Submitted", crypto.randomUUID()],
  ] as const)
    f.variants.push({
      id,
      resumeId: crypto.randomUUID(),
      resume: { userId },
      label,
      applicationId,
      createdAt: new Date("2020-01-01"),
    });
  f.documentSelections.push({
    id: crypto.randomUUID(),
    userId,
    variantId: selected,
    current: true,
  });
  const result = await deleteUnselectedVariants(f.db, cutoffs(new Date()));
  expect(result.count).toBe(1);
  expect(f.variants.map((variant) => variant.label).sort()).toEqual(
    ["Selected", "Submitted", "Suggested rewrite"].sort(),
  );
  expect(f.locks.length).toBe(1);
});
