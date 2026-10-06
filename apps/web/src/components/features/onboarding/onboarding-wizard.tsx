"use client";

import { type ReactElement, type SubmitEvent, useEffect, useState } from "react";
import {
  Alert,
  AlertTitle,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import {
  USER_DEFAULT_VALUES,
  type UserWithAutoApplyInput,
  userWithAutoApplySchema,
} from "@openapply/contracts/user";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { userQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { toFormValues } from "@/components/features/settings/profile-values";
import { PersonalSection } from "@/components/features/settings/sections";
import { AddressSection } from "@/components/features/settings/sections/address-section";
import { AutoApplySection } from "@/components/features/settings/sections/auto-apply-section";
import { EeoSection } from "@/components/features/settings/sections/eeo-section";
import { ReferencesSection } from "@/components/features/settings/sections/references-section";
import { SalarySection } from "@/components/features/settings/sections/salary-section";
import { WorkAuthSection } from "@/components/features/settings/sections/work-auth-section";
import { useAppForm, withForm } from "@/components/ui/form/tanstack";
import { SectionCard } from "@/components/ui/layout";
import { patchAgentStorage } from "@/lib/agent-storage";
import { useToast } from "@/providers/notification-provider";
import { migrateOpenApplyStorage } from "@/utils/storage-migration";
import { AgentSetupStep } from "./agent-setup-step";
import { readOnboardingDraft, writeOnboardingDraft } from "./onboarding-draft";
import { ResumeUploadStep } from "./resume-upload-step";
import { describeIssues, firstStepWithIssue } from "./validation-issues";

const STEPS = [
  { key: "resume", label: "Resume" },
  { key: "personal", label: "Personal" },
  { key: "eligibility", label: "Eligibility" },
  { key: "preferences", label: "Preferences" },
  { key: "review", label: "Review answers" },
  { key: "agent", label: "Connect agent" },
] as const;

/** Profile-form steps come first; the agent step is a self-contained section. */
const PROFILE_STEPS = STEPS.findIndex((s) => s.key === "agent");
export function OnboardingWizard(): ReactElement {
  const query = useApiQuery(userQueries.detail(), {
    errorMessage: "Could not load your saved profile",
  });
  if (query.error && !query.data)
    return <Alert severity="error">Could not load your saved profile. Refresh to retry.</Alert>;
  if (!query.data) return <LinearProgress />;
  return (
    <RestoreOnboarding
      key={query.data.user.id}
      userId={query.data.user.id}
      initialData={toFormValues(query.data)}
    />
  );
}

interface OnboardingProps {
  userId: string;
  initialData: UserWithAutoApplyInput;
}

function RestoreOnboarding({ userId, initialData }: OnboardingProps): ReactElement {
  const [serverValues] = useState(initialData);
  const [restored, setRestored] = useState<{
    values: UserWithAutoApplyInput;
    step: number;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    try {
      migrateOpenApplyStorage(window.localStorage);
      const draft = readOnboardingDraft(window.localStorage, userId);
      setRestored({
        values: draft?.values ?? serverValues,
        step: draft?.step ?? (serverValues.firstName && serverValues.primaryResumeId ? 1 : 0),
        error: false,
      });
    } catch {
      setRestored({ values: serverValues, step: 1, error: true });
    }
    // Restore once per account, before mounting the form. Refetches must not
    // replace the user's edits with the last server-validated profile.
  }, [userId, serverValues]);
  if (!restored) return <LinearProgress />;
  return (
    <OnboardingForm
      userId={userId}
      initialData={restored.values}
      initialStep={restored.step}
      restoreError={restored.error}
    />
  );
}

function OnboardingForm({
  initialData,
  userId,
  initialStep,
  restoreError,
}: OnboardingProps & { initialStep: number; restoreError: boolean }): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(initialStep);
  const [draftError, setDraftError] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Local drafts may be incomplete. Only explicitly reviewed, validated values
  // are promoted to the account's profile through the API.
  const save = useApiMutation<{ id: string }, UserWithAutoApplyInput>(
    (vars) => api.user.put(vars),
    {
      successMessage: "Profile saved",
      invalidate: [queryKeys.user.all],
      onSuccess: () => {
        queryClient.invalidateQueries();
        // Profile saved (non-empty) clears the redirect gate, so the optional steps can navigate away safely.
        setStep(PROFILE_STEPS);
      },
    },
  );

  const form = useAppForm({
    defaultValues: initialData,
    validators: { onSubmit: userWithAutoApplySchema },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });
  useEffect(() => {
    const persist = () => {
      try {
        writeOnboardingDraft(window.localStorage, userId, form.state.values, step);
        setDraftError(false);
      } catch {
        setDraftError(true);
      }
    };
    // Save synchronously on every store change: no debounce window in which a
    // refresh, route change or unmount can discard the last keystroke.
    persist();
    const subscription = form.store.subscribe(persist);
    return () => {
      subscription.unsubscribe();
    };
  }, [form, userId, step]);
  const isProfileStep = step < PROFILE_STEPS;
  const isLastProfileStep = step === PROFILE_STEPS - 1;

  const finish = (): void => {
    // Land on the workspace with the dock open so the agent is the obvious next step.
    patchAgentStorage({ dockExpanded: true });
    router.push("/mvp");
  };

  const submitForm = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isLastProfileStep) {
      setStep((s) => s + 1);
      return;
    }

    const result = userWithAutoApplySchema.safeParse(form.state.values);
    if (!result.success) {
      const issues = describeIssues(result.error.issues);
      setShowValidationErrors(true);
      const target = firstStepWithIssue(issues);
      if (target !== null) {
        setStep(target);
      }
      toast.error("Some fields need fixing before we can save your profile.");
      return;
    }

    setShowValidationErrors(false);
    await form.handleSubmit();
  };

  return (
    <Stack spacing={3}>
      <Alert severity={draftError || restoreError ? "warning" : "info"}>
        {draftError
          ? "Your browser could not save this draft. Keep this page open until browser storage is available."
          : restoreError
            ? "The previous local draft could not be restored. Your saved profile has been loaded; new edits are saved on this device."
            : "Draft saved automatically on this device, including incomplete answers and your current step. Resume details already imported are saved in your account."}
      </Alert>
      <Stepper activeStep={step} alternativeLabel>
        {STEPS.map((s) => (
          <Step key={s.key}>
            <StepLabel>{s.label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <SectionCard>
        {isProfileStep ? (
          <form onSubmit={submitForm}>
            <Stack spacing={3}>
              {step === 0 && <ResumeUploadStep form={form} onContinue={() => setStep(1)} />}
              {step === 1 && (
                <>
                  <PersonalSection form={form} />
                  <AddressSection form={form} />
                </>
              )}
              {step === 2 && (
                <>
                  <Alert severity="info">
                    Review these answers explicitly. Work authorization and sponsorship are never
                    inferred from your resume. The US authorization field only applies to US roles;
                    other countries require a scoped answer before applying.
                  </Alert>
                  <WorkAuthSection form={form} />
                </>
              )}
              {step === 3 && (
                <>
                  <SalarySection form={form} />
                  <AutoApplySection form={form} />
                  <ReferencesSection form={form} />
                </>
              )}
              {step === 4 && (
                <>
                  <EeoSection form={form} />
                  <Alert severity="info">
                    Demographic answers are optional. You can choose not to disclose.
                    Employer-specific questions that are not covered here will pause that
                    application for your answer.
                  </Alert>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={confirmed}
                        onChange={(_, checked) => setConfirmed(checked)}
                      />
                    }
                    label="I reviewed my identity, work authorization, sponsorship, availability and preferences. Use only these confirmed answers."
                  />
                </>
              )}
              {showValidationErrors && <ValidationSummary form={form} />}
              <Button
                variant="text"
                onClick={() => {
                  setStep(PROFILE_STEPS);
                  setConfirmed(false);
                }}
              >
                Continue to agent setup — finish answers later
              </Button>
              {step !== 0 && (
                <Stack direction="row" sx={{ justifyContent: "space-between", pt: 1 }}>
                  <Button variant="outlined" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={save.isPending || (isLastProfileStep && !confirmed)}
                  >
                    {isLastProfileStep ? (save.isPending ? "Saving…" : "Save & continue") : "Next"}
                  </Button>
                </Stack>
              )}
            </Stack>
          </form>
        ) : (
          <Stack spacing={3}>
            <Alert severity="info">
              You can test browser account creation before completing your profile. Missing
              eligibility answers still need confirmation before real applications can be submitted.
            </Alert>
            <AgentSetupStep />
            <Stack direction="row" sx={{ justifyContent: "space-between", pt: 1 }}>
              <Button variant="outlined" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
              <Button variant="contained" onClick={finish}>
                Open test workspace
              </Button>
            </Stack>
          </Stack>
        )}
      </SectionCard>
    </Stack>
  );
}

const ValidationSummary = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function ValidationSummary({ form }) {
    return (
      <form.Subscribe selector={(s) => s.values}>
        {(values) => {
          const result = userWithAutoApplySchema.safeParse(values);
          if (result.success) {
            return null;
          }

          const issues = describeIssues(result.error.issues);
          return (
            <Alert severity="error">
              <AlertTitle>Some fields need fixing</AlertTitle>
              <Stack spacing={0.5}>
                {issues.map((issue) => {
                  const stepLabel = issue.stepIndex !== null ? STEPS[issue.stepIndex]?.label : null;
                  return (
                    <Typography key={`${issue.path}:${issue.message}`} variant="body2">
                      <strong>{issue.path}</strong>
                      {stepLabel ? ` (${stepLabel} step)` : ""}: {issue.message}
                    </Typography>
                  );
                })}
              </Stack>
            </Alert>
          );
        }}
      </form.Subscribe>
    );
  },
});
