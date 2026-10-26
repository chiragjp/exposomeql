import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { ExposomeQLConfig } from "../config.js";
import type { RResult } from "../types.js";
import { RPool } from "./r-pool.js";
import { makeReproCall, withReproCall } from "../repro-call.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SCRIPTS_DIR = path.join(__dirname, "..", "..", "src", "r-bridge", "r-scripts");
const POOL_WORKER_PATH = path.join(R_SCRIPTS_DIR, "_pool_worker.R");

/** Maximum buffer size (50 MB) to prevent memory exhaustion from runaway R processes */
const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

/** Time to wait after SIGTERM before escalating to SIGKILL (ms) */
const SIGKILL_DELAY = 5_000;

function poolEnabled(): boolean {
  // Default ON: every R script has been migrated from on.exit(disconnect…) to
  // tryCatch(finally = …) for pool compatibility. Opt out with EXPOSOMEQL_R_POOL=0.
  return process.env.EXPOSOMEQL_R_POOL !== "0";
}

function poolSize(): number {
  const n = Number(process.env.EXPOSOMEQL_R_POOL_SIZE ?? "2");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

export class RExecutor {
  private rscriptPath: string;
  private nhanesDbPath: string;
  private nhanespewasPath: string;
  private timeoutMs: number;
  private pool: RPool | null = null;
  /** Data roots rewritten to env-var placeholders in `repro_call` params. */
  private dataRoots: Record<string, string | undefined>;

  constructor(config: ExposomeQLConfig, timeoutMs = 60_000) {
    this.rscriptPath = config.rscriptPath;
    this.nhanesDbPath = config.nhanesDbPath;
    this.nhanespewasPath = config.nhanespewasPath;
    this.timeoutMs = timeoutMs;
    this.dataRoots = { HHEAR_DATA_DIR: config.hhearDataDir, EXPOSOMEQL_DATA_DIR: config.dataDir };

    if (poolEnabled()) {
      const size = poolSize();
      console.error(`[r-executor] starting R worker pool (size=${size})`);
      this.pool = new RPool({
        rscriptPath: this.rscriptPath,
        workerScriptPath: POOL_WORKER_PATH,
        size,
        baseEnv: {
          EXPOSOMEQL_DB_PATH: this.nhanesDbPath,
          NHANESPEWAS_PATH: this.nhanespewasPath,
        },
        defaultTimeoutMs: this.timeoutMs,
      });
    }
  }

  /**
   * Check that Rscript and required R packages are available. Non-blocking:
   * logs a warning to stderr if anything is missing but never throws.
   * Returns the list of missing packages (empty array if all good; `null` if
   * Rscript itself couldn't be spawned).
   */
  async checkRDependencies(): Promise<string[] | null> {
    const required = [
      "survey", "dplyr", "tidyr", "purrr", "broom", "jsonlite",
      "DBI", "RSQLite", "nhanespewas",
    ];
    const rExpr = `missing <- c(${required.map((p) => `"${p}"`).join(", ")})[!vapply(c(${required
      .map((p) => `"${p}"`)
      .join(", ")}), requireNamespace, logical(1), quietly = TRUE)]; cat(paste(missing, collapse = ","))`;

    return new Promise((resolve) => {
      const child = spawn(this.rscriptPath, ["-e", rExpr], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        if (code !== 0) return resolve(null);
        const missing = out.trim() ? out.trim().split(",") : [];
        resolve(missing);
      });
    });
  }

  async execute(
    scriptName: string,
    params: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<RResult> {
    const scriptPath = path.join(R_SCRIPTS_DIR, scriptName);
    const result = await this.executeRaw(scriptName, scriptPath, params, timeoutMs);
    return withReproCall(result, makeReproCall("r", scriptPath, params, this.dataRoots));
  }

  private async executeRaw(
    scriptName: string,
    scriptPath: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<RResult> {
    if (this.pool) {
      try {
        const stdout = await this.pool.call(scriptPath, params, {}, timeoutMs);
        return parseRJsonOutput(stdout, scriptName);
      } catch (err) {
        // Pool failure (worker crash, timeout, bad JSON) — fall through to per-call spawn
        // so a flaky worker doesn't take a single tool call down with it.
        console.error(`[r-executor] pool call ${scriptName} failed, falling back to subprocess: ${(err as Error).message}`);
      }
    }
    return this.executeOneShot(scriptName, scriptPath, params, timeoutMs);
  }

  private executeOneShot(
    scriptName: string,
    scriptPath: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<RResult> {
    const timeout = timeoutMs ?? this.timeoutMs;

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (fn: typeof resolve | typeof reject, value: unknown) => {
        if (settled) return;
        settled = true;
        (fn as (v: unknown) => void)(value);
      };

      const child = spawn(this.rscriptPath, [scriptPath], {
        env: {
          ...process.env,
          EXPOSOMEQL_DB_PATH: this.nhanesDbPath,
          NHANESPEWAS_PATH: this.nhanespewasPath,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let bufferOverflow = false;

      child.stdout.on("data", (data: Buffer) => {
        if (bufferOverflow) return;
        stdout += data.toString();
        if (stdout.length > MAX_BUFFER_SIZE) {
          bufferOverflow = true;
          stdout = stdout.slice(0, MAX_BUFFER_SIZE);
          child.kill("SIGTERM");
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        if (stderr.length < MAX_BUFFER_SIZE) {
          stderr += data.toString();
          if (stderr.length > MAX_BUFFER_SIZE) {
            stderr = stderr.slice(0, MAX_BUFFER_SIZE);
          }
        }
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        const killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, SIGKILL_DELAY);
        child.on("close", () => clearTimeout(killTimer));
        settle(reject, new Error(`R script ${scriptName} timed out after ${timeout}ms`));
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);

        if (bufferOverflow) {
          settle(reject, new Error(`R script ${scriptName} exceeded ${MAX_BUFFER_SIZE / 1024 / 1024}MB output buffer limit`));
          return;
        }

        if (code !== 0) {
          let scriptError: string | null = null;
          const jStart = stdout.indexOf("{");
          const jEnd = stdout.lastIndexOf("}");
          if (jStart !== -1 && jEnd > jStart) {
            try {
              const parsed = JSON.parse(stdout.slice(jStart, jEnd + 1)) as { error?: unknown };
              if (parsed && typeof parsed.error === "string") {
                scriptError = parsed.error;
              }
            } catch { /* fall through to stderr */ }
          }
          settle(
            reject,
            new Error(
              scriptError
                ? `R script ${scriptName} error: ${scriptError}`
                : `R script ${scriptName} exited with code ${code}\nstderr: ${stderr}`
            )
          );
          return;
        }

        try {
          const parsed = parseRJsonOutput(stdout, scriptName);
          settle(resolve, parsed);
        } catch (e) {
          settle(
            reject,
            new Error(`Failed to parse R JSON output: ${(e as Error).message}\nstdout: ${stdout}\nstderr: ${stderr}`)
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        settle(reject, new Error(`Failed to spawn Rscript: ${err.message}`));
      });

      child.stdin.write(JSON.stringify(params));
      child.stdin.end();
    });
  }
}

/** Extract the script's JSON payload from raw stdout (R may emit startup noise first).
 *
 *  If the R script's tryCatch emitted `{"error":"..."}` (e.g., a filter referenced
 *  a column not in the merged table), surface it as a thrown Error so each tool's
 *  catch block reports the real cause instead of silently dropping undefined fields
 *  into the response. The pool worker intercepts `quit()`, so these errors otherwise
 *  arrive as "successful" stdout and get destructured into nothing. */
function parseRJsonOutput(stdout: string, scriptName: string): RResult {
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  let parsed: RResult | null = null;
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as RResult;
  } else {
    const arrStart = stdout.indexOf("[");
    const arrEnd = stdout.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd > arrStart) {
      parsed = JSON.parse(stdout.slice(arrStart, arrEnd + 1)) as RResult;
    }
  }
  if (!parsed) {
    throw new Error(`No JSON in R output from ${scriptName}.\nstdout: ${stdout}`);
  }
  const errField = (parsed as { error?: unknown }).error;
  if (typeof errField === "string" && errField.length > 0) {
    throw new Error(errField);
  }
  return parsed;
}
