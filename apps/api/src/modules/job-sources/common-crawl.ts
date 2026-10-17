import { type AsyncBuffer, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { z } from "zod/v4";
import { fetchSourceRange } from "./http";
import { boardOf, type FoundBoard } from "./public-feeds-simplify";
import type { FetchText } from "./public-feeds-wwr";
import type { FetchJson } from "./types";
import { workdayJobCount } from "./workday";

const BASE = "https://data.commoncrawl.org";
// The index is sorted by SURT key (reversed host), so these prefixes bound the job-board rows.
const BOARD_PREFIXES = [
  "io,greenhouse,boards)",
  "io,greenhouse,job-boards)",
  "co,lever,jobs)",
  "com,ashbyhq,jobs)",
  "com,myworkdayjobs,",
];
const PROVIDERS = new Set(["greenhouse", "lever", "ashby", "workday"]);

export type RangeReader = typeof fetchSourceRange;

/** The newest crawl that has a columnar index, from the download host's own crawl list. */
export async function latestCrawl(fetchText: FetchText): Promise<string> {
  const crawls = [
    ...new Set((await fetchText(`${BASE}/crawl-data/index.html`)).match(/CC-MAIN-\d{4}-\d{2}/g)),
  ].sort();
  const latest = crawls.at(-1);
  if (!latest) throw new Error("Common Crawl lists no crawls.");
  return latest;
}

async function indexFiles(read: RangeReader, crawl: string): Promise<string[]> {
  // A range past the end returns the whole small file.
  const { bytes } = await read(`${BASE}/crawl-data/${crawl}/cc-index-table.paths.gz`, 0, 1_000_000);
  return new TextDecoder()
    .decode(Bun.gunzipSync(new Uint8Array(bytes)))
    .split("\n")
    .filter((path) => path.includes("/subset=warc/"));
}

/** Reads a remote Parquet file only where hyparquet asks: footer first, then single column chunks. */
async function rangeFile(read: RangeReader, url: string): Promise<AsyncBuffer> {
  const { size } = await read(url, 0, 1);
  return {
    byteLength: size,
    slice: async (start, end = size) => (await read(url, start, end)).bytes,
  };
}

function overlaps(min: unknown, max: unknown): boolean {
  if (typeof min !== "string" || typeof max !== "string") return true;
  return BOARD_PREFIXES.some((prefix) => max >= prefix && min <= `${prefix}￿`);
}

/**
 * Every Greenhouse, Lever, Ashby and Workday board a crawl saw, from the URL column of only the
 * row groups whose SURT range covers those hosts. Whole files are never downloaded.
 */
export async function commonCrawlBoards(
  read: RangeReader,
  fetchText: FetchText,
): Promise<{ crawl: string; boards: Omit<FoundBoard, "company">[]; rowGroups: number }> {
  const crawl = await latestCrawl(fetchText);
  const boards = new Map<string, Omit<FoundBoard, "company">>();
  let rowGroups = 0;
  for (const path of await indexFiles(read, crawl)) {
    const file = await rangeFile(read, `${BASE}/${path}`);
    const metadata = await parquetMetadataAsync(file);
    let rowStart = 0;
    for (const group of metadata.row_groups) {
      const rows = Number(group.num_rows);
      const surt = group.columns.find(
        (column) => column.meta_data?.path_in_schema.join(".") === "url_surtkey",
      )?.meta_data?.statistics;
      if (overlaps(surt?.min_value ?? surt?.min, surt?.max_value ?? surt?.max)) {
        rowGroups++;
        const urls = await parquetReadObjects({
          file,
          metadata,
          columns: ["url"],
          rowStart,
          rowEnd: rowStart + rows,
          compressors,
        });
        for (const { url } of urls as { url: string }[]) {
          const board = URL.canParse(url) ? boardOf(url) : null;
          if (board && PROVIDERS.has(board.provider))
            boards.set(`${board.provider}/${board.slug.toLowerCase()}`, board);
        }
      }
      rowStart += rows;
    }
  }
  return { crawl, boards: [...boards.values()], rowGroups };
}

const titleCase = (slug: string) =>
  slug.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** One request: whether a found board lists jobs, and the company name when the board gives one. */
export async function checkBoard(
  fetch: FetchJson,
  board: Omit<FoundBoard, "company">,
): Promise<FoundBoard | null> {
  const slug = encodeURIComponent(board.slug);
  if (board.provider === "workday")
    return (await workdayJobCount(fetch, board.slug)) > 0
      ? { ...board, company: titleCase(board.slug.split(".")[0] ?? board.slug) }
      : null;
  if (board.provider === "greenhouse") {
    const data = z
      .object({ jobs: z.array(z.object({ company_name: z.string().nullish() })) })
      .parse(await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`));
    return data.jobs.length
      ? { ...board, company: data.jobs[0]?.company_name ?? titleCase(board.slug) }
      : null;
  }
  if (board.provider === "ashby") {
    const data = z
      .object({ jobs: z.array(z.unknown()) })
      .parse(await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`));
    return data.jobs.length ? { ...board, company: titleCase(board.slug) } : null;
  }
  const data = z
    .array(z.unknown())
    .parse(await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`));
  return data.length ? { ...board, company: titleCase(board.slug) } : null;
}
