import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { ExposomeQLConfig } from "../config.js";
import type { RResult } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SCRIPTS_DIR = path.join(__dirname, "..", "..", "src", "r-bridge", "r-scripts");

/** Maximum buffer size (50 MB) to prevent memory exhaustion from runaway R processes */
const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

/** Time to wait after SIGTERM before escalating to SIGKILL (ms) */
const SIGKILL_DELAY = 5_000;

export class RExecutor {
  private rscriptPath: string;
  private nhanesDbPath: string;
  private nhanespewasPath: string;
  private timeoutMs: number;

  constructor(config: ExposomeQLConfig, timeoutMs = 60_000) {
    this.rscriptPath = config.rscriptPath;
    this.nhanesDbPath = config.nhanesDbPath;
    this.nhanespewasPath = config.nhanespewasPath;
    this.timeoutMs = timeoutMs;
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
        // Escalate to SIGKILL if process doesn't exit after SIGTERM
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
          settle(
            reject,
            new Error(
              `R script ${scriptName} exited with code ${code}\nstderr: ${stderr}`
            )
          );
          return;
        }

        try {
          // Find the JSON output — R scripts write JSON to stdout
          // There may be R startup messages before it
          const jsonStart = stdout.indexOf("{");
          const jsonEnd = stdout.lastIndexOf("}");
          if (jsonStart === -1 || jsonEnd === -1) {
            // Try array
            const arrStart = stdout.indexOf("[");
            const arrEnd = stdout.lastIndexOf("]");
            if (arrStart === -1 || arrEnd === -1) {
              settle(
                reject,
                new Error(
                  `No JSON in R output.\nstdout: ${stdout}\nstderr: ${stderr}`
                )
              );
              return;
            }
            settle(resolve, JSON.parse(stdout.slice(arrStart, arrEnd + 1)) as RResult);
            return;
          }
          settle(resolve, JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as RResult);
        } catch (e) {
          settle(
            reject,
            new Error(
              `Failed to parse R JSON output: ${(e as Error).message}\nstdout: ${stdout}\nstderr: ${stderr}`
            )
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        settle(reject, new Error(`Failed to spawn Rscript: ${err.message}`));
      });

      // Send params as JSON on stdin
      child.stdin.write(JSON.stringify(params));
      child.stdin.end();
    });
  }
}
