import { randomBytes } from "node:crypto";
import { sha256 } from "./api.mjs";
import { CASES, SYNTHETIC_APPLICANT } from "./cases.mjs";

export function syntheticApplicant(runId, fixtureCount = CASES.length) {
  const password = `Fixture!9${randomBytes(24).toString("hex")}`;
  const loginEmail = `apply-e2e-${runId}@example.test`;
  const content = {
    basics: {
      name: SYNTHETIC_APPLICANT.name,
      headline: "Full stack software engineer",
      email: SYNTHETIC_APPLICANT.email,
      phone: "+14165550198",
      location: "Toronto, Ontario, Canada",
    },
    summary:
      "Software engineer building accessible web applications with TypeScript, React, Node.js, and PostgreSQL.",
    experience: [
      {
        company: "Synthetic Software Cooperative",
        title: "Software Engineer",
        location: "Toronto, Ontario, Canada",
        start: "January 2023",
        end: "September 2026",
        bullets: [
          "Built an accessible application dashboard with TypeScript, React, Node.js, and PostgreSQL.",
          "Implemented REST APIs, PostgreSQL queries, and automated unit and integration tests for application records.",
          "Improved keyboard navigation and screen reader labels after accessibility testing.",
          "Collaborated with designers and engineers, reviewed pull requests, and documented application workflows.",
        ],
      },
    ],
    projects: [
      {
        name: SYNTHETIC_APPLICANT.project,
        description: "A synthetic portfolio project for tracking job applications.",
        keywords: ["TypeScript", "React", "Node.js", "PostgreSQL", "accessibility"],
        bullets: [
          "Built a dashboard using React and TypeScript with accessible forms, a Node.js API, PostgreSQL storage, and automated tests.",
        ],
        start: "2025",
        end: "2026",
      },
    ],
    skills: [
      {
        group: "Engineering",
        items: [
          "TypeScript",
          "JavaScript",
          "React",
          "Node.js",
          "PostgreSQL",
          "REST APIs",
          "Git",
          "Automated testing",
          "Accessibility",
        ],
      },
    ],
    education: [
      {
        school: "Synthetic Institute of Technology",
        degree: "Bachelor of Science in Computer Science",
        start: "2018",
        end: "2022",
        details: [],
      },
    ],
    publications: [],
    awards: [],
    certifications: [],
    sections: [],
  };
  const originalText = [
    "SYNTHETIC APPLICANT — LOCAL FIXTURE TEST ONLY",
    ...Object.values(content.basics),
    content.summary,
    ...content.experience.flatMap((entry) => [
      entry.company,
      entry.title,
      `${entry.start} - ${entry.end}`,
      entry.location,
      ...entry.bullets,
    ]),
    ...content.projects.flatMap((entry) => [entry.name, entry.description, ...entry.bullets]),
    ...content.skills.flatMap((entry) => [entry.group, entry.items.join(", ")]),
    ...content.education.flatMap((entry) => [
      entry.school,
      entry.degree,
      `${entry.start} - ${entry.end}`,
    ]),
  ].join("\n");
  const profile = {
    firstName: SYNTHETIC_APPLICANT.firstName,
    lastName: SYNTHETIC_APPLICANT.lastName,
    contactEmail: SYNTHETIC_APPLICANT.email,
    phone: content.basics.phone,
    city: "Toronto",
    state: "Ontario",
    country: "Canada",
    zipCode: "M5V 2T6",
    currentCompany: "Synthetic Software Cooperative",
    usAuthorized: false,
    requiresSponsorship: true,
    workAuthorization: [{ country: "Canada", authorized: true, sponsorship: true }],
    visaStatus: SYNTHETIC_APPLICANT.sponsorshipDetails,
    willingToRelocate: false,
    preferredLocations: ["Canada", "Remote"],
    references: [],
    salaryPreferences: [],
    jobPreferences: {
      roles: ["Software engineering", "Full stack"],
      levels: ["Intermediate / Mid"],
      yearsExperience: 3,
      workModes: ["Remote", "Hybrid", "Onsite"],
      employmentTypes: ["Full-time"],
    },
    autoApply: {
      minMatchScore: 60,
      maxApplicationsPerCampaign: fixtureCount,
      defaultStartDate: "",
    },
  };
  return { password, loginEmail, content, originalText, profile };
}

export async function seedApplicant(api, applicant, redactor) {
  redactor.add(applicant.password);
  const session = await api.request("/api/auth/register", {
    method: "POST",
    body: { email: applicant.loginEmail, password: applicant.password },
  });
  api.setSession(session);
  if (!session.user.emailVerified)
    throw new Error(
      "Disposable API must auto-verify synthetic development signup; no external email will be used",
    );
  await api.request("/api/user/", { method: "PUT", body: applicant.profile });
  const upload = new FormData();
  upload.set("label", "Synthetic original — fixture acceptance");
  upload.set(
    "file",
    new Blob([applicant.originalText], { type: "text/plain" }),
    "morgan-fixture-original.txt",
  );
  const resume = await api.request("/api/resumes/upload", { method: "POST", body: upload });
  await api.request(`/api/resumes/${resume.id}`, {
    method: "PUT",
    body: { content: applicant.content },
  });
  await api.request("/api/user/primary-resume", { method: "PUT", body: { resumeId: resume.id } });
  const artifact = await api.request(`/api/resumes/${resume.id}/artifacts`, {
    method: "POST",
    timeoutMs: 120_000,
  });
  const pdf = await api.request(`/api/resumes/${resume.id}/pdf`, { binary: true });
  if (
    artifact.resumeId !== resume.id ||
    artifact.variantId !== null ||
    artifact.validation?.valid !== true ||
    pdf.subarray(0, 5).toString() !== "%PDF-" ||
    sha256(pdf) !== artifact.pdfSha256
  ) {
    throw new Error(
      "Synthetic base resume compiler preflight did not produce the expected immutable PDF",
    );
  }
  return {
    userId: session.user.id,
    resumeId: resume.id,
    baseArtifact: {
      resumeId: resume.id,
      revision: artifact.revision,
      pdfSha256: artifact.pdfSha256,
      sizeBytes: pdf.length,
    },
  };
}
