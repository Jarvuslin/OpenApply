import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { PUBLIC_ROUTES } from "./public-routes";

/**
 * Crawl-budget hygiene, not a confidentiality boundary - `proxy.ts` 307s anonymous
 * requests to /login. Keep this polarity: `disallow: ["/"]` ties with PUBLIC_ROUTES'
 * "/" and loses (ties go to the least restrictive), and crawlers honoring only
 * `Disallow:` would read it as "block the whole site".
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [...PUBLIC_ROUTES],
        disallow: [
          "/admin",
          "/pilot",

          "/workspace",
          "/campaigns",
          "/applications",
          "/analytics",
          "/inbox",

          "/documents",
          "/resumes",
          "/cover-letters",
          "/boards",

          "/settings",
          "/onboarding",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
