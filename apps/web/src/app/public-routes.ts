/**
 * Indexable, no-auth entry pages, feeding `sitemap.ts` and `robots.ts`'s allow list.
 * A new static page must ALSO go in `proxy.ts`'s `config.matcher` lookahead - Next needs
 * that literal, so it can't derive from here - or the route 307s to /login at runtime.
 * Dynamic pages (`/u/[username]`) stay out; `sitemap.ts` emits them.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/docs",
  "/install",
  "/jobs",

  "/login",
  "/register",
] as const;
