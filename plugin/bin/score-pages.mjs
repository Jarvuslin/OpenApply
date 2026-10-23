// A scoring run may open only the sites of the job postings the server chose for it.

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

/**
 * Pages and redirects stay on the site of a listed posting. A pasted link often lands on an
 * apply or listing page of the same site, and the posting is one click away.
 */
export function scoreSiteAllowed(addresses, address, allowLoopback = false) {
  const next = scorePageUrl(address, allowLoopback);
  return (
    next !== null &&
    addresses.some((listed) => scorePageUrl(listed, allowLoopback)?.origin === next.origin)
  );
}
