# LinkedIn discovery worker

This optional Python worker uses the **released `python-jobspy==1.2.0` wheel** to read
logged-out LinkedIn job-search cards. The API must have LinkedIn discovery enabled
and one to four saved searches for the personal token's owner. Results are sent to
that user's private discovery index. This worker never applies to jobs.

The shared OpenApply API owns saved searches, daily scheduling, duplicate handling,
title/experience filtering and employer-link resolution. The worker claims a run,
performs its bounded searches, and submits one result payload. Disabled or not-due
runs return HTTP 409 and produce no LinkedIn requests.

## Limits and behavior

- At most four saved searches per claimed daily run, 50 results and five requests
  per search: 200 raw results and 20 LinkedIn requests at most.
- `hours_old=24`, `fetch_description=False`, offset zero. No job-detail, company,
  login or browser requests. The only LinkedIn endpoint is the HTTPS guest search
  endpoint, and redirects are rejected.
- Plain `requests` transport, TLS verification enabled, zero retries,
  `trust_env=False`, no proxy, credentials, cookies, or authorization headers.
  The personal OpenApply token is confined to a separate API session.
- Any non-200 response, transport failure, or response without job cards stops
  the entire run and writes a **24-hour global backoff** to disk. An empty guest
  page cannot reliably distinguish zero matches from throttling, so it also
  triggers backoff. Later searches are reported as not attempted.
- All workers sharing an outbound IP must use the same persistent state file.
  Preserve it across restarts. A block is never worked around by changing IP,
  credentials, cookies, or query variants.
- Before ingestion, the exact payload is saved in the state directory under a
  personal-token hash. A later invocation retries only that same API payload;
  it does not search LinkedIn again. A confirmed expired, unfinished API lease
  discards the pending payload. Completed runs remain idempotently readable.
  The API timeout is 300 seconds; each invocation makes only one ingest attempt.
  The daemon retries a pending ingest after five minutes so a transient failure
  can recover before the API's one-hour lease expires, without fetching jobs again.
- The worker does not download descriptions, so source cards normally have no
  description, years-of-experience evidence, salary or employer application URL.
  Unknown values stay unknown. Direct employer URLs must be resolved by the API.

The private `f_E` extension accepts `1` or `2` for isolated verification, but is
**disabled in production**: the live check below showed it was ignored. Saved
experience preferences are handled by the API's explicit local filtering.
`remoteOnly` is passed through JobSpy's released `f_WT` parameter; remote eligibility
was not separately validated in the three-request live check.

## Run locally

Use Python 3.12. From `services/jobspy-worker`:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
$env:OPENAPPLY_API_URL = "http://127.0.0.1:4101"
.venv/Scripts/python.exe -m openapply_jobspy
```

This command stays running and checks for a daily run. **Enabling Settings alone
does not launch the worker**: keep this host process or container running. After a
completed run it waits 24 hours. Disabled/not-due/error responses wait one hour
before another API-only check, except an existing pending ingest retries after
five minutes; a global block waits until its stored backoff ends.
There is no rapid retry loop. The API also enforces one run per user per day across
worker restarts. For an existing external daily scheduler, use:

```powershell
.venv/Scripts/python.exe -m openapply_jobspy --once
```

Set `OPENAPPLY_API_TOKEN` through your existing secret/environment mechanism to a
personal API token for the intended user; do not put it in a command argument or
commit it. `OPENAPPLY_API_URL` accepts an HTTPS origin, with an optional `/api`
suffix. HTTP is allowed only for loopback development. Proxy environment variables
are ignored. The worker does not install an operating-system scheduled task.

Native runs default to `~/.openapply/jobspy-worker/state.json`, independent of the
working directory. Set `OPENAPPLY_JOBSPY_STATE` to use a different shared state
location. Docker sets `/state/state.json` explicitly. Before claiming a run, the
worker checks that this directory can persist both the global block and pending
ingest files; a bad or read-only state mount fails before any jobs are fetched.

The state directory contains a short-lived lease token while an ingest is pending.
Files are created with owner-only permissions on POSIX. On Windows, use a private
user directory with appropriate inherited ACLs. Logs never print the personal API
token, lease token, request headers or full API payload.
Each completed or blocked attempt logs request/page counts and a short stop reason
such as `http_429` or `empty_or_blocked_page` without query parameters.

## Container

Build from the repository root:

```sh
docker build -t openapply-jobspy services/jobspy-worker
docker volume create openapply-jobspy-state
docker run --detach --name openapply-jobspy --restart unless-stopped --env OPENAPPLY_API_URL --env OPENAPPLY_API_TOKEN \
  --mount source=openapply-jobspy-state,target=/state openapply-jobspy
```

Supply an HTTPS API address reachable from the container; container loopback is not
the host machine. The image runs the daily process by default as UID 10001, and `/state` must remain writable by
that user. Reuse the volume for every run and for other worker configurations on
the same outbound IP. API disabled/not-due responses are normal skipped runs.

## Tests and evidence

```sh
python -m unittest discover -s tests -t . -v
```

Tests use a minimal anonymized HTML fixture shaped like the observed public card.
They test the installed pinned parser, page/result limits, blocked responses,
durable backoff, token isolation, and exact pending-payload recovery without any
live network calls.

On **2026-10-07**, three Canada / `software engineer` first-page searches returned
HTTP 200 with 10 rows each: baseline, `f_E=1`, and `f_E=2`. All three had identical
job IDs, including senior titles. Only 10 unique jobs were observed. The checks
made exactly three logged-out requests and imported nothing. Aggregated evidence
is in [`docs/live-check-2026-10-07.json`](docs/live-check-2026-10-07.json); local raw
HTML and parsed rows were saved under `.temp/jobspy-live/` at the repository root.
Successful small checks do not guarantee LinkedIn will allow a later run.

The [PyPI release](https://pypi.org/project/python-jobspy/1.2.0/) differs from the
[current upstream source](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py).
The released wheel constructs query parameters inline in `scrape()` and has no
`_search_params` method/property. Optional experimental `f_E` injection therefore
lives in the guarded request session. The worker rejects another JobSpy version
until its behavior has been reviewed and the pin and tests updated together.
