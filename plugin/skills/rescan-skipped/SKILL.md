---
name: rescan-skipped
description: Re-score a campaign's skipped jobs and promote the eligible ones to `approved` for later applying. Recovers jobs wrongly dropped for location, a sparse JD, 1099, or seniority. Does not apply.
argument-hint: "<campaign-id> [--jobs key1,key2,…]"
---

# Rescan Skipped - Recover Wrongly-Dropped Jobs

Re-score a campaign's `skipped` jobs and set eligible ones to `approved`. **Never apply and never change the campaign's status**. Applying promoted jobs requires explicit selection through the common queue. Follow `../_shared/queue-workspace.md`; a rescan task never delegates an apply-mode worker.

## Setup

Follow `../_shared/setup.md`. Fetch the campaign: `openapply-api GET /api/campaigns/<campaign-id>`. Threshold = `config.minScore` (fallback `autoApply.minMatchScore`, else 60).

## Step 1: Select Targets

Targets are **every** `status:"skipped"` job; with `--jobs key1,key2,…`, restrict to those `key`s.

- **Always leave (permanent) - only these:** `skipReason` starting `Already applied`, `CAPTCHA`, `Payment required`, or `No visa sponsorship (JD:`, or one stating a JD-cited citizenship/clearance requirement.
- **Whole-campaign mode (no `--jobs`):** also leave deliberate user choices - `Removed by user`, `Not selected by user`, `User cancelled…`, `Max applications limit reached`, `Campaign paused by user`.
- **`--jobs` mode:** reconsider every named target except the permanent ones.

Count the full target list up front and process every one. **Below-threshold, zero-score, and no-`skipReason` jobs are all targets** - the stored score came from the campaign that wrongly skipped them, so it's never a reason to skip the re-score. Don't cherry-pick the jobs already at/above threshold.

## Step 2: Per Job

1. **Read the full posting** with narrowed snapshots; authenticate per `../_shared/auth.md` if needed. A cached digest or old numeric score is insufficient. Inspect role, all nonempty preferences and explicit eligibility requirements.
2. **Refresh source first** - terminal rows cannot be PATCHed. Write `{action:"refresh",description:<complete posting text>,digest:<display/tailoring JSON text>,title,company,location,type}` with only known metadata to a job-prefixed JSON file and POST `/api/campaigns/<id>/jobs/<key>/rescan`. It stays skipped; changed source invalidates the prior assessment. Never include score fields.
3. **Assess original evidence** using `../_shared/original-fit.md`: request context for this saved skipped job, assess every criterion and submit the basis hashes. Reuse a current cached assessment unchanged; never rerate identical material to raise the score. An unavailable full posting remains unresolved, not approved.
4. **Decide:**
   - A current assessment meets the threshold and preference/eligibility checks → promote without applying. Write `{"decision":"approved"}` to `$OPENAPPLY_TEMP/rescan-<key>.json`, then:

```bash
openapply-api POST /api/campaigns/<campaign-id>/jobs/<key>/rescan --data @"$OPENAPPLY_TEMP/rescan-<key>.json"
```

- Below threshold → POST `/rescan` with `{decision:"skipped",skipReason:"Below minimum match score (X < Y)"}`. Never send a client score or reason field.
- A known preference mismatch or confirmed JD eligibility conflict → POST `/rescan` with `{decision:"skipped",skipReason:<exact reason>}`.
- Unclear scope or unresolved required facts → leave skipped, report unresolved and do not promote. Assessment uncertainty first requires agent inspection; it does not automatically request user approval.

## Step 3: Finish

Process every target before finishing - `promoted + left-skipped + permanent` must equal the target count. If any are unprocessed, keep going; don't report a partial pass as complete.

Print a short table (promoted vs left `skipped`, with reasons) plus the reconciliation (e.g. "228 skipped → 226 targets; 19 promoted, 207 left skipped"). Then point the user to the campaign page's Apply selected action. Don't apply; don't change campaign status.
