import type { PrismaClient } from "@/generated/prisma/client";
import { TranscriptService } from "./transcript.service";
import { describe, expect, test } from "bun:test";

function service() {
  const user = {
    transcriptFilename: null as string | null,
    transcriptOriginalName: null as string | null,
  };
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ ...user }),
      update: async ({ data }: { data: typeof user }) => Object.assign(user, data),
    },
  } as unknown as PrismaClient;
  return { svc: new TranscriptService(prisma), user };
}

describe("profile transcript", () => {
  test("rejects a file that is not a PDF", async () => {
    const { svc } = service();
    await expect(svc.upload("u1", new File(["hello"], "notes.txt"))).rejects.toThrow("PDF");
  });

  test("saves, serves and removes a PDF under a plain file name", async () => {
    const { svc, user } = service();
    const saved = await svc.upload("u1", new File(["%PDF-1.4 transcript"], 'my "transcript".pdf'));
    expect(saved.transcriptOriginalName).toBe("my _transcript_.pdf");
    const response = await svc.download("u1");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(await response.text()).toBe("%PDF-1.4 transcript");
    await svc.remove("u1");
    expect(user.transcriptFilename).toBeNull();
    await expect(svc.download("u1")).rejects.toThrow("No transcript");
  });
});
