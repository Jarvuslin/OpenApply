import { ThemeProvider } from "@mui/material/styles";
import type { ApplicationPreparation } from "@openapply/contracts/application-preparation";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { queryKeys } from "@/api/query-keys";
import { ToastProvider } from "@/providers/notification-provider";
import { theme } from "@/theme";
import { ApplicationQuestionCard } from "./application-question-card";
import { expect, test } from "bun:test";

test("a matching resume field label leaves one question heading and no filename answer form", () => {
  const question: ApplicationQuestionView = {
    id: "f687213a-ab04-4725-b32b-ea9f7e67e3ad",
    jobId: "60351594-bef2-42bf-995d-ff191ca1ff5e",
    revision: 1,
    definitionHash: "a".repeat(64),
    category: "document",
    source: "browser_dom",
    sourceUrl: "http://127.0.0.1/form",
    observedAt: new Date(0),
    collectionId: "6a0a4735-dc08-429f-83bc-a23b372a3e3e",
    collectorVersion: "fixture",
    verification: "observed",
    current: true,
    blocking: true,
    answer: null,
    createdAt: new Date(0),
    definition: {
      stableKey: "resume",
      prompt: "Resume",
      required: "required",
      visibility: "visible",
      condition: { state: "unconditional", rules: [] },
      groupMode: "all",
      fields: [{ key: "resume", label: "Resume", type: "file", options: [] }],
    },
  };
  const preparation: ApplicationPreparation = {
    job: {
      id: question.jobId,
      campaignId: "309e3548-bd6c-4367-a973-b80df2324590",
      key: "synthetic",
      title: "Synthetic job",
      company: "Synthetic",
      url: question.sourceUrl,
    },
    collectionVersion: 1,
    coverage: "complete",
    manifestHash: "b".repeat(64),
    mode: "preview",
    questions: [question],
    documentFields: [
      {
        questionId: question.id,
        fieldKey: "resume",
        purpose: "resume",
        reason: null,
        selection: null,
      },
    ],
    submissionAllowed: false,
  };
  const client = new QueryClient();
  client.setQueryData(queryKeys.applicationQuestions.preparation(question.jobId), preparation);
  const html = renderToStaticMarkup(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ApplicationQuestionCard question={question} job={preparation.job} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  expect(html.match(/<h[1-6]\b[^>]*>Resume<\/h[1-6]>/g)).toHaveLength(1);
  expect(html).toContain("Saved resume for this upload");
  expect(html).not.toContain("Save confirmed answer");
  expect(html).not.toContain("<form");
});
