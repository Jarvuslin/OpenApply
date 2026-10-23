import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError, unprocessable } from "@/common/errors";
import { compilerDiagnostics } from "./compiler-diagnostics";

const execute = promisify(execFile);
let compiling = 0;

export interface LatexCompilerOptions {
  executable?: string;
  cacheDir?: string;
  bundle?: string;
  onlyCached?: boolean;
  timeoutMs?: number;
}

async function configuredOptions(): Promise<LatexCompilerOptions> {
  const { env } = await import("@/env");
  return {
    executable: env.OPENAPPLY_TECTONIC_PATH,
    cacheDir: env.TECTONIC_CACHE_DIR,
    bundle: env.OPENAPPLY_TECTONIC_BUNDLE,
    onlyCached: env.OPENAPPLY_TECTONIC_ONLY_CACHED,
    timeoutMs: env.OPENAPPLY_TECTONIC_TIMEOUT_MS,
  };
}

export async function compileResumeTex(
  tex: string,
  configured?: LatexCompilerOptions,
): Promise<{ pdf: Buffer; version: string; warnings: string[] }> {
  const options = configured ?? (await configuredOptions());
  const executable = options.executable || Bun.which("tectonic");
  if (!executable || !path.isAbsolute(executable))
    throw new HttpError(
      "RESUME_COMPILER_UNAVAILABLE",
      "Configure an existing Tectonic executable before generating a resume.",
      503,
    );
  if (
    !(await stat(executable)
      .then((file) => file.isFile())
      .catch(() => false))
  )
    throw new HttpError(
      "RESUME_COMPILER_UNAVAILABLE",
      "Configured Tectonic executable is unavailable.",
      503,
    );
  const timeout = Math.max(1000, Math.min(options.timeoutMs ?? 90_000, 90_000));
  const environment = {
    ...process.env,
    TECTONIC_UNTRUSTED_MODE: "1",
    SOURCE_DATE_EPOCH: "0",
    ...(options.cacheDir ? { TECTONIC_CACHE_DIR: options.cacheDir } : {}),
  };
  if (compiling >= 2)
    throw new HttpError("RESUME_COMPILER_BUSY", "Resume compiler is busy; retry shortly.", 503);
  compiling++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "openapply-resume-"));
    const version = await execute(executable, ["--version"], {
      timeout: 5000,
      maxBuffer: 8192,
      windowsHide: true,
      env: environment,
    });
    if (!/^Tectonic\s+\S+/i.test(version.stdout.trim()))
      throw new HttpError(
        "RESUME_COMPILER_UNAVAILABLE",
        "Configured executable is not Tectonic.",
        503,
      );
    await writeFile(path.join(directory, "resume.tex"), tex, "utf8");
    const args = ["--untrusted", "--keep-logs", "--outfmt", "pdf", "--outdir", directory];
    if (options.onlyCached) args.push("--only-cached");
    if (options.bundle) args.push("--bundle", options.bundle);
    args.push("resume.tex");
    try {
      await execute(executable, args, {
        cwd: directory,
        timeout,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: environment,
      });
    } catch (error) {
      const timedOut = error instanceof Error && "killed" in error && error.killed;
      const log = await readFile(path.join(directory, "resume.log"), "utf8").catch(() => "");
      const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
      throw unprocessable(
        timedOut
          ? "Resume compilation exceeded its time limit. No artifact was accepted."
          : "Resume compilation failed. Check compiler resources and supported characters; no alternate template was used.",
        { issues: compilerDiagnostics(`${stderr}\n${log}`), timedOut: Boolean(timedOut) },
      );
    }
    const log = await readFile(path.join(directory, "resume.log"), "utf8").catch(() => "");
    const issues = compilerDiagnostics(log);
    if (issues.length)
      throw unprocessable(
        "Resume compilation reported overflowing text or missing fonts/characters; no artifact was accepted.",
        { issues },
      );
    const warnings = log
      .split(/\r?\n/)
      .filter((line) => /Warning:/.test(line))
      .map((line) => line.trim());
    const pdf = await readFile(path.join(directory, "resume.pdf"));
    if (pdf.length > 5 * 1024 * 1024 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw unprocessable("Resume compiler returned an invalid PDF.");
    return { pdf, version: version.stdout.trim(), warnings };
  } finally {
    compiling--;
    if (
      directory &&
      path.dirname(directory) === path.resolve(tmpdir()) &&
      path.basename(directory).startsWith("openapply-resume-")
    )
      await rm(directory, { recursive: true, force: true });
  }
}
