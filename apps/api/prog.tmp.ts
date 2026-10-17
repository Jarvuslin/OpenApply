import { SQL } from "bun";

const sql = new SQL(process.env.DATABASE_URL!.replace(/\?.*$/, ""));
console.log(
  new Date().toISOString().slice(11, 16),
  JSON.stringify([
    ...(await sql`select d.provider, count(*)::int as boards, count(r.last_success_at)::int as refreshed, count(*) filter (where r.last_error is not null)::int as failing from discovered_job_boards d left join job_feed_refreshes r on r.key = d.key where d.gone_at is null group by 1 order by 2 desc`),
  ]),
);
await sql.close();
