import { requireConnectorBrowserSession } from "./connector-registration";
import { describe, expect, it } from "bun:test";

describe("connector registration authorization", () => {
  it("rejects a PAT-authenticated agent without a browser session cookie", async () => {
    let called = false;
    await expect(
      requireConnectorBrowserSession("owner", undefined, async () => {
        called = true;
        return { id: "owner" };
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(called).toBe(false);
  });

  it("rejects expired cookies and mismatched cookie/bearer principals", async () => {
    await expect(
      requireConnectorBrowserSession("owner", "expired", async () => null),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requireConnectorBrowserSession("owner", "another-session", async () => ({ id: "other" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("accepts the same verified browser-session principal", async () => {
    await expect(
      requireConnectorBrowserSession("owner", "browser-session", async (token) => {
        expect(token).toBe("browser-session");
        return { id: "owner" };
      }),
    ).resolves.toBeUndefined();
  });
});
