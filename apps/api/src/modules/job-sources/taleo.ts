import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import { withDetails } from "./details";
import type { FetchText } from "./public-feeds-wwr";
import {
  type BoardOptions,
  type BoardResult,
  boardResult,
  type FetchJson,
  monthDayYear,
  plainText,
  requisition,
  type SourceJob,
} from "./types";

// Taleo career sections live at {tenant}.taleo.net/careersection/{section}, so a slug is
// "tenant/section", for example "uab/ext".
const SECTION_SLUG = /^([a-z0-9]{2,40})\/([A-Za-z0-9_.-]{1,60})$/;
// The job board API answers 25 jobs a page, whatever is asked.
const PAGE = 25;
const MAX_PAGES = 200;
const DAY = 86_400_000;

const page = z.object({
  careerSectionUnAvailable: z.boolean().nullish(),
  pagingData: z.object({ totalCount: z.number() }).nullish(),
  requisitionList: z
    .array(
      z.object({
        jobId: z.union([z.string(), z.number()]),
        contestNo: z.string().nullish(),
        column: z.array(z.string().nullable()),
        linkedColumn: z.number().default(0),
        locationsColumns: z.array(z.number()).default([]),
      }),
    )
    .nullish(),
});

export function taleoSection(slug: string) {
  const match = SECTION_SLUG.exec(slug);
  return match ? { origin: `https://${match[1]}.taleo.net`, section: match[2] as string } : null;
}

/**
 * Reads a Taleo section through the job board API its search page uses. Sections still on the
 * older search page have no API portal; their list is positional data, so they aren't read.
 */
export async function taleo(
  fetch: FetchJson,
  fetchText: FetchText,
  slug: string,
  company = slug,
  options: BoardOptions = {},
): Promise<BoardResult> {
  const board = taleoSection(slug);
  if (!board) throw unprocessable("Invalid Taleo career section.");
  const base = `${board.origin}/careersection/${board.section}`;
  const search = await fetchText(`${base}/jobsearch.ftl?lang=en`);
  const portal = /[?&;]portal=(\d{1,20})/.exec(search)?.[1];
  if (!portal) throw unprocessable("This Taleo section has no job board API.");
  const jobs: SourceJob[] = [];
  let total = 0;
  let seen = 0;
  let limited = false;
  for (let pageNo = 1; ; pageNo++) {
    if (pageNo > MAX_PAGES) {
      limited = true;
      break;
    }
    const data = page.parse(
      await fetch(
        `${board.origin}/careersection/rest/jobboard/searchjobs?lang=en&portal=${portal}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", tz: "GMT+00:00" },
          body: JSON.stringify({
            multilineEnabled: false,
            // Sort 3 is the posting date, newest first.
            sortingSelection: { sortBySelectionParam: "3", ascendingSortingOrder: "false" },
            fieldData: { fields: { KEYWORD: "", LOCATION: "" }, valid: true },
            filterSelectionParam: { searchFilterSelections: [] },
            advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
            pageNo,
          }),
        },
      ),
    );
    if (data.careerSectionUnAvailable) throw unprocessable("This Taleo section is unavailable.");
    const list = data.requisitionList ?? [];
    if (pageNo === 1) total = data.pagingData?.totalCount ?? 0;
    seen += list.length;
    for (const job of list) {
      const url = `${base}/jobdetail.ftl?job=${job.jobId}&lang=en`;
      const others = job.column.filter(
        (_, index) => index !== job.linkedColumn && !job.locationsColumns.includes(index),
      );
      jobs.push({
        title: plainText(job.column[job.linkedColumn] ?? ""),
        company,
        location: job.locationsColumns.flatMap((index) => places(job.column[index])).join("; "),
        url,
        attributionUrl: url,
        externalId: String(job.jobId),
        requisitionId: requisition(job.contestNo),
        description: "",
        // The section's columns are its own choice, but the only past date among them is the
        // posting date; a future one is the closing date.
        postedAt: others.map(postingDate).find((date) => date !== null) ?? null,
      });
    }
    if (list.length === 0 || pageNo * PAGE >= total) break;
  }
  await withDetails(jobs, options, async (listed) => ({
    description: detailText(await fetchText(listed.url)),
  }));
  return boardResult(
    jobs.filter((job) => job.title),
    total,
    seen,
    limited,
  );
}

/** A locations column holds a JSON array; "Multiple Locations" names none, so it is dropped. */
function places(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .filter((place): place is string => typeof place === "string")
      .map((place) => plainText(place))
      .filter((place) => place && place !== "Multiple Locations");
  } catch {
    return value ? [plainText(value)] : [];
  }
}

/** "Oct 16, 2026", "10/16/2026" or "10/16/26", on or before today. */
function postingDate(value: string | null): Date | null {
  const text = value?.trim() ?? "";
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (numeric && Number(numeric[1]) > 12) return null;
  const year = Number(numeric?.[3]) < 100 ? 2000 + Number(numeric?.[3]) : Number(numeric?.[3]);
  const date = numeric
    ? new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2])))
    : monthDayYear(text);
  return date && date.getTime() <= Date.now() + DAY ? date : null;
}

/** The detail page keeps its description sections in its history field, each led by "!*!". */
function detailText(html: string): string {
  const history = /id="initialHistory" value="([^"]*)"/.exec(html)?.[1] ?? "";
  const sections = history
    .split("!|!")
    .filter((field) => field.startsWith("!*!"))
    .map((field) => plainText(decode(field.slice(3))));
  return [...new Set(sections.filter(Boolean))].join("\n\n");
}

function decode(value: string): string {
  // "%5C" escapes the "\" Taleo puts before ":" and other separators.
  const unescaped = value.replace(/%5C/gi, "");
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped.replace(/%([0-9A-F]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
}
