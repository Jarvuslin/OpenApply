"use client";

import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  DialogActions,
  DialogContent,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  APPLICATION_QUESTIONS,
  type UserWithAutoApplyInput,
  userWithAutoApplySchema,
} from "@openapply/contracts/user";
import { useSelector } from "@tanstack/react-form";
import {
  BriefcaseBusiness,
  FileText,
  FileUp,
  GraduationCap,
  IdCard,
  MapPin,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
} from "lucide-react";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { userQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { normalizeProfileDraft } from "@/components/features/onboarding/normalize-profile-draft";
import { ResumesList } from "@/components/features/resumes";
import { EmptyState } from "@/components/ui/data";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import { useAppForm } from "@/components/ui/form/tanstack";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { settingsDrafts } from "@/lib/settings-drafts";
import { removeAt } from "@/utils/array";
import { ApplicationAnswersPanel } from "./application-answers-panel";
import { durationLabel } from "./history-dates";
import { EducationEntryDialog, WorkEntryDialog } from "./history-entry-dialog";
import { HistoryTimeline } from "./history-timeline";
import { EditButton, ProfileCard, type ProfileFact, SectionIntro } from "./profile-card";
import { ProfileHeader, type ProfileTab } from "./profile-header";
import { saveProfileSettings, toFormValues } from "./profile-values";
import { ResumeImportDialog } from "./resume-import-dialog";
import { AddressSection } from "./sections/address-section";
import { EducationSection } from "./sections/education-section";
import { EeoSection } from "./sections/eeo-section";
import { JobPreferencesSection } from "./sections/job-preferences-section";
import { PersonalSection } from "./sections/personal-section";
import { ReferencesSection } from "./sections/references-section";
import { SalarySection } from "./sections/salary-section";
import { WorkAuthSection } from "./sections/work-auth-section";

export function SettingsContent(): ReactElement {
  const query = useApiQuery(userQueries.detail());
  const retryAction = (
    <Button color="inherit" disabled={query.isFetching} onClick={() => query.refetch()}>
      {query.isFetching ? "Retrying" : "Retry"}
    </Button>
  );

  if (!query.data) {
    if (query.isPending) return <LinearProgress />;
    return (
      <Alert severity="error" action={retryAction}>
        Could not load your profile.
      </Alert>
    );
  }

  return (
    <Stack spacing={3}>
      {query.isError && (
        <Alert severity="warning" action={retryAction}>
          Profile refresh failed. Your edits are still here.
        </Alert>
      )}
      <SettingsForm
        key={query.data.user.id}
        userId={query.data.user.id}
        initialData={toFormValues(query.data)}
        profileUpdatedAt={query.dataUpdatedAt}
        transcriptName={query.data.user.transcriptOriginalName}
      />
    </Stack>
  );
}

interface SettingsFormProps {
  userId: string;
  initialData: UserWithAutoApplyInput;
  profileUpdatedAt: number;
  transcriptName: string | null;
}

function SettingsForm(props: SettingsFormProps): ReactElement {
  const { initialData, userId, profileUpdatedAt, transcriptName } = props;
  const [draft] = useState(() => settingsDrafts.read(userId));
  const [saved] = useState(() => settingsDrafts.readSaved(userId, profileUpdatedAt));
  const [baseline, setBaseline] = useState(draft?.baseline ?? saved ?? initialData);
  const [defaults, setDefaults] = useState(draft?.values ?? saved ?? initialData);
  const baselineRef = useRef(baseline);
  const [sessionGeneration] = useState(settingsDrafts.generation);
  const [tab, setTab] = useState<ProfileTab>("about");
  const [editing, setEditing] = useState<EditKey | null>(null);
  const [answerFilter, setAnswerFilter] = useState<"all" | "missing">("all");
  const [jobIndex, setJobIndex] = useState<number | "new" | null>(null);
  const [schoolIndex, setSchoolIndex] = useState<number | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  const save = useApiMutation<{ id: string }, UserWithAutoApplyInput>(
    (vars) =>
      saveProfileSettings(
        vars,
        async () => {
          const current = await api.user.get();
          if (current.error) throw new Error(apiErrorMessage(current.error));
          if (!current.data)
            throw new Error("Could not verify your primary resume. Please retry saving.");
          return current.data.user.primaryResumeId;
        },
        (input) => api.user.put(input),
      ),
    {
      successMessage: "Profile saved",
      invalidate: [queryKeys.user.all],
    },
  );

  const form = useAppForm({
    defaultValues: defaults,
    validators: { onSubmit: userWithAutoApplySchema },
    onSubmit: async ({ value }) => {
      const pendingSave = settingsDrafts.beginSave(userId, value);
      await save.mutateAsync(userWithAutoApplySchema.parse(value));
      settingsDrafts.completeSave(pendingSave);
      setEditing(null);
    },
  });
  const values = useSelector(form.store, (state) => state.values);
  const pristine = JSON.stringify(values) === JSON.stringify(baseline);
  // settingsDrafts keeps edits across in-app navigation, so only a reload or close asks.
  useUnsavedChangesGuard(!pristine, true);
  useEffect(() => {
    const preserve = () => {
      const current = form.state.values;
      const saved = baselineRef.current;
      if (JSON.stringify(current) === JSON.stringify(saved))
        settingsDrafts.delete(userId, sessionGeneration);
      else settingsDrafts.write(userId, { baseline: saved, values: current }, sessionGeneration);
    };
    preserve();
    const subscription = form.store.subscribe(preserve);
    const unsubscribeSaved = settingsDrafts.subscribe(userId, (saved) => {
      const current = form.state.values;
      const pristineBeforeSave = JSON.stringify(current) === JSON.stringify(baselineRef.current);
      baselineRef.current = saved;
      setBaseline(saved);
      if (pristineBeforeSave || JSON.stringify(current) === JSON.stringify(saved)) {
        setDefaults(saved);
        form.reset(saved);
      }
      preserve();
    });
    return () => {
      subscription.unsubscribe();
      unsubscribeSaved();
    };
  }, [form, userId, sessionGeneration]);

  const answers = values.applicationAnswers ?? {};
  const missingAnswers = APPLICATION_QUESTIONS.filter((question) => !answers[question.key]).length;
  const checks = [
    values.firstName,
    values.lastName,
    values.contactEmail,
    values.phone,
    values.linkedin,
    values.city,
    values.country,
    values.workAuthorization?.length,
    values.gpa,
    values.educationHistory?.length,
    values.workHistory?.length,
    ...APPLICATION_QUESTIONS.map((question) => answers[question.key]),
  ];
  const percent = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const preferences = values.jobPreferences;
  const jobs = values.workHistory ?? [];
  const schools = values.educationHistory ?? [];

  function submit(): void {
    const normalized = normalizeProfileDraft(form.state.values);
    form.setFieldValue("phone", normalized.phone);
    form.setFieldValue("autoApply", normalized.autoApply);
    void form.handleSubmit();
  }
  /** Saves one change straight from the saved profile, outside the section editors. */
  async function persist(change: Partial<UserWithAutoApplyInput>): Promise<void> {
    const value = normalizeProfileDraft({ ...baselineRef.current, ...change });
    const pendingSave = settingsDrafts.beginSave(userId, value);
    await save.mutateAsync(userWithAutoApplySchema.parse(value));
    settingsDrafts.completeSave(pendingSave);
  }
  function cancelEdit(): void {
    setDefaults(baseline);
    form.reset(baseline);
    settingsDrafts.delete(userId, sessionGeneration);
    setEditing(null);
  }
  const edit = (key: EditKey) => () => setEditing(key);
  const replaceAt = <T,>(list: T[], index: number | "new", item: T): T[] =>
    index === "new" ? [item, ...list] : list.map((old, i) => (i === index ? item : old));
  const link = (url: string | null | undefined) =>
    url ? url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;

  return (
    <Stack spacing={3}>
      <ProfileHeader
        values={values}
        percent={percent}
        missingAnswers={missingAnswers}
        tab={tab}
        onTab={(next) => {
          setAnswerFilter("all");
          setTab(next);
        }}
        onEditLinks={edit("contact")}
        onShowMissing={() => {
          setAnswerFilter("missing");
          setTab("answers");
        }}
      />
      {tab === "about" && (
        <Stack spacing={2.5}>
          <SectionIntro
            icon={<UserRound {...ICON} />}
            title="About you"
            description="Personal details, contact information and preferences used across your applications."
            action={<FillFromResumeButton onClick={() => setImporting(true)} />}
          />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 3fr) minmax(0, 2fr)" },
              gap: 2,
              alignItems: "stretch",
            }}
          >
            <ProfileCard
              stacked
              fullHeight
              title="Personal information"
              icon={<ShieldCheck {...ICON} />}
              onEdit={edit("contact")}
              items={[
                [
                  ["Legal name", [values.firstName, values.lastName].filter(Boolean).join(" ")],
                  ["Preferred name", values.preferredName],
                  ["Pronouns", values.pronouns, null, "she/her, they/them"],
                  ["Current company", values.currentCompany],
                ],
                [
                  [
                    "Email",
                    values.contactEmail,
                    values.contactEmail && `mailto:${values.contactEmail}`,
                  ],
                  ["Phone", [values.phone, answers.phoneType].filter(Boolean).join(" · ")],
                  ["LinkedIn", link(values.linkedin), values.linkedin],
                  ["GitHub", link(values.github), values.github],
                  ["Website", link(values.website), values.website],
                  ["Portfolio", link(values.portfolio), values.portfolio],
                ],
              ]}
            />
            <Stack spacing={2}>
              <ProfileCard
                title="Address"
                icon={<MapPin {...ICON} />}
                onEdit={edit("address")}
                items={[
                  ["Street", [values.street, values.aptUnit].filter(Boolean).join(", ")],
                  ["City", [values.city, values.state].filter(Boolean).join(", ")],
                  ["Postal code", values.zipCode],
                  ["Country", values.country],
                ]}
              />
              <ProfileCard
                title="Work authorization"
                icon={<ShieldCheck {...ICON} />}
                onEdit={edit("workAuth")}
                items={[
                  ...(values.workAuthorization ?? []).map(
                    (entry) => [entry.country, authorizationText(entry)] as ProfileFact,
                  ),
                  ["Relocation", values.willingToRelocate ? "Willing" : "Not willing"],
                  ["Preferred locations", values.preferredLocations.join(", ")],
                ]}
              />
            </Stack>
          </Box>
          <ProfileCard
            title="Job preferences"
            description="The roles, levels and pay you are looking for."
            icon={<SlidersHorizontal {...ICON} />}
            onEdit={edit("jobPreferences")}
            items={[
              [
                ["Roles", preferences?.roles.join(", "), null, "Software engineering, Backend"],
                ["Levels", preferences?.levels.join(", "), null, "Internship, Entry"],
                ["Work arrangement", preferences?.workModes.join(", "), null, "Hybrid, Remote"],
                [
                  "Employment type",
                  preferences?.employmentTypes.join(", "),
                  null,
                  "Full-time, Contract",
                ],
              ],
              [
                [
                  "Years of experience",
                  preferences?.yearsExperience == null ? null : String(preferences.yearsExperience),
                  null,
                  "2",
                ],
                ...(values.salaryPreferences.length
                  ? values.salaryPreferences.map(
                      (salary) =>
                        [`Salary · ${salary.appliesTo}`, salaryText(salary)] as ProfileFact,
                    )
                  : [["Salary range", null, null, "CA$80k – 120k / year"] as ProfileFact]),
              ],
            ]}
          />
          <ProfileCard
            title="Voluntary self-identification"
            description="Only used on optional equal-opportunity questions. Blank means decline to answer."
            icon={<IdCard {...ICON} />}
            onEdit={edit("eeo")}
            items={[
              [
                ["Gender", values.eeoGender],
                ["Race", values.eeoRace],
                ["Hispanic or Latino", values.eeoHispanicOrLatino],
              ],
              [
                ["Veteran status", values.eeoVeteranStatus],
                ["Disability status", values.eeoDisabilityStatus],
              ],
            ]}
          />
        </Stack>
      )}
      {tab === "work" && (
        <Stack spacing={3}>
          <Stack spacing={2}>
            <SectionIntro
              icon={<BriefcaseBusiness {...ICON} />}
              title="Work & education"
              description="Your work history and education fill the matching sections of application forms."
              action={
                <Stack direction="row" spacing={1}>
                  <FillFromResumeButton onClick={() => setImporting(true)} />
                  <Button
                    variant="contained"
                    startIcon={<Plus size={16} aria-hidden />}
                    onClick={() => setJobIndex("new")}
                  >
                    Add work experience
                  </Button>
                </Stack>
              }
            />
            <HistoryTimeline
              noun="job"
              entries={jobs.map((job, i) => ({
                key: `${i}-${job.company}-${job.title}`,
                dates: dates(job.start, job.end || "Present"),
                duration: durationLabel(job.start, job.end),
                title: job.title,
                subtitle: [job.company, job.location].filter(Boolean).join(" · "),
                body: job.summary,
              }))}
              empty={
                <EmptyState
                  title="No work experience yet"
                  description="Add jobs, internships and contracts. Forms that ask for your work history are filled from these."
                />
              }
              onEdit={setJobIndex}
              onDelete={(index) => persist({ workHistory: removeAt(jobs, index) })}
            />
          </Stack>
          <Stack spacing={2}>
            <SectionIntro
              nested
              icon={<GraduationCap {...ICON} />}
              title="Education"
              description="Schools, dates, GPA and transcript."
              action={
                <Stack direction="row" spacing={1}>
                  <EditButton label="GPA and transcript" onClick={edit("education")} />
                  <AddButton label="Add education" onClick={() => setSchoolIndex("new")} />
                </Stack>
              }
            />
            <HistoryTimeline
              noun="school"
              entries={schools.map((school, i) => ({
                key: `${i}-${school.school}`,
                dates: dates(school.start, school.end),
                duration: durationLabel(school.start, school.end),
                title: school.school,
                subtitle: [school.degree, school.field].filter(Boolean).join(", "),
                aside: i === 0 && (
                  <Stack direction="row" spacing={3} sx={{ flexShrink: 0 }}>
                    <Fact label="GPA">
                      {values.gpa == null ? null : `${values.gpa} / ${values.gpaScale ?? 4}`}
                    </Fact>
                    <Fact label="Transcript">{transcriptName}</Fact>
                  </Stack>
                ),
              }))}
              empty={
                <EmptyState title="No schools yet" description="Add where you studied and when." />
              }
              onEdit={setSchoolIndex}
              onDelete={(index) => persist({ educationHistory: removeAt(schools, index) })}
            />
          </Stack>
          <Stack spacing={2}>
            <SectionIntro
              nested
              icon={<UsersRound {...ICON} />}
              title="References"
              description="Up to 3. Forms that ask for references are filled from these."
              action={
                values.references.length ? (
                  <EditButton onClick={edit("references")} />
                ) : (
                  <AddButton label="Add reference" onClick={edit("references")} />
                )
              }
            />
            {values.references.length === 0 ? (
              <EmptyState title="No references yet" />
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" },
                  gap: 1.5,
                }}
              >
                {values.references.map((reference) => (
                  <Card key={`${reference.name}-${reference.email}`} sx={{ p: 2 }}>
                    <Typography variant="body2Strong" component="p">
                      {reference.name}
                    </Typography>
                    <Typography variant="body2Muted" component="p">
                      {[reference.relationship, reference.company].filter(Boolean).join(" · ")}
                    </Typography>
                    {reference.email && (
                      <Typography variant="captionMuted" component="p">
                        {reference.email}
                      </Typography>
                    )}
                  </Card>
                ))}
              </Box>
            )}
          </Stack>
        </Stack>
      )}
      {tab === "answers" && (
        <ApplicationAnswersPanel
          answers={answers}
          startWithMissing={answerFilter === "missing"}
          onSave={(key, value) => persist({ applicationAnswers: { ...answers, [key]: value } })}
        />
      )}
      {tab === "documents" && (
        <Stack spacing={2.5}>
          <SectionIntro
            icon={<FileText {...ICON} />}
            title="Documents"
            description="Your resumes. The agent tailors one for each application."
          />
          <ResumesList />
        </Stack>
      )}
      {importing && (
        <ResumeImportDialog
          values={baselineRef.current}
          onImport={persist}
          onClose={() => setImporting(false)}
        />
      )}
      {jobIndex !== null && (
        <WorkEntryDialog
          initial={jobIndex === "new" ? null : (jobs[jobIndex] ?? null)}
          onClose={() => setJobIndex(null)}
          onSave={async (job) => {
            await persist({ workHistory: replaceAt(jobs, jobIndex, job) });
            setJobIndex(null);
          }}
          onDelete={() => {
            if (jobIndex === "new") return;
            void persist({ workHistory: removeAt(jobs, jobIndex) })
              .then(() => setJobIndex(null))
              .catch(() => undefined);
          }}
        />
      )}
      {schoolIndex !== null && (
        <EducationEntryDialog
          initial={schoolIndex === "new" ? null : (schools[schoolIndex] ?? null)}
          onClose={() => setSchoolIndex(null)}
          onSave={async (school) => {
            await persist({ educationHistory: replaceAt(schools, schoolIndex, school) });
            setSchoolIndex(null);
          }}
          onDelete={() => {
            if (schoolIndex === "new") return;
            void persist({ educationHistory: removeAt(schools, schoolIndex) })
              .then(() => setSchoolIndex(null))
              .catch(() => undefined);
          }}
        />
      )}
      <Dialog open={editing !== null} onClose={cancelEdit} maxWidth="md" fullWidth scroll="paper">
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <DialogTitle>{editing && EDIT_TITLES[editing]}</DialogTitle>
          <DialogContent>
            <Stack spacing={4}>
              {editing === "contact" && <PersonalSection form={form} />}
              {editing === "address" && <AddressSection form={form} />}
              {editing === "workAuth" && <WorkAuthSection form={form} />}
              {editing === "education" && <EducationSection form={form} />}
              {editing === "references" && <ReferencesSection form={form} />}
              {editing === "jobPreferences" && (
                <>
                  <JobPreferencesSection form={form} />
                  <SalarySection form={form} />
                </>
              )}
              {editing === "eeo" && <EeoSection form={form} />}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={cancelEdit} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={save.isPending || pristine}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Stack>
  );
}

const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

type EditKey =
  | "contact"
  | "address"
  | "workAuth"
  | "education"
  | "references"
  | "jobPreferences"
  | "eeo";

const EDIT_TITLES: Record<EditKey, string> = {
  contact: "Edit personal information",
  address: "Edit address",
  workAuth: "Edit work authorization",
  education: "Edit GPA and transcript",
  references: "Edit references",
  jobPreferences: "Edit job preferences",
  eeo: "Edit voluntary self-identification",
};

function FillFromResumeButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Button variant="outlined" startIcon={<FileUp size={16} aria-hidden />} onClick={onClick}>
      Fill from resume
    </Button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<Plus size={14} aria-hidden />}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function Fact({ label, children }: { label: string; children: string | null }): ReactElement {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="captionMuted" component="p">
        {label}
      </Typography>
      <Typography
        variant="body2Strong"
        component="p"
        sx={{ color: children ? "text.primary" : "text.disabled", overflowWrap: "anywhere" }}
      >
        {children || "Not set"}
      </Typography>
    </Box>
  );
}

function dates(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

function yesNo(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "yes" : "no";
}

function authorizationText(entry: { authorized: boolean | null; sponsorship: boolean | null }) {
  return `Authorized: ${yesNo(entry.authorized)} · Sponsorship: ${yesNo(entry.sponsorship)}`;
}

function salaryText(salary: UserWithAutoApplyInput["salaryPreferences"][number]): string {
  const range = [salary.minAmount, salary.maxAmount]
    .filter((amount) => amount != null)
    .map((amount) => Number(amount).toLocaleString())
    .join("–");
  return range ? `${salary.currency} ${range} / ${salary.period}` : "";
}
