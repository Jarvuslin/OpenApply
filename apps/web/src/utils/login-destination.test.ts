import { loginDestination } from "./login-destination";
import { describe, expect, test } from "bun:test";

describe("return after sign-in", () => {
  test("preserves an internal page and its filters", () => {
    expect(loginDestination("/documents/resumes?tab=tailored#review")).toBe(
      "/documents/resumes?tab=tailored#review",
    );
  });

  test.each([
    null,
    "https://other.example/",
    "//other.example/",
    "/\\other.example/",
    "/%2fother.example/",
    "/%5cother.example/",
    "/\n/other.example/",
    "/login?next=/login",
    "/register/",
    "/%6cogin",
    "/documents/../login",
    "/api/auth/logout",
    "/_next/static/app.js",
    "/%broken",
  ])("rejects an external, malformed or looping return path: %s", (next) => {
    expect(loginDestination(next)).toBe("/workspace");
  });
});
