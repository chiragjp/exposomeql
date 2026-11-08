#!/usr/bin/env npx tsx
/**
 * ExposomeAtlas (evidence.exposomeatlas.com) ETL for ExposomeQL.
 *
 * The ExposomeAtlas console's REST API (/api/associations, /api/insights, ...) needs a
 * signed-in account, but the corpus is also published as an open FAIR linked-data export
 * (CC BY 4.0). This script reads the DCAT dataset manifest, downloads each distribution
 * (entities, papers, associations), flattens the JSON-LD and writes Parquet files that
 * DuckDBManager registers as views at startup.
 *
 * Usage:
 *   npx tsx scripts/exposomeatlas-etl.ts                 # download + convert
 *   npx tsx scripts/exposomeatlas-etl.ts --skip-download # reconvert already-downloaded files
 *
 * Env:
 *   EXPOSOMEATLAS_BASE   override the FAIR base (default https://demo.healthfax.ai/exposomeatlas)
 *   EXPOSOMEQL_DATA_DIR  data directory (default ./data); output goes to <dataDir>/exposomeatlas/
 *
 * Output:
 *   <dataDir>/exposomeatlas/raw/      dataset.jsonld, entities.jsonld, papers.jsonld, associations.ndjson.gz
 *   <dataDir>/exposomeatlas/parquet/  atlas_associations.parquet, atlas_entities.parquet,
 *                                     atlas_papers.parquet, manifest.json
 */

import fs from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import duckdb from "duckdb";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const FAIR_BASE = (process.env.EXPOSOMEATLAS_BASE ?? "https://demo.healthfax.ai/exposomeatlas").replace(/\/+$/, "");
const DATA_DIR = process.env.EXPOSOMEQL_DATA_DIR ?? path.join(PROJECT_ROOT, "data");
const OUT_DIR = path.join(DATA_DIR, "exposomeatlas");
const RAW_DIR = path.join(OUT_DIR, "raw");
const PARQUET_DIR = path.join(OUT_DIR, "parquet");

const SKIP_DOWNLOAD = process.argv.includes("--skip-download");

const ID_PREFIX = "/exposomeatlas/id/";

type Json = Record<string, any>;

function localId(iri: string | undefined): string | null {
  if (!iri) return null;
  const i = iri.lastIndexOf("/");
  return i >= 0 ? iri.slice(i + 1) : iri;
}

function ontologyFields(node: Json | undefined) {
  const m = node?.ontologyMapping ?? {};
  return {
    curie: m.curie ?? null,
    ontology: m.ontology ?? null,
    match: node?.exactMatch ? "exact" : node?.closeMatch ? "close" : null,
    confidence: typeof m.confidence === "number" ? m.confidence : null,
    status: m.status ?? null,
  };
}

// ── Cohort harmonization ──────────────────────────────────────────────────
// The export's `cohort` is free text written per paper: the same cohort appears under several
// spellings ("UKB", "UK Biobank", "UKB-England"), and many values are not cohorts at all but
// pooled/meta-analytic samples or review summaries. We keep the raw string and add:
//   cohort       canonical name (aliases collapsed)
//   cohort_kind  'cohort' | 'pooled_or_review' | 'unspecified'
//   nhanes_based true when the source population is NHANES (not independent of EP-WAS)

/** [pattern on the raw string, canonical name]; first match wins. */
const COHORT_ALIASES: Array<[RegExp, string]> = [
  [/\bNHANES\b/i, "NHANES"],
  [/^(UKB|UK Biobank)\b/i, "UK Biobank"],
  [/^HELIX\b/i, "HELIX"],
  [/^Generation R\b/i, "Generation R"],
  [/^ABCD\b/i, "ABCD"],
  [/^Add Health\b/i, "Add Health"],
  [/^(BAPE|Biomarkers of Air Pollution Exposure)\b/i, "BAPE"],
  [/^Medicare FFS\b/i, "Medicare FFS"],
  [/^(Growing Up Today Study|GUTS)\b(?!,)/i, "GUTS"],
  [/^NHS\+HPFS\b/i, "NHS+HPFS"], // pooled analysis of two named cohorts; one population unit
];

const POOLED_OR_REVIEW =
  /\b(pooled|meta[- ]?(analy\w*|pooled)?|review|synthesis|evidence base|corpus|systematic|narrative)\b|^POOLED|^REVIEW-|^Meta-pooled$|-pool$/i;

function harmonizeCohort(raw: unknown): { cohort: string | null; cohort_kind: string; nhanes_based: boolean } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s === "—" || s === "-") return { cohort: null, cohort_kind: "unspecified", nhanes_based: false };
  const nhanes = /\bNHANES\b/i.test(s);
  for (const [re, canon] of COHORT_ALIASES) {
    // Keep pooled variants (e.g. "HELIX (pooled)") as the parent cohort: still one population.
    if (re.test(s)) return { cohort: canon, cohort_kind: "cohort", nhanes_based: nhanes };
  }
  return { cohort: s, cohort_kind: POOLED_OR_REVIEW.test(s) ? "pooled_or_review" : "cohort", nhanes_based: nhanes };
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "exposomeql-etl" } });
  if (!res.ok || !res.body) throw new Error(`GET ${url} → HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
  console.error(`  ✓ ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

function writeNdjson(file: string, rows: Iterable<Json>): number {
  const fd = fs.openSync(file, "w");
  let n = 0;
  for (const r of rows) { fs.writeSync(fd, JSON.stringify(r) + "\n"); n++; }
  fs.closeSync(fd);
  return n;
}

function duckExec(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => conn.exec(sql, (err) => (err ? reject(err) : resolve())));
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(PARQUET_DIR, { recursive: true });

  // ── 1. Manifest + distributions ─────────────────────────────────────────
  const manifestPath = path.join(RAW_DIR, "dataset.jsonld");
  if (!SKIP_DOWNLOAD) {
    console.error(`[atlas-etl] Fetching dataset manifest from ${FAIR_BASE}/dataset`);
    await download(`${FAIR_BASE}/dataset`, manifestPath);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const dists: Json[] = manifest["dcat:distribution"] ?? [];
  const urlFor = (file: string) =>
    dists.map((d) => d["dcat:downloadURL"] as string).find((u) => u?.endsWith("/" + file)) ??
    `${FAIR_BASE}/download/${file}`;

  const files = ["entities.jsonld", "papers.jsonld", "associations.ndjson.gz"];
  if (!SKIP_DOWNLOAD) {
    for (const f of files) await download(urlFor(f), path.join(RAW_DIR, f));
  }

  // ── 2. Entities ─────────────────────────────────────────────────────────
  const entGraph: Json[] = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "entities.jsonld"), "utf-8"))["@graph"] ?? [];
  const entities = entGraph.map((e) => {
    const types: string[] = Array.isArray(e["@type"]) ? e["@type"] : [e["@type"]];
    const kind = types.includes("Exposure") ? "exposure" : types.includes("Outcome") ? "phenotype" : "other";
    const o = ontologyFields(e);
    return {
      entity_id: localId(e["@id"]), kind, label: e.label ?? null, category: e.category ?? null,
      ontology_curie: o.curie, ontology: o.ontology, ontology_match: o.match,
      ontology_confidence: o.confidence, ontology_status: o.status, iri: e["@id"],
    };
  });
  const categoryById = new Map(entities.map((e) => [e.entity_id, e.category]));

  // ── 3. Papers ───────────────────────────────────────────────────────────
  const paperGraph: Json[] = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "papers.jsonld"), "utf-8"))["@graph"] ?? [];
  const papers = paperGraph.map((p) => ({
    paper_id: localId(p["@id"]), journal: p.label ?? null,
    citation: p["dcterms:bibliographicCitation"] ?? null,
    doi: typeof p["schema:identifier"] === "string" ? p["schema:identifier"].replace(/^doi:/, "") : null,
    year: Number((p["dcterms:bibliographicCitation"] ?? "").match(/(19|20)\d{2}\b/)?.[0]) || null,
    n_associations: typeof p.contributesTo === "number" ? p.contributesTo : null,
    iri: p["@id"],
  }));

  // ── 4. Associations (streamed; ~128K lines) ─────────────────────────────
  const assocTmp = path.join(PARQUET_DIR, "_associations.ndjson");
  const out = fs.createWriteStream(assocTmp);
  const rl = createInterface({ input: fs.createReadStream(path.join(RAW_DIR, "associations.ndjson.gz")).pipe(createGunzip()), crlfDelay: Infinity });
  let nAssoc = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const d: Json = JSON.parse(line);
    const s = d["OBAN:association_has_subject"] ?? {};
    const o = d["OBAN:association_has_object"] ?? {};
    const e = d.effect ?? {};
    const src = d.wasDerivedFrom ?? {};
    const ev = d.hasEvidence ?? {};
    const so = ontologyFields(s), oo = ontologyFields(o);
    const expId = localId(s["@id"]), outId = localId(o["@id"]);
    const citation: string | null = src["dcterms:bibliographicCitation"] ?? null;
    const row = {
      assoc_id: localId(d["@id"]),
      exposure_id: expId, exposure: s.label ?? null, exposure_category: categoryById.get(expId) ?? null,
      exposure_curie: so.curie, exposure_ontology_match: so.match,
      phenotype_id: outId, phenotype: o.label ?? null, phenotype_category: categoryById.get(outId) ?? null,
      phenotype_curie: oo.curie, phenotype_ontology_match: oo.match,
      metric: e.type ?? null,
      estimate: typeof e.value === "number" ? e.value : null,
      ci_lower: typeof e.ciLower === "number" ? e.ciLower : null,
      ci_upper: typeof e.ciUpper === "number" ? e.ciUpper : null,
      ci_level: typeof e.ciLevel === "number" ? e.ciLevel : null,
      p_fdr: typeof e.pFDR === "number" ? e.pFDR : null,
      passed_fdr: e.passedFDR === true,
      direction: e.direction ?? null,
      // "nhanes_atlas" = computed from NHANES summary stats (overlaps ExposomeQL's own EP-WAS);
      // "literature" = human/LLM-curated from a published paper.
      evidence_source: ev["@id"] === "obo:ECO_0007672" ? "nhanes_atlas" : "literature",
      evidence_label: ev.label ?? null,
      generated_by: d["prov:wasGeneratedBy"]?.label ?? null,
      paper_id: localId(src["@id"]), citation,
      doi: typeof src["schema:identifier"] === "string" ? src["schema:identifier"].replace(/^doi:/, "") : null,
      year: Number(citation?.match(/(19|20)\d{2}\b/)?.[0]) || null,
      cohort_raw: typeof d.cohort === "string" && d.cohort.trim() && d.cohort !== "—" ? d.cohort : null,
      ...harmonizeCohort(d.cohort),
      iri: d["@id"],
    };
    if (!out.write(JSON.stringify(row) + "\n")) await new Promise((r) => out.once("drain", r));
    nAssoc++;
  }
  await new Promise<void>((r) => out.end(r));

  const entTmp = path.join(PARQUET_DIR, "_entities.ndjson");
  const papTmp = path.join(PARQUET_DIR, "_papers.ndjson");
  writeNdjson(entTmp, entities);
  writeNdjson(papTmp, papers);

  // ── 5. Parquet via DuckDB ───────────────────────────────────────────────
  const db = new duckdb.Database(":memory:");
  const conn = db.connect();
  const q = (p: string) => p.replace(/'/g, "''");
  const toParquet = (tmp: string, name: string) =>
    duckExec(conn, `COPY (SELECT * FROM read_json_auto('${q(tmp)}', format='newline_delimited', sample_size=-1))
                    TO '${q(path.join(PARQUET_DIR, name))}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  await toParquet(assocTmp, "atlas_associations.parquet");
  await toParquet(entTmp, "atlas_entities.parquet");
  await toParquet(papTmp, "atlas_papers.parquet");
  await new Promise<void>((r) => db.close(() => r()));
  for (const f of [assocTmp, entTmp, papTmp]) fs.unlinkSync(f);

  const meta = {
    source: "ExposomeAtlas FAIR export",
    homepage: "https://evidence.exposomeatlas.com/",
    dataset_iri: manifest["@id"],
    title: manifest.label,
    version: manifest["schema:version"] ?? null,
    modified: manifest["dcterms:modified"] ?? null,
    license: manifest["dcterms:license"] ?? "https://creativecommons.org/licenses/by/4.0/",
    downloaded_at: new Date().toISOString(),
    counts: { associations: nAssoc, entities: entities.length, papers: papers.length },
    id_prefix: FAIR_BASE.replace(/\/exposomeatlas$/, "") + ID_PREFIX,
  };
  fs.writeFileSync(path.join(PARQUET_DIR, "manifest.json"), JSON.stringify(meta, null, 2));

  console.error(`[atlas-etl] Wrote ${nAssoc} associations, ${entities.length} entities, ${papers.length} papers → ${PARQUET_DIR}`);
  console.error(`[atlas-etl] Dataset modified ${meta.modified}; license ${meta.license}`);
}

main().catch((err) => {
  console.error(`[atlas-etl] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
