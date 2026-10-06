# OpenApply plugin

This plugin turns Claude Code or Codex into your job-search agent. It searches
job boards, tailors your resume for each posting, fills in applications, writes
cover letters and outreach messages, and keeps your pipeline in the
[OpenApply dashboard](http://localhost:4100) up to date.

It runs on your machine, on your own Claude or Codex subscription. Your
profile, resumes, and applications live in your OpenApply account; the agent
reads and writes them through the OpenApply API.

## Install

Install the plugin from your provider's marketplace (commands in the
[root README](../README.md#install-the-plugin)), then run the `setup` skill. It
installs the local terminal host, starts it, and sends you to the dashboard.
From then on you start and watch the agent from the dashboard.

The marketplace copy contains only `setup`. The terminal host ships the full
skill tree and keeps it updated.

## Skills

The main ones are `search`, `auto-apply`, `apply`, and
`cover-letter`. The [root README](../README.md#skills) lists them all.

## What's in here

| Path | What it is |
| --- | --- |
| `skills/<name>/SKILL.md` | One skill per directory. The same file serves Claude and Codex. |
| `skills/_shared/` | Docs several skills read: setup, login, form filling, browser tips, eligibility. No `SKILL.md`, so it isn't listed as a skill. |
| `skills/pilot/kinds/` | One file per task type the autonomous Pilot can pick up. |
| `skills/humanizer/` | Rewrites letters, proposals, and messages so they read like a person wrote them. Adapted from [blader/humanizer](https://github.com/blader/humanizer) (MIT). |
| `agents/` | `job-worker`, the subagent that handles one job at a time so browser output stays out of the main session. |
| `bin/` | `openapply-api`, the helper every skill uses to call the API. |
| `settings/` | Agent settings the terminal host passes to Claude and Codex. |
| `.mcp.json` | The Playwright browser server. |

## Editing skills

Edit the files here directly; there's no build step. Skills call sibling skills
by name and shared docs by relative path (`../_shared/setup.md`), which keeps
one text working for both providers. The
[development guide](../docs/development.md) covers how the host loads the
plugin and how releases ship it.
