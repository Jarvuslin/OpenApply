---
name: connect-email
description: Verify Gmail in the running Claude Code or Codex session and register its matching mailbox by importing recent job mail. Connection only; no classification, sending, or application-status changes.
---

# Connect Email

Start with `openapply-api GET /api/health`. If it fails, stop with the backend message from
`../_shared/setup.md`. Follow that document's authentication and profile steps, then read
`../_shared/mailbox.md`. Do not load board credentials or resume files for this task.

Verify the connection and import messages only. Do not invoke `scan-inbox`, classify messages,
extract or consume verification codes, send test mail, draft replies, change application
statuses, or launch application work.

## 1. Establish the intended mailbox

Read `GET /api/email/account` and retain the selected mailbox's `id` and `email` for the entire
run. If none is selected, use `user.contactEmail` from `GET /api/user` only for initial setup.
If no intended address is available, return `needs_user` and direct the user to add or select
an email in OpenApply. Do not substitute the OpenApply login, resume address, or another chat's
account. Do not change `contactEmail` while connecting a mailbox.

A selected non-connector mailbox requires the user to choose a connector mailbox in
`$OPENAPPLY_WEB/settings/email`. Return `needs_user`. Do not remove or replace existing accounts;
multiple mailboxes may coexist and switching selection should preserve their imported history.

## 2. Verify the current agent's Gmail tools

Discover tools actually exposed to this session. Follow mailbox.md's provider setup instructions
when missing. Read the real mailbox address using the connector's authenticated profile/account
tool. A tool listing, installed plugin, or saved OpenApply row is not proof.

Compare the actual address with the selected mailbox's `email`, or the profile address for
initial setup, trimming whitespace and ignoring case only. On mismatch, stop before searching
or importing: report expected and actual addresses and return `needs_user` to switch Gmail
accounts or choose the intended saved mailbox. Do not equate
Gmail dots, plus aliases, recipients, or forwarded mail with authenticated account identity.

If profile access fails or no authenticated identity tool exists, return `needs_user` with the
missing step. The standard Claude Gmail connector exposes search tools without a profile lookup;
its successful background `read_access` check and a user-confirmed saved address
(`identityVerified: false`) do not satisfy this skill's identity requirement. Explain that
automated import remains unavailable with those tools; reconnecting alone does not add the
missing identity tool. Even `identityVerified: true` from an earlier check requires a fresh
profile response in this session. Never guess the mailbox or request passwords, cookies,
tokens, Google Cloud client IDs, or client secrets. Do not modify tool grants or agent allowlists.

## 3. Prove read access and register

Pull recent job mail per mailbox.md. For setup, search the last seven days even if `lastSyncAt`
exists; ingestion deduplicates repeat messages. Follow pagination and read actual matching
messages. Include verification mail only from known employer or career-platform senders,
not unrelated account-security mail.

Normalize and upload with `POST /api/email/messages/ingest`. An empty batch is valid only after
a completed successful search found zero matches. Timeout, missing tools, unreadable results,
and incomplete pagination are not an empty inbox. If a later batch fails, report partial
progress and retain the original search window for retry; do not claim completion.

Include the selected `accountId` with each ingest batch. After all batches succeed, re-read
`GET /api/email/accounts` and require the row for the original verified mailbox:

- `provider: "connector"`, the verified mailbox in `email`, and the original `id` when available;
- non-null `lastSyncAt`, advanced by this run's successful ingest;
- actual successful profile and search/read responses in this session, plus successful ingest
  responses. A previously saved account row cannot replace these checks.

Do not call OAuth client/start/sync, message-classification, reply, or application-status
endpoints. OpenApply stores normalized messages; Gmail authentication stays with the agent.

## 4. Report

On success, report the verified mailbox, local agent checked, seven-day search window, actual
number of messages read, sum of ingest responses' `new` counts, and confirmed `lastSyncAt`.
Distinguish zero matches from messages already imported. Say connection and read access were
checked; sending and career-page email activation were not tested.

On `needs_user`, name the failing step and action needed to retry. Worker access is separate:
never claim autonomous application verification works merely because the main session connects.
