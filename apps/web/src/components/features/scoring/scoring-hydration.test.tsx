import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { queryKeys } from "@/api/query-keys";
import { evaluationReportFixture } from "./fakes";
import { ScoringEvaluationView } from "./scoring-evaluation-view";
import { ScoringEvaluationsView } from "./scoring-evaluations-view";
import { expect, test } from "bun:test";

test("cached evaluation queries do not alter streamed loading markup before hydration", () => {
  const report = evaluationReportFixture();
  const empty = new QueryClient();
  const cached = new QueryClient();
  cached.setQueryData(queryKeys.scoreEvaluations.report(report.run.id), report);
  cached.setQueryData(queryKeys.scoreEvaluations.list({ page: 1, limit: 25 }), {
    items: [report.run],
    pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
  });
  const render = (client: QueryClient) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ScoringEvaluationsView />
        <ScoringEvaluationView runId={report.run.id} />
      </QueryClientProvider>,
    );
  expect(render(cached)).toBe(render(empty));
  expect(render(cached)).toContain("Loading evaluation report");
  expect(render(cached)).not.toContain("Synthetic scoring report");
});
