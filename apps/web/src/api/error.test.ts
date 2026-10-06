import { ApiError } from "./error";
import { describe, expect, test } from "bun:test";

describe("API errors", () => {
  test("preserves a rejected session status and its message", () => {
    const error = new ApiError({ status: 401, value: { message: "Sign-in expired" } });
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Sign-in expired");
  });

  test("distinguishes a server outage from a rejected session", () => {
    expect(new ApiError({ status: 503 }).status).toBe(503);
    expect(new ApiError({ status: 0 }).status).toBeUndefined();
    expect(new ApiError(new TypeError("Failed to fetch")).status).toBeUndefined();
  });
});
