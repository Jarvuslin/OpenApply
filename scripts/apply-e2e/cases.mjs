export const SYNTHETIC_APPLICANT = Object.freeze({
  name: "Morgan Fixture",
  firstName: "Morgan",
  lastName: "Fixture",
  email: "morgan.fixture@example.test",
  authorized: "yes",
  needsSponsorship: "yes",
  sponsorshipDetails:
    "I am currently authorized to work in Canada and will require employer sponsorship in the future.",
  project: "Accessible application dashboard",
});

export function expectedWhyUs(job) {
  return `I want to help ${job.company} ${job.mission}. My ${SYNTHETIC_APPLICANT.project} project used React and TypeScript with accessible forms, a Node.js API, PostgreSQL storage, and automated tests. I would bring that experience to this role.`;
}

export const CASES = Object.freeze([
  {
    id: "greenhouse",
    title: "Full Stack Software Engineer",
    company: "Harbor Accessibility Labs",
    mission: "make public services accessible",
    sponsorshipField: "needsSponsorship",
    sponsorshipQuestion:
      "Will you now or in the future require employer sponsorship to work in Canada?",
    expectedSponsorship: "yes",
    nameFields: ["firstName", "lastName"],
    entryPath: "",
    controlIds: {
      firstName: "first_name",
      lastName: "last_name",
      workAuthorization: "question_1001",
      needsSponsorship: "question_1002",
      sponsorshipDetails: "question_1003",
      whyUs: "question_1004",
    },
    steps: 1,
  },
  {
    id: "lever",
    title: "Software Engineer, Developer Tools",
    company: "Maple Developer Tools",
    mission: "make developer tools reliable",
    sponsorshipField: "needsSponsorship",
    sponsorshipQuestion:
      "Will you require employer sponsorship now or in the future to work in Canada?",
    expectedSponsorship: "yes",
    nameFields: ["name"],
    entryPath: "/start",
    controlIds: {
      resume: "resume-upload-input",
      workAuthorization: "card-eligibility-field0",
      needsSponsorship: "card-eligibility-field1",
    },
    steps: 1,
  },
  {
    id: "ashby",
    title: "Software Engineer, Product Platform",
    company: "Cedar Product Systems",
    mission: "make application workflows accessible",
    sponsorshipField: "doesNotNeedSponsorship",
    sponsorshipQuestion:
      "Can you confirm that you do NOT need employer sponsorship, now or in the future, to work in Canada?",
    expectedSponsorship: "no",
    nameFields: ["name"],
    entryPath: "/start",
    controlIds: {
      name: "_systemfield_name",
      email: "_systemfield_email",
      resume: "_systemfield_resume",
      workAuthorization: "3f5801b1-82d8-4d18-a17e-84019b163af1",
      doesNotNeedSponsorship: "3f5801b1-82d8-4d18-a17e-84019b163af2",
    },
    steps: 1,
  },
  {
    id: "unfamiliar",
    title: "Software Engineer, Workflow Tools",
    company: "Juniper Workflow Studio",
    mission: "make everyday application workflows accessible",
    sponsorshipField: "needsSponsorship",
    sponsorshipQuestion:
      "Will you now or in the future need employer sponsorship to work in Canada?",
    expectedSponsorship: "yes",
    nameFields: ["name"],
    entryPath: "/start",
    controlIds: {},
    steps: 3,
  },
]);
