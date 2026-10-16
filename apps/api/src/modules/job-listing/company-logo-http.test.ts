import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions, request } from "node:https";
import { PassThrough } from "node:stream";
import { fetchLogoImage, fetchLogoPage, validatePublicLogoUrl } from "./company-logo-http";
import { describe, expect, test } from "bun:test";

const PUBLIC_ADDRESS = { address: "93.184.215.14", family: 4 };

type Page = {
  status?: number;
  headers?: Record<string, string | undefined>;
  chunks?: readonly Buffer[];
  hang?: boolean;
  abort?: boolean;
};

function network(pages: Page[]) {
  const calls: { url: string; options: RequestOptions }[] = [];
  const responses: PassThrough[] = [];
  const requests: { destroyed: boolean }[] = [];
  const fakeRequest = (
    url: string,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    const page = pages[calls.length] ?? {};
    calls.push({ url, options });
    const response = Object.assign(new PassThrough(), {
      statusCode: page.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...page.headers },
    });
    responses.push(response);
    const outgoing = Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() {
        outgoing.destroyed = true;
        return outgoing;
      },
      end() {
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          if (page.hang || response.destroyed) return;
          if (page.abort) {
            response.emit("aborted");
            return;
          }
          for (const chunk of page.chunks ?? [Buffer.from("<title>Company</title>")]) {
            if (response.destroyed) return;
            response.write(chunk);
          }
          response.end();
        });
        return outgoing;
      },
    });
    requests.push(outgoing);
    return outgoing as unknown as ClientRequest;
  };
  return {
    calls,
    responses,
    requests,
    dependencies: {
      lookup: async () => [PUBLIC_ADDRESS],
      request: fakeRequest as unknown as typeof request,
    },
  };
}

describe("company logo URL validation", () => {
  test.each([
    "http://company.com/logo.png",
    "https://user:secret@company.com/logo.png",
    "https://company.com:8443/logo.png",
    "file:///etc/passwd",
    "data:image/png;base64,aGVsbG8=",
    "https://localhost/logo.png",
    "https://metadata/logo.png",
    "https://foo.local/logo.png",
    "https://foo.internal/logo.png",
    "https://router.home.arpa/logo.png",
    "https://foo.localdomain/logo.png",
    "https://foo.localhost./logo.png",
    "https://127.1/logo.png",
    "https://2130706433/logo.png",
    "https://0x7f000001/logo.png",
    "https://0.0.0.0/logo.png",
    "https://10.0.0.1/logo.png",
    "https://100.64.0.1/logo.png",
    "https://169.254.169.254/logo.png",
    "https://172.16.0.1/logo.png",
    "https://192.168.0.1/logo.png",
    "https://192.0.0.1/logo.png",
    "https://192.0.2.1/logo.png",
    "https://192.88.99.1/logo.png",
    "https://198.18.0.1/logo.png",
    "https://198.51.100.1/logo.png",
    "https://203.0.113.1/logo.png",
    "https://224.0.0.1/logo.png",
    "https://255.255.255.255/logo.png",
    "https://[::]/logo.png",
    "https://[::1]/logo.png",
    "https://[::ffff:127.0.0.1]/logo.png",
    "https://[::ffff:8.8.8.8]/logo.png",
    "https://[fc00::1]/logo.png",
    "https://[fe80::1]/logo.png",
    "https://[ff02::1]/logo.png",
    "https://[64:ff9b::7f00:1]/logo.png",
    "https://[2001::1]/logo.png",
    "https://[2001:db8::1]/logo.png",
    "https://[2002:7f00:1::]/logo.png",
    "https://[3fff::1]/logo.png",
  ])("rejects unsafe URL %s", (url) => {
    expect(validatePublicLogoUrl(url)).toBeNull();
  });

  test("resolves public relative and CDN images", () => {
    expect(validatePublicLogoUrl("/logo.png", "https://company.com/careers")).toBe(
      "https://company.com/logo.png",
    );
    expect(validatePublicLogoUrl("//cdn.company.com/logo.svg", "https://company.com")).toBe(
      "https://cdn.company.com/logo.svg",
    );
    expect(validatePublicLogoUrl("https://[2606:4700:4700::1111]/logo.png")).toBe(
      "https://[2606:4700:4700::1111]/logo.png",
    );
  });
});

describe("verified logo image reader", () => {
  test("accepts actual image bytes, pins DNS, and follows only public redirects", async () => {
    const fake = network([
      { status: 302, headers: { location: "https://cdn.company.com/logo.png" } },
      {
        headers: { "content-type": "image/png" },
        chunks: [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
      },
    ]);
    expect(await fetchLogoImage("https://company.com/logo.png", fake.dependencies)).toBe(
      "https://cdn.company.com/logo.png",
    );
    expect(fake.calls[1]?.options.lookup).toBeDefined();
    expect(fake.calls[1]?.options.headers).not.toHaveProperty("Cookie");
  });
  test.each([
    { status: 404, headers: { "content-type": "image/png" } },
    {
      headers: { "content-type": "text/html" },
      chunks: [Buffer.from("<html>Missing image</html>")],
    },
    { headers: { "content-type": "image/png" }, chunks: [Buffer.from("<html>Fake image</html>")] },
    { status: 302, headers: { location: "https://127.0.0.1/logo.png" } },
    { headers: { "content-type": "image/png", "content-length": String(2 * 1024 * 1024 + 1) } },
  ])("rejects broken, fake, private or oversized image %#", async (page) => {
    const fake = network([page]);
    expect(await fetchLogoImage("https://company.com/logo.png", fake.dependencies)).toBeNull();
    expect(fake.responses.every((response) => response.destroyed)).toBe(true);
  });
});

describe("bounded company page reader", () => {
  test("pins the checked DNS answer and sends no user credentials", async () => {
    const fake = network([{}]);
    expect(await fetchLogoPage("https://company.com/careers", fake.dependencies)).toEqual({
      url: "https://company.com/careers",
      html: "<title>Company</title>",
    });
    const options = fake.calls[0].options;
    expect(options.agent).toBe(false);
    expect(options.headers).not.toHaveProperty("Cookie");
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.rejectUnauthorized).not.toBe(false);
    const answers: unknown[][] = [];
    const callback = (...args: unknown[]) => answers.push(args);
    options.lookup!("company.com", { all: false }, callback);
    options.lookup!("company.com", { all: true }, callback);
    expect(answers).toEqual([
      [null, PUBLIC_ADDRESS.address, 4],
      [null, [PUBLIC_ADDRESS]],
    ]);
    expect(fake.requests[0].destroyed).toBe(true);
  });

  test.each(["127.0.0.1", "10.1.2.3", "::1", "::ffff:10.0.0.1", "2001:db8::1"])(
    "rejects mixed public/private DNS before connecting: %s",
    async (address) => {
      const fake = network([{}]);
      const result = await fetchLogoPage("https://company.com", {
        ...fake.dependencies,
        lookup: async () => [PUBLIC_ADDRESS, { address, family: address.includes(":") ? 6 : 4 }],
      });
      expect(result).toBeNull();
      expect(fake.calls).toHaveLength(0);
    },
  );

  test("validates every redirect destination and destroys rejected bodies", async () => {
    const fake = network([{ status: 302, headers: { location: "https://127.0.0.1/admin" } }]);
    expect(await fetchLogoPage("https://company.com", fake.dependencies)).toBeNull();
    expect(fake.calls).toHaveLength(1);
    expect(fake.responses[0].destroyed).toBe(true);
  });

  test("rejects HTTP redirects", async () => {
    const fake = network([{ status: 302, headers: { location: "http://company.com" } }]);
    expect(await fetchLogoPage("https://company.com", fake.dependencies)).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  test("returns null on DNS or connection failure", async () => {
    const fake = network([]);
    expect(
      await fetchLogoPage("https://company.com", {
        ...fake.dependencies,
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).toBeNull();
    expect(fake.calls).toHaveLength(0);
    expect(
      await fetchLogoPage("https://company.com", {
        ...fake.dependencies,
        request: (() => {
          throw new Error("Connection failed");
        }) as typeof request,
      }),
    ).toBeNull();
  });

  test("performs DNS validation again for each redirected hostname", async () => {
    const fake = network([{ status: 302, headers: { location: "https://private.company.com" } }]);
    const hostnames: string[] = [];
    expect(
      await fetchLogoPage("https://company.com", {
        ...fake.dependencies,
        lookup: async (hostname) => {
          hostnames.push(hostname);
          return [
            {
              address: hostname.startsWith("private") ? "127.0.0.1" : PUBLIC_ADDRESS.address,
              family: 4,
            },
          ];
        },
      }),
    ).toBeNull();
    expect(hostnames).toEqual(["company.com", "private.company.com"]);
    expect(fake.calls).toHaveLength(1);
  });

  test("allows at most three redirects", async () => {
    const redirect = { status: 302, headers: { location: "/next" } };
    const allowed = network([redirect, redirect, redirect, {}]);
    expect((await fetchLogoPage("https://company.com", allowed.dependencies))?.url).toBe(
      "https://company.com/next",
    );
    const rejected = network([redirect, redirect, redirect, redirect, {}]);
    expect(await fetchLogoPage("https://company.com", rejected.dependencies)).toBeNull();
    expect(rejected.calls).toHaveLength(4);
    expect(rejected.responses.every((response) => response.destroyed)).toBe(true);
  });

  test.each([
    { headers: { "content-type": "image/png" } },
    { headers: { "content-encoding": "gzip" } },
    { headers: { "content-length": String(2 * 1024 * 1024 + 1) } },
    { status: 500 },
    { abort: true },
    { chunks: [Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024 + 1)] },
  ])("rejects invalid or oversized response %#", async (page) => {
    const fake = network([page]);
    expect(await fetchLogoPage("https://company.com", fake.dependencies)).toBeNull();
    expect(fake.responses[0].destroyed).toBe(true);
    expect(fake.requests[0].destroyed).toBe(true);
  });

  test("deadline covers DNS and never connects after expiry", async () => {
    const fake = network([{}]);
    let completeLookup: ((value: (typeof PUBLIC_ADDRESS)[]) => void) | undefined;
    const result = await fetchLogoPage("https://company.com", {
      ...fake.dependencies,
      lookup: () =>
        new Promise((resolve) => {
          completeLookup = resolve;
        }),
      timeoutMs: 5,
    });
    expect(result).toBeNull();
    completeLookup!([PUBLIC_ADDRESS]);
    await Promise.resolve();
    expect(fake.calls).toHaveLength(0);
  });

  test("deadline aborts an unfinished response", async () => {
    const fake = network([{ hang: true }]);
    expect(
      await fetchLogoPage("https://company.com", { ...fake.dependencies, timeoutMs: 5 }),
    ).toBeNull();
    expect(fake.responses[0].destroyed).toBe(true);
    expect(fake.requests[0].destroyed).toBe(true);
  });
});
