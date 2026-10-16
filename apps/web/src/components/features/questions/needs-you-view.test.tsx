import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { queryKeys } from "@/api/query-keys";
import { NeedsYouView } from "./needs-you-view";
import { expect, test } from "bun:test";

test("streamed Needs-you markup stays identical when navigation has already cached the count", () => {
  const empty = new QueryClient();
  const cached = new QueryClient();
  cached.setQueryData(queryKeys.needsYou.count(), {
    total: 4,
    application: 3,
    operational: 1,
    collection: 0,
  });
  const render = (client: QueryClient) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <NeedsYouView />
      </QueryClientProvider>,
    );
  const html = render(empty);
  expect(render(cached)).toBe(html);
  expect(html).toContain('aria-label="Loading questions"');
  expect(html).not.toContain("data-needs-you-total");
});
