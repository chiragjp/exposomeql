/**
 * Participant-ID guard for restricted data (HHEAR, under a data-use
 * agreement). Scripts should only ever return aggregates; this is the
 * backstop applied by the R/Python executors to every result from a
 * restricted script, so a new or edited script can't leak per-person rows
 * to the model, the UI, or a downloaded bundle.
 *
 * Any array of records carrying a participant-identifier column is replaced
 * by a short marker, and the result gains a `withheld` list naming the paths.
 */

/** Column names that identify a participant. */
const PARTICIPANT_KEY = /^(pid|pid_\w+|\w+_pid|_pj|participant(_id)?|subject(_id)?|person_id|seqn|id_participant)$/i;

/** Scripts that read HHEAR participant-level files. */
export function isRestrictedScript(scriptName: string, params: unknown, hhearDataDir?: string): boolean {
  if (/^cohort_/.test(scriptName)) return true;
  if (!hhearDataDir) return false;
  return JSON.stringify(params ?? null).includes(JSON.stringify(hhearDataDir).slice(1, -1));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function withholdParticipantRows<T>(result: T): T {
  const withheld: string[] = [];
  const walk = (v: unknown, path: string[]): unknown => {
    if (Array.isArray(v)) {
      if (v.some((r) => isRecord(r) && Object.keys(r).some((k) => PARTICIPANT_KEY.test(k)))) {
        withheld.push(path.join(".") || "(result)");
        return `[withheld: ${v.length} participant-level rows; restricted data]`;
      }
      return v.map((x, i) => walk(x, [...path, String(i)]));
    }
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...path, k])]));
    return v;
  };
  const out = walk(result, []);
  if (withheld.length === 0) return result;
  if (isRecord(out)) out.withheld = withheld;
  console.error(`[guardrails] withheld participant-level rows: ${withheld.join(", ")}`);
  return out as T;
}
