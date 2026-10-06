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

Read `user.contactEmail` from `GET /api/user`. If missing, return `needs_user` and direct the user
to complete their applicant contact email in OpenApply. Do not substitute the OpenApply login,
a resume address, or an account from another chat.

Read `GET /api/email/account`. An existing non-connector account requires the user to disconnect
it in `$OPENAPPLY_WEB/settings/email` before switching. Return `needs_user`; disconnecting can
remove saved messages, so do not do it automatically.

## 2. Verify the current agent's Gmail tools

Discover tools actually exposed to this session. Follow mailbox.md's provider setup instructions
when missing. Read the real mailbox address using the connector's authenticated profile/account
tool. A tool listing, installed plugin, or saved OpenApply row is not proof.

Compare the actual address with `user.contactEmail` and any existing connector account's `email`,
trimming whitespace and ignoring case only. On mismatch, stop before searching or importing:
report expected and actual addresses and return `needs_user` to switch Gmail accounts. If the
intended applicant address is wrong, the user must correct the profile first. Do not equate
Gmail dots, plus aliases, recipients, or forwarded mail with authenticated account identity.

If profile access fails or no authenticated identity tool exists, return `needs_user` with the
missing step. Never guess the mailbox or request passwords, cookies, tokens, Google Cloud client
IDs, or client secrets. Do not modify tool grants or agent allowlists.

## 3. Prove read access and register

Pull recent job mail per mailbox.md. For setup, search the last seven days even if `lastSyncAt`
exists; ingestion deduplicates repeat messages. Follow pagination and read actual matching
messages. Include verification mail only from known employer or career-platform senders,
not unrelated account-security mail.

Normalize and upload with `POST /api/email/messages/ingest`. An empty batch is valid only after
a completed successful search found zero matches. Timeout, missing tools, unreadable results,
and incomplete pagination are not an empty inbox. If a later batch fails, report partial
progress and retain the original search window for retry; do not claim completion.

After all batches succeed, re-read `GET /api/email/account` and require:

- `connected: true`, `provider: "connector"`, and the profile-verified mailbox in `email`;
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
