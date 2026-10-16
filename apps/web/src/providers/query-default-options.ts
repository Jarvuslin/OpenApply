import type { DefaultOptions } from "@tanstack/react-query";

export const queryDefaultOptions = {
  queries: {
    staleTime: 30_000,
    // Hidden tabs pause SSE, so even fresh active queries must catch up on return.
    refetchOnWindowFocus: "always",
    retry: 1,
  },
} satisfies DefaultOptions;
