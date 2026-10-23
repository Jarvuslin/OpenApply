# Telegram connect

Status: implemented 2026-10-14 (QR first, manual code second). Real-phone test pending a configured bot. Setup: docs/telegram-setup.md.

## Goal

A user on the web app (on a computer) links Telegram on their phone in under a minute, with no
Telegram app on the computer. After linking, the bot is their OpenApply contact.

Done when: on a real phone, a user opens the Telegram tab, searches the bot, sends the code, gets
"Connected" back in Telegram, and the web tab shows "Connected as @username" without a reload.

## The flow

```
Telegram tab (computer)                    Telegram (phone)
1. Search @<Bot> in Telegram          →    finds the bot, taps Start
                                           bot: "Send me the code from your OpenApply Telegram tab."
2. Send it this code: K7P-4QX         →    sends K7P-4QX
                                           bot: "Connected to OpenApply ✓"
3. Tab switches to "Connected as @username"
   Small QR shortcut: scan → Telegram opens the bot with the code filled in → tap Start.
```

## Decisions

- **One shared bot** for every user, made with @BotFather. Free. Each user gets a private chat.
- **Code**: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), shown as
  `K7P-4QX`, valid 10 minutes, single use. One live code per user; a new one cancels the old.
- **Accepted input**: `K7P-4QX`, `k7p4qx`, `K7P 4QX`, and `/start K7P4QX` (the QR deep link).
  Case, spaces and the hyphen are ignored.
- **Stored as an HMAC** of the normalized code with the bot's webhook secret, not a plain hash: a
  short code is cheap to brute-force from a leaked hash.
- **Wrong-code limit**: 5 wrong or expired codes per Telegram sender per hour, then the bot says
  to wait. Counted in a new small table.
- **The bot answers unlinked people.** Today it stays silent, which is confusing. Replies go out
  directly, not through the linked-user outbox, and only for: welcome/how to link, code not
  recognized or expired, too many tries, already linked to another account.
- **Local updates by polling.** `TELEGRAM_UPDATES=polling` makes the API fetch updates with
  `getUpdates`, so linking works on localhost with no tunnel. Production keeps the webhook
  (default `webhook`). Polling is for a single API process only.
- **Show the Telegram username** after linking. Stored on the link when Telegram sends one;
  falls back to "Connected" when the user has no username.

## Prerequisite (you)

Create the bot with @BotFather (`/newbot`), then put in `apps/api/.env`, never in chat:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=OpenApplyBot      # without @
TELEGRAM_WEBHOOK_SECRET=<32+ random chars>
TELEGRAM_UPDATES=polling
```

## Build steps

### 1. Short code (API, pure)

- `telegram.policy.ts`: replace `pairingCode()` with a 6-character code generator and a
  `normalizePairingCode()`; `parseTelegramText` returns `pair` for a bare code or
  `/start <code>`, and a new `start` intent for `/start` with no code.
- Tests: every accepted format, rejects 5- and 7-character input, ambiguous letters, and
  multi-line text; generator only uses the alphabet.

### 2. Data

- Migration: `telegram_pairing_attempts (id, sender_hash, created_at)` with an index on
  `(sender_hash, created_at)`; `telegram_links.username` nullable; cancel any pending
  pairings (old long codes can't be typed or matched any more).
- Contracts: `from.username` optional on the Telegram update schema; `link.username` on the
  status response.

### 3. Linking and replies (API)

- `telegram.service.ts` `pair()`: new code, HMAC, retry once on the rare unique collision;
  return `code`, `expiresAt`, and `startUrl` (`t.me/<bot>?start=<CODE>`) for the QR.
- `telegram.inbound.ts`: for unlinked senders, check the attempt limit, then link or reply.
  Linked senders sending a code for a different account get "already connected; /unlink first".
  Save the username on the new link.
- `telegram.transport.ts`: a small `replyTelegram(chatId, text)` for the unlinked replies.
- Tests with the existing fakes: link succeeds, expired code, used code, wrong code, sixth
  wrong try blocked, already linked elsewhere, `/start` with no code gets the welcome reply.

### 4. Polling (API)

- New `telegram.polling.ts`: on start, `deleteWebhook`, then loop `getUpdates`
  (`timeout=25`, `allowed_updates=["message","callback_query"]`, advancing `offset`), validate
  each update with the same schema the webhook uses, and hand it to `TelegramInbound.accept`.
  Back off on network errors. Started from the existing scheduler when mode is `polling`.
- `env.schema.ts`, `.env.example`: `TELEGRAM_UPDATES` (`webhook` | `polling`).
- Test: offset advances past handled updates, a bad update is skipped, errors back off.

### 5. Telegram tab (web)

Split the link card out of `telegram-settings-view.tsx` into `telegram-connect-card.tsx`:

- **Not configured**: "Telegram isn't set up on this server yet."
- **Not linked**: create a code automatically when the tab opens. Show the bot name with a
  copy button, the code large with a copy button, a countdown, "Get a new code", and a small
  QR (`t.me` link) labeled "Or scan with your phone". Poll status every 3 s while a code is
  showing; stop when linked or expired.
- **Linked**: "Connected as @username", linked date, Unlink.
- Remove the Reload button, the hide-code button, and the "code is hidden" state. A lost
  code is simply replaced with a new one.
- QR: add `qrcode.react` (pinned exact version) — the one new dependency.
- Style to the Figma design system (cards, buttons, status pill).

### 6. Verify

- `bun run test`, `bun run ci`, `bun run knip`, web and API typecheck.
- Real run: local API in polling mode, real bot, real phone. Link by code, link by QR, wrong
  code reply, unlink then relink, and the web tab updating on its own. Screenshot the tab in
  each state.
- Update `docs/run-locally.md` with the Telegram env lines and `README` Telegram section.

## Out of scope

Queue updates and digests, the Telegram commands for linked users (`/add`, buttons, etc. stay
as they are), webhook setup automation for production, and higher Telegram rate limits.
