import Fuse from "fuse.js";
import type { DuckDBManager } from "../data/duckdb-manager.js";
import type { VariableEntry, ResolveResult, CohortConfig } from "../types.js";
import { ALIAS_MAP } from "./alias-map.js";
import { HHEAR_ALIAS_MAP, HHEAR_ANALYTE_NAMES } from "./hhear-alias-map.js";

/** Result of resolving an HHEAR analyte query */
export interface HhearResolveResult {
  resolved: boolean;
  analyteCode?: string;
  analyteName?: string;
  candidates?: { code: string; name: string }[];
}

export class VariableResolver {
  private db: DuckDBManager;
  private fuse!: Fuse<VariableEntry>;
  private variableMap = new Map<string, VariableEntry>();
  private initialized = false;

  constructor(db: DuckDBManager) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    // Load all variables from the codebook
    const rows = await this.db.query<{
      "Variable.Name": string;
      "Variable.Description": string;
      Component: string;
      "Data.File.Name": string;
      "Data.File.Description": string;
      "Begin.Year": number;
      EndYear: number;
    }>(`
      SELECT DISTINCT
        "Variable.Name",
        "Variable.Description",
        "Component",
        "Data.File.Name",
        "Data.File.Description",
        "Begin.Year",
        "EndYear"
      FROM nhanes.variable_names_epcf
      WHERE "Variable.Name" IS NOT NULL
    `);

    // Deduplicate by variable name (keep first occurrence with description)
    const uniqueVars = new Map<string, VariableEntry>();
    for (const row of rows) {
      const name = row["Variable.Name"];
      if (!uniqueVars.has(name)) {
        uniqueVars.set(name, {
          variableName: name,
          description: row["Variable.Description"] ?? "",
          component: row["Component"] ?? "",
          dataFileName: row["Data.File.Name"] ?? "",
          dataFileDescription: row["Data.File.Description"] ?? "",
          beginYear: row["Begin.Year"] ?? 0,
          endYear: row["EndYear"] ?? 0,
        });
      }
    }

    this.variableMap = uniqueVars;
    const entries = Array.from(uniqueVars.values());

    // Build Fuse.js index
    this.fuse = new Fuse(entries, {
      keys: [
        { name: "variableName", weight: 0.4 },
        { name: "description", weight: 0.4 },
        { name: "dataFileDescription", weight: 0.2 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 2,
    });

    this.initialized = true;
    console.error(
      `[variable-resolver] Indexed ${uniqueVars.size} unique variables`
    );
  }

  async resolve(query: string): Promise<ResolveResult> {
    if (!this.initialized) {
      throw new Error("VariableResolver not initialized");
    }

    const normalized = query.trim();

    // 1. Exact match on variable name (case-insensitive)
    const upper = normalized.toUpperCase();
    const exact = this.variableMap.get(upper);
    if (exact) {
      return { resolved: true, variable: exact, confidence: 1.0 };
    }

    // 2. Alias map lookup (case-insensitive)
    const lowerQuery = normalized.toLowerCase();
    const alias = ALIAS_MAP[lowerQuery];
    if (alias) {
      if (typeof alias === "string") {
        const entry = this.variableMap.get(alias);
        if (entry) {
          return { resolved: true, variable: entry, confidence: 0.95 };
        }
      } else {
        // Ambiguous — return candidates
        const candidates = alias
          .map((v) => this.variableMap.get(v))
          .filter(Boolean) as VariableEntry[];
        return {
          resolved: false,
          candidates,
          confidence: 0.8,
        };
      }
    }

    // 3. Fuzzy search via Fuse.js
    const results = this.fuse.search(normalized, { limit: 5 });

    if (results.length === 0) {
      return { resolved: false, confidence: 0 };
    }

    // If top result is very strong match, resolve directly
    const topScore = 1 - (results[0].score ?? 1);
    if (topScore > 0.8 && results.length === 1) {
      return {
        resolved: true,
        variable: results[0].item,
        confidence: topScore,
      };
    }

    if (topScore > 0.7) {
      // Check if top result is much better than second
      const secondScore = results.length > 1 ? 1 - (results[1].score ?? 1) : 0;
      if (topScore - secondScore > 0.2) {
        return {
          resolved: true,
          variable: results[0].item,
          confidence: topScore,
        };
      }
    }

    // Return top candidates for disambiguation
    return {
      resolved: false,
      candidates: results.map((r) => r.item),
      confidence: topScore,
    };
  }

  /** Get a variable entry by exact name */
  get(variableName: string): VariableEntry | undefined {
    return this.variableMap.get(variableName.toUpperCase());
  }

  /** Get all available variable entries */
  getAll(): VariableEntry[] {
    return Array.from(this.variableMap.values());
  }

  /**
   * Resolve a natural language query to an HHEAR analyte code.
   * Checks: exact code match → alias map → fuzzy match on analyte names.
   * If cohort provided, filters to analytes available in that cohort.
   */
  resolveHhear(query: string, cohort?: CohortConfig): HhearResolveResult {
    const normalized = query.trim();
    const available = cohort ? new Set(cohort.analytes) : null;

    // 1. Exact match on analyte code (case-sensitive, since codes like "Pb" vs "PB" matter)
    if (HHEAR_ANALYTE_NAMES[normalized]) {
      if (!available || available.has(normalized)) {
        return {
          resolved: true,
          analyteCode: normalized,
          analyteName: HHEAR_ANALYTE_NAMES[normalized],
        };
      }
    }

    // 1b. Case-insensitive exact match on known codes
    const codeMatch = Object.keys(HHEAR_ANALYTE_NAMES).find(
      (k) => k.toLowerCase() === normalized.toLowerCase()
    );
    if (codeMatch) {
      if (!available || available.has(codeMatch)) {
        return {
          resolved: true,
          analyteCode: codeMatch,
          analyteName: HHEAR_ANALYTE_NAMES[codeMatch],
        };
      }
    }

    // 1c. Direct match against cohort analytes (case-insensitive)
    if (available) {
      const directMatch = cohort!.analytes.find(
        (a) => a.toLowerCase() === normalized.toLowerCase()
      );
      if (directMatch) {
        return {
          resolved: true,
          analyteCode: directMatch,
          analyteName: HHEAR_ANALYTE_NAMES[directMatch] ?? directMatch,
        };
      }
    }

    // 2. Alias map lookup
    const lowerQuery = normalized.toLowerCase();
    const alias = HHEAR_ALIAS_MAP[lowerQuery];
    if (alias) {
      if (typeof alias === "string") {
        if (!available || available.has(alias)) {
          return {
            resolved: true,
            analyteCode: alias,
            analyteName: HHEAR_ANALYTE_NAMES[alias] ?? alias,
          };
        }
      } else {
        // Multiple candidates — filter by cohort availability
        const filtered = available
          ? alias.filter((a) => available.has(a))
          : alias;
        if (filtered.length === 1) {
          return {
            resolved: true,
            analyteCode: filtered[0],
            analyteName: HHEAR_ANALYTE_NAMES[filtered[0]] ?? filtered[0],
          };
        }
        if (filtered.length > 1) {
          return {
            resolved: false,
            candidates: filtered.map((a) => ({
              code: a,
              name: HHEAR_ANALYTE_NAMES[a] ?? a,
            })),
          };
        }
      }
    }

    // 3. Fuzzy search on HHEAR_ANALYTE_NAMES values
    const nameEntries = Object.entries(HHEAR_ANALYTE_NAMES)
      .filter(([code]) => !available || available.has(code))
      .map(([code, name]) => ({ code, name }));

    const hhearFuse = new Fuse(nameEntries, {
      keys: [
        { name: "name", weight: 0.6 },
        { name: "code", weight: 0.4 },
      ],
      threshold: 0.4,
      includeScore: true,
    });

    const results = hhearFuse.search(normalized, { limit: 5 });
    if (results.length === 0) {
      return { resolved: false };
    }

    const topScore = 1 - (results[0].score ?? 1);
    if (topScore > 0.7) {
      return {
        resolved: true,
        analyteCode: results[0].item.code,
        analyteName: results[0].item.name,
      };
    }

    return {
      resolved: false,
      candidates: results.map((r) => r.item),
    };
  }

  /** Get the full chemical name for an HHEAR analyte code */
  getAnalyteName(code: string): string | undefined {
    return HHEAR_ANALYTE_NAMES[code];
  }
}
