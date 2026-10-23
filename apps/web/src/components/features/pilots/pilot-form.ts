"use client";

import { type PilotInput, pilotRulesSchema } from "@openapply/contracts/pilots";
import type { PilotDto } from "@/api/pilot-queries";
import { useAppForm } from "@/components/ui/form/tanstack";

export type PilotFormValues = Omit<PilotInput, "provider">;

export function pilotDefaults(primaryResumeId: string | null, pilot?: PilotDto): PilotFormValues {
  if (pilot)
    return {
      name: pilot.name,
      rules: pilot.rules,
      resumeId: pilot.resumeId,
      minScore: pilot.minScore,
      autoRun: pilot.autoRun,
      intervalMinutes: pilot.intervalMinutes,
      mode: pilot.mode,
      maxJobsPerRun: pilot.maxJobsPerRun,
    };
  return {
    name: "",
    rules: pilotRulesSchema.parse({ postedWithin: [1440] }),
    resumeId: primaryResumeId ?? "",
    minScore: 70,
    autoRun: true,
    intervalMinutes: 10,
    mode: "review",
    maxJobsPerRun: 15,
  };
}

export function usePilotForm(
  defaultValues: PilotFormValues,
  onSubmit: (values: PilotFormValues) => Promise<void>,
) {
  return useAppForm({ defaultValues, onSubmit: ({ value }) => onSubmit(value) });
}

export type PilotForm = ReturnType<typeof usePilotForm>;

/** What must be filled before leaving each step; empty means the step is fine. */
export function stepProblem(step: number, values: PilotFormValues): string | null {
  if (step === 0 && !values.name.trim()) return "Give the pilot a name.";
  if (step === 0 && !values.rules.roles.length && !values.rules.keywords.length)
    return "Pick at least one role.";
  if (step === 2 && !values.resumeId) return "Pick the resume to score against.";
  if (step === 3 && (values.maxJobsPerRun < 1 || values.maxJobsPerRun > 50))
    return "Max jobs per run is between 1 and 50.";
  return null;
}
