"use client";

import type { LoginInput, RegisterInput } from "@openapply/contracts/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import {
  type ApiMutationResult,
  type ApiQueryResult,
  useApiMutation,
  useApiQuery,
} from "@/api/hooks";
import { authQueries } from "@/api/queries";
import type { AuthSessionResponse, AuthUserDto, LogoutResponse, MeResponse } from "@/api/types";
import { loginDestination } from "@/utils/login-destination";

export interface UseSessionResult {
  user: AuthUserDto | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  meQuery: ApiQueryResult<MeResponse>;
}

export interface UseAuthActionsResult {
  login: ApiMutationResult<AuthSessionResponse, LoginInput>;
  register: ApiMutationResult<AuthSessionResponse, RegisterInput>;
  logout: ApiMutationResult<LogoutResponse, void>;
}

/**
 * The signed-in user, read from `/api/auth/me` (auth rides the httpOnly cookie).
 * A fresh probe on the login page restores expired access cookies before showing the form.
 */
export function useSession(options?: { fresh?: boolean }): UseSessionResult {
  const meQuery = useApiQuery(authQueries.me(), {
    retry: false,
    staleTime: 30_000,
    refetchOnMount: options?.fresh ? "always" : true,
  });
  const signedOut = meQuery.error instanceof ApiError && meQuery.error.status === 401;

  return {
    user: signedOut ? undefined : meQuery.data,
    isLoading: meQuery.isLoading,
    isAuthenticated: !signedOut && Boolean(meQuery.data),
    meQuery,
  };
}

/**
 * Login/register/logout mutations. On a successful login or register the `me`
 * cache is cleared before opening the requested page so a previous user's data cannot linger.
 * The proxy routes on to `/onboarding` when the profile is empty.
 */
export function useAuthActions(): UseAuthActionsResult {
  const router = useRouter();
  const queryClient = useQueryClient();

  const onSession = () => {
    queryClient.clear();
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(loginDestination(next));
  };

  // The forms render these errors inline - no toast on top.
  const login = useApiMutation<AuthSessionResponse, LoginInput>(
    (body) => api.auth.login.post(body),
    { onSuccess: onSession, showErrorToast: false },
  );

  const register = useApiMutation<AuthSessionResponse, RegisterInput>(
    (body) => api.auth.register.post(body),
    { onSuccess: onSession, showErrorToast: false },
  );

  const logout = useApiMutation<LogoutResponse, void>(() => api.auth.logout.post(), {
    onSuccess: () => {
      queryClient.clear();
      router.push("/login");
    },
  });

  return { login, register, logout };
}
