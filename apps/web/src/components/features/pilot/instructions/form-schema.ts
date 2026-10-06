import {
  type PilotInstructionsConfig,
  type PilotState,
  pilotInstructionsConfigSchema,
} from "@jobpilot/contracts/pilot";
import { z } from "zod/v4";

export const instructionsFormSchema = z.object({
  goals: z.string().trim().min(1, "Required"),
  dailyApplyCap: z.number().int().min(0),
  minScore: z.number().min(0).max(100),
  checkIntervalMinutes: z.number().int().min(5),
  // Mirrors the config block so the section addresses its fields by their real path. Spelled out

  boards: z.array(z.string()),
});

export type InstructionsFormValues = z.infer<typeof instructionsFormSchema>;

/** Shared `defaultValues` the withForm sections type against; real values come from pilot state. */
export const INSTRUCTIONS_FORM_DEFAULTS: InstructionsFormValues = {
  goals: "",
  dailyApplyCap: 10,
  minScore: 60,
  checkIntervalMinutes: 30,

  boards: [],
};

export function toConfig(value: InstructionsFormValues): PilotInstructionsConfig {
  return {
    dailyApplyCap: value.dailyApplyCap,
    minScore: value.minScore,
    checkIntervalMinutes: value.checkIntervalMinutes,
    boards: value.boards,
  };
}

export function toFormValues(state: PilotState): InstructionsFormValues {
  const c = state.instructionsConfig;
  return {
    goals: state.instructionsGoals,
    dailyApplyCap: c.dailyApplyCap,
    minScore: c.minScore,
    checkIntervalMinutes: c.checkIntervalMinutes,

    boards: [...c.boards],
  };
}

/** A config indistinguishable from `{}` means the user never tuned anything. */
const DEFAULT_CONFIG_JSON = JSON.stringify(pilotInstructionsConfigSchema.parse({}));

export function hasTunedConfig(state: PilotState): boolean {
  return JSON.stringify(state.instructionsConfig) !== DEFAULT_CONFIG_JSON;
}
