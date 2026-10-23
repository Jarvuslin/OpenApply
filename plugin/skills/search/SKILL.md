---
name: search
description: Discover suitable jobs from the profile and original resume, save a scored candidate list, and show evidence and preference checks without applying.
argument-hint: "[query] [--board <domain>] [--max-jobs N] [--campaign <campaign-id>]"
---

# Job Search

Start with `openapply-api GET /api/health`. Stop clearly if the API is unavailable.

## Profile candidate lists

For `--campaign <id>`, fetch the exact campaign first. If it has `config.discovery`, follow
`../_shared/profile-discovery.md` in preview mode and stop after collection/scoring. Keep its
selected resume and campaign in progress; `discovery.phase:"complete"` identifies the finished
preview. Never apply through this skill, even if a different command previously authorized
that list. With no board or campaign, create a profile list with intent `preview` through the
same workflow. A natural request such as "find entry-level jobs for me" needs no CLI flags.

The board-specific steps below apply only to older explicit single-board search campaigns.

Read `$OPENAPPLY_SKILLS_ROOT/_shared/blocked-sites.md` before any browser action.

Search a single board (picked by the user when launching the campaign) and rank results by qualification fit against the resume.

## Setup

1. Follow `../_shared/setup.md`.
2. Parse and strip the flags; the rest is the free-text query.
   - `--board <domain>` - **required** (e.g. `--board linkedin.com`).
   - `--max-jobs <N>` - optional cap on results to rank. Absent = unlimited (rank until the board is exhausted).
   - `--campaign <campaign-id>` - campaign to save results to (Phase 5). The web UI passes it; if absent, match the latest `source:"search"`, `status:"in_progress"` campaign on the query, else create one (a `source:"search"` create requires `config.resumeId` - default to the profile's `primaryResumeId`).
3. Resolve the board:

   ```bash
   openapply-api GET /api/job-boards
   ```

   Pick the entry whose `domain` is `<domain>`. If none matches, abort with: "Board `<domain>` is not configured. Add it on /boards or run again with a different `--board`." When a `--campaign` id was given, first command it to `failed` with `POST /api/campaigns/<id>/status {"status":"failed"}`.

## Phase 1: Parse Query

Read saved `jobPreferences.roles`, levels, work modes, employment types and preferred locations. Include selected roles in the query alongside the user's keywords/location. Empty selections are unrestricted; never silently alter saved preferences. Resolve a genuinely ambiguous user target before searching.

## Phase 2: Search the Board

1. `browser_navigate` to the resolved board's `searchUrl`.
2. Follow `../_shared/auth.md` to log in proactively.
3. Fill the search fields and submit.
4. Take a `browser_snapshot` narrowed to the results list (per `../_shared/browser-tips.md`) and read `{ title, company, location, url, postedAt }` per row. While under `--max-jobs` (or always, when it's absent/unlimited), scroll/paginate per **Pagination & infinite scroll** in `../_shared/browser-tips.md` until the cap is met or results run dry.
5. Take the first `--max-jobs` results (or all when unlimited). Snippets are discovery data only: do not rank or score them. Assign each a stable shell-safe key and save a pending, unscored Job with `{key,title,company,location,url,board,status:"pending"}`. The next phases use these existing rows; never create a second copy after scoring.

## Phase 3: Exclude Previously Applied

Run the applied-check (`../_shared/campaign-flow.md`) per result. If `.applied`, tag with
"Previously Applied" (note `.match.kind`), then record `skipped` through the saved row's
`/jobs/<key>/result`; do not offer it for apply.

## Phase 4: Fit Review

Delegate every surviving row to `job-worker` in batches of at most five, one worker at a time: `{mode:"score",campaignId,jobs:[{jobKey,url,title,company}],save:"patch",resumeId,minMatchScore:<campaign minimum or profile default>}`. The worker visits each full posting, saves its complete description, and follows `../_shared/original-fit.md`. A digest is only a display/tailoring summary. Never use a zero threshold to bypass the campaign minimum.

Collect the saved server score, evidence and separate preference decision. Below-threshold or known-mismatch jobs are skipped with an exact reason. Unavailable postings stay unscored. For each scoring needs_user, save its named question and PATCH that row to needs_user per campaign-flow, preserve the tab and continue. Known-role needs_review assessments receive agent inspection; do not turn candid gaps into routine user approval. Do not offer unscored or parked rows as qualified.

## Phase 5: Verify Saved Results

Read the campaign's saved rows and reconcile scored, skipped and unscored counts. The assessment endpoint already saved each score and reason; never PATCH them or bulk-create the jobs again. **Don't offer apply/search-again commands** - the user applies from the campaign page. Leave incomplete discovery/scoring work visible. When discovery and scoring are finished, close the search campaign:

```bash
openapply-api POST /api/campaigns/<campaign-id>/status --data '{"status":"completed"}'
```

## Phase 6: Hand Off

Print a compact ranked table, then link to the campaign - nothing else:

```
## Saved <N> jobs · "[query]" - review and apply at $OPENAPPLY_WEB/campaigns/<campaign-id>

| # | Score | Title | Company | Location |
|---|-------|-------|---------|----------|
```

## Rules

The shared campaign rules (`../_shared/campaign-flow.md`) apply throughout. On top of them:

1. **Exactly one board per campaign** - the `--board` flag is required and the skill targets only that board.
2. **Handle rate limiting** - if blocked, note it and continue.
3. **Deduplicate** within the board.

Read `../_shared/browser-tips.md` for large pages, popups, and browser best practices.
