import { createHash } from "node:crypto";

export function requireLoopback(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("The fixture runner accepts only credential-free HTTP loopback origins");
  }
  return url;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createRedactor() {
  const secrets = new Set();
  return {
    add(...values) {
      for (const value of values) if (typeof value === "string" && value) secrets.add(value);
    },
    clean(value) {
      const json = JSON.stringify(value, (key, item) => {
        if (
          /^(password|authorization|cookie|set-cookie|token|accessToken|refreshToken|leaseToken|terminalToken)$/i.test(
            key,
          )
        ) {
          return "[redacted]";
        }
        return item;
      });
      if (json === undefined) return null;
      let result = json;
      for (const secret of secrets) result = result.split(secret).join("[redacted]");
      result = result.replace(/Bearer\s+[a-zA-Z0-9_.-]+/g, "Bearer [redacted]");
      return JSON.parse(result);
    },
  };
}
