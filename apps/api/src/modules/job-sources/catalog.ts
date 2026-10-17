import type { AtsProvider } from "./ats";
import type { PublicFeedId } from "./public-feeds";

export interface CatalogBoard {
  provider: AtsProvider;
  slug: string;
  company: string;
}

// Shared source coverage is maintained by OpenApply, independently of candidate profiles.
export const JOB_FEED_CATALOG: CatalogBoard[] = [
  { provider: "ashby", slug: "openai", company: "OpenAI" },
  { provider: "ashby", slug: "notion", company: "Notion" },
  { provider: "ashby", slug: "ramp", company: "Ramp" },
  { provider: "ashby", slug: "linear", company: "Linear" },
  { provider: "ashby", slug: "cohere", company: "Cohere" },
  { provider: "ashby", slug: "ashby", company: "Ashby" },
  { provider: "ashby", slug: "zip", company: "Zip" },
  { provider: "ashby", slug: "cerebras", company: "Cerebras" },
  { provider: "greenhouse", slug: "anthropic", company: "Anthropic" },
  { provider: "greenhouse", slug: "figma", company: "Figma" },
  { provider: "greenhouse", slug: "datadog", company: "Datadog" },
  { provider: "greenhouse", slug: "cloudflare", company: "Cloudflare" },
  { provider: "greenhouse", slug: "mongodb", company: "MongoDB" },
  { provider: "greenhouse", slug: "airbnb", company: "Airbnb" },
  { provider: "greenhouse", slug: "affirm", company: "Affirm" },
  { provider: "greenhouse", slug: "robinhood", company: "Robinhood" },
  { provider: "greenhouse", slug: "reddit", company: "Reddit" },
  { provider: "greenhouse", slug: "coinbase", company: "Coinbase" },
  { provider: "ashby", slug: "wealthsimple", company: "Wealthsimple" },
  { provider: "ashby", slug: "1password", company: "1Password" },
  { provider: "lever", slug: "palantir", company: "Palantir" },
  { provider: "smartrecruiters", slug: "ServiceNow", company: "ServiceNow" },
  { provider: "workable", slug: "huggingface", company: "Hugging Face" },
  { provider: "greenhouse", slug: "stripe", company: "Stripe" },
  { provider: "greenhouse", slug: "databricks", company: "Databricks" },
  { provider: "greenhouse", slug: "discord", company: "Discord" },
  { provider: "greenhouse", slug: "duolingo", company: "Duolingo" },
  { provider: "greenhouse", slug: "dropbox", company: "Dropbox" },
  { provider: "greenhouse", slug: "gitlab", company: "GitLab" },
  { provider: "greenhouse", slug: "asana", company: "Asana" },
  { provider: "greenhouse", slug: "scaleai", company: "Scale AI" },
  { provider: "greenhouse", slug: "brex", company: "Brex" },
  { provider: "greenhouse", slug: "instacart", company: "Instacart" },
  { provider: "greenhouse", slug: "roblox", company: "Roblox" },
  { provider: "greenhouse", slug: "doordashusa", company: "DoorDash" },
  { provider: "smartrecruiters", slug: "Canva", company: "Canva" },
  { provider: "greenhouse", slug: "gusto", company: "Gusto" },
  { provider: "greenhouse", slug: "chime", company: "Chime" },
  { provider: "greenhouse", slug: "lyft", company: "Lyft" },
  { provider: "greenhouse", slug: "pinterest", company: "Pinterest" },
  { provider: "greenhouse", slug: "twilio", company: "Twilio" },
  { provider: "greenhouse", slug: "okta", company: "Okta" },
  { provider: "greenhouse", slug: "elastic", company: "Elastic" },
  { provider: "greenhouse", slug: "samsara", company: "Samsara" },
  { provider: "greenhouse", slug: "fastly", company: "Fastly" },
  { provider: "greenhouse", slug: "cockroachlabs", company: "Cockroach Labs" },
  { provider: "greenhouse", slug: "squarespace", company: "Squarespace" },
  { provider: "greenhouse", slug: "toast", company: "Toast" },
  { provider: "greenhouse", slug: "klaviyo", company: "Klaviyo" },
  { provider: "greenhouse", slug: "webflow", company: "Webflow" },
  { provider: "greenhouse", slug: "vercel", company: "Vercel" },
  { provider: "ashby", slug: "replit", company: "Replit" },
  { provider: "ashby", slug: "supabase", company: "Supabase" },
  { provider: "ashby", slug: "perplexity", company: "Perplexity" },
  { provider: "ashby", slug: "elevenlabs", company: "ElevenLabs" },
  { provider: "ashby", slug: "modal", company: "Modal" },
  { provider: "ashby", slug: "cursor", company: "Cursor" },
  // Canadian banks, insurers, telecom, and enterprise employers hire through Workday, plus big tech with Canadian offices.
  // RBC's robots.txt disallows its main site (rbcglobal1); its host is exempt for personal use.
  { provider: "workday", slug: "rbc.wd3.rbcglobal1", company: "RBC" },
  { provider: "workday", slug: "rbc.wd3.rbcearlytalent1", company: "RBC" },
  { provider: "workday", slug: "td.wd3.td_bank_careers", company: "TD" },
  { provider: "workday", slug: "bmo.wd3.external", company: "BMO" },
  { provider: "workday", slug: "bmo.wd3.Campus", company: "BMO" },
  { provider: "workday", slug: "cibc.wd3.search", company: "CIBC" },
  { provider: "workday", slug: "cibc.wd3.campus", company: "CIBC" },
  { provider: "workday", slug: "manulife.wd3.mfcjh_jobs", company: "Manulife" },
  { provider: "workday", slug: "sunlife.wd3.experienced-jobs", company: "Sun Life" },
  { provider: "workday", slug: "sunlife.wd3.Campus", company: "Sun Life" },
  { provider: "workday", slug: "desjardins.wd10.Desjardins", company: "Desjardins" },
  { provider: "workday", slug: "intactfc.wd3.intactfc", company: "Intact" },
  {
    provider: "workday",
    slug: "otppb.wd3.ontarioteachers_careers",
    company: "Ontario Teachers' Pension Plan",
  },
  {
    provider: "workday",
    slug: "thomsonreuters.wd5.external_career_site",
    company: "Thomson Reuters",
  },
  { provider: "workday", slug: "bb.wd3.blackberry", company: "BlackBerry" },
  { provider: "workday", slug: "ciena.wd5.careers", company: "Ciena" },
  { provider: "workday", slug: "mitel.wd3.mitelcareers", company: "Mitel" },
  { provider: "workday", slug: "cae.wd3.career", company: "CAE" },
  {
    provider: "workday",
    slug: "canadiantirecorporation.wd3.enterprise_external_careers_site",
    company: "Canadian Tire",
  },
  { provider: "workday", slug: "magna.wd3.magna", company: "Magna" },
  { provider: "workday", slug: "enbridge.wd3.enbridge_careers", company: "Enbridge" },
  { provider: "workday", slug: "tcenergy.wd3.career_site_tc", company: "TC Energy" },
  { provider: "workday", slug: "suncor.wd1.Suncor_External", company: "Suncor" },
  { provider: "workday", slug: "nvidia.wd5.nvidiaexternalcareersite", company: "NVIDIA" },
  { provider: "workday", slug: "salesforce.wd12.external_career_site", company: "Salesforce" },
  { provider: "workday", slug: "adobe.wd5.external_experienced", company: "Adobe" },
  { provider: "workday", slug: "autodesk.wd1.ext", company: "Autodesk" },
  { provider: "workday", slug: "intel.wd1.external", company: "Intel" },
  { provider: "workday", slug: "paypal.wd1.jobs", company: "PayPal" },
  { provider: "workday", slug: "mastercard.wd1.corporatecareers", company: "Mastercard" },
  { provider: "workday", slug: "visa.wd5.visa", company: "Visa" },
  { provider: "workday", slug: "cisco.wd5.cisco_careers", company: "Cisco" },
  { provider: "workday", slug: "workday.wd5.workday", company: "Workday" },
  // Scotiabank, Rogers, and TELUS list jobs on SuccessFactors career sites; the slug is the site host.
  { provider: "successfactors", slug: "jobs.scotiabank.com", company: "Scotiabank" },
  { provider: "successfactors", slug: "jobs.rogers.com", company: "Rogers" },
  { provider: "successfactors", slug: "careers.telus.com", company: "TELUS" },
  // Bell and OpenText run Phenom career sites; the slug is host/country/locale/tenant code.
  { provider: "phenom", slug: "jobs.bell.ca/ca/en_CA/BECACA", company: "Bell" },
  { provider: "phenom", slug: "careers.opentext.com/us/en_US/OPJOPEUS", company: "OpenText" },
  // Oracle Recruiting Cloud career sites; the slug is the tenant host and site number.
  { provider: "oracle", slug: "eeho.fa.us2.oraclecloud.com/CX_45001", company: "Oracle" },
  { provider: "oracle", slug: "iaziqy.fa.ocs.oraclecloud.com/UberCareers", company: "Uber" },
  { provider: "oracle", slug: "fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com/CX_1", company: "Nokia" },
  { provider: "oracle", slug: "ebxr.fa.us2.oraclecloud.com/CX_1", company: "DTCC" },
  { provider: "oracle", slug: "efds.fa.em5.oraclecloud.com/CX_1", company: "Ford" },
  { provider: "oracle", slug: "hctz.fa.us2.oraclecloud.com/CX_1001", company: "onsemi" },
  { provider: "oracle", slug: "hdjq.fa.us2.oraclecloud.com/CX_1", company: "Emerson" },
  {
    provider: "oracle",
    slug: "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/CX_2001",
    company: "Chubb",
  },
  {
    provider: "oracle",
    slug: "fa-esfc-saasfaprod1.fa.ocs.oraclecloud.com/CX_1",
    company: "Federated Co-operatives",
  },
  { provider: "oracle", slug: "ejwl.fa.us2.oraclecloud.com/CX", company: "Marriott" },
  { provider: "oracle", slug: "efet.fa.us2.oraclecloud.com/CX_1009", company: "Hilton" },
  {
    provider: "oracle",
    slug: "fa-evax-saasfaprod1.fa.ocs.oraclecloud.com/CX_1001",
    company: "IHG",
  },
  { provider: "oracle", slug: "ibnjjb.fa.ocs.oraclecloud.com/CX_1", company: "Lifepoint Health" },
  { provider: "oracle", slug: "eswt.fa.us6.oraclecloud.com/CX_1001", company: "UC Health" },
  {
    provider: "oracle",
    slug: "fa-evly-saasfaprod1.fa.ocs.oraclecloud.com/CX_1",
    company: "TriHealth",
  },
  {
    provider: "oracle",
    slug: "fa-evxo-saasfaprod1.fa.ocs.oraclecloud.com/CX_1",
    company: "Community Health Systems",
  },
  { provider: "oracle", slug: "emcm.fa.us2.oraclecloud.com/WMCareers", company: "WM" },
  // Taleo career sections on its job board API; the slug is tenant/section.
  { provider: "taleo", slug: "hdr/ex", company: "HDR" },
  { provider: "taleo", slug: "textron/textron", company: "Textron" },
  { provider: "taleo", slug: "valero/2", company: "Valero" },
  { provider: "taleo", slug: "uab/ext", company: "University of Alabama at Birmingham" },
  { provider: "taleo", slug: "cfopitt/pitt_staff_external", company: "University of Pittsburgh" },
  { provider: "taleo", slug: "wvu/staff", company: "West Virginia University" },
  { provider: "taleo", slug: "massanf/ex", company: "Commonwealth of Massachusetts" },
  { provider: "taleo", slug: "bayshore/bs_ex", company: "Bayshore HealthCare" },
  { provider: "taleo", slug: "humber/hbr_ex", company: "Humber College" },
];

export const PUBLIC_FEED_CATALOG: {
  id: PublicFeedId;
  name: string;
  details: string;
}[] = [
  {
    id: "simplify-new-grad",
    name: "Simplify · New Grad",
    details:
      "Every active new-grad role with a direct employer link in SimplifyJobs' GitHub list; checked hourly. Their employers' own job boards are added too.",
  },
  {
    id: "simplify-internships",
    name: "Simplify · Internships",
    details:
      "Every active internship with a direct employer link in SimplifyJobs' Summer 2027 GitHub list; checked every 30 minutes.",
  },
  {
    id: "canadian-internships",
    name: "Canadian Tech Internships",
    details:
      "Open roles in the community-kept Canadian Tech Internships 2027 list on GitHub; checked every 30 minutes.",
  },
  {
    id: "remoteok",
    name: "Remote OK",
    details: "Recent jobs from the public Remote OK feed; checked hourly.",
  },
  {
    id: "weworkremotely",
    name: "We Work Remotely",
    details: "Recent jobs from the official RSS feed; checked hourly.",
  },
  {
    id: "hackernews",
    name: "Hacker News · Who is hiring?",
    details: "Up to 500 employer posts in the newest monthly hiring thread; checked hourly.",
  },
  {
    id: "hackernews-jobs",
    name: "Hacker News · YC jobs",
    details: "Up to 200 official Hacker News job stories; this is a subset of YC companies.",
  },
  {
    id: "google-careers",
    name: "Google Careers",
    details:
      "Up to 60 verified postings from US/Canada software searches, prioritizing Early experience; checked hourly. Limited Google coverage, separate from Google Jobs.",
  },
];

export const CATALOG_FEED_KEYS = [
  ...JOB_FEED_CATALOG.map((board) => `${board.provider}/${board.slug}`),
  ...PUBLIC_FEED_CATALOG.map((feed) => `public/${feed.id}`),
];
