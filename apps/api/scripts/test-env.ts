import { tmpdir } from "node:os";
import { join } from "node:path";

// Only bun:test loads this preload. Disposable integration scripts run separately with bun run.
Object.assign(process.env, {
  NODE_ENV: "test",
  STORAGE_ROOT: join(tmpdir(), `openapply-unit-storage-${process.pid}`),
  DATABASE_URL: "postgresql://unit:unit@127.0.0.1:1/openapply_unit_tests_forbidden",
  JWT_SECRET: "openapply-unit-test-secret-never-used-outside-tests",
  SECRET_MASTER_KEY: "Y2ktdGVzdC1tYXN0ZXIta2V5LTMyLWJ5dGVzLWxvbmc=",
  JOB_FEED_REFRESH_ENABLED: "false",
  MVP_LOCAL_RUNNER: "false",
  CAPTCHA_SOLVER_ENABLED: "false",
  TELEGRAM_DELIVERY_ENABLED: "false",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_BOT_USERNAME: "",
  TELEGRAM_WEBHOOK_SECRET: "",
  RESEND_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "mailto:unit@example.test",
  OPENAPPLY_API_TOKEN: "",
  OPENAPPLY_MODEL_BUDGET: "0",
  OPENAPPLY_QUEUE_MODEL_APPROVAL: "",
  OPENAPPLY_PREPARATION_MODEL_APPROVAL: "",
  NODE_PG_FORCE_NATIVE: "",
});

const { default: pg } = await import("pg");
const denyDatabase = (): never => {
  throw new Error(
    "Unit tests cannot access PostgreSQL. Use an explicit disposable integration runner.",
  );
};
// Block both adapter pools and direct driver calls before any connection can open.
pg.Client.prototype.connect = denyDatabase;
pg.Client.prototype.query = denyDatabase;
pg.Pool.prototype.connect = denyDatabase;
pg.Pool.prototype.query = denyDatabase;
