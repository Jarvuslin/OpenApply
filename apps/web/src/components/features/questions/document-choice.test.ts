import type {
  ApplicationPreparation,
  DocumentSelection,
} from "@openapply/contracts/application-preparation";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { documentChoiceInput, selectedDocumentFieldKeys } from "./document-choice";
import { expect, test } from "bun:test";

const question: ApplicationQuestionView = {
  id: "1d1a94cf-40a9-4c32-b164-c49d201c792d",
  jobId: "a42ac80e-6e99-400f-a1f4-fd50c247bfb0",
  revision: 2,
  definitionHash: "a".repeat(64),
  category: "document",
  source: "browser_dom",
  sourceUrl: "http://127.0.0.1/form",
  observedAt: new Date(0),
  collectionId: "4f8f28cc-5b6f-40fc-85db-d8ce6f454fc1",
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
    fields: [{ key: "upload", type: "file", options: [] }],
  },
};
const choice = {
  resumeId: "59532145-1955-49ce-ae4a-26d48057a1d2",
  artifactRevision: "b".repeat(64),
  pdfSha256: "c".repeat(64),
  sizeBytes: 100,
};
const preparation: ApplicationPreparation = {
  job: {
    id: question.jobId,
    campaignId: "7ce1bf17-0f9f-481d-a878-02034b24e8c6",
    key: "synthetic",
    title: "Synthetic job",
    company: "Synthetic",
    url: question.sourceUrl,
  },
  collectionVersion: 4,
  coverage: "complete",
  manifestHash: "d".repeat(64),
  mode: "preview",
  questions: [question],
  documentFields: [
    {
      questionId: question.id,
      fieldKey: "upload",
      purpose: "resume",
      reason: null,
      selection: null,
    },
  ],
  submissionAllowed: false,
};
const selection: DocumentSelection = {
  id: "aab9dbdf-28e1-4c84-9c88-ed76e114366e",
  questionId: question.id,
  jobId: question.jobId,
  fieldKey: "upload",
  questionRevision: question.revision,
  definitionHash: question.definitionHash,
  ...choice,
  variantId: null,
  confirmedAt: new Date(0),
  current: true,
  available: true,
  unavailableReason: null,
  pdfUrl: "/api/synthetic.pdf",
};

test("document choice binds current question, collection and exact artifact with separate consent", () => {
  expect(() => documentChoiceInput(question, preparation, "upload", choice, false)).toThrow(
    "Confirm this exact PDF",
  );
  expect(documentChoiceInput(question, preparation, "upload", choice, true)).toEqual({
    jobId: question.jobId,
    expectedCollectionVersion: 4,
    expectedRevision: 2,
    expectedDefinitionHash: question.definitionHash,
    fieldKey: "upload",
    resumeId: choice.resumeId,
    artifactRevision: choice.artifactRevision,
    expectedSelectionId: null,
    confirmed: true,
  });
  expect(
    documentChoiceInput(
      question,
      { ...preparation, documentFields: [{ ...preparation.documentFields[0]!, selection }] },
      "upload",
      choice,
      true,
    ).expectedSelectionId,
  ).toBe(selection.id);
});
test("foreign, stale and unsupported file requirements cannot borrow a PDF selection", () => {
  expect(() =>
    documentChoiceInput(
      question,
      { ...preparation, job: { ...preparation.job, id: "foreign" } },
      "upload",
      choice,
      true,
    ),
  ).toThrow("question changed");
  expect(() =>
    documentChoiceInput({ ...question, revision: 3 }, preparation, "upload", choice, true),
  ).toThrow("question changed");
  expect(() =>
    documentChoiceInput(
      question,
      {
        ...preparation,
        documentFields: [{ ...preparation.documentFields[0]!, purpose: "unsupported" }],
      },
      "upload",
      choice,
      true,
    ),
  ).toThrow("inspection");
  expect(() => documentChoiceInput(question, preparation, "other", choice, true)).toThrow(
    "inspection",
  );
});
test("only available current selections satisfy their exact field revision", () => {
  const withSelection = {
    ...preparation,
    documentFields: [{ ...preparation.documentFields[0]!, selection }],
  };
  expect(selectedDocumentFieldKeys(question, withSelection)).toEqual(["upload"]);
  for (const patch of [
    { available: false },
    { current: false },
    { questionRevision: 3 },
    { definitionHash: "e".repeat(64) },
  ])
    expect(
      selectedDocumentFieldKeys(question, {
        ...preparation,
        documentFields: [
          { ...preparation.documentFields[0]!, selection: { ...selection, ...patch } },
        ],
      }),
    ).toEqual([]);
});
