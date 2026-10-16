# Telegram setup

OpenApply uses one shared Telegram bot for every user. A user links their Telegram account in
**Settings → Telegram** by scanning a QR code with their phone, or by sending the bot a
6-character code. Telegram does not need to be installed on the computer.

## 1. Create the bots

Use **two bots**: one for local development and one for production. Polling (local) and a
webhook (production) cannot run on the same bot, and the local API refuses to poll a bot that
has a webhook set.

In Telegram, message [@BotFather](https://t.me/BotFather):

1. Send `/newbot`, pick a display name, then a username ending in `bot` (for example
   `OpenApplyDevBot`).
2. Copy the token it gives you. Treat it like a password: never paste it in chat or commit it.

## 2. Configure the API

Add these to `apps/api/.env` (see `.env.example`):

```bash
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_BOT_USERNAME=OpenApplyDevBot   # without the @
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
TELEGRAM_PAIRING_HMAC_KEY=<openssl rand -hex 32, different from the webhook secret>
TELEGRAM_DELIVERY_ENABLED=true
TELEGRAM_UPDATES=polling
```

Telegram stays off until the first four are set. Without `TELEGRAM_DELIVERY_ENABLED=true` the
bot links accounts but never replies.

Restart the API. The log shows `Telegram polling started.` Run polling in **one** API process
per bot; a second one gets a conflict from Telegram and waits.

## 3. Test linking locally

1. Start the app and open http://localhost:4100/settings/telegram. A code and QR code appear.
2. **QR:** scan it with your phone's camera. Telegram opens the bot; tap **Start**. The bot
   replies "Connected to OpenApply!" and the page switches to "Connected as @you" within a few
   seconds, without a reload.
3. **Manual:** unlink, then connect again. In Telegram, search for the bot, tap **Start**, and
   send the code (any case, with or without the hyphen).
4. Also worth trying:
   - A wrong code: the bot says it didn't match.
   - An old code after "Get a new code": the bot says it expired or was used.
   - `/start` alone: the bot explains how to connect.
   - Six wrong codes in an hour: the bot asks you to wait.

## Production

Use the production bot's credentials with `TELEGRAM_UPDATES=webhook`, and register the webhook
once with Telegram (replace the placeholders):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<api-host>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","callback_query"]'
```

## How linking works

- Codes are 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, last 10 minutes, and work
  once. An account has at most one live code; a new one cancels the old.
- The database stores only an HMAC of each code, keyed by `TELEGRAM_PAIRING_HMAC_KEY`.
- A Telegram account is identified by its numeric user ID, never its username. It can be linked
  to only one OpenApply account at a time; `/unlink` in Telegram or **Unlink** in Settings
  frees it.
- Linking only works in a private chat with the bot.
- Each Telegram account gets 5 wrong codes per hour. All senders together get 300 wrong codes
  per 10 minutes. Each chat gets at most 10 bot replies per hour.
- Repeated deliveries of the same Telegram update are ignored.
