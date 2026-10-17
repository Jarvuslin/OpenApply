import "reflect-metadata";
import { SQL } from "bun";
import { boardCompanyName } from "../src/modules/job-sources/common-crawl";
import { fetchSourceText } from "../src/modules/job-sources/http";
import type { FoundBoard } from "../src/modules/job-sources/public-feeds-simplify";
import { normalizeCompanyName } from "../src/modules/scoring/applied-duplicates";

// Ashby and Lever boards found by Common Crawl were named after their slug. Read each board page's
// title once and give the board, its company and its listings the real name.
const sql = new SQL(process.env.DATABASE_URL!.replace(/\?.*$/, ""));
const boards = [
  ...(await sql`select d.key, d.provider, d.slug, d.company from job_board_probes p
    join discovered_job_boards d on d.key = p.board_key
    where p.key like 'cc/%' and d.provider in ('ashby', 'lever')`),
];
const counts = {
  boards: boards.length,
  renamed: 0,
  joinedExisting: 0,
  boardOnly: 0,
  unchanged: 0,
  noTitle: 0,
};
for (const board of boards) {
  const name = await boardCompanyName(fetchSourceText, board as FoundBoard).catch(() => null);
  if (!name) {
    counts.noTitle++;
    continue;
  }
  if (name === board.company) {
    counts.unchanged++;
    continue;
  }
  const alias = normalizeCompanyName(name);
  const boardKey = String(board.key).toLowerCase();
  const outcome = await sql.begin(async (tx) => {
    await tx`update discovered_job_boards set company = ${name} where key = ${board.key}`;
    const [link] = await tx`select company_id from company_boards where board_key = ${boardKey}`;
    // Not refreshed yet: the board's first refresh creates its company under the new name.
    if (!link) return "boardOnly" as const;
    const [existing] =
      await tx`select id, name from companies where id <> ${link.company_id} and ${alias} = any(aliases) limit 1`;
    if (existing) {
      // The real name belongs to a company already known under it, so the board joins that one.
      await tx`update company_boards set company_id = ${existing.id} where board_key = ${boardKey}`;
      await tx`update job_listings set company_id = ${existing.id}, company = ${existing.name}
        where id in (select listing_id from job_listing_sources where board_key = ${boardKey})`;
      return "joinedExisting" as const;
    }
    await tx`update companies set name = ${name}, aliases = array(select distinct unnest(array_append(aliases, ${alias}::text))) where id = ${link.company_id}`;
    await tx`update job_listings set company = ${name} where company_id = ${link.company_id}`;
    return "renamed" as const;
  });
  counts[outcome]++;
}
console.log(JSON.stringify(counts));
await sql.close();
