import type { Prisma } from "@/generated/prisma/client";
import { candidateKey, lockDiscovery, saveCandidate } from "./candidate-intake";
import { expect, it } from "bun:test";

function database() {
  const rows: Record<string, unknown>[] = [];
  const db = {
    job: {
      findUnique: async ({ where }: { where: { campaignId_key: { key: string } } }) =>
        rows.find((row) => row.key === where.campaignId_key.key) ?? null,
      count: async () => rows.length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `j${rows.length}`, fitAssessment: null, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { db, rows };
}
const source = {
  title: "Engineer",
  company: "Acme",
  location: "Toronto",
  url: "https://example.com/jobs/1",
  attributionUrl: "https://example.com/jobs/1?utm_source=feed",
  description: "Full requirements.\n\nResponsibilities and benefits stay intact.",
  postedAt: null,
};

it("dedupes canonical source URLs and preserves the full private JD without approving it", async () => {
  const { db, rows } = database();
  await saveCandidate(db, "c1", source, "public", { applyUrl: source.url, confidence: 1 }, 100);
  await saveCandidate(
    db,
    "c1",
    { ...source, description: "thin excerpt" },
    "public",
    { applyUrl: `${source.url}?utm_source=other`, confidence: 1 },
    100,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "pending", description: source.description });
  expect(JSON.parse(rows[0]!.digest as string).discovery.sourceDescription).toBe(
    source.description,
  );
  expect(candidateKey(source.url)).toBe(candidateKey(source.attributionUrl));
});

it("keeps unresolved sources queued, and enforces a finite saved-list limit", async () => {
  const { db, rows } = database();
  await saveCandidate(db, "c1", source, "public", { applyUrl: null, confidence: 0.2 }, 1);
  expect(rows[0]!.status).toBe("queued");
  const result = await saveCandidate(
    db,
    "c1",
    { ...source, attributionUrl: "https://example.com/jobs/2" },
    "public",
    { applyUrl: null, confidence: 0 },
    1,
  );
  expect(result).toEqual({ saved: false, truncated: true });
  expect(rows).toHaveLength(1);
});

it("uses a campaign compare-and-swap lock so concurrent intake cannot race the completion gate", async () => {
  const db = {
    campaign: {
      findFirst: async () => ({
        campaignId: "c1",
        status: "in_progress",
        updatedAt: new Date(),
        config: {
          discovery: {
            phase: "collecting",
            intent: "apply",
            searches: [],
            sources: [],
            completedAt: null,
            reason: null,
          },
        },
      }),
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as Prisma.TransactionClient;
  await expect(lockDiscovery(db, "u1", "c1")).rejects.toThrow("concurrently");
});

it("upgrades an unresolved source to its employer URL without cloning or overwriting the saved source JD", async () => {
  const { db, rows } = database();
  await saveCandidate(db, "c1", source, "public", { applyUrl: null, confidence: 0 }, 1);
  await saveCandidate(
    db,
    "c1",
    { ...source, description: "short excerpt" },
    "public",
    { applyUrl: "https://jobs.ashbyhq.com/acme/job1", confidence: 1 },
    1,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    url: "https://jobs.ashbyhq.com/acme/job1",
    status: "pending",
    description: source.description,
  });
});
