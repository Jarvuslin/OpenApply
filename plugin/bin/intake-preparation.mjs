import { randomUUID } from "node:crypto";
import { workerControl } from "./worker-control.mjs";

export async function intakePreparation(
  action,
  input,
  environment = process.env,
  fetcher = fetch,
  control = workerControl,
) {
  const {
    OPENAPPLY_API: base,
    OPENAPPLY_API_TOKEN: token,
    OPENAPPLY_WORK_ITEM_ID: workItemId,
    OPENAPPLY_WORK_LEASE_TOKEN: lease,
    OPENAPPLY_PREPARATION_SNAPSHOT: snapshotHash,
  } = environment;
  if (
    !["context", "collect", "record-fit"].includes(action) ||
    !/^[a-f0-9-]{36}$/.test(workItemId ?? "") ||
    !/^[a-f0-9-]{36}$/.test(lease ?? "") ||
    token !== `prep.${workItemId}.${lease}` ||
    !/^[a-f0-9]{64}$/.test(snapshotHash ?? "")
  )
    throw new Error("An exact preparation capability is required.");
  const api = new URL(base);
  if (
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    !["", "/"].includes(api.pathname) ||
    (api.protocol !== "https:" &&
      !(api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)))
  )
    throw new Error("Invalid preparation API.");
  const request = async (path, body) => {
    const response = await fetcher(`${api.origin}/api/intake-preparation/${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error("Preparation capability operation refused. No automatic retry.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing preparation response.");
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 2000000) throw new Error("Preparation response exceeded its bound.");
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const context = await request("context");
  if (
    context.snapshot?.workItemId !== workItemId ||
    context.snapshot?.snapshotHash !== snapshotHash ||
    context.snapshot?.purpose !== "intake_prepare"
  )
    throw new Error("Preparation snapshot changed.");
  const summary = (value) => ({
    snapshot: value.snapshot,
    fit: value.fit ?? null,
    questions: {
      collectionVersion: value.questions.collectionVersion,
      coverage: value.questions.latestCollection?.coverage ?? null,
      count: value.questions.questions?.length ?? 0,
    },
  });
  if (action === "context") return summary(context);
  if (action === "record-fit") {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      JSON.stringify(input).length > 200000
    )
      throw new Error("Bounded fit judgments are required.");
    return request("fit", input);
  }
  const observed = await control("inspect", environment, fetcher);
  if (
    observed.submissionAllowed !== false ||
    !Array.isArray(observed.definitions) ||
    observed.definitions.length > 200
  )
    throw new Error("Invalid read-only observation.");
  let postingSaved = false;
  if (
    typeof observed.description === "string" &&
    observed.description.trim().length >= 200 &&
    observed.description.length <= 100000 &&
    !observed.truncated
  ) {
    await request("posting", { description: observed.description });
    postingSaved = true;
  }
  await request("questions", {
    requestId: randomUUID(),
    expectedCollectionVersion: context.questions.collectionVersion,
    source: "browser_dom",
    sourceUrl: observed.sourceUrl,
    coverage: observed.coverage,
    collectorVersion: "owned-intake-dom-v1",
    reason: observed.reason ?? undefined,
    definitions: observed.definitions,
  });
  return {
    postingSaved,
    coverage: observed.coverage,
    reason: observed.reason,
    submissionAllowed: false,
    context: summary(await request("context")),
  };
}
