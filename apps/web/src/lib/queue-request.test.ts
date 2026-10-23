import { createQueueRequestStore, sendQueueRequest } from "./queue-request";
import { describe, expect, test } from "bun:test";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("queue admission recovery", () => {
  test("a lost acknowledgement reuses its durable ID after a reload", async () => {
    const saved = storage();
    const scope = ["enqueue", ["selected-job"]];
    const accepted: string[] = [];
    const id = crypto.randomUUID();
    await expect(
      sendQueueRequest(
        createQueueRequestStore(saved),
        "owner",
        scope,
        async (key) => {
          accepted.push(key);
          throw new Error("Acknowledgement lost");
        },
        () => id,
      ),
    ).rejects.toThrow("Acknowledgement lost");
    await sendQueueRequest(
      createQueueRequestStore(saved),
      "owner",
      scope,
      async (key) => {
        accepted.push(key);
        return { items: ["work-item"] };
      },
      () => {
        throw new Error("Must not generate a replacement ID");
      },
    );
    expect(accepted).toEqual([id, id]);
  });

  test("different accounts and exact selections never share an ambiguous request", async () => {
    const store = createQueueRequestStore(storage());
    const ids = new Set<string>();
    for (const [account, jobs] of [
      ["one", ["a"]],
      ["two", ["a"]],
      ["one", ["a", "b"]],
    ] as const) {
      await expect(
        sendQueueRequest(store, account, ["enqueue", jobs], async (id) => {
          ids.add(id);
          throw new Error("Offline");
        }),
      ).rejects.toThrow("Offline");
    }
    expect(ids.size).toBe(3);
  });

  test("confirmation finishes a request and rejects anonymous admission before sending", async () => {
    const store = createQueueRequestStore(storage());
    const ids: string[] = [];
    const send = async (id: string) => {
      ids.push(id);
      return "queued";
    };
    await sendQueueRequest(store, "owner", ["apply", "job"], send);
    await sendQueueRequest(store, "owner", ["apply", "job"], send);
    expect(new Set(ids).size).toBe(2);
    await expect(sendQueueRequest(store, "", [], send)).rejects.toThrow("Sign in");
    expect(ids).toHaveLength(2);
  });
});
