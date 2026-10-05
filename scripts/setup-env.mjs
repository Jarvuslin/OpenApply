import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function setupEnv(root) {
  const apiTemplate = await readFile(path.join(root, "apps/api/.env.example"), "utf8");
  const api =
    apiTemplate
      .replace("JWT_SECRET=dev-insecure-change-me", `JWT_SECRET=${randomBytes(32).toString("hex")}`)
      .replace(/^SECRET_MASTER_KEY=.*$/m, `SECRET_MASTER_KEY=${randomBytes(32).toString("base64")}`)
      .replace(
        "postgresql://jobpilot:jobpilot@localhost:5433/jobpilot",
        "postgresql://postgres@127.0.0.1:5433/jobpilot",
      )
      .replace(/^[A-Z_]+=\r?$/gm, "") + "\nMVP_LOCAL_RUNNER=true\nCLAUDE_BIN=claude\n";
  const web = await readFile(path.join(root, "apps/web/.env.example"), "utf8");
  for (const [name, body] of [
    ["apps/api/.env", api],
    ["apps/web/.env.local", web],
  ]) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, body, { flag: "wx", mode: 0o600 });
      console.log(`Created ${name}`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log(`Kept existing ${name}`);
    }
  }
}
