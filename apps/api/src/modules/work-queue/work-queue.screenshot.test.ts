import type { PrismaClient } from "@/generated/prisma/client";
import { WorkQueueScreenshotService } from "./work-queue.screenshot";
import { describe, expect, test } from "bun:test";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ID = "11111111-1111-4111-8111-111111111111";

function service(item: object | null) {
  const prisma = { workItem: { findFirst: async () => item } } as unknown as PrismaClient;
  return new WorkQueueScreenshotService(prisma);
}

const leased = {
  state: "filling",
  leaseToken: "lease",
  leaseExpiresAt: new Date(Date.now() + 60_000),
};

describe("submission screenshot", () => {
  test("rejects a file that is not a PNG", async () => {
    const file = new File([Buffer.from("not an image")], "a.png");
    await expect(service(leased).save("user", ID, "lease", file)).rejects.toThrow("PNG");
  });

  test("requires the worker's live lease", async () => {
    const file = new File([PNG], "a.png");
    await expect(service(leased).save("user", ID, "other", file)).rejects.toThrow("lease");
  });

  test("saves a PNG and serves it back to its owner", async () => {
    const svc = service(leased);
    await svc.save("user", ID, "lease", new File([PNG], "a.png"));
    const response = await svc.read("user", ID);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
  });

  test("reports a cleared screenshot as not found", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    await expect(service({ id: other }).read("user", other)).rejects.toThrow("cleared");
  });
});
