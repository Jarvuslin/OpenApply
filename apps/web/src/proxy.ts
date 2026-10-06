import { createApiClient } from "@openapply/api-client";
import { type NextRequest, NextResponse } from "next/server";
import { API_ORIGIN } from "@/api/base-url";
import { isAdminRole } from "@/lib/roles";
import { onboardingRedirect } from "@/utils/onboarding";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // The landing page stays reachable signed in - asking for it is not a wrong turn.
  // Checked before /me so the busiest public page costs no auth round trip.
  if (request.nextUrl.pathname === "/") return NextResponse.next();

  // Per-request Eden client that forwards the incoming auth cookie
  const cookie = request.headers.get("cookie") ?? "";
  const { api } = createApiClient(API_ORIGIN, {
    headers: cookie ? { cookie } : {},
    fetch: { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  });

  // One flat object carries the verified flag, role, and profile fields
  const result = await api.auth.me.get().catch(() => null);
  // Auth middleware can return 401 even though it is not in the endpoint's typed response map.
  if (!result || (result.error && Number(result.error.status) !== 401)) {
    return new NextResponse(
      "OpenApply cannot check your session right now. Please reload to retry.",
      {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "5" },
      },
    );
  }
  const { data, error } = result;

  // The browser can use the refresh cookie at /api/auth; it is not sent on page requests.
  if (error || data === null) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  // Profile not filled in -> onboarding.
  const onboardingDestination = onboardingRedirect(request.nextUrl.pathname, data);
  if (onboardingDestination) {
    return NextResponse.redirect(new URL(onboardingDestination, request.url));
  }

  // The /me call above already carried the role, so gating /admin here is free
  if (request.nextUrl.pathname.startsWith("/admin") && !isAdminRole(data.role)) {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|docs|install|jobs|login|register|verify-email|forgot-password|reset-password|confirm-email-change|opengraph-image|apple-icon|favicon.ico|.*\\..*).*)",
  ],
};
