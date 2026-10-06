import type { Data } from "@openapply/api-client";
import type { api } from "@/api/client";

/** A stored credential, inferred from `GET /api/credentials`. */
export type CredentialDto = Data<typeof api.credentials.get>[number];
