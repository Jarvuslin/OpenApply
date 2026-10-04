import type { ReactElement } from "react";
import type { Metadata } from "next";
import { AuthCard, RegisterForm } from "@/components/features/auth";

export const metadata: Metadata = {
  title: "Create account",
  description:
    "Create a free OpenApply account and let an AI agent search boards, tailor your resume, and apply on your own Claude or Codex subscription.",
  alternates: { canonical: "/register" },
};

export default function RegisterPage(): ReactElement {
  return (
    <AuthCard title="Create account" subtitle="Set up your local OpenApply account.">
      <RegisterForm />
    </AuthCard>
  );
}
