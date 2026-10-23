import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

test("the unit preload replaces inherited and dotenv secrets and rejects driver/Prisma access before sockets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openapply-test-isolation-"));
  const preload = fileURLToPath(new URL("./test-env.ts", import.meta.url));
  const pgModule = import.meta.resolve("pg");
  const envModule = new URL("../src/env.ts", import.meta.url).href;
  const clientModule = new URL("../src/common/database/prisma.client.ts", import.meta.url).href;
  try {
    await writeFile(
      path.join(directory, ".env"),
      "DATABASE_URL=postgresql://dotenv-secret@user-db.example.test/private\nJWT_SECRET=dotenv-secret\n",
    );
    await writeFile(
      path.join(directory, "isolation.test.ts"),
      `
      import {expect,test} from 'bun:test';
      import net from 'node:net';
      import pg from ${JSON.stringify(pgModule)};
      import {env} from ${JSON.stringify(envModule)};
      import {db} from ${JSON.stringify(clientModule)};
      test('dummy settings and no database sockets', async()=>{
        expect(env.DATABASE_URL).toBe('postgresql://unit:unit@127.0.0.1:1/openapply_unit_tests_forbidden');
        expect(env.JWT_SECRET).toBe('openapply-unit-test-secret-never-used-outside-tests');
        expect(env.NODE_ENV).toBe('test');
        expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
        expect(env.TELEGRAM_DELIVERY_ENABLED).toBe(false);
        expect(env.RESEND_API_KEY).toBeUndefined();
        expect(process.env.OPENAPPLY_MODEL_BUDGET).toBe('0');
        expect(process.env.OPENAPPLY_QUEUE_MODEL_APPROVAL).toBe('');
        expect(process.env.OPENAPPLY_PREPARATION_MODEL_APPROVAL).toBe('');
        let sockets=0;
        const connect=net.Socket.prototype.connect;
        net.Socket.prototype.connect=function(){sockets++;throw Error('Unexpected database socket');};
        try {
          for (const driver of [new pg.Client(),new pg.Pool()]) {
            expect(()=>driver.connect()).toThrow('Unit tests cannot access PostgreSQL');
            expect(()=>driver.query('SELECT 1')).toThrow('Unit tests cannot access PostgreSQL');
          }
          await expect(Promise.resolve(db.$queryRawUnsafe('SELECT 1'))).rejects.toThrow('Unit tests cannot access PostgreSQL');
          expect(sockets).toBe(0);
        } finally {net.Socket.prototype.connect=connect;await db.$disconnect();}
      });
    `,
    );
    for (const inherited of [true, false]) {
      const childEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: "postgresql://inherited-secret@user-db.example.test/private",
        JWT_SECRET: "inherited-secret",
        TELEGRAM_BOT_TOKEN: "inherited-secret",
        TELEGRAM_DELIVERY_ENABLED: "true",
        RESEND_API_KEY: "inherited-secret",
        OPENAPPLY_MODEL_BUDGET: "99",
        OPENAPPLY_QUEUE_MODEL_APPROVAL: "inherited-secret",
        OPENAPPLY_PREPARATION_MODEL_APPROVAL: "inherited-secret",
      };
      if (!inherited) {
        delete childEnvironment.DATABASE_URL;
        delete childEnvironment.JWT_SECRET;
      }
      const result = spawnSync(
        process.execPath,
        ["test", "--preload", preload, "isolation.test.ts"],
        {
          cwd: directory,
          env: childEnvironment,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 65_536,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain("inherited-secret");
      expect(`${result.stdout}${result.stderr}`).not.toContain("dotenv-secret");
    }
  } finally {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory).startsWith("openapply-test-isolation-")).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
