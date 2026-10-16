import { createServer } from "node:http";
import { requireLoopback } from "../apply-e2e/api.mjs";

const uuid = /^[0-9a-f-]{36}$/;
export function recordedHandback(body, response) {
  if (
    body?.outcome !== "recorded" ||
    !uuid.test(body.checkpointId ?? "") ||
    !uuid.test(body.applicationId ?? "") ||
    Object.keys(body).some(
      (key) => !["outcome", "checkpointId", "applicationId", "observations"].includes(key),
    ) ||
    (body.observations !== undefined &&
      (!Array.isArray(body.observations) ||
        body.observations.length > 3 ||
        body.observations.some((value) => typeof value !== "string" || value.length > 1000))) ||
    response?.valid !== true ||
    response.outcome !== "recorded" ||
    response.attempt?.checkpointId !== body.checkpointId ||
    response.attempt?.applicationId !== body.applicationId
  )
    return null;
  return {
    handback: { ...body },
    workerCheck: {
      valid: true,
      outcome: "recorded",
      attempt: {
        checkpointId: response.attempt.checkpointId,
        applicationId: response.attempt.applicationId,
      },
    },
  };
}

export async function startEvidenceObserver({
  apiUrl,
  terminalToken,
  workItemId,
  jobPath,
  onHandback,
}) {
  const upstream = requireLoopback(apiUrl).origin;
  let lease;
  let failure;
  let captured;
  let execution;
  const server = createServer(async (request, response) => {
    try {
      if (
        !request.url?.startsWith("/api/") ||
        request.headers.authorization !== `Bearer ${terminalToken}`
      )
        throw new Error("Only this synthetic terminal session may use its observer.");
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8_000_000) throw new Error("Observer request exceeds its bound.");
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (value && !["host", "connection", "content-length", "transfer-encoding"].includes(key))
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const result = await fetch(upstream + request.url, {
        method: request.method,
        headers,
        body: input.length ? input : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(130_000),
      });
      const reader = result.body?.getReader();
      const output = [];
      let bytes = 0;
      if (reader)
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.length;
          if (bytes > 8_000_000) {
            await reader.cancel();
            throw new Error("Observer response exceeds its bound.");
          }
          output.push(next.value);
        }
      const data = Buffer.concat(output);
      if (request.method === "POST" && request.url === "/api/work-queue/claim" && result.ok) {
        const claim = JSON.parse(data).claim;
        if (claim?.item?.id === workItemId && uuid.test(claim.leaseToken ?? "")) {
          lease = claim.leaseToken;
          if (
            !uuid.test(claim.ownership?.executionId ?? "") ||
            !uuid.test(claim.ownership?.browserSessionId ?? "")
          )
            throw new Error("The actual queue claim is missing execution ownership.");
          const observed = {
            workItemId,
            executionId: claim.ownership.executionId,
            browserSessionId: claim.ownership.browserSessionId,
          };
          if (execution && JSON.stringify(execution) !== JSON.stringify(observed))
            throw new Error("A different execution was claimed for the same fixture.");
          execution = observed;
        }
      }
      if (
        request.method === "POST" &&
        request.url === `${jobPath}/worker-result-check` &&
        result.ok &&
        request.headers["x-openapply-work-item"] === workItemId &&
        lease &&
        request.headers["x-openapply-work-lease"] === lease
      ) {
        const observed = recordedHandback(JSON.parse(input), JSON.parse(data));
        if (observed) {
          if (captured && JSON.stringify(captured) !== JSON.stringify(observed))
            throw new Error("Conflicting actual worker handbacks were observed.");
          captured = observed;
          await onHandback(observed);
        }
      }
      for (const [key, value] of result.headers)
        if (
          !["connection", "content-length", "content-encoding", "transfer-encoding"].includes(key)
        )
          response.setHeader(key, value);
      response.writeHead(result.status);
      response.end(data);
    } catch {
      failure = "The private queue evidence observer failed; no model retry is permitted.";
      response.writeHead(502);
      response.end("Synthetic evidence transport failed.");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    assertHealthy() {
      if (failure) throw new Error(failure);
    },
    result: () => captured,
    execution: () => execution && { ...execution },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
