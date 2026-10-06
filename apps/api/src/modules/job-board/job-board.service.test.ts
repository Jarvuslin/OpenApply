import type { PrismaClient } from "@/generated/prisma/client";
import { JobBoardService } from "./job-board.service";
import { describe, expect, it } from "bun:test";

const employer = {
  name: "Employer",
  domain: "employer.com",
  searchUrl: "https://employer.com/careers",
};

function makeService(knownBoard = true) {
  const upserts: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  const db = {
    jobBoard: {
      upsert: async (args: Record<string, unknown>) => {
        upserts.push(args);
        return { id: knownBoard ? "b1" : "new" };
      },
    },
    userJobBoard: {
      findMany: async () => [{ id: "l1", jobBoard: employer }],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        links.push(data);
        return { id: "l2", jobBoard: employer };
      },
    },
  } as unknown as PrismaClient;
  return { svc: new JobBoardService(db), upserts, links };
}

describe("JobBoardService", () => {
  it("projects a link to its id plus the catalog fields", async () => {
    const { svc } = makeService();
    expect(await svc.list("u1")).toEqual([
      {
        id: "l1",
        name: "Employer",
        domain: "employer.com",
        searchUrl: "https://employer.com/careers",
      },
    ]);
  });

  it("links by domain without touching the catalog row", async () => {
    const { svc, upserts, links } = makeService();
    await svc.create("u1", { domain: "employer.com", name: "ignored" });
    expect(upserts[0]).toMatchObject({ where: { domain: "employer.com" }, update: {} });
    expect(links[0]).toEqual({ userId: "u1", jobBoardId: "b1" });
  });

  it("adds an unknown domain to the catalog unlisted, named by the domain when no name is given", async () => {
    const { svc, upserts, links } = makeService(false);
    await svc.create("u1", { domain: "jobs.example", searchUrl: "" });
    expect(upserts[0]).toMatchObject({
      create: { domain: "jobs.example", name: "jobs.example", searchUrl: null },
    });
    expect(links[0]).toEqual({ userId: "u1", jobBoardId: "new" });
  });
});
