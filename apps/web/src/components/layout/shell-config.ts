import {
  Bell,
  Briefcase,
  Bug,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Send,
  Settings,
  Shield,
  User,
  Zap,
} from "lucide-react";
import { BUG_REPORT_URL, FEATURE_REQUEST_URL } from "@/lib/constants";
import { isAdminRole } from "@/lib/roles";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown only to ADMIN/SUPER_ADMIN. Cosmetic - the API's requireRole is the real gate. */
  adminOnly?: boolean;
  /** Live count at the end of the item: what needs you, or work in the queue. */
  badge?: "needs-you" | "queue";
  /** Extra pathname prefixes that keep this item highlighted (e.g. detail routes living outside its href). */
  matchHrefs?: string[];
}

export interface NavGroup {
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutGrid,
        matchHrefs: ["/analytics"],
      },
      {
        label: "Queue",
        href: "/queue",
        icon: ListChecks,
        badge: "queue",
        matchHrefs: ["/account-setup"],
      },
      { label: "Needs you", href: "/needs-you", icon: Bell, badge: "needs-you" },
      {
        label: "Jobs",
        href: "/discover",
        icon: Briefcase,
      },
      { label: "Pilots", href: "/pilots", icon: Zap },
      {
        label: "Applications",
        href: "/applications",
        icon: Send,
        matchHrefs: ["/campaigns"],
      },
      {
        label: "Profile",
        href: "/profile",
        icon: User,
        matchHrefs: ["/documents", "/resumes"],
      },
    ],
  },
];

/** Pinned to the foot of the rail, by the feedback and account controls - not part of the app's own nav. */
export const footerNavGroups: NavGroup[] = [
  {
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        matchHrefs: ["/boards", "/inbox"],
      },
      { label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
    ],
  },
];

/** The navigation available to the current account. */
export function visibleNavGroups(role: string | undefined, groups = navGroups): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || isAdminRole(role)),
    }))
    .filter((group) => group.items.length > 0);
}

/** External GitHub issue links - rendered as plain anchors, never through navGroups/next-link. */
export const feedbackLinks: NavItem[] = [
  { label: "Report a Bug", href: BUG_REPORT_URL, icon: Bug },
  { label: "Feature Request", href: FEATURE_REQUEST_URL, icon: Lightbulb },
];

export const APP_TITLE = "OpenApply";
export const RAIL_WIDTH = 240;
export const DOCK_COLLAPSED = 56;
export const DOCK_EXPANDED = 400;
export const DOCK_MIN_EXPANDED = 320;
export const DOCK_MAX_EXPANDED = 640;

function isHrefActive(pathname: string, href: string): boolean {
  const target = href.split("?")[0];
  return pathname === target || (target !== "/" && pathname.startsWith(`${target}/`));
}

/** Match the destination and any detail routes it owns. */
export function isNavEntryActive(pathname: string, item: NavItem): boolean {
  return (
    isHrefActive(pathname, item.href) ||
    (item.matchHrefs?.some((href) => isHrefActive(pathname, href)) ?? false)
  );
}
