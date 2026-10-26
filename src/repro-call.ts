/**
 * `repro_call`: the exact script invocation behind an R/Python-backed tool
 * result, attached by the executors so a client can re-run the step on its
 * own copy of the data (the web app's reproducibility bundle does this).
 *
 *   { engine, script, script_sha256, params, portable }
 *
 * Absolute data paths in `params` are rewritten to `${ENV_VAR}/relative`
 * placeholders (HHEAR_DATA_DIR, EXPOSOMEQL_DATA_DIR) so nothing about the
 * server's filesystem leaks and the caller can point them at local copies.
 * Paths outside those roots (e.g. a derived-phenotype temp file) can't be
 * mapped; they become `<server-only>/<basename>` and `portable` is false.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

export interface ReproCall {
  engine: "r" | "python";
  script: string;
  script_sha256: string | null;
  params: unknown;
  portable: boolean;
}

const hashCache = new Map<string, { mtimeMs: number; sha: string }>();

function scriptSha256(scriptPath: string): string | null {
  try {
    const { mtimeMs } = fs.statSync(scriptPath);
    const hit = hashCache.get(scriptPath);
    if (hit && hit.mtimeMs === mtimeMs) return hit.sha;
    const sha = createHash("sha256").update(fs.readFileSync(scriptPath)).digest("hex");
    hashCache.set(scriptPath, { mtimeMs, sha });
    return sha;
  } catch {
    return null;
  }
}

/** Both the configured and the symlink-resolved form of each root, longest
 *  first so nested roots win. */
function expandRoots(roots: Record<string, string | undefined>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, dir] of Object.entries(roots)) {
    if (!dir) continue;
    const forms = new Set([path.resolve(dir)]);
    try { forms.add(fs.realpathSync(dir)); } catch { /* missing dir */ }
    for (const f of forms) out.push([name, f.replace(/\/+$/, "")]);
  }
  return out.sort((a, b) => b[1].length - a[1].length);
}

export function makeReproCall(
  engine: "r" | "python",
  scriptPath: string,
  params: unknown,
  roots: Record<string, string | undefined>,
): ReproCall {
  const rootList = expandRoots(roots);
  let portable = true;

  const mapPath = (s: string): string => {
    for (const [name, dir] of rootList) {
      if (s === dir || s.startsWith(dir + "/")) return `\${${name}}${s.slice(dir.length)}`;
    }
    portable = false;
    return `<server-only>/${path.basename(s)}`;
  };

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return path.isAbsolute(v) && v.length > 1 ? mapPath(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };

  return {
    engine,
    script: path.basename(scriptPath),
    script_sha256: scriptSha256(scriptPath),
    params: walk(params),
    portable,
  };
}

/** Attach to an object result (arrays and scalars are left alone). */
export function withReproCall<T>(result: T, call: ReproCall): T {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    (result as Record<string, unknown>).repro_call = call;
  }
  return result;
}
