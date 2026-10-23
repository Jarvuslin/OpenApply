import type { JOB_LEVELS } from "@openapply/contracts/job-listing";
import type { SalaryCurrency } from "@openapply/contracts/user";

export interface DiscoverFilters {
  titles: string[];
  locations: string[];
  levels: (typeof JOB_LEVELS)[number][];
  workModes: ("remote" | "hybrid" | "onsite")[];
  employmentTypes: ("full_time" | "part_time" | "contract" | "internship" | "temporary")[];
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: SalaryCurrency;
  salaryPeriod: "year" | "hour" | "month";
  includeUnknownSalary: boolean;
  noExperience: boolean;
  minYears: string;
  maxYears: string;
  includeUnknownYears: boolean;
  countries: ("CA" | "US")[];
  companies: string[];
  excludeCompanies: string[];
  excludeTitles: string[];
  includeUnknownLevel: boolean;
  includeUnknownPostedAt: boolean;
  activity: "all" | "not_applied" | "applied" | "saved";
  postedRange: "all" | "1" | "3" | "7" | "14" | "30" | "90" | "custom";
  postedFrom: string;
  postedTo: string;
  discoveredRange: "all" | "1" | "3" | "7" | "14" | "30" | "90" | "custom";
  discoveredFrom: string;
  discoveredTo: string;
}

export interface DiscoverJobCardData {
  id: string;
  title: string;
  company: string;
  companyLogoUrl?: string | null;
  location?: string | null;
  level?: (typeof JOB_LEVELS)[number] | null;
  workMode?: string | null;
  employmentType?: string | null;
  salaryText?: string | null;
  description?: string | null;
  techStack: string[];
  postedAt?: string | null;
  careerUrl?: string | null;
  attributionLinks?: { board: string | null; url: string }[];
}
