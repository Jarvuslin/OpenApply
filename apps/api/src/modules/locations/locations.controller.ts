import { Elysia } from "elysia";
import { z } from "zod/v4";
import { authGuard } from "@/common/middleware";
import { locationSuggestions } from "./locations.service";

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
  });
