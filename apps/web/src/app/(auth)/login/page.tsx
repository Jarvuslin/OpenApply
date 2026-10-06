import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { AuthCard, AuthFormSkeleton } from "@/components/features/auth";
import { LoginSession } from "@/components/features/auth/login-session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your OpenApply dashboard to run and track job-application campaigns.",
  alternates: { canonical: "/login" },
};

export default function LoginPage(): ReactElement {
  return (
    <AuthCard title="Sign in" subtitle="Welcome back. Sign in to continue.">
      <Suspense fallback={<AuthFormSkeleton />}>
        <LoginSession />
      </Suspense>
    </AuthCard>
  );
}
