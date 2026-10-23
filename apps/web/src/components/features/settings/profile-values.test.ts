import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { saveProfileSettings } from "./profile-values";
import { expect, test } from "bun:test";

for (const primaryResumeId of [null, "11111111-1111-4111-8111-111111111111"]) {
  test(`profile saves preserve the server's primary resume when the draft contains ${primaryResumeId}`, async () => {
    const values = {
      ...structuredClone(USER_DEFAULT_VALUES),
      firstName: "Morgan",
      lastName: "Example",
      contactEmail: "morgan@example.com",
      city: "Toronto",
      country: "Canada",
      primaryResumeId,
      workAuthorization: [{ country: "Canada", authorized: true, sponsorship: true }],
    };
    const savedPrimary = "22222222-2222-4222-8222-222222222222";
    const payload = await saveProfileSettings(
      values,
      async () => savedPrimary,
      async (input) => input,
    );
    expect(payload.primaryResumeId).toBe(savedPrimary);
    expect(payload.contactEmail).toBe(values.contactEmail);
    expect(payload.workAuthorization).toEqual(values.workAuthorization);
    expect(values.primaryResumeId).toBe(primaryResumeId);
  });
}

test("profile save never writes when the latest primary selection cannot be read", async () => {
  let writes = 0;
  const values = {
    ...structuredClone(USER_DEFAULT_VALUES),
    firstName: "Morgan",
    lastName: "Example",
    contactEmail: "morgan@example.com",
  };
  await expect(
    saveProfileSettings(
      values,
      async () => {
        throw new Error("API unavailable");
      },
      async () => {
        writes += 1;
      },
    ),
  ).rejects.toThrow("API unavailable");
  expect(writes).toBe(0);
});
