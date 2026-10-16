/** Landing-page FAQ - rendered by `Faq` and emitted as FAQPage JSON-LD from the landing page. */
export const FAQ_ITEMS = [
  {
    q: "What does it cost?",
    a: "Nothing. OpenApply is free and MIT-licensed, and the whole project is one public repository on GitHub. Your only cost is the Claude or Codex subscription you already have.",
  },
  {
    q: "Do I need an API key?",
    a: "No. The agent runs inside Claude Code or Codex, so the AI work comes out of the subscription you already pay for. There's nothing to top up and no per-token bill from us.",
  },
  {
    q: "Does my computer need to stay on?",
    a: "While it's applying, yes. Your dashboard lives on the web, but the agent and the browser filling the forms run on your computer. Jobs wait in your queue while it's off and start again when it reconnects.",
  },
  {
    q: "Which job boards does it search?",
    a: "Company job boards on Greenhouse, Lever, Ashby, SmartRecruiters and Workable, plus public feeds such as Hacker News, Remote OK and We Work Remotely. The shared index refreshes every 10 to 30 minutes. Applications always run on the employer's own careers page.",
  },
  {
    q: "Will it apply to a job twice?",
    a: "No. Every job is checked against what you already applied to, by link and by title and company. If an earlier attempt might have gone through, the job waits in Needs you instead of being sent again.",
  },
  {
    q: "What happens with captchas and verification codes?",
    a: "Verification codes are read from the Gmail connected to your Claude or Codex plugin. Simple captchas it handles itself; image puzzles use your 2Captcha or CapSolver key if you've added one, otherwise the job waits for you.",
  },
  {
    q: "Can I review jobs before it applies?",
    a: "Yes. Each pilot can hold its matches for your review, and Run now always does. Add the ones you want to your queue, one at a time or all at once.",
  },
  {
    q: "Which AI model should I use?",
    a: "A mid-tier one: Claude Sonnet 5.5 or GPT 6 Luna. Applying to jobs is reading postings and filling forms, not hard reasoning, so top-tier models use up your limits faster without applying to more jobs.",
  },
] as const;
