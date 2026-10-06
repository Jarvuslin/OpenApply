# How JobPilot works

A plain-language tour of what JobPilot is made of and what happens when you
use it. You don't need to know how to program to follow it. For the technical
internals, see [development.md](development.md).

## The big picture

JobPilot is split into two halves:

- **The dashboard** lives in the cloud. It's the website where you sign up,
  fill in your profile, manage resumes, start campaigns, and track every
  application from "applied" to "offer".
- **The agent** lives on your computer: an AI assistant (Claude Code or Codex,
  running on your own subscription) equipped with the JobPilot plugin. It
  opens a real browser on your machine and does the actual work of searching
  job boards, tailoring your resume, filling out application forms, and
  messaging recruiters.

```text
        In the cloud                          On your computer
  ┌──────────────────────┐             ┌───────────────────────────┐
  │  JobPilot dashboard  │ ◄────────►  │  AI agent (Claude/Codex)  │
  │  profile · resumes   │             │  + JobPilot plugin        │
  │  campaigns · inbox   │             │  + a real web browser     │
  └──────────────────────┘             └───────────────────────────┘
```

There are three reasons for the split:

1. The AI runs on the Claude or Codex plan you already pay for, so JobPilot
   never resells AI usage or meters tokens.
2. Applications are submitted from a real browser on your own computer, logged
   in as you, rather than from a data center.
3. That browser opens right in front of you. Every search, click, and form
   fill happens on your screen, and you can step in anytime.

## The three parts

### 1. The dashboard (the website)

Your data lives at [jobpilot.suxrobgm.net](https://jobpilot.suxrobgm.net):
your profile, resumes and tailored variants, campaigns, the application
pipeline, recruiter inbox and analytics. The site also
has a built-in terminal panel (the "agent dock") where you can see and control
the agent running on your machine.

### 2. The agent (the plugin)

The JobPilot plugin teaches Claude Code or Codex a set of **skills**: commands
like `search`, `auto-apply`, or `cover-letter`. When you run
one, the agent:

- reads your profile and resume from the dashboard,
- drives a real browser to do the work (search, log in, fill forms),
- writes the results back, so your pipeline updates in real time.

Three skills handle resumes. `extract-resume` parses your PDF exactly as
written, `review-resume` proposes an improved rewrite that waits for your
approval, and `tailor-resume` makes a per-job copy (a **variant**) while
leaving your base alone. None of them can add an employer, date, or metric
that isn't already in your resume: the dashboard enforces that server-side
instead of trusting the model, and flags whatever it can't verify.

The same plugin works in both Claude Code and Codex, so install it in
whichever one you use.

### 3. The terminal companion (the bridge)

A small helper program that runs in the background on your computer. It keeps
the agent session alive and connects it to the dashboard, so the terminal
panel on the website shows the agent working on your machine, and buttons on
the website can send it commands. It also hands the agent a secure token when
it starts, so the agent acts as _you_ without any manual setup.

You don't interact with it directly: the `setup` skill (or the dashboard's
agent dock) installs and starts it for you.

## What happens when you run a campaign

Say you run `auto-apply senior typescript remote`:

1. The agent checks in with the dashboard and loads your profile,
   preferences, and default resume.
2. It opens a browser on your machine and searches the job board you chose,
   logging in with your saved credentials if needed.
3. It scores each job against your resume and skips the ones that don't fit,
   duplicates you've already applied to, and low-quality postings.
4. For each match it applies: picking or tailoring the right resume variant,
   filling out the form, answering screening questions, and writing a cover
   letter when one is requested.
5. It reports back after every job, so the campaign page on the dashboard
   updates live with applied, skipped, or failed, and a reason.
6. Every submitted application lands in the tracker, and later recruiter
   replies in your inbox get matched to it automatically.

Depending on the campaign mode, the agent either asks you to review matches
first (`search`, `apply`) or proceeds on its own up to a cap you set
(`auto-apply`).

## The Pilot: fully autonomous mode

Everything above still works by hand, but you can also hand the whole loop
over. Write your instructions once (goals, daily caps, and saved searches) and the Pilot repeats one
cycle for as long as it's enabled:

```text
  sense ──► decide ──► act ──► record ──► exit
    ▲                                        │
    └──── the orchestrator re-injects ◄───────┘
```

- **Sense.** The agent fetches its agenda, a prioritized list the server
  compiles fresh from your data on every request (jobs to apply to, replies to
  review, follow-ups due). There is no separate task queue or background cron.
- **Decide.** It takes the single top item.
- **Act.** It claims the item, with a short-lived claim that has a built-in
  timeout, and does that one thing: apply to a job, send a follow-up, draft an
  interview reply. The result is saved to the server before anything else
  happens, so a crash mid-cycle loses nothing. The claim expires and the work
  returns to the agenda.
- **Record.** The action lands in the live journal.
- **Exit.** The cycle prints a sentinel line (`[[JOBPILOT_CYCLE ...]]`) and
  stops. The orchestrator on your machine reads it, confirms completion with
  the server (garbled terminal output can't fake a finish), and schedules the
  next run. A quiet or stuck run gets a check-in reminder, then a session
  restart; the claim timeout returns its work to the agenda either way.

Two things let this run without a browser tab open: **one-time pairing**
stores your login token securely with the host when you first enable the
Pilot, so it can start its own sessions after a reboot or crash; and a live
SSE connection lets the dashboard wake the agent the moment something
time-sensitive happens instead of waiting for the next scheduled check.

Anything the Pilot isn't sure about (a salary question, an unexpected form
field, an interview invite) is sent to your phone as a question in the form of
a one-tap card, and the affected job is parked until you answer. The important
limits are more than instructions to the AI. The daily apply cap is enforced by the API.

## Where your data lives

- Your profile, resumes, applications, and campaigns are stored in your
  JobPilot account on the web.
- Job-board passwords and tokens are encrypted with a key unique to your
  account.
- The cloud never logs into job boards for you. Board sessions, cookies, and
  form submissions all stay in the browser on your computer.
- Your prompts and the agent's work go through your own Claude or Codex
  subscription, not through JobPilot's servers.

## Live updates

While the agent works, every open dashboard page keeps itself current. The
campaign page shows per-job progress, the pipeline shows new applications, and
the inbox shows newly matched replies, so you never have to refresh.

## Further reading

- [development.md](development.md): run JobPilot locally, repository layout,
  tech stack, and the technical internals behind everything above.
- [User docs](https://jobpilot.suxrobgm.net/docs): getting started, campaigns
  & skills, email setup, credentials, FAQ.
