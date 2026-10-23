"use client";

import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  CalendarClock,
  Check,
  Filter,
  Pencil,
  Target,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import type { PilotDto } from "@/api/pilot-queries";
import { userQueries } from "@/api/queries";
import { invalidations } from "@/api/query-keys";
import { SectionCard } from "@/components/ui/layout";
import { getStoredProvider } from "@/lib/agent-storage";
import { pilotDrafts } from "@/lib/pilot-drafts";
import { type PilotFormValues, pilotDefaults, stepProblem, usePilotForm } from "./pilot-form";
import {
  COMPANY_TYPE_OPTIONS,
  experienceLabel,
  intervalLabel,
  WINDOW_OPTIONS,
  WORK_MODE_OPTIONS,
} from "./pilot-format";
import { PilotBreadcrumb } from "./pilot-parts";
import { BasicsStep, FiltersStep, MatchingStep, ScheduleStep } from "./pilot-steps";
import { PilotSummary } from "./pilot-summary";

const STEPS = [
  { label: "Basics", title: "Basic information", icon: Briefcase },
  { label: "Filters", title: "Job filters", icon: Filter },
  { label: "Matching", title: "Matching criteria", icon: Target },
  { label: "Schedule", title: "Run settings", icon: CalendarClock },
  { label: "Review", title: "Review and create", icon: Check },
] as const;

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

function stepFill(index: number, step: number): string {
  if (index === step) return "primary.main";
  return index < step ? "statusTints.info" : "transparent";
}

interface PilotWizardProps {
  /** Editing reuses the steps with the saved values. */
  pilot?: PilotDto;
}

export function PilotWizard({ pilot }: PilotWizardProps): ReactElement {
  const router = useRouter();
  const profile = useApiQuery(userQueries.detail());
  const draftKey = pilot?.id ?? "new";
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const save = useApiMutation<{ id: string }, { values: PilotFormValues; runNow: boolean }>(
    async ({ values, runNow }) => {
      const body = { ...values, provider: getStoredProvider() };
      const saved = pilot
        ? await api.pilots({ id: pilot.id }).patch(body)
        : await api.pilots.post(body);
      if (saved.error) throw new ApiError(saved.error);
      if (runNow) {
        const run = await api.pilots({ id: saved.data.id }).run.post();
        if (run.error) throw new ApiError(run.error);
      }
      return { data: { id: saved.data.id }, error: null };
    },
    {
      invalidate: invalidations.pilots,
      successMessage: (_, { runNow }) =>
        runNow ? "Pilot saved. Looking for jobs." : "Pilot saved.",
      onSuccess: (data) => {
        pilotDrafts.delete(draftKey);
        router.push(`/pilots/${data.id}`);
      },
    },
  );
  const resumes = profile.data?.resumes ?? [];
  const defaults = pilotDefaults(
    profile.data?.user.primaryResumeId ?? resumes[0]?.id ?? null,
    pilot,
  );
  const form = usePilotForm(defaults, async () => undefined);
  const untouched = JSON.stringify(defaults);

  // Session storage exists only in the browser, so the draft comes back after the first render.
  useEffect(() => {
    const draft = pilotDrafts.read(draftKey);
    if (draft) {
      form.reset(draft.values, { keepDefaultValues: true });
      setStep(draft.step);
      setRestored(true);
    }
    setDraftChecked(true);
  }, [draftKey, form]);

  useEffect(() => {
    if (!draftChecked) return;
    const keep = () => {
      const values = form.state.values;
      if (step === 0 && JSON.stringify(values) === untouched) pilotDrafts.delete(draftKey);
      else pilotDrafts.write(draftKey, { values, step });
    };
    keep();
    const subscription = form.store.subscribe(keep);
    return () => subscription.unsubscribe();
  }, [draftChecked, draftKey, form, step, untouched]);

  function startOver(): void {
    pilotDrafts.delete(draftKey);
    form.reset(defaults);
    setStep(0);
    setProblem(null);
    setRestored(false);
  }

  function go(next: number): void {
    const issue = next > step ? stepProblem(step, form.state.values) : null;
    setProblem(issue);
    if (!issue) setStep(next);
  }

  function submit(runNow: boolean): void {
    for (let index = 0; index < STEPS.length - 1; index++) {
      const issue = stepProblem(index, form.state.values);
      if (issue) {
        setStep(index);
        setProblem(issue);
        return;
      }
    }
    save.mutate({ values: form.state.values, runNow });
  }

  const current = STEPS[step] ?? STEPS[0];
  const StepIcon = current.icon;
  const last = step === STEPS.length - 1;

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: 1 }}>
          <PilotBreadcrumb current={pilot ? pilot.name : "New pilot"} />
          <Typography variant="h2" component="h1" sx={{ mt: 1.5 }}>
            {pilot ? `Edit ${pilot.name}` : "Create a new pilot"}
          </Typography>
          <Typography variant="body2Muted">
            Set up your search in a few steps. You can always change these later.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          disabled={save.isPending}
          onClick={() =>
            stepProblem(0, form.state.values) ? router.push("/pilots") : submit(false)
          }
        >
          Save and exit
        </Button>
      </Stack>

      {restored && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={startOver}>
              {pilot ? "Discard changes" : "Start over"}
            </Button>
          }
        >
          {pilot
            ? "Your unsaved changes to this pilot are back where you left them."
            : "Picked up where you left off. Your unfinished pilot is saved in this tab until you create it."}
        </Alert>
      )}

      <Stack
        component="ol"
        direction="row"
        aria-label="Steps"
        sx={{ m: 0, p: 0, listStyle: "none", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}
      >
        {STEPS.map((item, index) => (
          <Stack
            key={item.label}
            component="li"
            direction="row"
            spacing={1}
            aria-current={index === step ? "step" : undefined}
            sx={{ alignItems: "center" }}
          >
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: index > step ? 1 : 0,
                borderColor: "line.borderHi",
                bgcolor: stepFill(index, step),
                color: index === step ? "primary.contrastText" : "primary.main",
              }}
            >
              {index < step ? (
                <Check size={13} strokeWidth={2.5} aria-hidden />
              ) : (
                <Typography variant="captionMuted" sx={{ color: "inherit", fontWeight: 600 }}>
                  {index + 1}
                </Typography>
              )}
            </Box>
            <Typography
              variant={index === step ? "body2Strong" : "body2"}
              color={index <= step ? "text.primary" : "text.secondary"}
            >
              {item.label}
            </Typography>
            {index < STEPS.length - 1 && (
              <Typography color="text.disabled" aria-hidden>
                ›
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: last ? "minmax(0, 1fr)" : "minmax(0, 1fr) 340px",
          },
          alignItems: "start",
        }}
      >
        <SectionCard title={current.title} icon={<StepIcon {...ICON} />}>
          <Stack spacing={3}>
            {step === 0 && <BasicsStep form={form} />}
            {step === 1 && <FiltersStep form={form} />}
            {step === 2 && (
              <MatchingStep
                form={form}
                resumes={resumes.map((resume) => ({ id: resume.id, label: resume.label }))}
              />
            )}
            {step === 3 && <ScheduleStep form={form} />}
            {last && <ReviewStep values={form.state.values} resumes={resumes} onEdit={setStep} />}
            {problem && <Alert severity="warning">{problem}</Alert>}
            {save.error && <Alert severity="error">{save.error.message}</Alert>}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {step > 0 && (
                <Button startIcon={<ArrowLeft {...ICON} />} onClick={() => go(step - 1)}>
                  Back
                </Button>
              )}
              <Box sx={{ flex: 1 }} />
              {!last && (
                <Button
                  variant="contained"
                  endIcon={<ArrowRight {...ICON} />}
                  onClick={() => go(step + 1)}
                >
                  Continue
                </Button>
              )}
              {last && (
                <>
                  <Button
                    variant="outlined"
                    disabled={save.isPending}
                    onClick={() => submit(false)}
                  >
                    {pilot ? "Save changes" : "Create pilot"}
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<Zap {...ICON} />}
                    disabled={save.isPending}
                    onClick={() => submit(true)}
                  >
                    {pilot ? "Save and run now" : "Create and run now"}
                  </Button>
                </>
              )}
            </Stack>
          </Stack>
        </SectionCard>
        {!last && (
          <form.Subscribe selector={(state) => state.values}>
            {(values) => <PilotSummary values={values} step={step} resumes={resumes} />}
          </form.Subscribe>
        )}
      </Box>
    </Stack>
  );
}

interface ReviewStepProps {
  values: PilotFormValues;
  resumes: { id: string; label: string }[];
  onEdit: (step: number) => void;
}

function ReviewStep({ values, resumes, onEdit }: ReviewStepProps): ReactElement {
  const { rules } = values;
  const label = <T extends string>(list: T[], options: readonly { value: T; label: string }[]) =>
    list.map((item) => options.find((option) => option.value === item)?.label ?? item).join(", ") ||
    "Any";
  const join = (list: string[], empty = "Any") => list.join(", ") || empty;
  const sections: { title: string; icon: ReactNode; step: number; rows: [string, string][] }[] = [
    {
      title: "Basic information",
      icon: <Briefcase {...ICON} />,
      step: 0,
      rows: [
        ["Name", values.name],
        ["Roles", join(rules.roles)],
        ["Experience", experienceLabel(rules)],
        ["Company type", label(rules.companyTypes, COMPANY_TYPE_OPTIONS)],
        ["Location", join(rules.locations, "Anywhere")],
        ["Work mode", label(rules.workModes, WORK_MODE_OPTIONS)],
      ],
    },
    {
      title: "Filters",
      icon: <Filter {...ICON} />,
      step: 1,
      rows: [
        ["Keywords", join(rules.keywords, "None")],
        ["Exclude keywords", join(rules.excludeKeywords, "None")],
        ["Companies", join(rules.companies, "Any company")],
        ["Skip companies", join(rules.skipCompanies, "None")],
        [
          "Posted within",
          rules.postedWithin.length
            ? rules.postedWithin
                .map((value) => WINDOW_OPTIONS.find((option) => option.value === value)?.label)
                .join(", ")
            : "Any time",
        ],
      ],
    },
    {
      title: "Matching",
      icon: <Target {...ICON} />,
      step: 2,
      rows: [
        ["Minimum fit", `${values.minScore}%`],
        ["Score against", resumes.find((resume) => resume.id === values.resumeId)?.label ?? "—"],
        [
          "Unknown details",
          rules.includeUnknown ? "Include, let the fit score decide" : "Skip them",
        ],
      ],
    },
    {
      title: "Schedule",
      icon: <CalendarClock {...ICON} />,
      step: 3,
      rows: [
        [
          "Auto run",
          values.autoRun ? `On · ${intervalLabel(values.intervalMinutes).toLowerCase()}` : "Off",
        ],
        ["When a job matches", values.mode === "queue" ? "Add to my queue" : "Hold for my review"],
        ["Max jobs per run", String(values.maxJobsPerRun)],
      ],
    },
  ];
  return (
    <Stack spacing={1.75}>
      <Typography variant="body2Muted">
        Check everything below. You can change any of it later from the pilot page.
      </Typography>
      {sections.map((section) => {
        const half = Math.ceil(section.rows.length / 2);
        return (
          <Box key={section.title} sx={{ border: 1, borderColor: "divider", borderRadius: 2 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                px: 1.75,
                py: 1.25,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Box sx={{ display: "flex" }}>{section.icon}</Box>
              <Typography variant="body2Strong" sx={{ flex: 1 }}>
                {section.title}
              </Typography>
              <Button
                size="small"
                startIcon={<Pencil size={13} aria-hidden />}
                onClick={() => onEdit(section.step)}
              >
                Edit
              </Button>
            </Stack>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" },
                py: 1.5,
              }}
            >
              {[section.rows.slice(0, half), section.rows.slice(half)].map((column, index) => (
                <Stack
                  key={column.map(([key]) => key).join()}
                  spacing={1.25}
                  sx={{ px: 1.75, borderLeft: { md: index ? 1 : 0 }, borderColor: "divider" }}
                >
                  {column.map(([key, value]) => (
                    <Stack key={key} direction="row" spacing={1.5}>
                      <Typography variant="body2Muted" sx={{ width: 140, flexShrink: 0 }}>
                        {key}
                      </Typography>
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                        {value}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              ))}
            </Box>
          </Box>
        );
      })}
      <Alert severity="info">
        {values.autoRun
          ? `Create and run now starts the first run right away and holds the results for your review. After that it runs ${intervalLabel(values.intervalMinutes).toLowerCase()} while your computer is connected.`
          : "Create and run now starts one run right away and holds the results for your review."}
      </Alert>
    </Stack>
  );
}
