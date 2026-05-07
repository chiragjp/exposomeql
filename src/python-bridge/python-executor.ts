import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { ExposomeQLConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_SCRIPTS_DIR = path.join(__dirname, "..", "..", "src", "python-bridge", "py-scripts");

/** Maximum buffer size (50 MB) */
const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

/** Time to wait after SIGTERM before escalating to SIGKILL (ms) */
const SIGKILL_DELAY = 5_000;

/** Extract JSON payload from raw stdout (Python may emit warnings/logs before JSON). */
function parseJsonOutput(stdout: string, scriptName: string): Record<string, unknown> {
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  }
  const arrStart = stdout.indexOf("[");
  const arrEnd = stdout.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    return JSON.parse(stdout.slice(arrStart, arrEnd + 1)) as Record<string, unknown>;
  }
  throw new Error(`No JSON in Python output from ${scriptName}.\nstdout: ${stdout}`);
}

function findPython(): string {
  // Prefer python3, fall back to python
  return process.env.PYTHON_PATH ?? "python3";
}

export class PythonExecutor {
  private pythonPath: string;
  private nhanesDbPath: string;
  private timeoutMs: number;

  constructor(config: ExposomeQLConfig, timeoutMs = 60_000) {
    this.pythonPath = findPython();
    this.nhanesDbPath = config.nhanesDbPath;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check that Python and required packages are available. Non-blocking:
   * logs a warning to stderr if anything is missing but never throws.
   */
  async checkPythonDependencies(): Promise<string[] | null> {
    const required = ["pandas", "numpy", "scipy", "statsmodels"];
    // Note: importlib.util is a submodule, so it has to be imported
    // explicitly — `__import__('importlib').util` only works after the
    // first `import importlib.util` somewhere in the process. Python 3.9
    // is the strictest about this; on 3.11+ it sometimes happens to work.
    const checkExpr = `import importlib.util, json; missing = [p for p in ${JSON.stringify(required)} if not importlib.util.find_spec(p)]; print(json.dumps(missing))`;

    return new Promise((resolve) => {
      const child = spawn(this.pythonPath, ["-c", checkExpr], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        if (code !== 0) return resolve(null);
        try {
          const missing = JSON.parse(out.trim()) as string[];
          resolve(missing);
        } catch {
          resolve(null);
        }
      });
    });
  }

  async execute(
    scriptName: string,
    params: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<Record<string, unknown>> {
    const scriptPath = path.join(PY_SCRIPTS_DIR, scriptName);
    const timeout = timeoutMs ?? this.timeoutMs;

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (fn: typeof resolve | typeof reject, value: unknown) => {
        if (settled) return;
        settled = true;
        (fn as (v: unknown) => void)(value);
      };

      const child = spawn(this.pythonPath, [scriptPath], {
        env: {
          ...process.env,
          EXPOSOMEQL_DB_PATH: this.nhanesDbPath,
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
        settle(reject, new Error(`Python script ${scriptName} timed out after ${timeout}ms`));
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);

        if (bufferOverflow) {
          settle(reject, new Error(`Python script ${scriptName} exceeded ${MAX_BUFFER_SIZE / 1024 / 1024}MB output buffer limit`));
          return;
        }

        if (code !== 0) {
          // Try to extract a structured error from stdout (same pattern as R)
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
                ? `Python script ${scriptName} error: ${scriptError}`
                : `Python script ${scriptName} exited with code ${code}\nstderr: ${stderr}`
            )
          );
          return;
        }

        try {
          const parsed = parseJsonOutput(stdout, scriptName);
          settle(resolve, parsed);
        } catch (e) {
          settle(
            reject,
            new Error(`Failed to parse Python JSON output: ${(e as Error).message}\nstdout: ${stdout}\nstderr: ${stderr}`)
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        settle(reject, new Error(`Failed to spawn Python: ${err.message}`));
      });

      // Send params as JSON on stdin
      child.stdin.write(JSON.stringify(params));
      child.stdin.end();
    });
  }
}
