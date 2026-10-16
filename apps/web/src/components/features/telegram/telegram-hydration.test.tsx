import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { queryKeys } from "@/api/query-keys";
import { JobIntakeView } from "./job-intake-view";
import { TelegramSettingsView } from "./telegram-settings-view";
import { expect, test } from "bun:test";

test("channel pages keep stable streamed loading markup even with cached private records", () => {
  const empty = new QueryClient(),
    cached = new QueryClient();
  cached.setQueryData(queryKeys.telegram.status(), {
    configured: true,
    link: { id: "private-id" },
    pairing: { id: "private-pairing" },
  });
  cached.setQueryData(queryKeys.jobIntakes.detail("fixture"), {
    id: "fixture",
    title: "Private title",
  });
  const render = (client: QueryClient) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TelegramSettingsView />
        <JobIntakeView id="fixture" />
      </QueryClientProvider>,
    );
  expect(render(cached)).toBe(render(empty));
  expect(render(cached)).toContain("Loading Telegram settings");
  expect(render(cached)).not.toContain("Private title");
  expect(render(cached)).not.toContain("private-pairing");
});
