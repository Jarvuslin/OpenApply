import type { Data } from "@openapply/api-client";
import type { api } from "@/api/client";

/** A listing as the lists render it, from `GET /api/public/jobs`. Carries `sourceCount`, not links. */
export type JobListingSummaryDto = Data<typeof api.public.jobs.get>["items"][number];

/** One public listing with every board it was seen on, from `GET /api/public/jobs/:slug`. */
export type JobListingDto = Data<ReturnType<typeof api.public.jobs>["get"]>;

/** A listing in the moderation table, from `GET /api/admin/listings`. */
export type AdminJobListingDto = Data<typeof api.admin.listings.get>["items"][number];
