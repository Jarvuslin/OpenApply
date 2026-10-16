"use client";

import { type PropsWithChildren, type ReactElement, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { observeSessionChanges } from "@/lib/sse/session-boundary";
import { queryDefaultOptions } from "./query-default-options";

export function QueryProvider(props: PropsWithChildren): ReactElement {
  const { children } = props;
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: queryDefaultOptions,
      }),
  );
  useEffect(
    () =>
      observeSessionChanges((remote) => {
        client.clear();
        if (remote) window.location.reload();
      }),
    [client],
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NEXT_PUBLIC_QUERY_DEVTOOLS === "true" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
