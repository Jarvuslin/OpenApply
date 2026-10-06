# Hosted OpenApply and local subscriptions

OpenApply's website and API hold the account, uploaded resumes and confirmed profile. The user's local companion runs the installed, unmodified Claude Code or Codex CLI. Users sign in through the provider's own interface. OpenApply does not collect provider passwords or copy subscription tokens to its server.

Onboarding starts with agent selection and an explicit **Verify connection** request. A reachable companion alone is not proof of model access. Verification uses a short inference request; authentication, quota and model failures remain visible. Manual onboarding remains available.

Resume import follows this path:

1. Save the source file through the authenticated API.
2. Read document text through the owner-scoped `/api/resumes/:id/source-text` endpoint (PDF.js/Mammoth; no model on the API server).
3. Send the text from the browser to the loopback companion at `/inference`.
4. Run a fresh Claude or Codex process, with a two-minute timeout. Claude extraction defaults to `haiku`; an explicit retry can use `sonnet`. Codex uses its CLI default model with low reasoning effort. Extraction disables shell tools and user MCP configuration and does not reuse the application agent's conversation.
5. Validate the structured output against the shared resume schema and save it through the authenticated API. A failed request leaves the uploaded file available to retry. Existing profile answers are not overwritten by imported basics.

Haiku is an extraction default, not a quality guarantee. Users review the result. It does not lower the fixed price of a subscription; it can reduce model usage and, when the user's CLI is configured with an API key, token costs. The companion preserves the CLI's configured authentication methods; do not promise that every user's request is subscription-billed.

## Distribution

The current development setup builds the companion from source. This change does not publish signed installers or deploy a public website. A hosted release should distribute a Windows installer and notarized macOS build containing the companion and OpenApply plugin assets, with provider installation/sign-in instructions. Users should not need PostgreSQL, the API or the web source on their own computer.

Configure `Terminal:AllowedOrigins` with the exact hosted web origin; do not use a wildcard. The host listens on loopback. Validate browser local-network permission behavior from the actual HTTPS deployment on Windows and macOS. The present localhost trial does not prove that hosted browser connection path. Add explicit account/device pairing before distributing the helper broadly; the current browser control boundary is the exact origin allowlist.

The local companion must remain running and the computer awake. A website cannot keep a local CLI working while the computer is asleep. Always-on operation needs a separately provisioned worker and a supported billing/authentication arrangement.

## Other connection options

- Claude: use the official unmodified CLI sign-in. Do not offer a custom Claude credential/token collection flow. See [Anthropic authentication and product guidance](https://code.claude.com/docs/en/legal-and-compliance).
- OpenAI: [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart) also documents eligible plan usage in open-source apps. That is an alternative integration to evaluate for model-only work; it is not implemented here and is distinct from simply signing into OpenApply with Google or GitHub.
- A fully hosted option can use provider APIs, billed separately, and a hosted browser worker. This removes the local install at the cost of ongoing infrastructure and inference charges.

Sources checked on 2026-10-06. Model availability, subscription entitlements and provider terms can change.
