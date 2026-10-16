import type { FitAssessment } from "@openapply/contracts/scoring";
import type {
  EvaluationCase,
  EvaluationResultInput,
} from "@openapply/contracts/scoring-evaluation";
import { conflict, HttpError } from "@/common/errors";
import { assessFit } from "@/modules/scoring/assessment";
import { evaluationHash } from "./evaluation.hash";

export function validateEvaluationResult(snapshot: EvaluationCase, input: EvaluationResultInput) {
  if (snapshot.contextHash !== input.expectedContextHash)
    throw conflict("Evaluation input hash changed or belongs to another case.");
  const requested = input.slot === "baseline" ? "sonnet" : "haiku";
  if (input.requestedModel !== requested)
    throw conflict("Result model does not match this immutable slot.");
  if (input.origin === "simulated" && input.telemetry.provenance !== "simulated")
    throw conflict("Authored output must label its telemetry simulated.");
  if (input.origin === "local_inference" && input.telemetry.provenance === "simulated")
    throw conflict("Local inference cannot carry simulated telemetry.");
  if (
    input.telemetry.provenance === "unavailable" &&
    [
      input.telemetry.requests,
      input.telemetry.inputTokens,
      input.telemetry.cacheReadTokens,
      input.telemetry.cacheWriteTokens,
      input.telemetry.outputTokens,
    ].some((value) => value !== null)
  )
    throw conflict("Unavailable usage must remain null.");
  if (
    input.origin === "historical" &&
    (input.slot !== "baseline" ||
      input.status !== "completed" ||
      input.judgments !== null ||
      input.actualModels.length ||
      input.modelVersion !== null ||
      input.telemetry.provenance !== "unavailable" ||
      input.telemetry.latencyMs !== null ||
      input.requestIdentityHashes.length)
  )
    throw conflict(
      "Historical reference reuse cannot invent model execution or measurement metadata.",
    );
  if (
    input.status === "completed"
      ? input.failureCode !== null
      : input.failureCode === null || input.judgments !== null
  )
    throw conflict(
      "Completed results need judgments; failed results need a failure code and no judgments.",
    );
  if (input.status !== "completed")
    return {
      status: input.status,
      failureCode: input.failureCode,
      assessment: null,
      validationReason: null,
    };
  let assessment: FitAssessment;
  try {
    const judgments =
      input.origin === "historical" ? snapshot.historicalReference : input.judgments;
    if (!judgments) throw conflict("This result has no source judgments or historical reference.");
    assessment = assessFit(snapshot.context, {
      campaignId: snapshot.campaignId,
      jobKey: snapshot.jobKey,
      basis: snapshot.context.basis,
      assessments: judgments.assessments,
      roleMatch: judgments.roleMatch,
      ...(judgments.preferenceChecks ? { preferenceChecks: judgments.preferenceChecks } : {}),
    });
    if (
      input.origin === "historical" &&
      evaluationHash(assessment) !== evaluationHash(snapshot.historicalReference)
    )
      throw conflict("Historical reference does not reproduce against this exact context.");
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return {
      status: "rejected" as const,
      failureCode: "invalid_output" as const,
      assessment: null,
      validationReason:
        "Judgments failed exact source, criterion, or historical-reference validation.",
    };
  }
  return { status: "completed" as const, failureCode: null, assessment, validationReason: null };
}
