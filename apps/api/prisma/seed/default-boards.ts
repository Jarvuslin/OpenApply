import type { Prisma } from "@/generated/prisma/client";

/**
 * What a fresh install's catalog holds. Consumed only by `job-boards.ts` beside it - after that
 * the table is the source of truth. Typed as the Prisma input so a new column breaks the build here.
 * Only boards with proven agent traction are `isDefault`; the rest are picker-only.
 */
export const DEFAULT_BOARDS: Prisma.JobBoardCreateManyInput[] = [
  {
    name: "Hiring Cafe",
    domain: "hiring.cafe",
    searchUrl: "https://hiring.cafe",
    isDefault: true,
    sortOrder: 3,
  },
  {
    name: "We Work Remotely",
    domain: "weworkremotely.com",
    searchUrl: "https://weworkremotely.com/remote-jobs",
    isDefault: true,
    sortOrder: 4,
  },

  {
    name: "Y Combinator",
    domain: "workatastartup.com",
    searchUrl: "https://www.workatastartup.com/companies",
    sortOrder: 6,
  },
  {
    name: "Welcome to the Jungle",
    domain: "welcometothejungle.com",
    searchUrl: "https://www.welcometothejungle.com/en/jobs",
    sortOrder: 7,
  },
  {
    name: "Hacker News Who's Hiring",
    domain: "news.ycombinator.com",
    searchUrl: "https://news.ycombinator.com/submitted?id=whoishiring",
    sortOrder: 8,
  },
  {
    name: "Remote OK",
    domain: "remoteok.com",
    searchUrl: "https://remoteok.com/",
    sortOrder: 9,
  },
  {
    name: "4 Day Week",
    domain: "4dayweek.io",
    searchUrl: "https://4dayweek.io/remote-jobs",
    sortOrder: 10,
  },
];
