/**
 * ExposomeAtlas tools — literature-curated exposure→phenotype evidence from
 * https://evidence.exposomeatlas.com (FAIR JSON-LD export, CC BY 4.0).
 *
 * Data is loaded by scripts/exposomeatlas-etl.ts into <dataDir>/exposomeatlas/parquet and
 * registered as DuckDB views (atlas_associations, atlas_entities, atlas_papers, atlas_manifest)
 * by DuckDBManager.
 *
 * The corpus has two layers, kept apart by `evidence_source`:
 *   - "literature"   : associations curated from ~140 published papers (many cohorts/countries)
 *   - "nhanes_atlas" : the NHANES EP-WAS atlas (Patel et al., Nat Med 2026) — the same evidence
 *                      ExposomeQL already serves natively via epwas_* tools, so tools default to
 *                      the literature layer to avoid double counting.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../types.js";

/** Metrics the ExposomeAtlas treats as comparable across studies. */
const COMPARABLE_METRICS = ["OR", "HR", "RR", "β", "% change"];

const SOURCE = z.enum(["literature", "nhanes_atlas", "all"]).optional().default("literature")
  .describe("Evidence layer: 'literature' (default; curated from published papers), 'nhanes_atlas' (NHANES EP-WAS atlas rows, which duplicate epwas_search), or 'all'");

const EXCLUDE_NHANES = z.boolean().optional().default(false)
  .describe("Drop literature records whose study population is NHANES (they are not independent of the EP-WAS atlas)");

/**
 * Independent cohorts = distinct harmonized cohort names, excluding pooled/meta/review rows and
 * rows with no cohort (see harmonizeCohort in scripts/exposomeatlas-etl.ts).
 */
const N_COHORTS_SQL = `count(DISTINCT cohort) FILTER (WHERE cohort_kind = 'cohort')`;

/** Replication needs ≥2 papers AND ≥2 cohorts: several sites/strata within one paper are not replication. */
function replicationLabel(nCohorts: number, nPapers: number, agreement: number): string {
  if (nCohorts < 2) return nCohorts === 1 ? "single cohort" : "no identifiable cohort";
  if (nPapers < 2) return `single study (${nCohorts} cohorts/sites)`;
  return agreement >= 0.8 ? "strong" : agreement >= 0.6 ? "partial" : "mixed";
}

function directionStats(pos: number, neg: number, nul: number) {
  const total = pos + neg + nul;
  const dominant = total === 0 ? null : pos >= neg && pos >= nul ? "positive" : neg >= nul ? "negative" : "null";
  const agreement = total > 0 ? Math.max(pos, neg, nul) / total : 0;
  return { dominant, agreement: Number(agreement.toFixed(3)) };
}

const NOT_LOADED =
  "ExposomeAtlas data is not loaded. Build it with `npm run atlas-etl` (downloads the open FAIR export from evidence.exposomeatlas.com into <dataDir>/exposomeatlas/parquet) and restart the server.";

function text(obj: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2),
    }],
  };
}

function isMissingView(err: unknown): boolean {
  return /atlas_(associations|entities|papers|manifest)/.test(String((err as Error)?.message ?? err)) &&
    /does not exist|not found|Catalog Error/i.test(String((err as Error)?.message ?? err));
}

/** Build a WHERE fragment matching an entity by local ID (EAX-/EAO-), ontology CURIE, or label substring. */
function entityFilter(
  term: string,
  cols: { id: string; label: string; curie: string },
  params: unknown[]
): string {
  const t = term.trim();
  if (/^EA[XO]-\d+$/i.test(t)) {
    params.push(t.toUpperCase());
    return `${cols.id} = ?`;
  }
  if (/^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_.-]+$/.test(t)) {
    params.push(t.toUpperCase(), `%${t.toLowerCase()}%`);
    return `(upper(${cols.curie}) = ? OR lower(${cols.label}) LIKE ?)`;
  }
  params.push(`%${t.toLowerCase()}%`);
  return `lower(${cols.label}) LIKE ?`;
}

function sourceFilter(source: string, params: unknown[]): string {
  if (source === "all") return "TRUE";
  params.push(source);
  return "evidence_source = ?";
}

async function provenance(ctx: AppContext): Promise<Record<string, unknown>> {
  try {
    const rows = await ctx.db.query<Record<string, unknown>>(
      `SELECT title, version, modified, license, downloaded_at FROM atlas_manifest LIMIT 1`
    );
    const m = rows[0] ?? {};
    return {
      dataset: m.title ?? "ExposomeAtlas",
      homepage: "https://evidence.exposomeatlas.com/",
      version: m.version ?? null,
      modified: m.modified ?? null,
      downloaded_at: m.downloaded_at ?? null,
      license: m.license ?? "https://creativecommons.org/licenses/by/4.0/",
    };
  } catch {
    return { dataset: "ExposomeAtlas", homepage: "https://evidence.exposomeatlas.com/" };
  }
}

const RECORD_COLS = `assoc_id, exposure_id, exposure, exposure_category, phenotype_id, phenotype, phenotype_category,
  metric, estimate, ci_lower, ci_upper, p_fdr, passed_fdr, direction, evidence_source,
  cohort, cohort_raw, cohort_kind, nhanes_based, citation, doi, year,
  (metric IN (${COMPARABLE_METRICS.map((m) => `'${m.replace(/'/g, "''")}'`).join(", ")})) AS metric_comparable`;

export function registerExposomeAtlasTools(server: McpServer, ctx: AppContext): void {
  // ── 1. Search associations ─────────────────────────────────────────────
  server.tool(
    "atlas_search",
    "Search ExposomeAtlas (evidence.exposomeatlas.com): ~9.3K exposure→phenotype associations curated from ~140 published epidemiology papers across 600+ cohorts and 30+ countries (UK Biobank, EPIC, HELIX, NHS/HPFS, birth cohorts, ...), plus the NHANES EP-WAS atlas layer. Use this to check whether an NHANES/EP-WAS finding has been reported in OTHER cohorts and the published literature (external replication). Filter by exposure and/or phenotype (name substring, ExposomeAtlas ID like EAX-0166/EAO-0641, or ontology CURIE like CHEBI:68641), direction, FDR and metric comparability. Effect sizes are as reported by each paper and are NOT on a common scale — never pool across metrics.",
    {
      exposure: z.string().optional().describe("Exposure name substring (e.g., 'PFOA', 'lead', 'cotinine'), EAX- ID, or ontology CURIE"),
      phenotype: z.string().optional().describe("Phenotype name substring (e.g., 'blood pressure', 'asthma'), EAO- ID, or ontology CURIE"),
      source: SOURCE,
      direction: z.enum(["positive", "negative", "null"]).optional().describe("Reported direction of effect"),
      fdr_only: z.boolean().optional().default(false).describe("Only associations that pass FDR (q<0.05)"),
      comparable_only: z.boolean().optional().default(false).describe("Only metrics comparable across studies (OR, HR, RR, β, % change)"),
      exposure_category: z.string().optional().describe("Exposure category substring (e.g., 'Metals', 'PFAS', 'Air pollution')"),
      phenotype_category: z.string().optional().describe("Phenotype category substring (e.g., 'Metabolic', 'Cancer', 'Respiratory')"),
      cohort: z.string().optional().describe("Cohort name substring, matched against harmonized and raw names (e.g., 'UK Biobank', 'HELIX')"),
      exclude_nhanes_based: EXCLUDE_NHANES,
      min_year: z.number().optional().describe("Earliest publication year"),
      limit: z.number().optional().default(25).describe("Max records returned (default 25, max 200)"),
    },
    async ({ exposure, phenotype, source, direction, fdr_only, comparable_only, exposure_category, phenotype_category, cohort, exclude_nhanes_based, min_year, limit }) => {
      const params: unknown[] = [];
      const where: string[] = [sourceFilter(source ?? "literature", params)];
      if (exposure) where.push(entityFilter(exposure, { id: "exposure_id", label: "exposure", curie: "exposure_curie" }, params));
      if (phenotype) where.push(entityFilter(phenotype, { id: "phenotype_id", label: "phenotype", curie: "phenotype_curie" }, params));
      if (direction) { where.push("direction = ?"); params.push(direction); }
      if (fdr_only) where.push("passed_fdr");
      if (comparable_only) {
        where.push(`metric IN (${COMPARABLE_METRICS.map(() => "?").join(", ")})`);
        params.push(...COMPARABLE_METRICS);
      }
      if (exposure_category) { where.push("lower(exposure_category) LIKE ?"); params.push(`%${exposure_category.toLowerCase()}%`); }
      if (phenotype_category) { where.push("lower(phenotype_category) LIKE ?"); params.push(`%${phenotype_category.toLowerCase()}%`); }
      if (cohort) {
        where.push("(lower(cohort) LIKE ? OR lower(cohort_raw) LIKE ?)");
        params.push(`%${cohort.toLowerCase()}%`, `%${cohort.toLowerCase()}%`);
      }
      if (exclude_nhanes_based) where.push("NOT nhanes_based");
      if (min_year != null) { where.push("year >= ?"); params.push(Math.trunc(min_year)); }
      const w = where.join(" AND ");
      const lim = Math.min(Math.max(1, Math.trunc(limit ?? 25)), 200);

      try {
        const [summary] = await ctx.db.query<Record<string, unknown>>(
          `SELECT count(*) AS n_records,
                  count(DISTINCT paper_id) AS n_papers,
                  ${N_COHORTS_SQL} AS n_cohorts,
                  count(*) FILTER (WHERE cohort_kind = 'pooled_or_review') AS n_pooled_or_review_records,
                  count(*) FILTER (WHERE nhanes_based) AS n_nhanes_based_records,
                  count(DISTINCT exposure_id) AS n_exposures,
                  count(DISTINCT phenotype_id) AS n_phenotypes,
                  count(*) FILTER (WHERE passed_fdr) AS n_pass_fdr,
                  count(*) FILTER (WHERE direction = 'positive') AS n_positive,
                  count(*) FILTER (WHERE direction = 'negative') AS n_negative,
                  count(*) FILTER (WHERE direction = 'null') AS n_null
           FROM atlas_associations WHERE ${w}`,
          ...params
        );
        const records = await ctx.db.query(
          `SELECT ${RECORD_COLS} FROM atlas_associations WHERE ${w}
           ORDER BY passed_fdr DESC, p_fdr ASC NULLS LAST, year DESC NULLS LAST, assoc_id
           LIMIT ${lim}`,
          ...params
        );
        // Top counterpart entities: phenotypes for an exposure query, exposures otherwise
        const groupCol = exposure && !phenotype ? "phenotype" : "exposure";
        const top = await ctx.db.query(
          `SELECT ${groupCol} AS name, count(*) AS n_records, count(DISTINCT paper_id) AS n_papers,
                  count(*) FILTER (WHERE passed_fdr) AS n_pass_fdr,
                  count(*) FILTER (WHERE direction = 'positive') AS n_positive,
                  count(*) FILTER (WHERE direction = 'negative') AS n_negative
           FROM atlas_associations WHERE ${w}
           GROUP BY 1 ORDER BY n_papers DESC, n_records DESC LIMIT 15`,
          ...params
        );
        const n = Number(summary?.n_records ?? 0);
        return text({
          query: { exposure, phenotype, source: source ?? "literature", direction, fdr_only, comparable_only, exposure_category, phenotype_category, cohort, exclude_nhanes_based, min_year },
          summary,
          [`top_${groupCol === "phenotype" ? "phenotypes" : "exposures"}`]: top,
          records,
          n_returned: records.length,
          notes: [
            n === 0
              ? "No matching records. Try a shorter name, atlas_entities to find the atlas label/ID, or source='all'."
              : `Showing ${records.length} of ${n} records (FDR-passing first).`,
            "Effects are as reported by each source paper (metric column); metric_comparable=false means the metric is study-specific. Do not pool across metrics.",
            "passed_fdr reflects the source paper's own multiple-testing correction where reported.",
            "n_cohorts counts distinct harmonized cohorts, excluding pooled/meta-analytic/review rows and rows with no cohort; cohort_raw is the name as the paper reported it.",
            (source ?? "literature") !== "literature"
              ? "nhanes_atlas rows are the NHANES EP-WAS atlas, also available with full detail via epwas_search; do not count them as independent replication of NHANES findings."
              : "NHANES EP-WAS atlas rows excluded (source='literature'); use epwas_search for NHANES.",
          ],
          provenance: await provenance(ctx),
        });
      } catch (err) {
        if (isMissingView(err)) return text({ error: NOT_LOADED });
        return text({ error: (err as Error).message });
      }
    }
  );

  // ── 2. Pair-level replication summary ──────────────────────────────────
  server.tool(
    "atlas_pair_evidence",
    "Replication summary from ExposomeAtlas literature for an exposure→phenotype pair: for each matching (exposure, phenotype) pair, how many papers and independent cohorts report it, the direction split, the share agreeing with the dominant direction, FDR-passing count, and every underlying study record. Use after an EP-WAS/NHANES finding to triangulate against the published literature (external cohorts). Agreement labels follow ExposomeAtlas: strong (≥2 papers and ≥2 cohorts, ≥80% agree), partial (≥60%), mixed (<60%), single study, single cohort. Cohort names are harmonized (e.g., UKB = UK Biobank) and pooled/review rows are not counted as cohorts; `external_to_nhanes` repeats the replication summary without NHANES-based studies, which are not independent of EP-WAS.",
    {
      exposure: z.string().describe("Exposure name substring, EAX- ID, or ontology CURIE"),
      phenotype: z.string().describe("Phenotype name substring, EAO- ID, or ontology CURIE"),
      source: SOURCE,
      exclude_nhanes_based: EXCLUDE_NHANES,
      max_pairs: z.number().optional().default(10).describe("Max distinct exposure→phenotype pairs (default 10)"),
      max_records_per_pair: z.number().optional().default(20).describe("Max study records listed per pair (default 20)"),
    },
    async ({ exposure, phenotype, source, exclude_nhanes_based, max_pairs, max_records_per_pair }) => {
      const params: unknown[] = [];
      const where = [
        sourceFilter(source ?? "literature", params),
        entityFilter(exposure, { id: "exposure_id", label: "exposure", curie: "exposure_curie" }, params),
        entityFilter(phenotype, { id: "phenotype_id", label: "phenotype", curie: "phenotype_curie" }, params),
        ...(exclude_nhanes_based ? ["NOT nhanes_based"] : []),
      ].join(" AND ");
      const pairLim = Math.min(Math.max(1, Math.trunc(max_pairs ?? 10)), 50);
      const recLim = Math.min(Math.max(1, Math.trunc(max_records_per_pair ?? 20)), 100);

      try {
        const pairs = await ctx.db.query<Record<string, any>>(
          `SELECT exposure_id, any_value(exposure) AS exposure, any_value(exposure_category) AS exposure_category,
                  phenotype_id, any_value(phenotype) AS phenotype, any_value(phenotype_category) AS phenotype_category,
                  count(*) AS n_records,
                  count(DISTINCT paper_id) AS n_papers,
                  ${N_COHORTS_SQL} AS n_cohorts,
                  count(DISTINCT cohort) FILTER (WHERE cohort_kind = 'cohort' AND NOT nhanes_based) AS n_cohorts_excl_nhanes,
                  count(DISTINCT paper_id) FILTER (WHERE NOT nhanes_based) AS n_papers_excl_nhanes,
                  list(DISTINCT cohort ORDER BY cohort) FILTER (WHERE cohort_kind = 'cohort') AS cohorts,
                  count(*) FILTER (WHERE cohort_kind = 'pooled_or_review') AS n_pooled_or_review_records,
                  count(*) FILTER (WHERE nhanes_based) AS n_nhanes_based_records,
                  count(*) FILTER (WHERE direction = 'positive') AS n_positive,
                  count(*) FILTER (WHERE direction = 'negative') AS n_negative,
                  count(*) FILTER (WHERE direction = 'null') AS n_null,
                  count(*) FILTER (WHERE direction = 'positive' AND NOT nhanes_based) AS n_positive_excl_nhanes,
                  count(*) FILTER (WHERE direction = 'negative' AND NOT nhanes_based) AS n_negative_excl_nhanes,
                  count(*) FILTER (WHERE direction = 'null' AND NOT nhanes_based) AS n_null_excl_nhanes,
                  count(*) FILTER (WHERE passed_fdr) AS n_pass_fdr,
                  list(DISTINCT metric) AS metrics
           FROM atlas_associations WHERE ${where}
           GROUP BY exposure_id, phenotype_id
           ORDER BY n_cohorts DESC, n_papers DESC, n_records DESC
           LIMIT ${pairLim}`,
          ...params
        );
        if (pairs.length === 0) {
          return text({
            query: { exposure, phenotype, source: source ?? "literature" },
            pairs: [],
            note: "No matching pair in ExposomeAtlas. Use atlas_entities to find how the atlas names these entities, or atlas_search with only one side.",
            provenance: await provenance(ctx),
          });
        }

        const out = [];
        for (const p of pairs) {
          const all = directionStats(Number(p.n_positive), Number(p.n_negative), Number(p.n_null));
          const ext = directionStats(Number(p.n_positive_excl_nhanes), Number(p.n_negative_excl_nhanes), Number(p.n_null_excl_nhanes));
          const { n_positive_excl_nhanes, n_negative_excl_nhanes, n_null_excl_nhanes, n_cohorts_excl_nhanes, n_papers_excl_nhanes, ...rest } = p;
          const recParams: unknown[] = [p.exposure_id, p.phenotype_id];
          const recSource = sourceFilter(source ?? "literature", recParams);
          const recs = await ctx.db.query(
            `SELECT ${RECORD_COLS} FROM atlas_associations
             WHERE exposure_id = ? AND phenotype_id = ? AND ${recSource}${exclude_nhanes_based ? " AND NOT nhanes_based" : ""}
             ORDER BY passed_fdr DESC, year DESC NULLS LAST, assoc_id LIMIT ${recLim}`,
            ...recParams
          );
          out.push({
            ...rest,
            dominant_direction: all.dominant,
            direction_agreement: all.agreement,
            replication: replicationLabel(Number(p.n_cohorts), Number(p.n_papers), all.agreement),
            // Replication counting only populations independent of NHANES (i.e., of the EP-WAS atlas)
            external_to_nhanes: {
              n_cohorts: Number(n_cohorts_excl_nhanes),
              n_papers: Number(n_papers_excl_nhanes),
              n_positive: Number(n_positive_excl_nhanes),
              n_negative: Number(n_negative_excl_nhanes),
              n_null: Number(n_null_excl_nhanes),
              dominant_direction: ext.dominant,
              direction_agreement: ext.agreement,
              replication: replicationLabel(Number(n_cohorts_excl_nhanes), Number(n_papers_excl_nhanes), ext.agreement),
            },
            records: recs,
          });
        }

        return text({
          query: { exposure, phenotype, source: source ?? "literature", exclude_nhanes_based },
          n_pairs: out.length,
          pairs: out,
          notes: [
            "Counts are of reported associations; one paper may report several models/subgroups for the same pair.",
            "n_cohorts = distinct harmonized cohorts (pooled/meta/review rows and rows with no cohort excluded). Use external_to_nhanes when triangulating an NHANES/EP-WAS finding: NHANES-based papers are not independent replication.",
            "Effects are not pooled: source papers use different metrics, contrasts and adjustment sets.",
            "To compare with NHANES, run epwas_search / epwas_summary for the matching NHANES variables.",
          ],
          provenance: await provenance(ctx),
        });
      } catch (err) {
        if (isMissingView(err)) return text({ error: NOT_LOADED });
        return text({ error: (err as Error).message });
      }
    }
  );

  // ── 3. Entity lookup ───────────────────────────────────────────────────
  server.tool(
    "atlas_entities",
    "Look up exposures and phenotypes in ExposomeAtlas: atlas IDs (EAX-/EAO-), categories, ontology mappings (CHEBI, ENVO, MONDO, HP, EFO, NCIT, ...) with match quality, and how many literature / NHANES-atlas associations and papers each has. Omit `query` to list categories with counts. Use to find the atlas's name for a concept before atlas_search / atlas_pair_evidence.",
    {
      query: z.string().optional().describe("Name substring, EAX-/EAO- ID, or ontology CURIE (omit to list categories)"),
      kind: z.enum(["exposure", "phenotype", "all"]).optional().default("all").describe("Entity kind"),
      category: z.string().optional().describe("Category substring filter"),
      limit: z.number().optional().default(25).describe("Max entities (default 25, max 200)"),
    },
    async ({ query, kind, category, limit }) => {
      const lim = Math.min(Math.max(1, Math.trunc(limit ?? 25)), 200);
      const params: unknown[] = [];
      const where: string[] = [];
      if ((kind ?? "all") !== "all") { where.push("e.kind = ?"); params.push(kind); }
      if (category) { where.push("lower(e.category) LIKE ?"); params.push(`%${category.toLowerCase()}%`); }
      try {
        if (!query) {
          const cats = await ctx.db.query(
            `SELECT e.kind, e.category, count(*) AS n_entities
             FROM atlas_entities e ${where.length ? "WHERE " + where.join(" AND ") : ""}
             GROUP BY 1, 2 ORDER BY e.kind, n_entities DESC`,
            ...params
          );
          return text({ categories: cats, provenance: await provenance(ctx) });
        }
        where.push(entityFilter(query, { id: "e.entity_id", label: "e.label", curie: "e.ontology_curie" }, params));
        const rows = await ctx.db.query(
          `WITH counts AS (
             SELECT exposure_id AS entity_id, evidence_source, paper_id FROM atlas_associations
             UNION ALL
             SELECT phenotype_id, evidence_source, paper_id FROM atlas_associations
           ), agg AS (
             SELECT entity_id,
                    count(*) FILTER (WHERE evidence_source = 'literature') AS n_literature,
                    count(*) FILTER (WHERE evidence_source = 'nhanes_atlas') AS n_nhanes_atlas,
                    count(DISTINCT paper_id) FILTER (WHERE evidence_source = 'literature') AS n_literature_papers
             FROM counts GROUP BY entity_id
           )
           SELECT e.entity_id, e.kind, e.label, e.category, e.ontology_curie, e.ontology, e.ontology_match,
                  e.ontology_confidence, e.ontology_status,
                  coalesce(a.n_literature, 0) AS n_literature, coalesce(a.n_nhanes_atlas, 0) AS n_nhanes_atlas,
                  coalesce(a.n_literature_papers, 0) AS n_literature_papers, e.iri
           FROM atlas_entities e LEFT JOIN agg a USING (entity_id)
           WHERE ${where.join(" AND ")}
           ORDER BY n_literature_papers DESC, n_literature DESC, n_nhanes_atlas DESC, e.label
           LIMIT ${lim}`,
          ...params
        );
        return text({
          query: { query, kind: kind ?? "all", category },
          n_returned: rows.length,
          entities: rows,
          notes: ["ontology_match: 'exact' = skos:exactMatch; 'close' = skos:closeMatch (often an automated suggestion awaiting curator review — check ontology_status)."],
          provenance: await provenance(ctx),
        });
      } catch (err) {
        if (isMissingView(err)) return text({ error: NOT_LOADED });
        return text({ error: (err as Error).message });
      }
    }
  );
}
