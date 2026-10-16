// A pilot scoring run may open only the job postings the server chose for it.

export function scorePageUrl(address, allowLoopback = false) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.username || url.password || address.length > 4000) return null;
  if (allowLoopback && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    return url.protocol === "http:" && Number(url.port) >= 1024 ? url : null;
  return url.protocol === "https:" && !url.port ? url : null;
}

/** One to fifty distinct, credential-free https job pages. */
export function scorePagesValid(addresses, allowLoopback = false) {
  return (
    Array.isArray(addresses) &&
    addresses.length >= 1 &&
    addresses.length <= 50 &&
    new Set(addresses).size === addresses.length &&
    addresses.every(
      (address) => typeof address === "string" && scorePageUrl(address, allowLoopback) !== null,
    )
  );
}

/** A top-level page is allowed when it is one of the listed postings, ignoring query and hash. */
export function scorePageAllowed(addresses, address, allowLoopback = false) {
  const next = scorePageUrl(address, allowLoopback);
  if (!next) return false;
  const path = (url) => url.pathname.replace(/\/+$/, "") || "/";
  return addresses.some((listed) => {
    const url = scorePageUrl(listed, allowLoopback);
    return url !== null && url.origin === next.origin && path(url) === path(next);
  });
}

/** Redirects stay on the site of a listed posting, as when a board moves a job within itself. */
export function scoreRedirectAllowed(addresses, address, allowLoopback = false) {
  const next = scorePageUrl(address, allowLoopback);
  return (
    next !== null &&
    addresses.some((listed) => scorePageUrl(listed, allowLoopback)?.origin === next.origin)
  );
}
