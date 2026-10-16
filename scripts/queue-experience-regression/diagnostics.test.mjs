import assert from "node:assert/strict";
import { test } from "node:test";
import { queueExperienceDiagnostic as describe } from "./diagnostics.mjs";

const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  companionUrl: "http://127.0.0.1:14102",
  itemIds: ["00000000-0000-4000-8000-000000000002"],
  workers: [],
};

test("diagnostics expose fixed classes and known read paths without raw messages or queries", () => {
  assert.deepEqual(
    describe(
      "Failed to load resource: the server responded with a status of 503 (Unavailable)",
      `${config.apiUrl}/api/pilot`,
      config,
    ),
    { surface: "api", resource: "/api/pilot", messageClass: "resource-failure", status: 503 },
  );
  assert.deepEqual(
    describe(
      "Failed to load resource: net::ERR_ABORTED secret",
      `${config.apiUrl}/api/work-queue/${config.itemIds[0]}`,
      config,
    ),
    {
      surface: "api",
      resource: "/api/work-queue/:id",
      messageClass: "resource-failure",
      networkCode: "ERR_ABORTED",
    },
  );
  for (const address of [
    "https://secret.example.test/private-token",
    `${config.apiUrl}/api/pilot?token=secret`,
    "http://secret@127.0.0.1:14101/api/pilot",
    "invalid secret",
  ]) {
    const detail = describe("secret raw message", address, config);
    assert.deepEqual(detail, {
      surface: "unknown",
      resource: "unknown",
      messageClass: "unclassified",
    });
    assert.equal(JSON.stringify(detail).includes("secret"), false);
  }
  assert.deepEqual(describe("secret", `${config.webUrl}/_next/private-secret.js?secret`, config), {
    surface: "web",
    resource: "next-asset",
    messageClass: "unclassified",
  });
});

test("classification does not accept errors or repeat arbitrary network codes", () => {
  for (const [message, messageClass] of [
    ["Hydration failed because secret", "react-hydration"],
    ["In HTML, button cannot be a descendant of button", "dom-nesting"],
    ["Access secret blocked by CORS policy", "cors-failure"],
    ["MUI: secret", "mui-warning"],
  ]) {
    const result = describe(message, config.webUrl, config);
    assert.equal(result.messageClass, messageClass);
    assert.equal("code" in result, false);
  }
  assert.equal("networkCode" in describe("net::ERR_PRIVATE_SECRET", "", config), false);
});
