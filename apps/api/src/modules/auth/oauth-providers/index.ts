import type { OAuthProviderInput } from "@openapply/contracts";
import type { OAuthProvider } from "@/generated/prisma/client";
import { GithubSignInProvider } from "./github.provider";
import { GoogleSignInProvider } from "./google.provider";
import type { SignInProvider } from "./sign-in-provider";

export const signInProviders: Record<OAuthProviderInput, SignInProvider> = {
  google: new GoogleSignInProvider(),
  github: new GithubSignInProvider(),
};

// The wire enum is the Prisma enum lowercased; both directions of that cast live here only.
export function dbProvider(name: OAuthProviderInput): OAuthProvider {
  return name.toUpperCase() as OAuthProvider;
}

export function wireProvider(provider: OAuthProvider): OAuthProviderInput {
  return provider.toLowerCase() as OAuthProviderInput;
}

export * from "./github.provider";
export * from "./google.provider";
export * from "./sign-in-provider";
