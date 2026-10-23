import { Elysia } from "elysia";
import { z } from "zod/v4";
import { authGuard } from "@/common/middleware";
import { locationSuggestions, searchPlaces } from "./locations.service";

export const locationsController = new Elysia({ prefix: "/locations" })
  .use(authGuard)
  .get("/", ({ query }) => locationSuggestions(query), {
    query: z.object({
      country: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
    }),
    response: z.object({
      countries: z.array(z.object({ code: z.string(), name: z.string() })),
      states: z.array(z.object({ code: z.string(), name: z.string() })),
      cities: z.array(z.string()),
      countryCode: z.string().nullable(),
    }),
    detail: { summary: "Country, region and city suggestions from the local geographic dataset" },
  })
  .get("/search", ({ query }) => searchPlaces(query.q), {
    query: z.object({ q: z.string().max(100) }),
    response: z.array(
      z.object({
        label: z.string(),
        kind: z.enum(["postal", "continent", "country", "region", "city"]),
        postalCode: z.string().optional(),
      }),
    ),
    detail: {
      summary: "Places matching a name, US ZIP code or Canadian postal code, for job locations",
    },
  });
