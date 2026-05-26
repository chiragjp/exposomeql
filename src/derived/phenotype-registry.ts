import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

export type PhenotypeType = "continuous" | "binary" | "ordinal" | "categorical";

export interface PhenotypeHandle {
  /** Stable handle id (phen_<8hex>) — pass this back to downstream tools. */
  id: string;
  /** Human-readable name (user-supplied or recipe). */
  name: string;
  /** Recipe family. */
  recipe: string;
  /** Variable type for downstream model selection. */
  type: PhenotypeType;
  /** Variables consumed by the recipe / formula (NHANES codes, or canonical names for other cohorts). */
  source_variables: string[];
  /** Cycle / wave identifiers with complete inputs. */
  cycles: string[];
  /** N participants with non-missing derived value. */
  n: number;
  /** Absolute path to materialized CSV. Columns vary by data_source; always has id_column + 'value'. */
  csv_path: string;
  /** Summary stats (weighted mean/SD/percentiles or prevalence/level counts). */
  summary: Record<string, unknown>;
  /** Recipe-specific metadata (formula text, units, criteria, derived thresholds). */
  recipe_meta: Record<string, unknown>;
  /** Unix ms when created. */
  created_at: number;
  /** Source cohort identifier ("nhanes", future: "framingham", "hchs", a registered upload, ...). */
  data_source: string;
  /** Whether the CSV carries survey-design columns (psu_column / strata_column / weight_column). */
  has_survey_design: boolean;
  /** Name of the participant-id column in the CSV (SEQN for NHANES). */
  id_column: string;
  /** Name of the per-participant weight column (null for unweighted cohorts). */
  weight_column: string | null;
  /** Name of the PSU column (null for unweighted cohorts). */
  psu_column: string | null;
  /** Name of the strata column (null for unweighted cohorts). */
  strata_column: string | null;
}

/** Process-local registry of derived phenotypes.
 *
 *  Handles live in-memory; the materialized per-participant vector lives on disk
 *  in a per-process tmp directory so downstream R/Python scripts can read it
 *  back without round-tripping through stdin. */
export class PhenotypeRegistry {
  private handles = new Map<string, PhenotypeHandle>();
  private byName = new Map<string, string>();
  private dir: string;

  constructor() {
    this.dir = path.join(os.tmpdir(), `exposomeql-handles-${process.pid}`);
    fs.mkdirSync(this.dir, { recursive: true });
    process.on("exit", () => this.cleanup());
  }

  newId(): string {
    return `phen_${crypto.randomBytes(4).toString("hex")}`;
  }

  pathFor(id: string): string {
    return path.join(this.dir, `${id}.csv`);
  }

  /** Resolve a string to a handle: matches handle id, then by name. */
  resolve(idOrName: string): PhenotypeHandle | undefined {
    const direct = this.handles.get(idOrName);
    if (direct) return direct;
    const byName = this.byName.get(idOrName);
    if (byName) return this.handles.get(byName);
    return undefined;
  }

  put(h: PhenotypeHandle): void {
    this.handles.set(h.id, h);
    this.byName.set(h.name, h.id);
  }

  list(): PhenotypeHandle[] {
    return Array.from(this.handles.values()).sort((a, b) => b.created_at - a.created_at);
  }

  drop(id: string): boolean {
    const h = this.handles.get(id);
    if (!h) return false;
    try { fs.unlinkSync(h.csv_path); } catch { /* file may already be gone */ }
    this.handles.delete(id);
    this.byName.delete(h.name);
    return true;
  }

  private cleanup(): void {
    try {
      for (const h of this.handles.values()) {
        try { fs.unlinkSync(h.csv_path); } catch { /* ignore */ }
      }
      fs.rmdirSync(this.dir);
    } catch { /* best-effort */ }
  }
}
