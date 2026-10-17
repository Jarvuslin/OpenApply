import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import {
  type BoardResult,
  boardResult,
  type FetchJson,
  plainText,
  postedAt,
  type SourceJob,
} from "./types";

// Recruitee boards live at {company}.recruitee.com.
const COMPANY_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const feed = z.object({
  offers: z.array(
    z.object({
      id: z.number(),
      slug: z.string(),
      title: z.string(),
      company_name: z.string().nullish(),
      description: z.string().nullish(),
      requirements: z.string().nullish(),
      location: z.string().nullish(),
      country_code: z.string().nullish(),
      locations: z.array(z.object({ country_code: z.string().nullish() })).nullish(),
      published_at: z.string().nullish(),
      remote: z.boolean().nullish(),
      hybrid: z.boolean().nullish(),
      on_site: z.boolean().nullish(),
    }),
  ),
});

export async function recruitee(
  fetch: FetchJson,
  slug: string,
  company = slug,
): Promise<BoardResult> {
  if (!COMPANY_SLUG.test(slug)) throw unprocessable("Invalid Recruitee company.");
  const origin = `https://${slug}.recruitee.com`;
  const { offers } = feed.parse(await fetch(`${origin}/api/offers/`));
  const jobs = offers.map((offer): SourceJob => {
    // The board's own address, not `careers_url`, which can be the employer's custom domain.
    const url = `${origin}/o/${offer.slug}`;
    const countries = [
      offer.country_code,
      ...(offer.locations ?? []).map((place) => place.country_code),
    ];
    return {
      title: plainText(offer.title),
      // The offer names a legal entity, "Huawei Technologies Canada Co., Ltd."; a known name wins.
      company: company === slug && offer.company_name ? offer.company_name : company,
      location: plainText(offer.location ?? ""),
      countries: [...new Set(countries.filter((code): code is string => !!code))],
      url,
      attributionUrl: url,
      externalId: String(offer.id),
      description: [offer.description, offer.requirements]
        .map((part) => plainText(part ?? ""))
        .filter(Boolean)
        .join("\n\n"),
      // "2026-10-15 17:57:27 UTC", which Date can't read as written.
      postedAt: postedAt(offer.published_at?.replace(" ", "T").replace(/ UTC$/, "Z")),
      workMode: workMode(offer),
    };
  });
  // The API returns every published offer in one response.
  return boardResult(jobs, null, jobs.length, false);
}

function workMode(offer: {
  remote?: boolean | null;
  hybrid?: boolean | null;
  on_site?: boolean | null;
}) {
  if (offer.remote) return "remote";
  if (offer.hybrid) return "hybrid";
  if (offer.on_site) return "onsite";
  return null;
}
