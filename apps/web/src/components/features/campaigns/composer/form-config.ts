import { applyUrlsSchema, type CampaignSource, MAX_APPLY_URLS } from "@jobpilot/contracts/campaign";
import { z } from "zod/v4";
import type { CreateCampaignRequest, JobBoardDto } from "@/api/types";
import { buildCliArgs } from "@/utils/cli-args";

/** Splits pasted text on whitespace/commas and dedupes - shared by validation and submit. */
function parseUrls(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    // Unparseable URLs already failed form validation; skip rather than crash.
    return null;
  }
}

/** First two distinct hostnames from a batch of pasted URLs, for a readable fallback campaign name. */
function deriveApplyQuery(urls: string[]): string {
  const hosts = [...new Set(urls.map(hostname).filter((h) => h !== null))];
  if (hosts.length === 0) {
    return "Pasted links";
  }
  const rest = hosts.length - 2;
  const shown = hosts.slice(0, 2).join(", ");
  return rest > 0 ? `Pasted links: ${shown} +${rest} more` : `Pasted links: ${shown}`;
}

export const composerFormSchema = z
  .object({
    mode: z.enum(["search", "auto_apply", "apply"]),
    query: z.string().trim(),
    board: z.string(),
    // Base resume to score/tailor against; apply tailors per pasted job, so none up front.
    resumeId: z.string(),
    minScore: z.number().int().min(0).max(100),
    maxApps: z.union([z.number().int().min(1).max(500), z.null(), z.undefined()]),
    // Empty = unlimited (search until the board is exhausted), mirroring maxApps.
    maxJobs: z.union([z.number().int().min(1), z.null(), z.undefined()]),

    // Apply campaign settings (mode === "apply").
    urlsText: z.string(),
    applyLabel: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "apply") {
      if (!applyUrlsSchema.safeParse(parseUrls(v.urlsText)).success) {
        ctx.addIssue({
          code: "custom",
          message: `Add 1-${MAX_APPLY_URLS} job links.`,
          path: ["urlsText"],
        });
      }
      return;
    }
    if (v.query.trim().length < 2) {
      ctx.addIssue({ code: "custom", message: "Enter a query", path: ["query"] });
    }
    if (!v.resumeId) {
      ctx.addIssue({ code: "custom", message: "Select a resume", path: ["resumeId"] });
    }
    if (!v.board) {
      ctx.addIssue({ code: "custom", message: "Pick a board", path: ["board"] });
    }
  });

/** What the board picker needs: a linked board and a catalog board both satisfy it. */
export type BoardOption = Pick<JobBoardDto, "domain" | "name">;

export type CampaignMode = Extract<CampaignSource, "search" | "auto_apply" | "apply">;
export type ComposerFormValues = z.infer<typeof composerFormSchema>;

/**
 * Static defaults shared by the parent `useAppForm` and the `withForm` field
 * groups so their form types line up. The parent overlays runtime values
 * (first board, profile min-score) before mounting.
 */
export const COMPOSER_DEFAULT_VALUES: ComposerFormValues = {
  mode: "auto_apply",
  query: "",
  board: "",
  resumeId: "",
  minScore: 60,
  maxApps: null,
  maxJobs: 15,

  urlsText: "",
  applyLabel: "",
};

/** The optional caps are "empty = unlimited", so only a real number counts as set. */
function isCap(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function buildCampaignConfig(values: ComposerFormValues): CreateCampaignRequest["config"] {
  if (values.mode !== "auto_apply") {
    // Omit maxJobs when empty so the search runs unlimited.
    return { board: values.board, ...(isCap(values.maxJobs) ? { maxJobs: values.maxJobs } : {}) };
  }
  return {
    board: values.board,
    minScore: values.minScore,
    ...(isCap(values.maxApps) ? { maxApplications: values.maxApps } : {}),
  };
}

/** Builds the campaigns POST body per mode - apply skips search config entirely. */
export function buildCreateCampaignRequest(values: ComposerFormValues): CreateCampaignRequest {
  if (values.mode === "apply") {
    const urls = parseUrls(values.urlsText);
    const label = values.applyLabel.trim();
    return {
      query: label || deriveApplyQuery(urls),
      source: "apply",
      config: {},
      urls,
      createdBy: "user",
    };
  }
  return {
    query: values.query.trim(),
    source: values.mode,
    config: { resumeId: values.resumeId, ...buildCampaignConfig(values) },
    createdBy: "user",
  };
}

export function buildSkillArg(values: ComposerFormValues, campaignId: string): string {
  if (values.mode === "apply") {
    // The apply skill looks the campaign up by id rather than taking search flags.
    return buildCliArgs({ positional: ["campaign", campaignId] });
  }

  return buildCliArgs({
    positional: [values.query.trim()],
    flags: {
      board: values.board,
      "min-score": values.mode === "auto_apply" ? values.minScore : undefined,
      "max-apps":
        values.mode === "auto_apply" && isCap(values.maxApps) ? values.maxApps : undefined,
      "max-jobs": values.mode === "search" && isCap(values.maxJobs) ? values.maxJobs : undefined,
      // Search saves results onto this campaign; pass the id the UI just created so
      // the skill doesn't have to rediscover it.
      campaign: values.mode === "search" || values.mode === "auto_apply" ? campaignId : undefined,
    },
  });
}

export const SUBMIT_LABELS: Record<CampaignMode, string> = {
  search: "Start search",
  auto_apply: "Start auto-apply",

  apply: "Apply to links",
};

export const MODE_DESCRIPTIONS: Record<CampaignMode, string> = {
  search:
    "Search a board and score matches in the selected board - nothing is sent. Review the ranked list yourself.",
  auto_apply:
    "Search, score, then auto-submit applications to matches above your score threshold in the selected board.",

  apply:
    "Already found the jobs yourself? Paste the links and the agent reviews fit, tailors your resume, and applies to each.",
};
