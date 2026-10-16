import { api } from "./client";
import { queryKeys } from "./query-keys";

export const accountSetupQueries = {
  detail: (id: string) => ({
    queryKey: queryKeys.accountSetup.detail(id),
    queryFn: () => api["account-setup"]({ id }).get(),
  }),
};
