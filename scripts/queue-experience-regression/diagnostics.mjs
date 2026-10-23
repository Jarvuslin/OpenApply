import { queueExperienceRequestAllowed } from "./policy.mjs";

export function queueExperienceDiagnostic(message, address, config) {
  let surface = "unknown",
    resource = "unknown";
  try {
    const url = new URL(address);
    if (!url.username && !url.password) {
      if (url.origin === config.webUrl) {
        surface = "web";
        resource = url.pathname.startsWith("/_next/") ? "next-asset" : "web-page";
      } else if (queueExperienceRequestAllowed("GET", address, null, config)) {
        surface = url.origin === config.apiUrl ? "api" : "companion";
        resource = url.pathname.replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi, ":id");
      }
    }
  } catch {}
  let messageClass = "unclassified";
  if (message.startsWith("Failed to load resource:")) messageClass = "resource-failure";
  else if (message.includes("blocked by CORS policy")) messageClass = "cors-failure";
  else if (/Hydration failed|hydrated but some attributes|hydration mismatch/i.test(message))
    messageClass = "react-hydration";
  else if (/cannot (?:be a (?:child|descendant)|contain a nested)|validateDOMNesting/.test(message))
    messageClass = "dom-nesting";
  else if (/Cannot update a component|not wrapped in act/.test(message))
    messageClass = "react-state-warning";
  else if (/preloaded using link preload/.test(message)) messageClass = "preload-warning";
  else if (/^MUI:/.test(message)) messageClass = "mui-warning";
  else if (/Failed to fetch|NetworkError when attempting to fetch/.test(message))
    messageClass = "fetch-failure";
  const status = message.match(
    /^Failed to load resource: the server responded with a status of ([45]\d{2})\b/,
  );
  const network = message.match(/\bnet::(ERR_[A-Z_]+)\b/);
  const networkCodes = [
    "ERR_ABORTED",
    "ERR_BLOCKED_BY_CLIENT",
    "ERR_CONNECTION_REFUSED",
    "ERR_FAILED",
    "ERR_EMPTY_RESPONSE",
    "ERR_INCOMPLETE_CHUNKED_ENCODING",
    "ERR_HTTP2_PROTOCOL_ERROR",
  ];
  return {
    surface,
    resource,
    messageClass,
    ...(status ? { status: Number(status[1]) } : {}),
    ...(network && networkCodes.includes(network[1]) ? { networkCode: network[1] } : {}),
  };
}
