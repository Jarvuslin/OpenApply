import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fixture, runHelper } from "./api-test-helpers.mjs";

const campaignId = "11111111-1111-4111-8111-111111111111";
const checkpointId = "22222222-2222-4222-8222-222222222222";
const receiptPath = `/api/campaigns/${campaignId}/jobs/job-%2F..%2Fkey/submission-receipt`;
const receipt = {
  checkpointId,
  confirmation: {
    url: "https://person:private@employer.test/thanks?job=123&token=private&auth_code=private#private",
    text: "  Your application was received.  ",
    observedAt: "2026-10-06T19:00:00.000Z",
    reference: " A123 ",
  },
};

async function retainedFiles(directory) {
  const root = join(directory, ".openapply", "submission-recovery");
  try {
    const names = await readdir(root, { recursive: true });
    return names.filter((name) => name.endsWith(".json")).map((name) => join(root, name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function privateHome(directory) {
  return { HOME: directory, USERPROFILE: directory };
}

test("retains normalized receipt bytes before HTTP failure and does not expose secrets", async (t) => {
  const { directory, requests, reply, base } = await fixture(t);
  reply.status = 500;
  let retainedAtRequest;
  reply.beforeResponse = async () => {
    const files = await retainedFiles(directory);
    assert.equal(files.length, 1);
    retainedAtRequest = await readFile(files[0], "utf8");
    assert.equal(retainedAtRequest, requests[0].bytes.toString());
  };
  const result = await runHelper(
    base,
    ["POST", receiptPath, "--data", JSON.stringify(receipt)],
    privateHome(directory),
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /submission recovery saved:/);
  assert.match(result.stderr, /HTTP 500/);
  assert.doesNotMatch(result.stdout + result.stderr, /private|test-token|Your application/);
  assert.deepEqual(JSON.parse(retainedAtRequest), {
    checkpointId,
    confirmation: {
      url: "https://employer.test/thanks?job=123",
      text: "Your application was received.",
      observedAt: receipt.confirmation.observedAt,
      reference: "A123",
    },
  });
  const [file] = await retainedFiles(directory);
  assert.match(file, new RegExp(`${checkpointId}\\.json$`));
  assert.ok(!file.includes("job-/../key"));
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("retains the receipt across network failure", async (t) => {
  const { directory, reply, base } = await fixture(t);
  reply.disconnect = true;
  const result = await runHelper(
    base,
    ["POST", receiptPath, "--data", JSON.stringify(receipt)],
    privateHome(directory),
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /submission recovery saved:/);
  assert.equal((await retainedFiles(directory)).length, 1);
});

test("refuses a receipt request when local storage cannot retain it", async (t) => {
  const { directory, requests, base } = await fixture(t);
  await writeFile(join(directory, ".openapply"), "not a directory");
  const result = await runHelper(
    base,
    ["POST", receiptPath, "--data", JSON.stringify(receipt)],
    privateHome(directory),
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no request was sent/);
  assert.equal(requests.length, 0);
});

test("rejects malformed receipt shapes before spooling or HTTP", async (t) => {
  const { directory, requests, base } = await fixture(t);
  for (const body of [
    '{"private":',
    "{}",
    JSON.stringify({ ...receipt, password: "private" }),
    JSON.stringify({ ...receipt, checkpointId: "../private" }),
    JSON.stringify({ ...receipt, confirmation: { ...receipt.confirmation, token: "private" } }),
    JSON.stringify({
      ...receipt,
      confirmation: { ...receipt.confirmation, text: "x".repeat(10001) },
    }),
    JSON.stringify({
      ...receipt,
      confirmation: { ...receipt.confirmation, observedAt: "2026-02-30T19:00:00.000Z" },
    }),
  ]) {
    const result = await runHelper(
      base,
      ["POST", receiptPath, "--data", body],
      privateHome(directory),
    );
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /private|test-token/);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(await retainedFiles(directory), []);
});

test("replays identical receipt bytes but cannot replace prior evidence", async (t) => {
  const { directory, requests, base } = await fixture(t);
  for (const origin of [base, `${base}/`]) {
    const result = await runHelper(
      origin,
      ["POST", receiptPath, "--data", JSON.stringify(receipt)],
      privateHome(directory),
    );
    assert.equal(result.code, 0, result.stderr);
  }
  const changed = {
    ...receipt,
    confirmation: { ...receipt.confirmation, text: "A different receipt" },
  };
  const result = await runHelper(
    base,
    ["POST", receiptPath, "--data", JSON.stringify(changed)],
    privateHome(directory),
  );
  assert.equal(result.code, 1);
  assert.equal(requests.length, 2);
  assert.equal((await retainedFiles(directory)).length, 1);
  const original = JSON.parse(await readFile((await retainedFiles(directory))[0], "utf8"));
  assert.equal(original.confirmation.text, "Your application was received.");
});

test("lists recovery paths only after a successful owned attempt lookup", async (t) => {
  const { directory, requests, reply, base } = await fixture(t);
  await runHelper(
    base,
    ["POST", receiptPath, "--data", JSON.stringify(receipt)],
    privateHome(directory),
  );
  const path = receiptPath.replace("submission-receipt", "submission-attempt");
  reply.status = 403;
  const denied = await runHelper(base, ["GET", path], privateHome(directory));
  assert.equal(denied.code, 1);
  assert.doesNotMatch(denied.stderr, /submission recovery available/);
  reply.status = 200;
  const allowed = await runHelper(base, ["GET", path], privateHome(directory));
  assert.equal(allowed.code, 0);
  assert.match(allowed.stderr, /submission recovery available:/);
  assert.doesNotMatch(allowed.stderr, /Your application|test-token/);
  assert.equal(requests.length, 3);
});

test("concurrent identical receipts share one immutable recovery file", async (t) => {
  const { directory, requests, base } = await fixture(t);
  const results = await Promise.all(
    [1, 2].map(() =>
      runHelper(
        base,
        ["POST", receiptPath, "--data", JSON.stringify(receipt)],
        privateHome(directory),
      ),
    ),
  );
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.equal((await retainedFiles(directory)).length, 1);
  assert.deepEqual(requests[0].bytes, requests[1].bytes);
});

test("receipt URL query and encoded endpoint cannot bypass retention", async (t) => {
  const { directory, requests, base } = await fixture(t);
  const path = `${receiptPath.replace("submission-receipt", "%73ubmission-receipt")}?trial=1`;
  const result = await runHelper(
    base,
    ["POST", path, "--data", JSON.stringify(receipt)],
    privateHome(directory),
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  const [file] = await retainedFiles(directory);
  assert.equal(await readFile(file, "utf8"), requests[0].bytes.toString());
});
