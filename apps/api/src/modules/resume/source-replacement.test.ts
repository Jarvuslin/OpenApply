import { Prisma } from "@/generated/prisma/client";
import { sourceReplacementWhere } from "./source-replacement";
import { expect, test } from "bun:test";

const source = {
  id: "resume-1",
  userId: "user-1",
  sourceFilename: "original.pdf",
  content: null,
  version: 1,
  _count: { variants: 0, applications: 0 },
};

for (const protectedState of [
  { ...source, content: { basics: { name: "Old resume" } } },
  { ...source, _count: { variants: 1, applications: 0 } },
  { ...source, _count: { variants: 0, applications: 1 } },
]) {
  test(`preserves original source when already used: ${JSON.stringify(protectedState._count)} content=${Boolean(protectedState.content)}`, () => {
    expect(() => sourceReplacementWhere(protectedState)).toThrow("Upload a new resume");
  });
}

test("replacement of an unused source is guarded against extraction and linking races", () => {
  expect(sourceReplacementWhere(source)).toEqual({
    id: source.id,
    userId: source.userId,
    version: source.version,
    sourceFilename: source.sourceFilename,
    content: { equals: Prisma.DbNull },
    variants: { none: {} },
    applications: { none: {} },
  });
});
