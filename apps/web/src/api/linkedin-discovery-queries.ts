import { api } from "./client";

export const linkedinDiscoveryQueries = {
  settings: () => ({
    queryKey: ["linkedin-discovery", "settings"] as const,
    queryFn: () => api["job-sources"].linkedin.settings.get(),
  }),
};
