import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

type Address = { address: string; family: number };
type Dependencies = {
  lookup?: (hostname: string) => Promise<Address[]>;
  request?: typeof request;
  timeoutMs?: number;
};

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const [first, second = 0] = address.split(":").map((part) => Number.parseInt(part || "0", 16));
  // Only global unicast; exclude transition, protocol-assignment, and documentation ranges.
  return (
    (first & 0xe000) === 0x2000 &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
  );
}

export function validatePublicLogoUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (isIP(hostname)) return publicAddress(hostname) ? url.href : null;
    if (
      !hostname.includes(".") ||
      /\.(localhost|local|localdomain|internal|intranet|corp|home|home\.arpa|lan|test|invalid|example|onion)$/i.test(
        hostname,
      ) ||
      !hostname.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function fetchLogoPage(
  input: string,
  dependencies: Dependencies = {},
): Promise<{ url: string; html: string } | null> {
  return fetchLogoResource(input, "page", dependencies).then((result) =>
    result ? { url: result.url, html: result.body.toString("utf8") } : null,
  );
}

export function fetchLogoImage(
  input: string,
  dependencies: Dependencies = {},
): Promise<string | null> {
  return fetchLogoResource(input, "image", dependencies).then((result) => result?.url ?? null);
}

function imageBytes(body: Buffer, contentType: string): boolean {
  if (body.length < 4) return false;
  const prefix = body.subarray(0, 64);
  if (prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return true;
  if (/^GIF8[79]a/.test(prefix.toString("ascii"))) return true;
  if (prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP")
    return true;
  if (prefix.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return true;
  if (prefix.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(prefix.toString("ascii", 8)))
    return true;
  return (
    contentType === "image/svg+xml" &&
    /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(body.toString("utf8"))
  );
}

function fetchLogoResource(
  input: string,
  kind: "page" | "image",
  dependencies: Dependencies,
): Promise<{ url: string; body: Buffer } | null> {
  const resolveAddress = dependencies.lookup ?? ((hostname) => lookup(hostname, { all: true }));
  const makeRequest = dependencies.request ?? request;

  return new Promise((resolve) => {
    let finished = false;
    let currentRequest: ClientRequest | undefined;
    let currentResponse: IncomingMessage | undefined;
    const deadline = setTimeout(() => finish(null), dependencies.timeoutMs ?? TIMEOUT_MS);

    function finish(result: { url: string; body: Buffer } | null) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      currentResponse?.destroy();
      currentRequest?.destroy();
      resolve(result);
    }

    async function visit(value: string, redirects: number): Promise<void> {
      try {
        const safeUrl = validatePublicLogoUrl(value);
        if (!safeUrl) return finish(null);
        const hostname = new URL(safeUrl).hostname.replace(/^\[|\]$/g, "");
        const literalFamily = isIP(hostname);
        const addresses = literalFamily
          ? [{ address: hostname, family: literalFamily }]
          : await resolveAddress(hostname);
        if (finished) return;
        if (
          !addresses.length ||
          addresses.some(
            ({ address, family }) => !publicAddress(address) || isIP(address) !== family,
          )
        ) {
          return finish(null);
        }
        let active = true;
        const outgoing = makeRequest(
          safeUrl,
          {
            method: "GET",
            agent: false,
            headers: {
              Accept: kind === "page" ? "text/html, application/xhtml+xml" : "image/*",
              "Accept-Encoding": "identity",
              "User-Agent": "OpenApply-CompanyLogos/1.0",
            },
            // Pin the validated answer while preserving the hostname for TLS verification.
            lookup: (_host, options, callback) => {
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            },
          },
          (response) => {
            if (finished) return response.destroy();
            currentResponse = response;
            response.once("error", () => {
              if (active) finish(null);
            });
            const status = response.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
              const nextUrl = validatePublicLogoUrl(response.headers.location ?? "", safeUrl);
              active = false;
              response.destroy();
              outgoing.destroy();
              currentResponse = undefined;
              currentRequest = undefined;
              if (!nextUrl || !response.headers.location || redirects >= MAX_REDIRECTS) {
                return finish(null);
              }
              void visit(nextUrl, redirects + 1);
              return;
            }
            const contentType = response.headers["content-type"]
              ?.split(";", 1)[0]
              .trim()
              .toLowerCase();
            const length = Number(response.headers["content-length"] ?? "0");
            if (
              status !== 200 ||
              (kind === "page" &&
                !["text/html", "application/xhtml+xml"].includes(contentType ?? "")) ||
              (kind === "image" &&
                !contentType?.startsWith("image/") &&
                contentType !== "application/octet-stream") ||
              (response.headers["content-encoding"] &&
                response.headers["content-encoding"] !== "identity") ||
              !Number.isFinite(length) ||
              length < 0 ||
              length > MAX_BYTES
            ) {
              return finish(null);
            }
            let bytes = 0;
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > MAX_BYTES) return finish(null);
              chunks.push(chunk);
            });
            response.once("aborted", () => finish(null));
            response.once("end", () => {
              const body = Buffer.concat(chunks);
              if (kind === "image" && !imageBytes(body, contentType ?? "")) return finish(null);
              finish({ url: safeUrl, body });
            });
          },
        );
        currentRequest = outgoing;
        outgoing.once("error", () => {
          if (active) finish(null);
        });
        outgoing.end();
      } catch {
        finish(null);
      }
    }

    void visit(input, 0);
  });
}
