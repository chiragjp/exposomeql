#!/usr/bin/env npx tsx
/**
 * HEAP (Human Exposomic Architecture of the Proteome, https://heap.bio) ETL for ExposomeQL.
 *
 * HEAP links 169 lifestyle/environmental exposures (E) to 2,686 plasma proteins (P) and 181
 * incident diseases (D) in ~53K UK Biobank participants, with Mendelian-randomization and
 * trial evidence on each edge. The site publishes its supplementary data in a public bucket;
 * this script downloads the tables that carry the E→P, P→D, E→P→D and E→D graph and writes
 * Parquet files that DuckDBManager registers as `heap_*` views at startup.
 *
 * Licensing: the public downloads are CC BY-NC-ND 4.0. ExposomeQL redistributes and harmonizes
 * them with permission of the HEAP authors; every tool response carries the citation block
 * written to manifest.json here.
 *
 * Usage:
 *   npx tsx scripts/heap-etl.ts                 # download + convert
 *   npx tsx scripts/heap-etl.ts --skip-download # reconvert already-downloaded files
 *
 * Env:
 *   HEAP_BASE            override the bucket (default https://storage.googleapis.com/heap-data)
 *   EXPOSOMEQL_DATA_DIR  data directory (default ./data); output goes to <dataDir>/heap/
 *
 * Output:
 *   <dataDir>/heap/raw/      downloaded TSV/JSON (decompressed)
 *   <dataDir>/heap/parquet/  heap_ep, heap_mediation, heap_mr_edges, heap_mr_triads,
 *                            heap_pes_disease, heap_intervention, heap_diseases (.parquet),
 *                            manifest.json
 */

import fs from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import duckdb from "duckdb";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const BUCKET = (process.env.HEAP_BASE ?? "https://storage.googleapis.com/heap-data").replace(/\/+$/, "");
const SUPP = `${BUCKET}/supp/v1`;
const WEB = `${BUCKET}/web/v1`;
const DATA_DIR = process.env.EXPOSOMEQL_DATA_DIR ?? path.join(PROJECT_ROOT, "data");
const OUT_DIR = path.join(DATA_DIR, "heap");
const RAW_DIR = path.join(OUT_DIR, "raw");
const PARQUET_DIR = path.join(OUT_DIR, "parquet");

const SKIP_DOWNLOAD = process.argv.includes("--skip-download");

/** Covariate specifications of the exposure→protein association sweep (see supp/v1/README.txt). */
const EP_SPECS = ["base", "base_plus_bmi", "base_plus_clinical", "base_plus_blood_draw", "exclude_prevalent_disease"];

/** [remote URL, local file name under raw/] */
const SOURCES: Array<[string, string]> = [
  ...EP_SPECS.map((s): [string, string] => [`${SUPP}/associations_E/${s}.tsv.gz`, `associations_E_${s}.tsv`]),
  [`${SUPP}/mediation/base/exposome_mediation.tsv.gz`, "exposome_mediation.tsv"],
  [`${SUPP}/mendelian_randomization/mr_edges.tsv.gz`, "mr_edges.tsv"],
  [`${SUPP}/pes_scores/disease/pes_disease_lookup.tsv.gz`, "pes_disease_lookup.tsv"],
  [`${SUPP}/intervention_concordance/intervention.tsv.gz`, "intervention.tsv"],
  [`${SUPP}/README.txt.gz`, "README.txt"],
  [`${WEB}/s/mr_triads.json.gz`, "mr_triads.json"],
  [`${WEB}/manifest.json.gz`, "web_manifest.json"],
];

/**
 * Download to `dest`, always leaving plain (decompressed) bytes. The bucket stores objects
 * gzip-encoded; depending on the client's Accept-Encoding they arrive already decoded or still
 * gzipped, so sniff the magic bytes instead of trusting the `.gz` suffix.
 */
async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "exposomeql-etl" } });
  if (!res.ok || !res.body) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const part = dest + ".part";
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(part));
  const fd = fs.openSync(part, "r");
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    await pipeline(fs.createReadStream(part), createGunzip(), fs.createWriteStream(dest));
    fs.unlinkSync(part);
  } else {
    fs.renameSync(part, dest);
  }
  console.error(`  ✓ ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

function duckExec(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => conn.exec(sql, (err) => (err ? reject(err) : resolve())));
}

function duckAll(conn: duckdb.Connection, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows as Record<string, unknown>[]))));
}

const q = (p: string) => p.replace(/'/g, "''");
const raw = (f: string) => q(path.join(RAW_DIR, f));
const pq = (name: string) => q(path.join(PARQUET_DIR, `${name}.parquet`));
const tsv = (files: string | string[]) =>
  `read_csv(${Array.isArray(files) ? `[${files.map((f) => `'${raw(f)}'`).join(", ")}]` : `'${raw(files)}'`},
            delim='\t', header=true, sample_size=-1, nullstr=['', 'NA', 'NaN'], union_by_name=true)`;

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(PARQUET_DIR, { recursive: true });

  // ── 1. Download ─────────────────────────────────────────────────────────
  if (!SKIP_DOWNLOAD) {
    console.error(`[heap-etl] Downloading HEAP tables from ${BUCKET}`);
    for (const [url, file] of SOURCES) await download(url, path.join(RAW_DIR, file));
  }
  for (const [, file] of SOURCES) {
    if (!fs.existsSync(path.join(RAW_DIR, file))) throw new Error(`Missing ${file} in ${RAW_DIR}; run without --skip-download`);
  }

  // ── 2. MR triads: columnar JSON ({col: [...]}) → NDJSON rows ─────────────
  const triads: Record<string, unknown[]> = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "mr_triads.json"), "utf-8"));
  const rename: Record<string, string> = {
    Exposure: "exposure", "Exposure category": "category", Protein: "protein",
    Disease: "finngen_id", ICD10: "icd10", Disease_UKB: "dz_id",
  };
  const cols = Object.keys(triads);
  const nTriads = triads[cols[0]].length;
  const triadTmp = path.join(PARQUET_DIR, "_mr_triads.ndjson");
  const fd = fs.openSync(triadTmp, "w");
  for (let i = 0; i < nTriads; i++) {
    const row: Record<string, unknown> = {};
    for (const c of cols) row[rename[c] ?? c] = triads[c][i] ?? null;
    // "A Mediator (E->P->D)" → code "A" + label "Mediator (E->P->D)"
    const m = String(row.motif ?? "").match(/^([A-E])\s+(.*)$/);
    row.motif_code = m ? m[1] : null;
    row.motif = m ? m[2] : row.motif;
    fs.writeSync(fd, JSON.stringify(row) + "\n");
  }
  fs.closeSync(fd);

  // ── 3. Parquet via DuckDB ───────────────────────────────────────────────
  const db = new duckdb.Database(":memory:");
  const conn = db.connect();
  const copy = (name: string, select: string) =>
    duckExec(conn, `COPY (${select}) TO '${pq(name)}' (FORMAT PARQUET, COMPRESSION ZSTD)`);

  // E→P: exposure-term × protein associations, one file per covariate specification
  await copy("heap_ep", `
    SELECT Exposure AS exposure, Term AS term, Protein AS protein, Category AS category,
           spec, spec_kind, covariate_set, run_id,
           N_train AS n_train, N_test AS n_test,
           beta_train, SE_train AS se_train, p_train,
           beta_test, SE_test AS se_test, p_test,
           CAST(replicated AS BOOLEAN) AS replicated
    FROM ${tsv(EP_SPECS.map((s) => `associations_E_${s}.tsv`))}`);

  // P→D: observational Cox HR per protein-disease pair + mediation of the total exposome score
  await copy("heap_mediation", `
    SELECT exposure_category AS driver, protID AS protein, icd AS icd10, disease AS disease_label, DZ_ID AS dz_id,
           n_cases, protein_HR AS protein_hr, protein_p,
           nie_HR AS nie_hr, nie_l95, nie_u95, nie_p,
           nde_HR AS nde_hr, nde_l95, nde_u95, nde_p,
           total_HR AS total_hr, prop_mediated, q,
           CAST(sig AS BOOLEAN) AS sig, CAST(estimable AS BOOLEAN) AS estimable,
           CAST(driver_present AS BOOLEAN) AS driver_present, CAST(pm_clamped AS BOOLEAN) AS pm_clamped
    FROM ${tsv("exposome_mediation.tsv")}`);

  // MR edges in all six directions, both pQTL arms (UKB Olink, deCODE SomaScan); tiers only
  await copy("heap_mr_edges", `
    SELECT dataset AS arm, edge_dir, src_id, tgt_id, lane, edge_class, nsnp,
           mr_tier, mr_tier_final, CAST(replicated AS BOOLEAN) AS replicated,
           tier_reason, het_status, coloc_status, coloc_pph4
    FROM ${tsv("mr_edges.tsv")}`);

  await copy("heap_mr_triads", `
    SELECT exposure, category, protein, finngen_id, icd10, dz_id, motif_code, motif, arms,
           * EXCLUDE (exposure, category, protein, finngen_id, icd10, dz_id, motif_code, motif, arms)
    FROM read_json_auto('${q(triadTmp)}', format='newline_delimited', sample_size=-1)`);

  // E→D: proteome-based exposure score (PES) vs incident disease
  await copy("heap_pes_disease", `SELECT * FROM ${tsv("pes_disease_lookup.tsv")}`);

  // E→P beside trial effects (HERITAGE exercise training; STEP1/STEP2 semaglutide)
  await copy("heap_intervention", `
    SELECT covarType AS spec, exposure_id AS exposure, Eid AS term, Category AS category, protein,
           beta_HEAP AS beta_heap, se_HEAP AS se_heap,
           HERITAGE_effect AS heritage_effect, HERITAGE_se AS heritage_se,
           GLP1_effect1 AS step1_effect, GLP1_se1 AS step1_se,
           GLP1_effect2 AS step2_effect, GLP1_se2 AS step2_se, olink_soma_r
    FROM ${tsv("intervention.tsv")}`);

  // Disease dictionary: UKB first-occurrence ID ↔ ICD-10 ↔ label ↔ FinnGen endpoint(s) used in MR
  await copy("heap_diseases", `
    SELECT m.dz_id, m.icd10, m.disease_label,
           coalesce(list(DISTINCT t.finngen_id) FILTER (WHERE t.finngen_id IS NOT NULL), []) AS finngen_ids
    FROM (SELECT DISTINCT dz_id, icd10, disease_label FROM read_parquet('${pq("heap_mediation")}')) m
    LEFT JOIN (SELECT DISTINCT dz_id, finngen_id FROM read_parquet('${pq("heap_mr_triads")}')) t USING (dz_id)
    GROUP BY ALL`);

  const counts: Record<string, number> = {};
  for (const v of ["heap_ep", "heap_mediation", "heap_mr_edges", "heap_mr_triads", "heap_pes_disease", "heap_intervention", "heap_diseases"]) {
    const [r] = await duckAll(conn, `SELECT count(*) AS n FROM read_parquet('${pq(v)}')`);
    counts[v] = Number(r.n);
  }
  await new Promise<void>((r) => db.close(() => r()));
  fs.unlinkSync(triadTmp);

  let webVersion: string | null = null;
  try { webVersion = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "web_manifest.json"), "utf-8")).version ?? null; } catch { /* optional */ }

  const meta = {
    dataset: "HEAP — Human Exposomic Architecture of the Proteome",
    homepage: "https://heap.bio/",
    source: BUCKET,
    version: webVersion,
    citation:
      "Isaac SK, Ellis RJ, Jee YH, Murthy VL, Udler MS, Neale B, Sunyaev S, Gusev A, Martin A, Patel CJ. Human Plasma Proteomics Links Modifiable Lifestyle Exposome to Disease Risk. medRxiv, 2026 (version 2, posted 2026-11-13). https://doi.org/10.1101/2025.05.07.25327178",
    doi: "10.1101/2025.05.07.25327178",
    url: "https://www.medrxiv.org/content/10.1101/2025.05.07.25327178v2",
    license: "CC BY-NC-ND 4.0 (https://creativecommons.org/licenses/by-nc-nd/4.0/)",
    license_note:
      "Redistributed and harmonized in ExposomeQL with permission of the HEAP authors. Non-commercial use; cite the HEAP preprint when reporting these results.",
    population: "UK Biobank (~53K participants with Olink plasma proteomics); MR arms: UKB Olink and deCODE SomaScan pQTLs, FinnGen R12 disease endpoints",
    downloaded_at: new Date().toISOString(),
    counts,
  };
  fs.writeFileSync(path.join(PARQUET_DIR, "manifest.json"), JSON.stringify(meta, null, 2));

  console.error(`[heap-etl] Wrote ${Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(", ")} → ${PARQUET_DIR}`);
}

main().catch((err) => {
  console.error(`[heap-etl] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
