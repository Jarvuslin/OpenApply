export async function workerControl(action, environment = process.env, fetcher = fetch) {
  const {
    OPENAPPLY_COMPANION: companion,
    OPENAPPLY_BROWSER_SESSION_ID: session,
    OPENAPPLY_WORKER_CAPABILITY: capability,
  } = environment;
  if (
    !["attach", "prepare", "handoff", "inspect", "login"].includes(action) ||
    !/^[0-9a-f-]{36}$/.test(session ?? "") ||
    !/^[0-9a-f]{64}$/.test(capability ?? "")
  )
    throw new Error("Owned browser context is required. No shared-browser fallback is permitted.");
  const url = new URL(companion);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error("Invalid companion endpoint");
  const response = await fetcher(`${url.origin}/queue/workers/${session}/${action}`, {
    method: "POST",
    headers: { "X-OpenApply-Worker-Capability": capability },
    redirect: "error",
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok)
    throw new Error(
      "Owned browser control refused. Inspect the current work item; do not retry or open a shared browser.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Owned browser response is missing");
  const chunks = [];
  let count = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > 2000000) throw new Error("Owned browser response exceeded its bound");
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    await reader.cancel();
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    action === "attach" &&
    (result.browserSessionId !== session ||
      !Number.isInteger(result.port) ||
      result.port < 1024 ||
      result.port > 65535 ||
      result.port === 9222 ||
      result.outputDir !== `/home/pilot/openapply/queue-workers/${session}`)
  )
    throw new Error("Owned browser identity mismatch");
  return result;
}
