import type { SourceJob } from "./types";

/** Bump when the rules change, so jobs dropped under older rules are classified again. */
export const CLASSIFIER_VERSION = 2;

export type TechVerdict = "tech" | "non_tech" | "unsure";

// "Data entry" is clerical, whatever the word "data" suggests.
const CLERICAL = /\bdata entry\b/i;
const TECH_TITLE = new RegExp(
  [
    "software",
    "developer",
    "programmer",
    "\\bdev ?ops\\b",
    "devsecops",
    "\\bsre\\b",
    "site reliability",
    "\\bdata\\b",
    "analytics",
    "business intelligence",
    "\\bbi (?:developer|analyst|engineer)",
    "machine learning",
    "\\bml\\b",
    "\\bai\\b",
    "artificial intelligence",
    "deep learning",
    "computer vision",
    "\\bnlp\\b",
    "\\bllm",
    "cloud",
    "\\baws\\b",
    "azure",
    "kubernetes",
    "cyber",
    "infosec",
    "information security",
    "security (?:engineer|analyst|architect|operations|researcher|specialist)",
    "appsec",
    "penetration test",
    "\\bsoc\\b",
    "\\bqa\\b",
    "quality assurance",
    "test automation",
    "\\bsdet\\b",
    "software test",
    "information technology",
    "help ?desk",
    "service desk",
    "desktop support",
    "technical support",
    "network (?:engineer|administrator|admin|architect|analyst|technician|specialist)",
    "systems? (?:administrator|admin|engineer|analyst|architect|integration)",
    "sysadmin",
    "database",
    "\\bdba\\b",
    "front[ -]?end",
    "back[ -]?end",
    "full[ -]?stack",
    "\\bweb\\b",
    "mobile (?:engineer|developer)",
    "\\bios\\b",
    "android",
    "firmware",
    "embedded",
    "product (?:manager|owner|management)",
    "technical program",
    "\\btpm\\b",
    "(?:solutions?|enterprise|cloud|technical|platform|security|data) architect",
    "technical (?:analyst|lead|consultant|specialist)",
    "tech lead",
    "engineering manager",
    "head of engineering",
    "chief technology",
    "\\bcto\\b",
    "scrum master",
    "agile coach",
    "\\bux\\b",
    "user experience",
    "product design",
    "\\bsap\\b",
    "salesforce (?:developer|administrator|admin|architect|engineer)",
    "\\berp\\b",
    "blockchain",
    "quant(?:itative)? (?:developer|engineer|researcher|analyst)",
    "computer",
    "technology (?:analyst|consultant|associate|intern|co-?op|specialist|lead|manager|risk)",
    "digital (?:engineer|developer|product|analyst)",
    "automation (?:developer|engineer|tester)",
    "\\brpa\\b",
    "integration (?:developer|engineer|specialist)",
    "observability",
    "infrastructure",
    "it (?:auditor|audit)",
    "systems? security",
    "technical account manager",
    "martech",
    "implementation (?:consultant|engineer|specialist|analyst|manager)",
    "systems implementation",
    "solutions? (?:consultant|engineer)",
  ].join("|"),
  "i",
);
// Upper-case "IT" only, so "it" in a sentence-like title never counts.
const IT_TITLE = /\bI\.?T\.?\b/;
const ENGINEERING = /\bengineer(?:ing)?\b|\barchitect\b/i;
// Engineering that is physical, not software, data, systems or IT.
const PHYSICAL_ENGINEERING =
  /\b(?:mechanical|civil|structural|electrical|manufacturing|process engineer\w*|chemical|industrial|field service|maintenance|facilit(?:y|ies)|hvac|environmental|geotechnical|mining|petroleum|reservoir|drilling|nuclear|biomedical|packaging|automotive|plant|production|construction|building|piping|water|wastewater|transportation|traffic|highway|metallurg\w*|materials|welding|power|energy|utilit(?:y|ies)|substation|stress|thermal|propulsion|aerospace|avionics hardware|tooling|cost|estimating|project engineer|landscape|interior|naval|marine|rail|geolog\w*|survey\w*)\b/i;
const NON_TECH_TITLE = new RegExp(
  [
    "nurse",
    "\\brn\\b",
    "\\blpn\\b",
    "\\bnp\\b",
    "physician",
    "surgeon",
    "doctor",
    "pharmac",
    "dental",
    "dentist",
    "hygienist",
    "therapist",
    "psycholog",
    "social worker",
    "caregiver",
    "personal support",
    "medical (?:assistant|receptionist|office)",
    "patient",
    "phlebotom",
    "veterinar",
    "driver",
    "truck",
    "delivery (?:driver|associate|helper|person|courier)",
    "courier",
    "forklift",
    "warehouse",
    "picker",
    "packer",
    "material handler",
    "cashier",
    "sales associate",
    "retail",
    "store (?:manager|associate|clerk|lead)",
    "barista",
    "\\bcook\\b",
    // "Chef de projet" is French for project lead.
    "\\bchef\\b(?!/| de)",
    "kitchen",
    "(?:food|restaurant|banquet) server",
    "bartender",
    "dishwasher",
    "crew member",
    "housekeep",
    "janitor",
    "custodian",
    "cleaner",
    "landscap",
    "security (?:guard|officer)",
    "loss prevention",
    "receptionist",
    "front desk",
    "administrative assistant",
    "executive assistant",
    "office (?:manager|assistant|administrator)",
    "secretary",
    "\\bclerk\\b",
    "bookkeep",
    "accountant",
    "accounting",
    "accounts (?:payable|receivable)",
    "payroll",
    "\\btax\\b",
    "controller",
    "treasury",
    "financial (?:analyst|advisor|adviser|planner|representative|consultant)",
    "wealth",
    "investment (?:advisor|adviser|banking|banker)",
    "banker",
    "teller",
    "branch",
    "mortgage",
    "loan officer",
    "underwrit",
    "claims",
    "insurance (?:agent|advisor|adviser|broker)",
    "actuar",
    "lawyer",
    "attorney",
    "paralegal",
    "\\blegal\\b",
    "\\bcounsel\\b",
    "recruiter",
    "talent acquisition",
    "human resources",
    "\\bhr\\b",
    "people partner",
    "marketing",
    "\\bbrand\\b",
    "public relations",
    "communications",
    "social media",
    "copywriter",
    "journalist",
    "sales (?:representative|rep|manager|executive|associate|director|consultant|specialist|lead|development)",
    "account (?:executive|manager|director)",
    "business development",
    "customer (?:service|success|care|experience)",
    "call cent",
    "contact cent",
    "teacher",
    "tutor",
    "educator",
    "childcare",
    "electrician",
    "plumber",
    "welder",
    "carpenter",
    "machinist",
    "mechanic",
    "\\bhvac\\b",
    "technician",
    "operator",
    "assembler",
    "assembly",
    "production (?:worker|associate|supervisor|lead)",
    "manufacturing",
    "maintenance",
    "construction",
    "laborer",
    "labourer",
    "painter",
    "millwright",
    "inspector",
    "merchandis",
    "\\bbuyer\\b",
    "purchasing",
    "procurement",
    "supply chain",
    "logistics",
    "dispatcher",
    "flight attendant",
    "hospitality",
    "hotel",
    "guest services",
    "concierge",
    "personal trainer",
    "stylist",
    "barber",
    "real estate",
    "property manager",
    "leasing",
    "compliance",
    "auditor",
    "credit (?:analyst|officer|adjudicator)",
    "relationship manager",
    "\\badvis[oe]r\\b",
  ].join("|"),
  "i",
);
const SOFTWARE_TEXT =
  /\b(?:software|code|coding|python|java|javascript|typescript|golang|c\+\+|c#|sql|api|apis|cloud|aws|azure|kubernetes|docker|linux|microservices|machine learning|data pipelines?|databases?|devops|ci\/cd|git|backend|frontend|it infrastructure|networking)\b/gi;
const PHYSICAL_TEXT =
  /\b(?:mechanical|cad|solidworks|catia|autocad|structural|civil|hvac|welding|machining|fabrication|piping|concrete|manufacturing|assembly line|plant floor|tooling|injection molding|thermal|fluid|propulsion|electrical wiring|plc|substation|construction site)\b/gi;

/** Tech when the title says so; non-tech only when it clearly names other work. Unsure keeps the job. */
export function classifyJob(title: string, description = ""): TechVerdict {
  if (CLERICAL.test(title)) return "non_tech";
  if (ENGINEERING.test(title)) {
    if (PHYSICAL_ENGINEERING.test(title)) {
      // "Electrical Engineer, Embedded Software" is still software work.
      return TECH_TITLE.test(title.replace(PHYSICAL_ENGINEERING, "")) ? "tech" : "non_tech";
    }
    if (TECH_TITLE.test(title) || IT_TITLE.test(title)) return "tech";
    const software = description.match(SOFTWARE_TEXT)?.length ?? 0;
    const physical = description.match(PHYSICAL_TEXT)?.length ?? 0;
    if (software >= 2 && software > physical) return "tech";
    if (physical >= 2 && physical > software * 2) return "non_tech";
    return "unsure";
  }
  if (TECH_TITLE.test(title) || IT_TITLE.test(title)) return "tech";
  // Product marketing sits between product and marketing, so it is kept.
  if (/product marketing/i.test(title)) return "unsure";
  if (NON_TECH_TITLE.test(title) || STORE_ROLE.test(title)) return "non_tech";
  return "unsure";
}

// Store and restaurant roles. Assistant and General Manager count only when they are the whole
// title, so "Associate Project Manager" or "General Manager, Cloud" never match.
const STORE_ROLE =
  /\b(?:pizza|delivery expert|shift (?:lead|leader|runner|manager|supervisor)|csr|crew member|team member|restaurant|food services?|food demo|line cook|prep cook|busser|barista|store (?:floor|lead|manager|associate))\b|^(?:[\w'’]+\s)?(?:level \d+ )?(?:assistant |general |assistant general )manager(?: in training)?(?:\s*[(\d-]|$)/i;

/** Whether a job is kept: everything except clear non-tech. */
export function keepsJob(title: string, description = ""): boolean {
  return classifyJob(title, description) !== "non_tech";
}

/** The id a dropped job is remembered by: the source's own id, else its identity URL. */
export function droppedJobId(job: SourceJob): string {
  return job.externalId ?? job.identityUrl ?? job.url;
}

/**
 * Split a board's jobs into kept and dropped. A job dropped under the current classifier version
 * is skipped without classifying; one dropped under an older version is classified again.
 */
export function splitByTech(jobs: SourceJob[], dropped: Map<string, number>) {
  const kept: SourceJob[] = [];
  const drop: string[] = [];
  const clear: string[] = [];
  let skipped = 0;
  for (const job of jobs) {
    const id = droppedJobId(job);
    const version = dropped.get(id);
    if (version === CLASSIFIER_VERSION) {
      skipped++;
      continue;
    }
    if (keepsJob(job.title, job.description)) {
      kept.push(job);
      if (version !== undefined) clear.push(id);
    } else drop.push(id);
  }
  return { kept, drop, clear, dropped: skipped + drop.length };
}

/** A Workday job family that only holds non-tech roles, such as "Retail Sales & Service". */
export function familyIsNonTech(name: string): boolean {
  if (TECH_TITLE.test(name) || IT_TITLE.test(name) || ENGINEERING.test(name)) return false;
  return NON_TECH_FAMILY.test(name);
}

const NON_TECH_FAMILY =
  /\b(?:sales|retail|marketing|human resources|\bhr\b|legal|finance|accounting|audit|compliance|wealth|banking|client relationships?|private investment|commercial lending|financial planning|facilit(?:y|ies)|real estate|administrat\w*|call centre|call center|contact centre|contact center|customer service|claims|underwriting|actuarial|procurement|purchasing|supply chain|materials management|logistics|warehouse|manufacturing|production|construction|hospitality|food|nursing|clinical|medical|pharmacy|communications|public relations|employee success|global affairs|insurance|credit|mortgage|trading|investments?|asset management|fixed income)\b/i;
