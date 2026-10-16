# Pilot searches: plan

Status: phases 1, 2, 3 and 5 built 2026-10-12 (pilots API + scheduler, pilot_score queue task, 10/30-min feed refresh, web /pilots). Phase 4 (company type data) not built: the company-type rule is saved but does not narrow results yet. Old Pilot (PilotSearch, agenda, Settings > Pilot) and the Searches tab still exist. Review screen follows the user-supplied reference (2026-10-12): header with Edit search / Run now / more, settings card, "Jobs to review" summary, selection bar with Queue all and Clear selection, Match column sortable.
https://www.figma.com/design/G0AY9xKcHpUqWbINS2DvDj (frames: all pilots, set up, looking,
review results).

## What a pilot is

A saved set of rules that finds new jobs and either holds them for review or adds them to the
queue. It replaces the old Pilot page and the run-once saved search.

| Rule | Choice | Data today |
| --- | --- | --- |
| Roles | multi-select + custom | `JobListing.title` (match against role synonyms) |
| Experience level | multi-select: intern, entry, mid, senior, lead | `JobListing.level` (often `unknown`) |
| Company type | multi-select: startup, scale-up, enterprise, agency | **missing**, see phase 4 |
| Location | multi-select cities/countries + remote region | `location`, `countries`, `remote` |
| Work mode | multi-select: remote, hybrid, on-site | `workMode` |
| Keywords / exclude keywords | free-text tags (optional) | title + description excerpt |
| Companies / skip companies | free-text tags (optional) | `company`, normalized name |
| Minimum fit | slider 0-100, scored against the original resume | agent scoring (existing) |
| Unknown details | include and let fit decide (default), or skip | — |
| Posted within | **multi-select** windows: 30 min, 1 h, 6 h, 24 h, 3 days, any | `postedAt`, else `listedAt` |
| Auto run | on/off | new |
| How often | always on (2 min), 10 min, 30 min, 1 h, 6 h, daily | new |
| When it finds matches | hold for review, or add to queue | new, per pilot |
| Max jobs per run | number, newest first | new |

Unknown level or company type counts as a match unless the pilot is set to skip unknown details (default
off), so missing data never silently hides jobs.

## Set up

A five-step wizard (Figma frames "Pilot set up — 1…5"): Basics (name, roles, level, company
type, location, work mode) → Filters (keywords, exclude keywords, companies, skip companies,
posted within) → Matching (minimum fit, resume, unknown details) → Schedule (auto run, how
often, hold or add, max jobs) → Review (each section with Edit; Create pilot / Create and run
now). Back and Continue between steps; Save and exit keeps a draft. A summary on the right
fills in as each step is completed. Editing an existing pilot reuses the same steps.

## Behaviour

- **Run now**: one run, results always held for review. Disabled while a run is in progress
  (button reads "Running…"). Stop looking ends the run and keeps what was found.
- **Auto run**: only when on. Runs on the chosen interval while the computer is connected. A
  run never overlaps another run of the same pilot; a due run is skipped, not queued.
- **Review**: results grouped by posted window (newest window first; a job appears once, in the
  newest window it fits). Per row: Add to queue, Remove. Bulk: select rows, Add all, Remove
  all. Tabs: To review / Added / Removed. Removed jobs never come back for that pilot.
- **Auto add**: matches go straight into the queue through the normal queue admission, so
  Queue settings (per day, per company, runs left), excluded companies, blocked sites and the
  already-applied check all still apply. They show under Added.
- Every job a pilot finds is deduped against the user's applications, queue and earlier
  results of every pilot.

## How a run works

1. **Filter on the server (no AI, seconds).** Query the shared `JobListing` index with the
   pilot's rules and windows, minus anything already seen. Cap at max jobs, newest first.
2. **Score on the computer (agent, minutes).** A `pilot_run` queue task gives the agent only
   those job IDs. It reads each full posting and saves the fit score with the existing scoring
   endpoint. Jobs below the minimum are dropped as "Below 70% fit".
3. **Finish.** Hold the rest for review, or admit them to the queue.

Step 1 makes frequent schedules cheap: a run with no new listings ends without waking the
agent or spending model allowance.

## Freshness: the real limit on "last 30 min"

Today company boards refresh every 30 min and public feeds every hour; Google and Simplify
give no posting time. So a 30-minute window is often empty. Fixes, in phase 3:

- Refresh boards that an active pilot depends on every 5 min (keep the hourly rate for the
  rest); add per-source backoff on errors.
- When `postedAt` is missing, use `listedAt` (first time we saw it) and label it
  "first seen 12 min ago" in the UI.
- Show per-pilot coverage: "Checked 412 postings from 38 sources · newest 6 min old".

## Phases

1. **Data + API.** New `Pilot` model (rules JSON, schedule, mode, max jobs, state, next run),
   `PilotResult` (pilot, listing, window, fit, status: found/scored/below_fit/review/added/
   removed). Routes: CRUD, run now (409 while running), stop, results list, add/remove one or
   many. Migrate any `PilotSearch` rows; drop `PilotSearch`, the old agenda kinds and
   `/pilot` instructions in a data migration. Contracts + tests.
2. **Runs.** Server filter (step 1), `pilot_run` work intent and skill instructions for
   scoring only, finish step, scheduler (code-only, replaces the agenda path for searches).
   Guard: one active run per pilot.
3. **Freshness.** Faster refresh for pilot-relevant sources, `listedAt` fallback, coverage
   numbers.
4. **Company type.** New `Company` table keyed by normalized name/domain with `stage`
   (startup, scale-up, enterprise, agency, unknown). Fill from source hints (YC/Ashby/HN
   boards lean startup), employee count when a source gives it, and an agent pass for unknown
   companies seen by active pilots. Until filled, company type filters treat unknown as a match.
5. **Web.** Pilots page, set up page (with "Matching right now" preview from step 1), pilot
   detail with looking and review states, sidebar list with counts, dashboard search card
   wired to pilots. Remove Settings > Pilot and the Searches tab once data is migrated.

## Decisions made

- Scheduled runs follow a per-pilot "hold for review / add to queue" setting; Run now always
  holds for review.
- Posted-within is multi-select and results are grouped by window.
- No new limits: Queue settings stay the single place for per-day / per-company caps.

## Open questions

- Should "always on" be allowed on battery or metered connections, or only when idle?
- Notify (Telegram) when a held run finishes with new matches?
- Keep removed jobs forever per pilot, or expire after 30 days so reposts can return?
