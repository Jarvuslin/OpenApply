import type { Route } from "next";

export interface DocsNavEntry {
  title: string;
  href: Route;
  description: string;
}

/** Ordered docs pages - drives the sidebar, the index cards, and the sitemap. */
export const DOCS_NAV: DocsNavEntry[] = [
  {
    title: "Getting started",
    href: "/docs/getting-started",
    description: "Install the plugin, run setup, and launch your first campaign.",
  },
  {
    title: "The Pilot",
    href: "/docs/pilot",
    description:
      "Autonomous mode: write your instructions once and read the journal in the morning.",
  },
  {
    title: "Campaigns & skills",
    href: "/docs/campaigns-and-skills",
    description:
      "The three campaign modes, what each dashboard action runs, and how statuses work.",
  },
  {
    title: "Email setup",
    href: "/docs/email-setup",
    description: "Connect Gmail through Claude Code or Codex.",
  },
  {
    title: "Credentials",
    href: "/docs/credentials",
    description: "Board logins, captcha services, and how your secrets are stored.",
  },
  {
    title: "FAQ",
    href: "/docs/faq",
    description: "Common questions about the agent, boards, and your data.",
  },
];

/** Every docs destination in nav order - the desktop rail and the mobile navigator render the same list. */
export const DOCS_LINKS: { href: Route; label: string }[] = [
  { href: "/docs", label: "Overview" },
  ...DOCS_NAV.map((entry) => ({ href: entry.href, label: entry.title })),
];
