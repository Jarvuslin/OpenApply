# Agent workflow

Pick the lightest path that fits the change. Every stage is optional unless the change needs it.

Matt Pocock's skills come from the `mattpocock-skills` plugin, so type them with the prefix:
`/mattpocock-skills:to-spec`. pstack and repo skills live in `.claude/skills/` and take no
prefix: `/architect`, `/verify`. Plain `/code-review` is Claude Code's built-in reviewer, not
Matt's.

## Pick a path

| Change | Path |
| --- | --- |
| Typo, copy, one-line fix | Edit, `/verify`, `/commit`. |
| Bug | `/mattpocock-skills:diagnosing-bugs`, then a failing test via `/mattpocock-skills:tdd`, fix, `/verify`, `/commit`. |
| Small feature, one module | `/architect` if it crosses a function boundary, then build with `/mattpocock-skills:tdd`, then Verify. |
| Feature across apps (web + API + contracts) | All four stages below. |
| Work too large for one session | `/mattpocock-skills:wayfinder` first, then run the stages per resolved ticket. |

## 1. Architecture

1. `/mattpocock-skills:grill-with-docs`: interview until the plan is sharp. Records terms in
   `GLOSSARY.md` and decisions as ADRs in `docs/adr/`.
2. `/architect`: settle types, signatures, and module shape before code. Respect
   `.claude/rules/*.md` and the API-owns-state boundary.
3. `/mattpocock-skills:to-spec`: write the spec to `.scratch/<feature>/spec.md`.

Use `/how` to learn a subsystem before changing it, and `/why` when a past decision is unclear.

## 2. Execution

1. `/mattpocock-skills:to-tickets`: split the spec into tracer-bullet tickets in
   `.scratch/<feature>/issues/`.
2. `/mattpocock-skills:implement-spec` for a whole spec plus its tickets, or
   `/mattpocock-skills:implement` for one ticket or a smaller piece of work.

Repo-specific helpers: `/add-api-route`, `/db-migrate`. A schema change always goes through
`/db-migrate`.

## 3. Verification

1. Automated tests: `/verify` (Biome, knip, typechecks, API, contracts, web, node tests, and .NET
   tests when terminal files change). Add the domain `*:verify` runner when you touch that domain
   and a disposable database is available (see `docs/testing-tiers.md`).
2. App behavior: drive the real UI on `:4100` with the browser pane or Playwright MCP, and
   capture evidence. Until a verify-app skill exists, check the changed screens by hand.
3. `/interrogate`: adversarial review by Opus and Sonnet. Use it only for risky or cross-app
   diffs.
4. `/mattpocock-skills:code-review`: check the diff against the repo's standards and the spec.

`/blast-radius` (or the existing `/what-could-break`) applies before an edit to a shared path:
an API payload, a contracts schema, stored data, or a plugin skill other agents read.

## 4. Shipping

1. Check affected modules and regressions: `/blast-radius` on the final diff when it touches
   `packages/contracts`, Prisma, or `plugin/`.
2. `/verify` must pass. CI (`.github/workflows/ci.yml`) runs the same gate on the PR.
3. `/commit`, then open one focused PR per ticket or tracer bullet. `/pr-review` before merge.

## Cost rules

- Skip `/arena`, `/interrogate`, and other multi-agent skills for trivial changes.
- `/arena` is for a design with two or more credible shapes, not for routine code.
- pstack's model choices live in `~/.agents/pstack-models.md` (Claude-only).
- Use `/correct` when the same agent mistake shows up twice. It turns the fix into a lint, type,
  or test instead of another doc line.
