import type { Route } from "next";

const AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/confirm-email-change",
]);

/** Only return to application pages; never follow an external URL or an auth loop. */
export function loginDestination(next: string | null): Route {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in redirect targets before URL normalization.
  if (!next?.startsWith("/") || next.startsWith("//") || /[\\\x00-\x20]/.test(next)) {
    return "/workspace";
  }
  try {
    const url = new URL(next, "https://openapply.invalid");
    const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
    if (
      url.origin !== "https://openapply.invalid" ||
      pathname.startsWith("//") ||
      pathname.includes("\\") ||
      AUTH_PATHS.has(pathname) ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/_next/")
    ) {
      return "/workspace";
    }
    return `${url.pathname}${url.search}${url.hash}` as Route;
  } catch {
    return "/workspace";
  }
}
