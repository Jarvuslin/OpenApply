import { createApiClient } from "@openapply/api-client";
import { API_ORIGIN } from "./base-url";
import { createSessionFetch } from "./session-fetch";

/** Eden Treaty client, typed from the backend `App`. Calls the API directly; cookie rides cross-origin via credentials + same-site + CORS. */
export const api = createApiClient(API_ORIGIN, {
  fetch: { credentials: "include" },
  fetcher:
    typeof window === "undefined"
      ? fetch
      : (createSessionFetch({
          origin: API_ORIGIN,
          fetcher: fetch,
          locks: navigator.locks,
        }) as typeof fetch),
}).api;
