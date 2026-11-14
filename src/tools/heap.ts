/**
 * HEAP tools — Human Exposomic Architecture of the Proteome (https://heap.bio).
 *
 * HEAP is a UK Biobank graph over exposures (E), plasma proteins (P) and incident diseases (D):
 *   E→P    169 lifestyle/environmental exposures × 2,686 Olink proteins (train/test replicated)
 *   P→D    Cox HR per protein × 181 incident diseases, plus mediation of the total exposome score
 *   E→P→D  Mendelian-randomization triads (six directed edges, motif A–E) in UKB and deCODE arms
 *   E→D    proteome-based exposure scores (PES) vs incident disease
 *
 * Data is loaded by scripts/heap-etl.ts into <dataDir>/heap/parquet and registered as DuckDB
 * views (heap_ep, heap_mediation, heap_mr_edges, heap_mr_triads, heap_pes_disease,
 * heap_intervention, heap_diseases, heap_manifest) by DuckDBManager.
 *
 * Every response carries a `citation` block: the public HEAP downloads are CC BY-NC-ND 4.0 and
 * ExposomeQL redistributes them with the authors' permission.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../types.js";
import { findBridgeEntries, HEAP_NHANES_BRIDGE } from "../variables/heap-nhanes-bridge.js";

const NOT_LOADED =
  "HEAP data is not loaded. Build it with `npm run heap-etl` (downloads the HEAP supplementary tables from heap.bio into <dataDir>/heap/parquet) and restart the server.";

const HEAP_CITATION =
  "Isaac SK, Ellis RJ, Jee YH, Murthy VL, Udler MS, Neale B, Sunyaev S, Gusev A, Martin A, Patel CJ. Human Plasma Proteomics Links Modifiable Lifestyle Exposome to Disease Risk. medRxiv, 2026 (version 2, posted 2026-11-13). https://doi.org/10.1101/2025.05.07.25327178";

const HEAP_URL = "https://www.medrxiv.org/content/10.1101/2025.05.07.25327178v2";

const SPEC = z.enum(["base", "base_plus_bmi", "base_plus_clinical", "base_plus_blood_draw", "exclude_prevalent_disease"])
  .optional().default("base")
  .describe("Covariate specification. 'base' (default; age, sex, centre, 20 genetic PCs) is what HEAP's headline results use; the others are robustness checks (+BMI; +BMI, fasting, season, medications; +blood-draw timing; sample free of prevalent major disease). BMI may lie on the exposure→protein path, so attenuation under base_plus_bmi is a sensitivity check, not a mediation test.");

const MOTIFS: Record<string, string> = {
  A: "Mediator (E→P→D): exposure moves the protein and the protein moves disease",
  B: "Biomarker: exposure moves protein and disease, and disease liability also moves the protein",
  C: "Exposure-marker: exposure moves protein and disease, but the protein does not move disease",
  D: "Reverse (P→E): the protein moves the exposure",
  E: "Disease-liability (D→P): disease liability moves the protein (and the exposure)",
};

function text(obj: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2),
    }],
  };
}

function isMissingView(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /heap_[a-z_]+/.test(msg) && /does not exist|not found|Catalog Error/i.test(msg);
}

/** Substring pattern tolerant of spaces/underscores/punctuation: "pack years" → %pack%years% */
function like(term: string): string {
  const core = term.toLowerCase().replace(/[^a-z0-9]+/g, "%").replace(/^%+|%+$/g, "");
  return `%${core}%`;
}

/** Citation + license block attached to every HEAP response. */
async function citation(ctx: AppContext): Promise<Record<string, unknown>> {
  let m: Record<string, unknown> = {};
  try {
    m = (await ctx.db.query<Record<string, unknown>>(
      `SELECT version, downloaded_at, citation, license, license_note, population FROM heap_manifest LIMIT 1`
    ))[0] ?? {};
  } catch { /* manifest optional */ }
  return {
    dataset: "HEAP — Human Exposomic Architecture of the Proteome",
    homepage: "https://heap.bio/",
    // code is the source of truth, so a manifest built before a preprint revision cannot serve a stale citation
    cite: HEAP_CITATION,
    url: HEAP_URL,
    license: m.license ?? "CC BY-NC-ND 4.0 (https://creativecommons.org/licenses/by-nc-nd/4.0/)",
    license_note: m.license_note ??
      "Redistributed and harmonized in ExposomeQL with permission of the HEAP authors. Non-commercial use; cite the HEAP preprint when reporting these results.",
    population: m.population ?? "UK Biobank (~53K participants with Olink plasma proteomics)",
    version: m.version ?? null,
    downloaded_at: m.downloaded_at ?? null,
  };
}

async function fail(ctx: AppContext, err: unknown) {
  if (isMissingView(err)) return text({ error: NOT_LOADED });
  return text({ error: (err as Error).message, citation: await citation(ctx) });
}

const clamp = (v: number | undefined, dflt: number, max: number) => Math.min(Math.max(1, Math.trunc(v ?? dflt)), max);

/** WHERE fragment: disease given as label words, UKB first-occurrence ID, or ICD-10 code. */
function diseaseFilter(term: string, cols: { label: string; id: string; icd?: string }, params: unknown[]): string {
  const p = like(term);
  params.push(p, p, term.trim().toUpperCase());
  const icd = cols.icd
    ? `upper(${cols.icd}) = ?`
    : `${cols.id} IN (SELECT dz_id FROM heap_diseases WHERE upper(icd10) = ?)`;
  return `(lower(${cols.label}) LIKE ? OR lower(${cols.id}) LIKE ? OR ${icd})`;
}

/** WHERE fragment for a FinnGen endpoint column (MR tables), resolved through the disease dictionary. */
function finngenFilter(term: string, col: string, params: unknown[]): string {
  const p = like(term);
  params.push(p, p, term.trim().toUpperCase(), p);
  return `(${col} IN (SELECT unnest(finngen_ids) FROM heap_diseases
                      WHERE lower(disease_label) LIKE ? OR lower(dz_id) LIKE ? OR upper(icd10) = ?)
           OR lower(${col}) LIKE ?)`;
}

/**
 * "MR supported": HEAP's final Mendelian-randomization tier for the edge is Tier1plus or Tier1 in
 * at least one pQTL arm (robust directional estimate, or cis-pQTL estimate that colocalizes).
 * Tier2 (cis without colocalization, or trans-only instruments), Suggestive and Reverse are
 * reported through `mr_tier` but do not count as supported.
 */
const MR_SUPPORTED_TIERS = "('Tier1plus', 'Tier1')";
const tierRank = (col: string) =>
  `CASE ${col} WHEN 'Tier1plus' THEN 0 WHEN 'Tier1' THEN 1 WHEN 'Tier2' THEN 2 WHEN 'Suggestive' THEN 3 WHEN 'Reverse' THEN 4 ELSE 5 END`;
const MR_SUPPORTED_NOTE =
  "mr_supported: true when HEAP's Mendelian-randomization tier for this edge is Tier1plus or Tier1 in at least one arm (robust directional MR, or cis-pQTL MR that colocalizes); false when the edge was tested and is Tier2 (cis without colocalization / trans-only), Suggestive, Reverse or Null; null when HEAP has no MR test for it (no genetic instruments for the exposure, or no matching FinnGen endpoint). Report the observational result and the MR result side by side; describe an association as 'MR supported' only when mr_supported is true, and never read null as evidence against causality.";

/** Subquery: one row per exposure × protein with the MR verdict for the exposure→protein edge. */
const MR_EP = `(SELECT src_id, tgt_id,
                       bool_or(mr_tier_final IN ${MR_SUPPORTED_TIERS}) AS mr_supported,
                       max(mr_tier_final) FILTER (WHERE arm = 'UKB') AS mr_tier_ukb,
                       max(mr_tier_final) FILTER (WHERE arm = 'DECODE') AS mr_tier_decode
                FROM heap_mr_edges WHERE edge_dir = 'E_to_P' GROUP BY 1, 2)`;

/** Subquery: one row per source (exposure or protein) × UKB disease with the best MR verdict across arms and mapped FinnGen endpoints. */
const mrByDisease = (edgeDirs: string) =>
  `(SELECT x.src_id, dd.dz_id AS mr_dz_id,
           bool_or(x.mr_tier_final IN ${MR_SUPPORTED_TIERS}) AS mr_supported,
           arg_min(x.mr_tier_final, ${tierRank("x.mr_tier_final")}) AS mr_tier,
           arg_min(x.edge_dir, ${tierRank("x.mr_tier_final")}) AS mr_edge,
           list(DISTINCT x.tgt_id) AS mr_finngen_endpoints
    FROM heap_mr_edges x
    JOIN (SELECT dz_id, unnest(finngen_ids) AS fid FROM heap_diseases) dd ON dd.fid = x.tgt_id
    WHERE x.edge_dir IN (${edgeDirs}) GROUP BY 1, 2)`;

export function registerHeapTools(server: McpServer, ctx: AppContext): void {
  // ── 1. E→P ─────────────────────────────────────────────────────────────
  server.tool(
    "heap_exposure_proteins",
    "HEAP (heap.bio) exposure→protein associations in UK Biobank: how 169 lifestyle and environmental exposures (smoking, alcohol, diet, physical activity, sleep, supplements, deprivation, air pollution, sun) are reflected in 2,686 Olink plasma proteins (~53K participants), each estimated in a training split and replicated in a held-out test split, with the Mendelian-randomization tier for the same exposure→protein edge where tested. Query by exposure (what proteins does smoking move?), by protein (what exposures move GDF15?), or both. Call with no arguments to list HEAP's exposure categories and exposure IDs. Use alongside NHANES EP-WAS tools to give an exposure a proteomic signature in an independent cohort.",
    {
      exposure: z.string().optional().describe("Exposure name or ID fragment (e.g., 'pack years', 'coffee', 'oily fish', 'pm2_5'). Matches HEAP exposure IDs, which are UK Biobank field names"),
      protein: z.string().optional().describe("Olink protein / gene symbol, exact (e.g., 'GDF15', 'CEACAM16')"),
      category: z.string().optional().describe("Exposure category fragment (Alcohol, Smoking, Diet_Weekly, Exercise_MET, Exercise_Freq, Sleep, Vitamins, Deprivation_Indices, Residential_Air_Pollution, Sun_Exposure, Sexual_Factors, Internet_Usage)"),
      spec: SPEC,
      replicated_only: z.boolean().optional().default(true).describe("Only associations HEAP flags as replicated in the held-out test split (default true)"),
      mr_supported_only: z.boolean().optional().default(false).describe("Only associations whose exposure→protein edge is MR supported (HEAP MR tier Tier1plus or Tier1 in at least one arm)"),
      limit: z.number().optional().default(25).describe("Max records (default 25, max 200)"),
    },
    async ({ exposure, protein, category, spec, replicated_only, mr_supported_only, limit }) => {
      try {
        if (!exposure && !protein && !category) {
          const cats = await ctx.db.query(
            `SELECT category, count(DISTINCT exposure) AS n_exposures,
                    count(*) FILTER (WHERE replicated) AS n_replicated_associations,
                    list(DISTINCT exposure ORDER BY exposure) AS exposures
             FROM heap_ep WHERE spec = 'base' GROUP BY 1 ORDER BY n_replicated_associations DESC`
          );
          return text({
            exposure_categories: cats,
            notes: ["Exposure IDs are UK Biobank field names (…_f<field>_0_0); categorical fields have one exposure per level (e.g. smoking_status_f20116_0_0_Current)."],
            citation: await citation(ctx),
          });
        }
        const params: unknown[] = [spec ?? "base"];
        const where = ["e.spec = ?"];
        if (exposure) { where.push("lower(e.exposure) LIKE ?"); params.push(like(exposure)); }
        if (protein) { where.push("upper(e.protein) = ?"); params.push(protein.trim().toUpperCase()); }
        if (category) { where.push("lower(e.category) LIKE ?"); params.push(like(category)); }
        if (replicated_only ?? true) where.push("e.replicated");
        if (mr_supported_only) where.push("mr.mr_supported");
        const w = where.join(" AND ");
        const from = `heap_ep e LEFT JOIN ${MR_EP} mr ON mr.src_id = e.exposure AND mr.tgt_id = e.protein`;
        const lim = clamp(limit, 25, 200);

        const [summary] = await ctx.db.query<Record<string, unknown>>(
          `SELECT count(*) AS n_associations, count(DISTINCT e.exposure) AS n_exposures,
                  count(DISTINCT e.protein) AS n_proteins,
                  count(*) FILTER (WHERE e.replicated) AS n_replicated,
                  count(*) FILTER (WHERE e.beta_test > 0) AS n_positive,
                  count(*) FILTER (WHERE e.beta_test < 0) AS n_negative,
                  count(*) FILTER (WHERE mr.mr_supported IS NOT NULL) AS n_mr_tested,
                  count(*) FILTER (WHERE mr.mr_supported) AS n_mr_supported
           FROM ${from} WHERE ${w}`,
          ...params
        );
        const records = await ctx.db.query(
          `SELECT e.exposure, e.term, e.category, e.protein, e.spec, e.n_train, e.n_test,
                  e.beta_train, e.se_train, e.p_train, e.beta_test, e.se_test, e.p_test, e.replicated,
                  mr.mr_supported, mr.mr_tier_ukb, mr.mr_tier_decode
           FROM ${from}
           WHERE ${w}
           ORDER BY e.replicated DESC, abs(e.beta_test) DESC NULLS LAST, e.exposure, e.protein
           LIMIT ${lim}`,
          ...params
        );
        const n = Number(summary?.n_associations ?? 0);
        return text({
          query: { exposure, protein, category, spec: spec ?? "base", replicated_only: replicated_only ?? true, mr_supported_only: mr_supported_only ?? false },
          summary,
          records,
          n_returned: records.length,
          notes: [
            n === 0
              ? "No matching associations. Call heap_exposure_proteins with no arguments to list exposure IDs, or set replicated_only=false."
              : `Showing ${records.length} of ${n} associations, largest held-out observational effect first; ${Number(summary?.n_mr_supported ?? 0)} are MR supported (of ${Number(summary?.n_mr_tested ?? 0)} with an MR test). Set mr_supported_only=true to list those.`,
            "One row per model term × protein. `term` is the exposure ID plus a level suffix for ordinal exposures (each level contrasted with the reference level), so one exposure can have several rows per protein and the sign depends on the field's coding.",
            "beta_train / beta_test: effect estimate on the protein level in the training and held-out splits (HEAP's scale); `replicated` is HEAP's train→test replication flag.",
            MR_SUPPORTED_NOTE,
            "mr_tier_ukb / mr_tier_decode: HEAP's MR tier for the exposure→protein edge using UKB Olink or deCODE SomaScan protein GWAS (Tier1plus > Tier1 > Tier2 > Suggestive; Reverse = MR favours protein→exposure; Null = tested, no evidence).",
            "Population is UK Biobank (UK, ages 40–69 at recruitment, self-reported exposures); it is independent of NHANES.",
          ],
          citation: await citation(ctx),
        });
      } catch (err) {
        return fail(ctx, err);
      }
    }
  );

  // ── 2. P→D ─────────────────────────────────────────────────────────────
  server.tool(
    "heap_protein_disease",
    "HEAP (heap.bio) protein→disease evidence in UK Biobank: for each of 2,686 plasma proteins × 181 incident diseases, the observational Cox hazard ratio of the protein, how much of the total exposome score's effect on that disease runs through the protein (natural indirect effect, proportion mediated), and Mendelian-randomization tiers for protein→disease using cis and trans pQTLs (UKB Olink and deCODE SomaScan arms, FinnGen outcomes) with colocalization. Query by protein, disease, or both. Use to ask whether a protein moved by an exposure is itself associated with, or causal for, disease.",
    {
      protein: z.string().optional().describe("Olink protein / gene symbol, exact (e.g., 'GDF15')"),
      disease: z.string().optional().describe("Disease name fragment (e.g., 'heart failure', 'diabetes'), ICD-10 3-character code (e.g., 'I50'), or UKB first-occurrence ID"),
      mediation_significant_only: z.boolean().optional().default(false).describe("Only protein–disease pairs where HEAP flags the exposome→protein→disease indirect effect as significant"),
      max_protein_p: z.number().optional().describe("Only pairs with observational protein P-value below this"),
      mr_supported_only: z.boolean().optional().default(false).describe("Only pairs whose protein→disease edge is MR supported (HEAP MR tier Tier1plus or Tier1, i.e. colocalized cis-pQTL MR)"),
      limit: z.number().optional().default(25).describe("Max observational records (default 25, max 200)"),
    },
    async ({ protein, disease, mediation_significant_only, max_protein_p, mr_supported_only, limit }) => {
      if (!protein && !disease) return text({ error: "Provide a protein, a disease, or both." });
      try {
        const lim = clamp(limit, 25, 200);
        const params: unknown[] = [];
        const where: string[] = [];
        if (protein) { where.push("upper(protein) = ?"); params.push(protein.trim().toUpperCase()); }
        if (disease) where.push(diseaseFilter(disease, { label: "disease_label", id: "dz_id", icd: "icd10" }, params));
        if (mediation_significant_only) where.push("sig");
        if (max_protein_p != null) { where.push("protein_p < ?"); params.push(max_protein_p); }
        if (mr_supported_only) where.push("mr.mr_supported");
        const w = where.join(" AND ");
        const from = `heap_mediation LEFT JOIN ${mrByDisease("'Pcis_to_D', 'Ptrans_to_D'")} mr ON mr.src_id = protein AND mr.mr_dz_id = dz_id`;

        const [summary] = await ctx.db.query<Record<string, unknown>>(
          `SELECT count(*) AS n_pairs, count(DISTINCT protein) AS n_proteins, count(DISTINCT dz_id) AS n_diseases,
                  count(*) FILTER (WHERE protein_p < 0.05 / 451520) AS n_protein_bonferroni,
                  count(*) FILTER (WHERE sig) AS n_mediation_significant,
                  count(*) FILTER (WHERE mr.mr_supported IS NOT NULL) AS n_mr_tested,
                  count(*) FILTER (WHERE mr.mr_supported) AS n_mr_supported
           FROM ${from} WHERE ${w}`,
          ...params
        );
        const observational = await ctx.db.query(
          `SELECT protein, disease_label, icd10, dz_id, n_cases, protein_hr, protein_p,
                  nie_hr, nie_l95, nie_u95, nde_hr, total_hr, prop_mediated, q AS mediation_q, sig AS mediation_significant,
                  mr.mr_supported, mr.mr_tier, mr.mr_edge, mr.mr_finngen_endpoints
           FROM ${from} WHERE ${w}
           ORDER BY protein_p ASC NULLS LAST, protein, dz_id LIMIT ${lim}`,
          ...params
        );

        const mrParams: unknown[] = [];
        const mrWhere = ["edge_dir IN ('Pcis_to_D', 'Ptrans_to_D')", "mr_tier_final <> 'Null'"];
        if (protein) { mrWhere.push("upper(src_id) = ?"); mrParams.push(protein.trim().toUpperCase()); }
        if (disease) mrWhere.push(finngenFilter(disease, "tgt_id", mrParams));
        const mr = await ctx.db.query(
          `SELECT src_id AS protein, tgt_id AS finngen_endpoint, edge_class AS instrument, arm, nsnp,
                  mr_tier_final AS mr_tier, mr_tier_final IN ${MR_SUPPORTED_TIERS} AS mr_supported, replicated AS replicated_both_arms, tier_reason, het_status, coloc_status, coloc_pph4
           FROM heap_mr_edges WHERE ${mrWhere.join(" AND ")}
           ORDER BY ${tierRank("mr_tier_final")},
                    coloc_pph4 DESC NULLS LAST, src_id, tgt_id
           LIMIT ${lim}`,
          ...mrParams
        );

        return text({
          query: { protein, disease, mediation_significant_only, max_protein_p, mr_supported_only: mr_supported_only ?? false },
          summary,
          observational,
          mendelian_randomization: mr,
          notes: [
            observational.length === 0 ? "No matching protein–disease pairs. Check the protein symbol, or try a shorter disease name or an ICD-10 code." : `Showing ${observational.length} of ${Number(summary?.n_pairs ?? 0)} pairs, smallest observational P first.`,
            "protein_hr: observational Cox hazard ratio of the protein for incident disease (HEAP's protein scale). n_protein_bonferroni counts pairs below 0.05 / 451,520 (all protein–disease pairs tested).",
            "nie_hr / prop_mediated: natural indirect effect of HEAP's total exposome score on the disease through this protein. It concerns the whole exposome score (driver PXS_total), not a single exposure.",
            MR_SUPPORTED_NOTE,
            "On observational rows, mr_tier / mr_edge give the best protein→disease MR tier across arms and whether it came from cis (Pcis_to_D) or trans (Ptrans_to_D) pQTL instruments.",
            "mendelian_randomization lists non-null protein→disease MR edges only; outcomes are FinnGen R12 endpoints, matched to the disease through HEAP's disease dictionary where one exists. cis-pQTL edges with coloc_pph4 ≥ 0.8 are the strongest causal evidence; HEAP reports that few observational mediators reach it.",
          ],
          citation: await citation(ctx),
        });
      } catch (err) {
        return fail(ctx, err);
      }
    }
  );

  // ── 3. E→P→D triads ────────────────────────────────────────────────────
  server.tool(
    "heap_triads",
    "HEAP (heap.bio) exposure→protein→disease triads from two-sample Mendelian randomization: for each exposure–protein–disease triple that carries a causal motif, the MR estimate on all six directed edges (E→P, P→D cis/trans, E→D, P→E, D→P, D→E) and the motif they form — A mediator (E→P→D), B biomarker, C exposure-marker, D reverse (P→E), E disease-liability (D→P) — plus the observational proportion mediated for the protein–disease pair. Use to ask whether a protein plausibly carries an exposure's effect on a disease or is only a marker of exposure or of disease liability.",
    {
      exposure: z.string().optional().describe("Exposure name or ID fragment (e.g., 'pack years', 'television')"),
      protein: z.string().optional().describe("Protein / gene symbol, exact"),
      disease: z.string().optional().describe("Disease name fragment, ICD-10 code, UKB first-occurrence ID, or FinnGen endpoint fragment"),
      motif: z.enum(["A", "B", "C", "D", "E"]).optional().describe("Motif: A mediator, B biomarker, C exposure-marker, D reverse (P→E), E disease-liability (D→P)"),
      limit: z.number().optional().default(25).describe("Max triads (default 25, max 200)"),
    },
    async ({ exposure, protein, disease, motif, limit }) => {
      try {
        const lim = clamp(limit, 25, 200);
        const params: unknown[] = [];
        const where: string[] = ["TRUE"];
        if (exposure) { where.push("lower(t.exposure) LIKE ?"); params.push(like(exposure)); }
        if (protein) { where.push("upper(t.protein) = ?"); params.push(protein.trim().toUpperCase()); }
        if (disease) {
          const p = like(disease);
          where.push("(lower(d.disease_label) LIKE ? OR lower(t.dz_id) LIKE ? OR upper(t.icd10) = ? OR lower(t.finngen_id) LIKE ?)");
          params.push(p, p, disease.trim().toUpperCase(), p);
        }
        if (motif) { where.push("t.motif_code = ?"); params.push(motif); }
        const from = `heap_mr_triads t LEFT JOIN heap_diseases d USING (dz_id)`;
        const w = where.join(" AND ");

        const byMotif = await ctx.db.query(
          `SELECT t.motif_code, any_value(t.motif) AS motif, count(*) AS n_triads,
                  count(DISTINCT t.protein) AS n_proteins, count(DISTINCT t.exposure) AS n_exposures,
                  count(DISTINCT t.finngen_id) AS n_disease_endpoints
           FROM ${from} WHERE ${w} GROUP BY 1 ORDER BY 1`,
          ...params
        );
        const triads = await ctx.db.query(
          `SELECT t.exposure, t.category, t.protein, d.disease_label, t.icd10, t.finngen_id, t.dz_id,
                  t.motif_code, t.motif, t.arms,
                  t.beta_EP, t.se_EP, t.padj_EP,
                  t.beta_PDcis, t.se_PDcis, t.padj_PDcis, t.beta_PDtrans, t.se_PDtrans, t.padj_PDtrans,
                  t.beta_ED, t.se_ED, t.padj_ED,
                  t.beta_PEcis, t.padj_PEcis, t.beta_PEtrans, t.padj_PEtrans,
                  t.beta_DP, t.padj_DP, t.beta_DE, t.padj_DE,
                  m.protein_hr AS obs_protein_hr, m.protein_p AS obs_protein_p,
                  m.prop_mediated AS obs_prop_mediated_total_exposome, m.sig AS obs_mediation_significant
           FROM ${from}
           LEFT JOIN heap_mediation m ON m.protein = t.protein AND m.dz_id = t.dz_id
           WHERE ${w}
           ORDER BY t.motif_code, least(t.padj_EP, t.padj_PDcis) ASC NULLS LAST, t.exposure, t.protein
           LIMIT ${lim}`,
          ...params
        );
        const total = byMotif.reduce((s, r) => s + Number((r as Record<string, unknown>).n_triads ?? 0), 0);
        return text({
          query: { exposure, protein, disease, motif },
          n_triads: total,
          by_motif: byMotif,
          triads,
          n_returned: triads.length,
          motif_key: MOTIFS,
          notes: [
            total === 0 ? "No matching triads. HEAP only lists triples that carry a motif; try fewer filters." : `Showing ${triads.length} of ${total} triads, mediator motifs first.`,
            "beta_* are two-sample MR estimates with BH-adjusted P (padj_*): EP exposure→protein, PDcis/PDtrans protein→disease with cis or trans pQTL instruments, ED exposure→disease, PE protein→exposure, DP disease→protein, DE disease→exposure.",
            "`arms` says which pQTL panel supports the triad (UKB Olink, deCODE SomaScan, or both). Most triads are motif E or C: the protein marks disease liability or exposure rather than mediating it. Mediator (A) triads are rare and should be reported as candidates.",
            "obs_* columns are the observational Cox / mediation results for the same protein–disease pair (mediation of the total exposome score, not of this single exposure).",
            "Self-reported behaviours make weak MR exposures: instruments for lifestyle traits are prone to pleiotropy.",
          ],
          citation: await citation(ctx),
        });
      } catch (err) {
        return fail(ctx, err);
      }
    }
  );

  // ── 4. E→D ─────────────────────────────────────────────────────────────
  server.tool(
    "heap_exposure_disease",
    "HEAP (heap.bio) exposure→disease evidence in UK Biobank through proteome-based exposure scores (PES): for each exposure, a protein score trained to read that exposure from plasma, and its hazard ratio for 181 incident diseases — on its own and after adjusting for the self-reported exposure — with the held-out gain in C-index. Also returns non-null Mendelian-randomization edges for exposure→disease. Use to ask which diseases an exposure's proteomic footprint predicts, and whether the proteome adds information beyond self-report.",
    {
      exposure: z.string().optional().describe("Exposure name or ID fragment (e.g., 'smoking_status', 'alcohol', 'vigorous')"),
      disease: z.string().optional().describe("Disease name fragment, ICD-10 3-character code, or UKB first-occurrence ID"),
      fdr_only: z.boolean().optional().default(true).describe("Only pairs with PES FDR q < 0.05 (default true)"),
      mr_supported_only: z.boolean().optional().default(false).describe("Only pairs whose exposure→disease edge is MR supported (HEAP MR tier Tier1plus or Tier1)"),
      limit: z.number().optional().default(25).describe("Max records (default 25, max 200)"),
    },
    async ({ exposure, disease, fdr_only, mr_supported_only, limit }) => {
      if (!exposure && !disease) return text({ error: "Provide an exposure, a disease, or both." });
      try {
        const lim = clamp(limit, 25, 200);
        const params: unknown[] = [];
        const where: string[] = [];
        if (exposure) { where.push("lower(exposure_id) LIKE ?"); params.push(like(exposure)); }
        if (disease) where.push(diseaseFilter(disease, { label: "disease_label", id: "disease_field_id" }, params));
        if (fdr_only ?? true) where.push("q_pes < 0.05");
        if (mr_supported_only) where.push("mr.mr_supported");
        const w = where.join(" AND ");
        const from = `heap_pes_disease LEFT JOIN ${mrByDisease("'E_to_D'")} mr ON mr.src_id = exposure_id AND mr.mr_dz_id = disease_field_id`;

        const [summary] = await ctx.db.query<Record<string, unknown>>(
          `SELECT count(*) AS n_pairs, count(DISTINCT exposure_id) AS n_exposures, count(DISTINCT disease_field_id) AS n_diseases,
                  count(*) FILTER (WHERE q_pes < 0.05) AS n_fdr,
                  count(*) FILTER (WHERE q_pes_beyond_selfreport < 0.05) AS n_fdr_beyond_selfreport,
                  count(*) FILTER (WHERE mr.mr_supported IS NOT NULL) AS n_mr_tested,
                  count(*) FILTER (WHERE mr.mr_supported) AS n_mr_supported
           FROM ${from} WHERE ${w}`,
          ...params
        );
        const records = await ctx.db.query(
          `SELECT exposure_id AS exposure, disease_label, disease_field_id AS dz_id, n, events,
                  hr_pes, hr_pes_lo, hr_pes_hi, q_pes,
                  hr_pes_beyond_selfreport, hr_pes_beyond_selfreport_lo, hr_pes_beyond_selfreport_hi, q_pes_beyond_selfreport,
                  C_covariates_heldout, C_covariates_pes_heldout,
                  dC_over_covariates_heldout, dC_over_covariates_heldout_lo, dC_over_covariates_heldout_hi,
                  dC_beyond_selfreport_heldout, dC_beyond_selfreport_heldout_lo, dC_beyond_selfreport_heldout_hi,
                  mr.mr_supported, mr.mr_tier, mr.mr_finngen_endpoints
           FROM ${from} WHERE ${w}
           ORDER BY q_pes ASC NULLS LAST, abs(ln(hr_pes)) DESC NULLS LAST, exposure_id, disease_field_id
           LIMIT ${lim}`,
          ...params
        );

        const mrParams: unknown[] = [];
        const mrWhere = ["edge_dir = 'E_to_D'", "mr_tier_final <> 'Null'"];
        if (exposure) { mrWhere.push("lower(src_id) LIKE ?"); mrParams.push(like(exposure)); }
        if (disease) mrWhere.push(finngenFilter(disease, "tgt_id", mrParams));
        const mr = await ctx.db.query(
          `SELECT src_id AS exposure, tgt_id AS finngen_endpoint, arm, nsnp, mr_tier_final AS mr_tier,
                  mr_tier_final IN ${MR_SUPPORTED_TIERS} AS mr_supported,
                  replicated AS replicated_both_arms, tier_reason, het_status
           FROM heap_mr_edges WHERE ${mrWhere.join(" AND ")}
           ORDER BY ${tierRank("mr_tier_final")}, src_id, tgt_id
           LIMIT ${lim}`,
          ...mrParams
        );

        return text({
          query: { exposure, disease, fdr_only: fdr_only ?? true, mr_supported_only: mr_supported_only ?? false },
          summary,
          pes_disease: records,
          mendelian_randomization: mr,
          notes: [
            records.length === 0 ? "No matching exposure–disease pairs. Try fdr_only=false, a shorter name, or heap_exposure_proteins with no arguments to list exposure IDs." : `Showing ${records.length} of ${Number(summary?.n_pairs ?? 0)} pairs, smallest q first.`,
            "hr_pes: hazard ratio for incident disease per unit of the proteome-based exposure score, i.e. of the exposure as read from plasma proteins. It is the association of a proteomic signature, not the direct effect of the exposure, and the signature also captures correlated behaviours and physiology.",
            "hr_pes_beyond_selfreport: the same after adjusting for the self-reported exposure. dC_* are held-out gains in Cox C-index over covariates, and over covariates plus self-report.",
            MR_SUPPORTED_NOTE,
            "mendelian_randomization lists non-null exposure→disease MR edges (FinnGen R12 endpoints); `arm` is HEAP's dataset label (UKB or DECODE) for the edge set.",
          ],
          citation: await citation(ctx),
        });
      } catch (err) {
        return fail(ctx, err);
      }
    }
  );

  // ── 5. Cross-cutting: NHANES EP-WAS ↔ HEAP ─────────────────────────────
  server.tool(
    "heap_nhanes_bridge",
    "Cross-cohort view of one exposure in NHANES (US, EP-WAS atlas) and HEAP (UK Biobank proteomics): maps the exposure through a hand-curated bridge (smoking/cotinine, alcohol, coffee/caffeine, oily fish/omega-3, salt/sodium, physical activity, walking, sedentary time, and calcium/iron/selenium/zinc/folic-acid/B-vitamin supplements), then returns the NHANES EP-WAS phenotype associations for the NHANES variables beside HEAP's replicated plasma-protein signature and proteome-score disease associations for the UK Biobank exposures. Accepts a NHANES variable (LBXCOT), a HEAP exposure ID fragment, or a concept ('smoking'). Call with no query to list the bridge. The two sides measure the exposure differently and in different outcome spaces (clinical phenotypes vs proteins and incident disease), so this is triangulation, not replication of an effect size.",
    {
      query: z.string().optional().describe("NHANES exposure variable (e.g., 'LBXCOT', 'DR1TALCO'), HEAP exposure ID fragment, or concept (e.g., 'smoking', 'alcohol', 'coffee', 'sedentary'). Omit to list bridged concepts"),
      max_proteins: z.number().optional().default(10).describe("Top replicated proteins per HEAP exposure (default 10, max 50)"),
      max_phenotypes: z.number().optional().default(10).describe("Top NHANES phenotypes per NHANES variable (default 10, max 50)"),
      max_diseases: z.number().optional().default(5).describe("Top HEAP proteome-score diseases per HEAP exposure (default 5, max 25)"),
    },
    async ({ query, max_proteins, max_phenotypes, max_diseases }) => {
      try {
        if (!query?.trim()) {
          return text({
            bridge: HEAP_NHANES_BRIDGE.map((e) => ({ concept: e.concept, match: e.match, nhanes_variables: e.nhanes, heap_exposure_pattern: e.heap.source, note: e.note })),
            match_key: {
              biomarker: "NHANES has an objective biomarker of the HEAP self-reported behaviour",
              analog: "both are self-report/recall measures of the same behaviour, from different instruments",
              proxy: "related construct only",
            },
            citation: await citation(ctx),
          });
        }
        const entries = findBridgeEntries(query);
        if (entries.length === 0) {
          return text({
            query,
            error: "No bridge entry for this query. HEAP covers lifestyle and environmental exposures only (no chemical biomonitoring), so most NHANES lab exposures (metals, PFAS, phthalates, …) have no HEAP counterpart.",
            bridged_concepts: HEAP_NHANES_BRIDGE.map((e) => e.concept),
            citation: await citation(ctx),
          });
        }
        const nProt = clamp(max_proteins, 10, 50);
        const nPhen = clamp(max_phenotypes, 10, 50);
        const nDz = clamp(max_diseases, 5, 25);
        const allExposures = (await ctx.db.query<{ exposure: string }>(
          `SELECT DISTINCT exposure FROM heap_ep WHERE spec = 'base' ORDER BY 1`
        )).map((r) => r.exposure);

        const out = [];
        for (const e of entries) {
          const heapExposures = allExposures.filter((x) => e.heap.test(x));
          const ph = heapExposures.map(() => "?").join(", ");

          const proteins = heapExposures.length === 0 ? [] : await ctx.db.query(
            `SELECT exposure, term, protein, beta_train, beta_test, se_test, p_test,
                    mr.mr_supported, mr.mr_tier_ukb, mr.mr_tier_decode
             FROM heap_ep LEFT JOIN ${MR_EP} mr ON mr.src_id = exposure AND mr.tgt_id = protein
             WHERE spec = 'base' AND replicated AND exposure IN (${ph})
             QUALIFY row_number() OVER (PARTITION BY exposure ORDER BY abs(beta_test) DESC) <= ${nProt}
             ORDER BY exposure, abs(beta_test) DESC`,
            ...heapExposures
          );
          const proteinCounts = heapExposures.length === 0 ? [] : await ctx.db.query(
            `SELECT exposure, count(DISTINCT protein) AS n_replicated_proteins,
                    count(DISTINCT protein) FILTER (WHERE mr.mr_supported) AS n_mr_supported_proteins,
                    bool_or(mr.mr_supported IS NOT NULL) AS mr_tested
             FROM heap_ep LEFT JOIN ${MR_EP} mr ON mr.src_id = exposure AND mr.tgt_id = protein
             WHERE spec = 'base' AND replicated AND exposure IN (${ph}) GROUP BY 1 ORDER BY 2 DESC`,
            ...heapExposures
          );
          const diseases = heapExposures.length === 0 ? [] : await ctx.db.query(
            `SELECT exposure_id AS exposure, disease_label, hr_pes, hr_pes_lo, hr_pes_hi, q_pes,
                    hr_pes_beyond_selfreport, q_pes_beyond_selfreport, mr.mr_supported, mr.mr_tier
             FROM heap_pes_disease LEFT JOIN ${mrByDisease("'E_to_D'")} mr ON mr.src_id = exposure_id AND mr.mr_dz_id = disease_field_id
             WHERE q_pes < 0.05 AND exposure_id IN (${ph})
             QUALIFY row_number() OVER (PARTITION BY exposure_id ORDER BY q_pes ASC, abs(ln(hr_pes)) DESC) <= ${nDz}
             ORDER BY exposure_id, q_pes`,
            ...heapExposures
          );

          let nhanes: Record<string, unknown>[] = [];
          let nhanesError: string | undefined;
          try {
            const rows = await ctx.db.query<Record<string, unknown>>(
              `SELECT evarname AS exposure, pvarname AS phenotype,
                      "estimate.uwls" AS estimate, "std.error.uwls" AS std_error, "p.value.uwls" AS p_value,
                      "i.squared.uwls" AS i_squared, "k.uwls" AS n_cycles
               FROM pe_stats.adjusted_meta_uwls
               WHERE expo_name = 'expo' AND CAST(model_number AS INTEGER) = 6
                 AND evarname IN (${e.nhanes.map(() => "?").join(", ")})
                 AND "p.value.uwls" IS NOT NULL
               QUALIFY row_number() OVER (PARTITION BY evarname ORDER BY abs("p.value.uwls") ASC) <= ${nPhen}
               ORDER BY evarname, abs("p.value.uwls") ASC`,
              ...e.nhanes
            );
            nhanes = rows.map((r) => ({
              ...r,
              exposure_description: ctx.resolver.get(r.exposure as string)?.description ?? null,
              phenotype_description: ctx.resolver.get(r.phenotype as string)?.description ?? null,
            }));
          } catch (err) {
            nhanesError = `NHANES EP-WAS lookup failed: ${(err as Error).message}`;
          }

          out.push({
            concept: e.concept,
            match: e.match,
            measurement_note: e.note,
            nhanes_epwas: {
              cohort: "NHANES 1999–2018 (US), survey-weighted, meta-analyzed across cycles, model 6 (age, sex, ethnicity)",
              variables: e.nhanes,
              top_phenotype_associations: nhanes,
              ...(nhanesError ? { error: nhanesError } : {}),
            },
            heap_ukb: {
              cohort: "UK Biobank, Olink plasma proteomics, base specification, replicated in held-out split",
              exposures: proteinCounts.length ? proteinCounts : heapExposures,
              top_proteins: proteins,
              top_proteome_score_diseases: diseases,
            },
          });
        }

        return text({
          query,
          n_concepts: out.length,
          results: out,
          notes: [
            "The bridge is hand-curated in ExposomeQL (src/variables/heap-nhanes-bridge.ts), not part of HEAP or the EP-WAS atlas. `match` says how close the two measures are; read measurement_note before comparing directions.",
            "Do not compare effect sizes across the two sides: NHANES estimates are on the EP-WAS atlas's scale for a biomarker or intake against clinical phenotypes; HEAP estimates are per exposure level or unit against protein levels, and hazard ratios for a proteomic score.",
            "Consistency to look for: the NHANES phenotypes and the HEAP proteins/diseases pointing at the same biology (e.g. inflammation, lipid metabolism, liver or kidney function). Follow up with heap_exposure_proteins, heap_triads, epwas_search and ctd_triangulate.",
            "Bonferroni threshold for the NHANES EP-WAS atlas is 3.02e-07.",
            MR_SUPPORTED_NOTE,
            "MR flags apply to the HEAP side only (exposure→protein and exposure→disease edges); the NHANES EP-WAS associations are observational.",
          ],
          citation: await citation(ctx),
        });
      } catch (err) {
        return fail(ctx, err);
      }
    }
  );
}
