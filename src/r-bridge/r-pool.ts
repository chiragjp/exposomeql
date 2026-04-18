import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";

/**
 * Persistent pool of pre-warmed Rscript workers running `_pool_worker.R`.
 *
 * Each worker boots once with all common packages (survey, nhanespewas, etc.)
 * loaded, then sits in a stdin command loop. Eliminates the ~1-2s per-call
 * Rscript startup + library loading overhead — a typical `nhanes_mean` call
 * drops from ~2-3s to ~200-400ms once the pool is warm.
 *
 * Wire protocol (line-delimited JSON over stdin/stdout, see _pool_worker.R):
 *   parent → worker:  one JSON object per line
 *   worker → parent:  __POOL_BEGIN__<id>\n{json}\n__POOL_END__\n
 */

const BEGIN_MARK = "__POOL_BEGIN__";
const END_MARK = "__POOL_END__";

interface PendingCall {
  cmd: {
    id: string;
    script: string;
    params: Record<string, unknown>;
    env: Record<string, string>;
  };
  timeoutMs: number;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

interface Worker {
  id: number;
  child: ChildProcess;
  ready: boolean;
  current: PendingCall | null;
  buffer: string;
  timeoutHandle: NodeJS.Timeout | null;
}

interface WorkerResponse {
  id: string;
  ok: boolean;
  result: string;
  error?: string | null;
}

export interface RPoolOptions {
  rscriptPath: string;
  workerScriptPath: string;
  size: number;
  baseEnv: Record<string, string>;
  defaultTimeoutMs: number;
}

export class RPool {
  private workers: Worker[] = [];
  private queue: PendingCall[] = [];
  private nextWorkerId = 0;
  private closing = false;

  constructor(private opts: RPoolOptions) {
    for (let i = 0; i < opts.size; i++) this.spawnWorker();
  }

  /** Submit a script for execution. Resolves with the script's captured stdout. */
  call(
    scriptPath: string,
    params: Record<string, unknown>,
    extraEnv: Record<string, string> = {},
    timeoutMs?: number,
  ): Promise<string> {
    if (this.closing) return Promise.reject(new Error("RPool is closing"));
    return new Promise<string>((resolve, reject) => {
      this.queue.push({
        cmd: {
          id: randomUUID(),
          script: scriptPath,
          params,
          env: { ...this.opts.baseEnv, ...extraEnv },
        },
        timeoutMs: timeoutMs ?? this.opts.defaultTimeoutMs,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  close(): void {
    this.closing = true;
    for (const w of this.workers) {
      try {
        w.child.stdin?.end();
      } catch {
        /* ignore */
      }
    }
    for (const c of this.queue.splice(0)) {
      c.reject(new Error("RPool closed before call dispatched"));
    }
  }

  private spawnWorker(): void {
    const id = this.nextWorkerId++;
    const child = spawn(this.opts.rscriptPath, [this.opts.workerScriptPath], {
      env: { ...process.env, ...this.opts.baseEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const w: Worker = { id, child, ready: false, current: null, buffer: "", timeoutHandle: null };

    child.stdout.on("data", (chunk: Buffer) => this.onWorkerData(w, chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      // R logs warnings to stderr; surface them to the MCP server stderr.
      const text = chunk.toString();
      if (text.trim()) console.error(`[r-pool worker ${id}] ${text.trimEnd()}`);
    });
    child.on("error", (err) => {
      console.error(`[r-pool worker ${id}] spawn error: ${err.message}`);
    });
    child.on("close", (code) => {
      console.error(`[r-pool worker ${id}] exited code=${code}`);
      this.cleanupWorker(w, new Error(`R worker died (exit ${code ?? "null"})`));
      if (!this.closing && this.workers.length < this.opts.size) {
        this.spawnWorker();
      }
    });

    this.workers.push(w);
  }

  private cleanupWorker(w: Worker, err: Error): void {
    if (w.timeoutHandle) {
      clearTimeout(w.timeoutHandle);
      w.timeoutHandle = null;
    }
    if (w.current) {
      w.current.reject(err);
      w.current = null;
    }
    const idx = this.workers.indexOf(w);
    if (idx !== -1) this.workers.splice(idx, 1);
  }

  private onWorkerData(w: Worker, text: string): void {
    w.buffer += text;
    while (true) {
      const begin = w.buffer.indexOf(BEGIN_MARK);
      if (begin === -1) {
        // Trim runaway buffer (shouldn't happen, but cap at 50 MB).
        if (w.buffer.length > 50 * 1024 * 1024) w.buffer = w.buffer.slice(-1024);
        return;
      }
      const end = w.buffer.indexOf(END_MARK, begin);
      if (end === -1) return;

      const block = w.buffer.slice(begin, end + END_MARK.length);
      w.buffer = w.buffer.slice(end + END_MARK.length);

      // Strip trailing newline after END_MARK if present
      if (w.buffer.startsWith("\n")) w.buffer = w.buffer.slice(1);

      this.handleWorkerBlock(w, block);
    }
  }

  private handleWorkerBlock(w: Worker, block: string): void {
    // Block format:  __POOL_BEGIN__<id>\n<json>\n__POOL_END__
    const headerEnd = block.indexOf("\n");
    if (headerEnd === -1) return;
    const idTag = block.slice(BEGIN_MARK.length, headerEnd);
    const jsonText = block.slice(headerEnd + 1, block.length - END_MARK.length).trimEnd();

    if (idTag === "ready") {
      w.ready = true;
      this.dispatch();
      return;
    }

    let parsed: WorkerResponse | null = null;
    try {
      parsed = JSON.parse(jsonText) as WorkerResponse;
    } catch (e) {
      const err = new Error(`Bad JSON from R worker: ${(e as Error).message}; raw=${jsonText.slice(0, 200)}`);
      if (w.current) w.current.reject(err);
      this.finishCurrent(w);
      return;
    }

    if (!w.current || w.current.cmd.id !== parsed.id) {
      // Stray response — log and drop
      console.error(`[r-pool worker ${w.id}] stray response id=${parsed.id}`);
      this.finishCurrent(w);
      return;
    }

    if (parsed.ok) {
      w.current.resolve(parsed.result);
    } else {
      w.current.reject(new Error(parsed.error || "R script failed (no error message)"));
    }
    this.finishCurrent(w);
  }

  private finishCurrent(w: Worker): void {
    if (w.timeoutHandle) {
      clearTimeout(w.timeoutHandle);
      w.timeoutHandle = null;
    }
    w.current = null;
    this.dispatch();
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const w = this.workers.find((x) => x.ready && x.current === null);
      if (!w) return;
      const call = this.queue.shift()!;
      w.current = call;

      const line = JSON.stringify(call.cmd) + "\n";
      try {
        w.child.stdin!.write(line);
      } catch (err) {
        call.reject(new Error(`Failed to write to R worker: ${(err as Error).message}`));
        w.current = null;
        continue;
      }

      w.timeoutHandle = setTimeout(() => {
        if (w.current === call) {
          // Worker is wedged on a single script — kill it; pool will respawn.
          console.error(`[r-pool worker ${w.id}] timeout on ${call.cmd.script}, restarting`);
          try {
            w.child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          call.reject(new Error(`R script ${call.cmd.script} timed out after ${call.timeoutMs}ms`));
          w.current = null;
          // 'close' handler will respawn.
        }
      }, call.timeoutMs);
    }
  }
}
