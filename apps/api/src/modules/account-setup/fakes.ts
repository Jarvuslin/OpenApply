import {
  type EnqueueAccountSetup,
  enqueueAccountSetupSchema,
} from "@openapply/contracts/account-setup";
import type { CryptoService } from "@/common/crypto";
import { prismaFixture } from "@/common/testing/prisma-fakes";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { WorkQueueReadService } from "@/modules/work-queue/work-queue.read";
import { AccountSetupService } from "./account-setup.service";

export function accountFixture() {
  const f = prismaFixture();
  const userId = crypto.randomUUID();
  const credential = {
    id: crypto.randomUUID(),
    userId,
    email: "applicant@example.com",
    scope: "default",
    password: "encrypted.synthetic.secret",
  };
  const reads: { id: string; userId: string }[] = [];
  const credentials = [credential];
  Object.assign(f.db, {
    credential: {
      findFirst: async ({ where }: { where: { id?: string; userId: string; scope?: string } }) => {
        if (where.id) reads.push({ id: where.id, userId: where.userId });
        return (
          credentials.find(
            (row) =>
              (!where.id || row.id === where.id) &&
              row.userId === where.userId &&
              (!where.scope || row.scope === where.scope),
          ) ?? null
        );
      },
      findUnique: async ({
        where,
      }: {
        where: { userId_scope: { userId: string; scope: string } };
      }) =>
        credentials.find(
          (row) =>
            row.userId === where.userId_scope.userId && row.scope === where.userId_scope.scope,
        ) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        credentials
          .filter((row) => row.userId === where.userId)
          .map(({ id, scope, email }) => ({ id, scope, email })),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_scope: { userId: string; scope: string } };
        create: typeof credential;
        update: Partial<typeof credential>;
      }) => {
        const row = credentials.find(
          (row) =>
            row.userId === where.userId_scope.userId && row.scope === where.userId_scope.scope,
        );
        if (row) {
          Object.assign(row, update);
          return { ...row };
        }
        const created = { ...create, id: crypto.randomUUID() };
        credentials.push(created);
        return { ...created };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<typeof credential>;
      }) => {
        const row = credentials.find((row) => row.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
  });
  const transaction = f.db.$transaction.bind(f.db);
  Object.assign(f.db, {
    $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      transaction(async (tx) => {
        const before = credentials.map((row) => ({ row, value: { ...row } }));
        try {
          return await work(tx);
        } catch (error) {
          for (const { row, value } of before) Object.assign(row, value);
          credentials.splice(0, credentials.length, ...before.map(({ row }) => row));
          throw error;
        }
      }),
  });
  const secrets = { reads: 0, afterRead: null as (() => void) | null };
  const cryptoService = {
    encryptFor: async () => "encrypted.correct.existing-password",
    decryptFor: async (owner: string, _context: string, value: string) => {
      if (owner !== userId || !credentials.some((row) => row.password === value))
        throw new Error("Wrong credential");
      secrets.reads++;
      secrets.afterRead?.();
      return "synthetic-password-never-in-context";
    },
  } as unknown as CryptoService;
  const service = new AccountSetupService(f.db, cryptoService);
  const input: EnqueueAccountSetup = enqueueAccountSetupSchema.parse({
    idempotencyKey: crypto.randomUUID(),
    signupUrl: "https://careers.example.com/signup",
    tenantOrigin: "https://careers.example.com",
    credentialId: credential.id,
    email: credential.email,
  });
  f.queuePolicies.push({
    userId,
    revision: 1,
    maxConcurrentWorkers: 1,
    dailyApplicationCap: 10,
    companyApplicationCap: 3,
    companyWindowDays: 7,
    domainDelaySeconds: 30,
    updatedAt: new Date(),
  });
  const enqueue = () => service.enqueue(userId, input, "session_user");
  const claimInput = (workItemId: string, snapshotHash?: string) => ({
    workItemId,
    accountSnapshotHash: snapshotHash,
    requestId: crypto.randomUUID(),
    runtimeId: crypto.randomUUID(),
    workerId: crypto.randomUUID(),
    capabilities: { isolatedBrowser: true as const, accountSetup: true as const },
  });
  const start = async () => {
    const result = await enqueue();
    const claim = (
      await f.queueClaims.claim(userId, claimInput(result.item.id, result.snapshot.snapshotHash))
    ).claim!;
    return { ...result, claim, authorization: `Bearer ${claim.execution.accountSetup!.apiToken}` };
  };
  return {
    ...f,
    userId,
    credential,
    credentials,
    reads,
    secrets,
    service,
    input,
    enqueue,
    start,
    claimInput,
    item: () => f.workItems[0] as unknown as WorkItem,
    reader: new WorkQueueReadService(f.db, {} as ScoringService),
  };
}
