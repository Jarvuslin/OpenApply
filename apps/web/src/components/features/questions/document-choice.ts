import type {
  ApplicationPreparation,
  DocumentSelection,
  SelectQuestionDocument,
} from "@openapply/contracts/application-preparation";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { questionNeedsInspection } from "./application-answer";

export type DocumentChoice = Pick<
  SelectQuestionDocument,
  "resumeId" | "variantId" | "artifactRevision"
> &
  Pick<DocumentSelection, "pdfSha256" | "sizeBytes">;

export function documentChoiceInput(
  question: ApplicationQuestionView,
  preparation: ApplicationPreparation,
  fieldKey: string,
  choice: DocumentChoice,
  confirmed: boolean,
): Omit<SelectQuestionDocument, "requestId"> {
  if (!confirmed) throw new Error("Confirm this exact PDF for this upload before selecting it.");
  const current = preparation.questions.find((item) => item.id === question.id && item.current);
  if (
    preparation.job.id !== question.jobId ||
    !current ||
    current.revision !== question.revision ||
    current.definitionHash !== question.definitionHash
  )
    throw new Error("The question changed. Refresh and review its current document requirement.");
  const field = current.definition.fields.find((item) => item.key === fieldKey);
  const document = preparation.documentFields.find(
    (item) => item.questionId === question.id && item.fieldKey === fieldKey,
  );
  if (
    field?.type !== "file" ||
    document?.purpose !== "resume" ||
    questionNeedsInspection(current.definition, current.blocking)
  )
    throw new Error("This upload needs inspection before a saved resume PDF can be selected.");
  return {
    jobId: preparation.job.id,
    expectedCollectionVersion: preparation.collectionVersion,
    expectedRevision: current.revision,
    expectedDefinitionHash: current.definitionHash,
    fieldKey,
    resumeId: choice.resumeId,
    ...(choice.variantId && { variantId: choice.variantId }),
    artifactRevision: choice.artifactRevision,
    expectedSelectionId: document.selection?.id ?? null,
    confirmed: true,
  };
}

export function selectedDocumentFieldKeys(
  question: ApplicationQuestionView,
  preparation: ApplicationPreparation | undefined,
): string[] {
  if (!preparation || preparation.job.id !== question.jobId) return [];
  return preparation.documentFields
    .filter(
      (field) =>
        field.questionId === question.id &&
        field.purpose === "resume" &&
        field.selection?.current &&
        field.selection.jobId === question.jobId &&
        field.selection.questionId === question.id &&
        field.selection.fieldKey === field.fieldKey &&
        field.selection.available &&
        field.selection.questionRevision === question.revision &&
        field.selection.definitionHash === question.definitionHash,
    )
    .map((field) => field.fieldKey);
}
