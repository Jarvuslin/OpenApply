import "reflect-metadata";
import { SQL } from "bun";
import { sha256 } from "../src/common/crypto/hash";
import { knownAliases } from "../src/modules/job-listing/companies";
import { KNOWN_COMPANIES } from "../src/modules/job-listing/company-directory";
import { canonicalizeUrl, listingSlug } from "../src/modules/job-listing/dedupe";
import { boardConflict, fuzzyMatch, matchKey } from "../src/modules/job-listing/listing-match";
import { greenhouseJobId, postingIdentity } from "../src/modules/job-listing/posting-identity";
import { sourceRank } from "../src/modules/job-listing/source-rank";
import { JOB_FEED_CATALOG } from "../src/modules/job-sources/catalog";
import { fetchSourceJson } from "../src/modules/job-sources/http";
import { normalizeCompanyName } from "../src/modules/scoring/applied-duplicates";

// Gives every company, source and listing its identity, splits listings that joined different
// openings, then merges duplicates by the publisher's four rules. Dry run unless --apply.
const apply = process.argv.includes("--apply");
const sql = new SQL(process.env.DATABASE_URL!.replace(/\?.*$/, ""));
const BATCH = 1000;

type Source = {
  id: string;
  listingId: string;
  url: string;
  applyUrl: string | null;
  board: string | null;
  postedAt: Date | null;
  boardKey: string | null;
  externalId: string | null;
  requisitionId: string | null;
  rank: number;
};
type Listing = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  descriptionExcerpt: string | null;
  slug: string;
  companyId: string | null;
  saved: boolean;
};

const counts = async () => {
  const [row] = await sql`select (select count(*)::int from job_listings) as listings,
    (select count(*)::int from job_listing_sources) as sources,
    (select count(*)::int from job_listing_sources where url like 'https://careers.opentext.com/%') as "openTextJobs",
    (select count(distinct listing_id)::int from job_listing_sources where url like 'https://careers.opentext.com/%') as "openTextListings"`;
  return row;
};
console.log("BEFORE", JSON.stringify(await counts()));

// 1. Companies: the directory by domain, then every board's company, with YC domains where known.
const companies = new Map<
  string,
  { id: string; key: string; name: string; aliases: Set<string> }
>();
const byAlias = new Map<string, string>();
for (const row of await sql`select id, key, name, aliases from companies`)
  companies.set(row.key, {
    id: row.id,
    key: row.key,
    name: row.name,
    aliases: new Set(row.aliases),
  });
const remember = (company: { id: string; key: string; aliases: Set<string> }) => {
  for (const alias of company.aliases) byAlias.set(alias, company.key);
};
for (const company of companies.values()) remember(company);
const ensureCompany = (key: string, name: string, aliases: string[], domain: string | null) => {
  let company = companies.get(key);
  if (!company) {
    company = { id: crypto.randomUUID(), key, name, aliases: new Set() };
    companies.set(key, company);
    (company as { domain?: string | null }).domain = domain;
  }
  for (const alias of aliases) company.aliases.add(alias);
  remember(company);
  return company;
};
for (const known of KNOWN_COMPANIES)
  ensureCompany(known.domain, known.name, knownAliases(known), known.domain);
const companyFor = (name: string, domain: string | null = null, more: string[] = []) => {
  const alias = normalizeCompanyName(name);
  const existing = byAlias.get(alias) ?? (domain ? companies.get(domain)?.key : undefined);
  if (existing) {
    const company = companies.get(existing)!;
    for (const other of more) company.aliases.add(normalizeCompanyName(other));
    remember(company);
    return company;
  }
  return ensureCompany(
    domain ?? `name:${alias}`,
    name,
    [alias, ...more.map(normalizeCompanyName)],
    domain,
  );
};
const yc = new Map<string, { website: string | null; former: string[] }>();
for (const company of (await fetchSourceJson(
  "https://yc-oss.github.io/api/companies/hiring.json",
)) as {
  slug: string;
  website?: string | null;
  former_names?: string[] | null;
}[])
  yc.set(company.slug, { website: company.website ?? null, former: company.former_names ?? [] });
const ycByBoard = new Map<string, string>();
for (const probe of await sql`select key, board_key from job_board_probes where board_key is not null`)
  ycByBoard.set(String(probe.board_key).toLowerCase(), String(probe.key).replace(/^yc\//, ""));
const domainOf = (website: string | null) =>
  website ? (URL.parse(website)?.hostname.replace(/^www\./, "") ?? null) : null;

const boards = new Map<string, string>();
for (const board of JOB_FEED_CATALOG)
  boards.set(`${board.provider}/${board.slug}`.toLowerCase(), companyFor(board.company).key);
for (const board of await sql`select key, company from discovered_job_boards`) {
  const key = String(board.key).toLowerCase();
  const ycCompany = yc.get(ycByBoard.get(key) ?? "");
  boards.set(
    key,
    companyFor(board.company, domainOf(ycCompany?.website ?? null), ycCompany?.former).key,
  );
}

// 2. Source identity, from the URL, or for Greenhouse jobs on employer sites, from the company's
//    one Greenhouse board; career sites map by host.
const sites = new Map<string, string>();
for (const board of JOB_FEED_CATALOG)
  if (board.provider === "successfactors" || board.provider === "phenom")
    sites.set(board.slug.split("/")[0]!, `${board.provider}/${board.slug}`.toLowerCase());
const greenhouseBoards = new Map<string, string[]>();
for (const [key, company] of boards)
  if (key.startsWith("greenhouse/"))
    greenhouseBoards.set(company, [...(greenhouseBoards.get(company) ?? []), key]);

const listings = new Map<string, Listing>();
for (const row of await sql`select l.id, l.title, l.company, l.location, l.posted_at as "postedAt", l.first_seen_at as "firstSeenAt", l.description_excerpt as "descriptionExcerpt", l.slug, l.company_id as "companyId", (exists (select 1 from saved_job_listings s where s.listing_id = l.id) or exists (select 1 from applications a where a.listing_id = l.id)) as saved from job_listings l`)
  listings.set(row.id, row as Listing);
const sources: Source[] = [
  ...(await sql`select id, listing_id as "listingId", url, apply_url as "applyUrl", board, posted_at as "postedAt", board_key as "boardKey", external_id as "externalId", requisition_id as "requisitionId", rank from job_listing_sources`),
] as Source[];
let identified = 0;
for (const source of sources) {
  source.rank = sourceRank(source.board);
  const host = URL.parse(source.url)?.hostname ?? "";
  const traced = postingIdentity(source.url);
  const listing = listings.get(source.listingId)!;
  const company = byAlias.get(normalizeCompanyName(listing.company));
  const greenhouse = greenhouseJobId(source.url);
  const ghBoards = company ? (greenhouseBoards.get(company) ?? []) : [];
  if (!source.boardKey && traced) Object.assign(source, traced);
  else if (!source.boardKey && greenhouse && ghBoards.length === 1)
    Object.assign(source, { boardKey: ghBoards[0], externalId: greenhouse });
  else if (!source.boardKey && sites.has(host)) {
    const id = /\/(?:job\/)?(\d+)\/?$/.exec(URL.parse(source.url)?.pathname ?? "")?.[1];
    if (id) Object.assign(source, { boardKey: sites.get(host), externalId: id });
  }
  // Workday ids end in the requisition: "..._R-0000183912-1".
  const requisition = /_((?:JR|REQ|R)[-_]?\d{4,12})(?:-\d+)?$/.exec(source.externalId ?? "")?.[1];
  if (source.boardKey?.startsWith("workday/") && requisition) source.requisitionId ??= requisition;
  if (source.boardKey) identified++;
}
console.log(
  JSON.stringify({
    companies: companies.size,
    boardsWithCompany: boards.size,
    sources: sources.length,
    identifiedSources: identified,
  }),
);

// 3. Company per listing: its best-ranked source's board company, else the company by name.
const sourcesByListing = new Map<string, Source[]>();
for (const source of sources)
  sourcesByListing.set(source.listingId, [
    ...(sourcesByListing.get(source.listingId) ?? []),
    source,
  ]);
const companyKeyOf = (listing: Listing, own: Source[]) => {
  const ranked = [...own].sort((a, b) => b.rank - a.rank);
  for (const source of ranked) {
    const key = source.boardKey ? boards.get(source.boardKey) : undefined;
    if (key) return key;
  }
  return companyFor(listing.company).key;
};

// 4. Split: a listing holding two ids from one board becomes one listing per id.
const splits: { from: string; listing: Listing; sources: Source[] }[] = [];
for (const [listingId, own] of sourcesByListing) {
  const byIdentity = new Map<string, Source[]>();
  const loose: Source[] = [];
  for (const source of own) {
    if (source.boardKey && source.externalId) {
      const key = `${source.boardKey}|${source.externalId}`;
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), source]);
    } else loose.push(source);
  }
  const groups = [...byIdentity.values()];
  const conflict = groups.some((group, index) =>
    groups.some((other, otherIndex) => otherIndex > index && boardConflict(group, other)),
  );
  if (!conflict) continue;
  const original = listings.get(listingId)!;
  // The first id keeps the listing, with every source that names no id.
  const kept: Source[][] = [[...(groups[0] ?? []), ...loose]];
  for (const group of groups.slice(1)) {
    const home = kept.find((cluster) => !boardConflict(cluster, group));
    if (home) home.push(...group);
    else kept.push(group);
  }
  for (const cluster of kept.slice(1)) {
    const first = cluster[0]!;
    const dates = cluster.map((source) => source.postedAt).filter((date): date is Date => !!date);
    const listing: Listing = {
      ...original,
      id: crypto.randomUUID(),
      slug: listingSlug(original, sha256(first.url)),
      postedAt: dates.length ? new Date(Math.min(...dates.map(Number))) : original.postedAt,
      saved: false,
    };
    listings.set(listing.id, listing);
    for (const source of cluster) source.listingId = listing.id;
    sourcesByListing.set(listing.id, cluster);
    splits.push({ from: listingId, listing, sources: cluster });
  }
  sourcesByListing.set(listingId, kept[0]!);
}

// 5. Merge in rule order, never joining two ids from one board.
const parent = new Map<string, string>();
const root = (id: string): string => {
  let at = id;
  while (parent.get(at) && parent.get(at) !== at) at = parent.get(at)!;
  return at;
};
const members = new Map<string, Source[]>();
for (const [id, own] of sourcesByListing) {
  parent.set(id, id);
  members.set(id, [...own]);
}
const union = (a: string, b: string) => {
  const left = root(a);
  const right = root(b);
  if (left === right || boardConflict(members.get(left)!, members.get(right)!)) return false;
  parent.set(right, left);
  members.set(left, [...members.get(left)!, ...members.get(right)!]);
  return true;
};
const merges = { byBoardId: 0, byApplyUrl: 0, byRequisition: 0, fuzzy: 0 };
const pass = (
  name: keyof typeof merges,
  keysOf: (listingId: string, own: Source[]) => string[],
) => {
  const first = new Map<string, string>();
  for (const [listingId, own] of sourcesByListing)
    for (const key of keysOf(listingId, own)) {
      const seen = first.get(key);
      if (!seen) first.set(key, listingId);
      else if (union(seen, listingId)) merges[name]++;
    }
};
const companyKeys = new Map<string, string>();
for (const [id, own] of sourcesByListing) companyKeys.set(id, companyKeyOf(listings.get(id)!, own));
pass("byBoardId", (_, own) =>
  own.filter((s) => s.boardKey && s.externalId).map((s) => `${s.boardKey}|${s.externalId}`),
);
pass("byApplyUrl", (_, own) =>
  own.flatMap((s) => (s.applyUrl ? [canonicalizeUrl(s.applyUrl)] : [])),
);
pass("byRequisition", (id, own) =>
  own.filter((s) => s.requisitionId).map((s) => `${companyKeys.get(id)}|${s.requisitionId}`),
);
const groups = new Map<string, string[]>();
for (const [id, listing] of listings) {
  if (!sourcesByListing.has(id)) continue;
  const key = `${companyKeys.get(id)}|${matchKey(listing.title, listing.location)}`;
  groups.set(key, [...(groups.get(key) ?? []), id]);
}
for (const ids of groups.values()) {
  if (ids.length < 2 || ids.length > 50) continue;
  for (const id of ids) {
    const self = listings.get(id)!;
    const matches = ids.filter((other) => {
      if (other === id || root(other) === root(id)) return false;
      const candidate = listings.get(other)!;
      return fuzzyMatch(
        {
          postedAt: self.postedAt,
          description: self.descriptionExcerpt,
          sources: members.get(root(id))!,
        },
        {
          postedAt: candidate.postedAt,
          description: candidate.descriptionExcerpt,
          sources: members.get(root(other))!,
        },
      );
    });
    if (matches.length === 1 && union(id, matches[0]!)) merges.fuzzy++;
  }
}
const clusters = new Map<string, string[]>();
for (const id of sourcesByListing.keys())
  clusters.set(root(id), [...(clusters.get(root(id)) ?? []), id]);
console.log(JSON.stringify({ splitOff: splits.length, ...merges, listingsAfter: clusters.size }));

if (apply) {
  // Splits and source moves commit together, so a failure never leaves listings without sources.
  await sql.begin(async (tx) => {
    for (const split of splits) {
      const l = split.listing;
      await tx`insert into job_listings (id, slug, dedupe_key, title, company, location, countries, remote, salary, salary_min, salary_max, salary_currency, salary_period, work_mode, employment_kind, company_logo_url, posted_at, listed_at, employment_type, skills, description_excerpt, requirements, responsibilities, years_experience, level, status, first_seen_at, last_seen_at, created_at, updated_at, is_public)
      select ${l.id}, ${l.slug}, dedupe_key, title, company, location, countries, remote, salary, salary_min, salary_max, salary_currency, salary_period, work_mode, employment_kind, company_logo_url, ${l.postedAt}, coalesce(${l.postedAt}, listed_at), employment_type, skills, description_excerpt, requirements, responsibilities, years_experience, level, status, first_seen_at, last_seen_at, now(), now(), is_public
      from job_listings where id = ${split.from}`;
    }
    const moves = sources.map((s) => ({
      id: s.id,
      listing: s.listingId,
      key: s.boardKey,
      ext: s.externalId,
      req: s.requisitionId,
      rank: s.rank,
    }));
    for (let start = 0; start < moves.length; start += BATCH) {
      const rows = moves.slice(start, start + BATCH);
      await tx`update job_listing_sources s set listing_id = v.listing, board_key = v.key, external_id = v.ext, requisition_id = v.req, rank = v.rank::int
      from (select * from json_to_recordset(${JSON.stringify(rows)}::text::json) as x(id text, listing text, key text, ext text, req text, rank int)) v
      where s.id = v.id`;
    }
  });
  // Merge each cluster into its best listing: one a user saved or applied to, else the highest rank.
  const best = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const left = listings.get(a)!;
      const right = listings.get(b)!;
      if (left.saved !== right.saved) return left.saved ? -1 : 1;
      const rank = (id: string) =>
        Math.max(0, ...(sourcesByListing.get(id) ?? []).map((s) => s.rank));
      return rank(b) - rank(a) || left.firstSeenAt.getTime() - right.firstSeenAt.getTime();
    })[0]!;
  let removed = 0;
  for (const ids of clusters.values()) {
    if (ids.length < 2) continue;
    const keep = best(ids);
    const losers = ids.filter((id) => id !== keep);
    await sql.begin(async (tx) => {
      await tx`update job_listing_sources set listing_id = ${keep} where listing_id in ${tx(losers)}`;
      await tx`insert into saved_job_listings (user_id, listing_id, saved_at) select user_id, ${keep}, saved_at from saved_job_listings where listing_id in ${tx(losers)} on conflict do nothing`;
      await tx`insert into personal_job_listings (user_id, listing_id) select user_id, ${keep} from personal_job_listings where listing_id in ${tx(losers)} on conflict do nothing`;
      await tx`update applications set listing_id = ${keep} where listing_id in ${tx(losers)}`;
      await tx`delete from pilot_results where listing_id in ${tx(losers)} and pilot_id in (select pilot_id from pilot_results where listing_id = ${keep})`;
      await tx`update pilot_results set listing_id = ${keep} where listing_id in ${tx(losers)}`;
      await tx`update job_listings set posted_at = (select min(posted_at) from job_listings where id in ${tx(ids)}) where id = ${keep} and posted_at is distinct from (select min(posted_at) from job_listings where id in ${tx(ids)})`;
      await tx`delete from job_listings where id in ${tx(losers)}`;
    });
    removed += losers.length;
  }
  // Companies, then each listing's company, match key and best rank.
  const companyRows = [...companies.values()].map((company) => ({
    id: company.id,
    key: company.key,
    domain: (company as { domain?: string | null }).domain ?? null,
    name: company.name,
    aliases: [...company.aliases],
  }));
  for (let start = 0; start < companyRows.length; start += BATCH)
    await sql`insert into companies (id, key, domain, name, aliases)
      select id, key, domain, name, array(select jsonb_array_elements_text(aliases))
      from jsonb_to_recordset(${JSON.stringify(companyRows.slice(start, start + BATCH))}::text::jsonb) as x(id text, key text, domain text, name text, aliases jsonb)
      on conflict (key) do update set aliases = excluded.aliases, domain = coalesce(companies.domain, excluded.domain)`;
  const ids = new Map<string, string>();
  for (const row of await sql`select id, key from companies`) ids.set(row.key, row.id);
  const boardRows = [...boards].map(([board_key, key]) => ({
    board_key,
    company_id: ids.get(key)!,
  }));
  for (let start = 0; start < boardRows.length; start += BATCH)
    await sql`insert into company_boards (board_key, company_id) select board_key, company_id from json_to_recordset(${JSON.stringify(boardRows.slice(start, start + BATCH))}::text::json) as x(board_key text, company_id text) on conflict (board_key) do update set company_id = excluded.company_id`;
  const updates = [...clusters.keys()].map((id) => {
    const listing = listings.get(best(clusters.get(id)!))!;
    const key = companyKeys.get(listing.id) ?? companyFor(listing.company).key;
    const company = companies.get(key)!;
    return {
      id: listing.id,
      company_id: ids.get(key)!,
      company: company.name,
      match_key: matchKey(listing.title, listing.location),
      rank: Math.max(0, ...members.get(id)!.map((s) => s.rank)),
    };
  });
  for (let start = 0; start < updates.length; start += BATCH)
    await sql`update job_listings l set company_id = v.company_id, company = v.company, match_key = v.match_key, source_rank = v.rank::int
      from (select * from json_to_recordset(${JSON.stringify(updates.slice(start, start + BATCH))}::text::json) as x(id text, company_id text, company text, match_key text, rank int)) v
      where l.id = v.id`;
  // One posting seen at two URLs (boards. and job-boards.greenhouse.io) keeps its best source row.
  const duplicates = await sql`delete from job_listing_sources s using job_listing_sources t
    where s.board_key = t.board_key and s.external_id = t.external_id
      and (s.rank, s.last_seen_at, s.id) < (t.rank, t.last_seen_at, t.id) returning s.id`;
  console.log(
    JSON.stringify({ removedByMerge: removed, duplicateSourceRowsRemoved: duplicates.length }),
  );
  console.log("AFTER", JSON.stringify(await counts()));
}
await sql.close();
