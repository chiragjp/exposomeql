#!/usr/bin/env npx tsx
/**
 * CTD (Comparative Toxicogenomics Database) ETL script for ExposomeQL.
 *
 * Downloads CTD batch files, decompresses them, filters to chemicals in our
 * NHANES/HHEAR panel (via MeSH ID), and loads into DuckDB Parquet files.
 *
 * Usage:
 *   npx tsx scripts/ctd-etl.ts
 *   npx tsx scripts/ctd-etl.ts --skip-download   # reuse already-downloaded files
 *   npx tsx scripts/ctd-etl.ts --skip-filter      # reprocess parquet from filtered TSVs
 *
 * Output:
 *   data/ctd/raw/           - downloaded .tsv.gz and decompressed .tsv files
 *   data/ctd/filtered/      - TSVs filtered to our chemicals
 *   data/ctd/parquet/       - final Parquet files + ctd.duckdb database
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import duckdb from "duckdb";
import { CTD_CHEMICAL_MAP, CTD_BY_MESH } from "../src/variables/ctd-chemical-map.js";

// Build MeSH ID set from the comprehensive mapping (326 chemicals, ~173 unique MeSH IDs)
const CTD_MESH_IDS: Set<string> = new Set(CTD_CHEMICAL_MAP.map((c) => c.mesh_id));
const CTD_MESH_TO_ENTRY = CTD_BY_MESH;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const CTD_BASE_URL = "https://ctdbase.org/reports/";
const DATA_DIR = path.join(PROJECT_ROOT, "data", "ctd");
const RAW_DIR = path.join(DATA_DIR, "raw");
const FILTERED_DIR = path.join(DATA_DIR, "filtered");
const PARQUET_DIR = path.join(DATA_DIR, "parquet");
const DUCKDB_PATH = path.join(PARQUET_DIR, "ctd.duckdb");

/** CTD files to download and their column schemas */
const CTD_FILES = [
  {
    filename: "CTD_chem_gene_ixns.tsv.gz",
    table: "ctd_chem_gene",
    /** 0-based column indices for fields we keep (after comment stripping) */
    columns: [
      "ChemicalName", "ChemicalID", "CasRN", "GeneSymbol", "GeneID",
      "GeneForms", "Organism", "OrganismID", "Interaction",
      "InteractionActions", "PubMedIDs",
    ],
    meshIdCol: 1, // ChemicalID column index
    outputColumns: [
      "mesh_id", "chemical_name", "cas", "gene_symbol", "gene_id",
      "organism", "organism_id", "interaction", "interaction_actions", "pubmed_ids",
    ],
    /** Map from input column index to output column index (-1 = skip) */
    colMap: [1, 0, 2, 3, 4, -1, 6, 7, 8, 9, 10], // skip GeneForms
  },
  {
    filename: "CTD_chemicals_diseases.tsv.gz",
    table: "ctd_chem_disease",
    columns: [
      "ChemicalName", "ChemicalID", "CasRN", "DiseaseName", "DiseaseID",
      "DirectEvidence", "InferenceGeneSymbol", "InferenceScore",
      "OmimIDs", "PubMedIDs",
    ],
    meshIdCol: 1,
    outputColumns: [
      "mesh_id", "chemical_name", "cas", "disease_name", "disease_id",
      "direct_evidence", "inference_gene_symbol", "inference_score",
      "omim_ids", "pubmed_ids",
    ],
    colMap: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9],
  },
  {
    filename: "CTD_chem_pathways_enriched.tsv.gz",
    table: "ctd_chem_pathway",
    columns: [
      "ChemicalName", "ChemicalID", "CasRN", "PathwayName", "PathwayID",
      "PValue", "CorrectedPValue", "TargetMatchQty", "TargetTotalQty",
      "BackgroundMatchQty", "BackgroundTotalQty",
    ],
    meshIdCol: 1,
    outputColumns: [
      "mesh_id", "chemical_name", "cas", "pathway_name", "pathway_id",
      "p_value", "corrected_p_value", "target_genes", "gene_count", "total_genes",
    ],
    colMap: [1, 0, 2, 3, 4, 5, 6, -1, 7, -1, 8], // keep TargetMatchQty as gene_count, BackgroundTotalQty as total_genes
  },
  {
    filename: "CTD_chem_go_enriched.tsv.gz",
    table: "ctd_chem_go",
    columns: [
      "ChemicalName", "ChemicalID", "CasRN", "Ontology",
      "GOTermName", "GOTermID", "HighestGOLevel",
      "PValue", "CorrectedPValue", "TargetMatchQty", "TargetTotalQty",
      "BackgroundMatchQty", "BackgroundTotalQty",
    ],
    meshIdCol: 1,
    outputColumns: [
      "mesh_id", "chemical_name", "cas", "go_name", "go_id", "ontology",
      "p_value", "corrected_p_value", "target_genes", "gene_count", "total_genes",
    ],
    // Reorder: ChemicalName(0)->1, ChemicalID(1)->0, CasRN(2)->2,
    // Ontology(3)->5, GOTermName(4)->3, GOTermID(5)->4, HighestGOLevel(6)->skip,
    // PValue(7)->6, CorrectedPValue(8)->7, TargetMatchQty(9)->skip,
    // TargetTotalQty(10)->8(target_genes as string), BackgroundMatchQty(11)->9, BackgroundTotalQty(12)->10
    colMap: [1, 0, 2, 5, 3, 4, -1, 6, 7, -1, 8, 9, 10],
  },
  {
    filename: "CTD_chemicals.tsv.gz",
    table: null, // vocabulary file, not loaded as a table
    columns: [],
    meshIdCol: 1,
    outputColumns: [],
    colMap: [],
  },
];

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const SKIP_DOWNLOAD = args.has("--skip-download");
const SKIP_FILTER = args.has("--skip-filter");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  process.stderr.write(`[ctd-etl] ${msg}\n`);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Download a file with progress reporting. Follows redirects. */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    log(`Downloading ${url}`);

    const request = (currentUrl: string) => {
      const proto = currentUrl.startsWith("https") ? https : http;
      proto.get(currentUrl, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          log(`  -> Redirect to ${res.headers.location}`);
          request(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;
        let lastReport = 0;

        const file = createWriteStream(dest);
        res.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const now = Date.now();
          if (now - lastReport > 2000) {
            const mb = (downloadedBytes / 1048576).toFixed(1);
            if (totalBytes > 0) {
              const pct = ((downloadedBytes / totalBytes) * 100).toFixed(0);
              log(`  ${mb} MB / ${(totalBytes / 1048576).toFixed(1)} MB (${pct}%)`);
            } else {
              log(`  ${mb} MB downloaded...`);
            }
            lastReport = now;
          }
        });

        res.pipe(file);
        file.on("finish", () => {
          file.close();
          const mb = (downloadedBytes / 1048576).toFixed(1);
          log(`  Done: ${mb} MB -> ${path.basename(dest)}`);
          resolve();
        });
        file.on("error", reject);
      }).on("error", reject);
    };

    request(url);
  });
}

/** Decompress a .gz file */
async function decompressGz(gzPath: string, outPath: string): Promise<void> {
  log(`Decompressing ${path.basename(gzPath)}`);
  await pipeline(
    createReadStream(gzPath),
    createGunzip(),
    createWriteStream(outPath),
  );
  const sizeMB = (fs.statSync(outPath).size / 1048576).toFixed(1);
  log(`  Decompressed: ${sizeMB} MB -> ${path.basename(outPath)}`);
}

/**
 * Parse CTD TSV header.
 *
 * CTD files have comment lines starting with '#'.
 * The last comment line before data is the actual header row, e.g.:
 *   # ChemicalName\tChemicalID\t...
 * Data lines do NOT start with '#'.
 */
function parseCTDHeader(line: string): string[] {
  // Strip leading '# ' or '#'
  const cleaned = line.replace(/^#\s*/, "");
  return cleaned.split("\t");
}

/**
 * Filter a CTD TSV file to only rows matching our MeSH IDs.
 * Writes a clean TSV (no comment lines) with our output column names as header.
 */
async function filterTSV(
  inputPath: string,
  outputPath: string,
  meshIdCol: number,
): Promise<number> {
  const rl = createInterface({
    input: createReadStream(inputPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  const out = createWriteStream(outputPath, { encoding: "utf-8" });
  let headerWritten = false;
  let headerCommentLine = "";
  let matchCount = 0;
  let lineCount = 0;

  for await (const line of rl) {
    if (line.startsWith("#")) {
      // Track the last comment line that contains tab-separated column names
      // (skip empty comment lines like bare "#")
      if (line.includes("\t")) {
        headerCommentLine = line;
      }
      continue;
    }

    // Write header on first data line
    if (!headerWritten) {
      if (headerCommentLine) {
        const headerCols = parseCTDHeader(headerCommentLine);
        out.write(headerCols.join("\t") + "\n");
      }
      headerWritten = true;
    }

    const fields = line.split("\t");
    const meshId = fields[meshIdCol];

    // CTD MeSH IDs are prefixed with "MESH:" -- strip for comparison
    const cleanMeshId = meshId?.replace(/^MESH:/, "") || "";

    if (CTD_MESH_IDS.has(cleanMeshId)) {
      out.write(line + "\n");
      matchCount++;
    }

    lineCount++;
    if (lineCount % 5_000_000 === 0) {
      log(`  Scanned ${(lineCount / 1_000_000).toFixed(0)}M rows, ${matchCount} matches so far...`);
    }
  }

  out.end();
  log(`  Filtered: ${matchCount} rows from ${lineCount.toLocaleString()} total`);
  return matchCount;
}

// ---------------------------------------------------------------------------
// DuckDB: create tables and load Parquet
// ---------------------------------------------------------------------------

function duckdbExec(db: duckdb.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function duckdbAll(db: duckdb.Database, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function createParquetFiles(db: duckdb.Database): Promise<void> {
  // -- Chemical-gene interactions --
  const chemGeneFiltered = path.join(FILTERED_DIR, "CTD_chem_gene_ixns.tsv");
  if (fs.existsSync(chemGeneFiltered)) {
    log("Creating ctd_chem_gene parquet...");
    await duckdbExec(db, `
      CREATE OR REPLACE TABLE ctd_chem_gene AS
      SELECT
        replace("ChemicalID", 'MESH:', '') AS mesh_id,
        "ChemicalName" AS chemical_name,
        "CasRN" AS cas,
        "GeneSymbol" AS gene_symbol,
        TRY_CAST("GeneID" AS INTEGER) AS gene_id,
        "Organism" AS organism,
        TRY_CAST("OrganismID" AS INTEGER) AS organism_id,
        "Interaction" AS interaction,
        "InteractionActions" AS interaction_actions,
        "PubMedIDs" AS pubmed_ids
      FROM read_csv('${chemGeneFiltered}',
        delim='\t', header=true, quote='', all_varchar=true,
        ignore_errors=true
      )
    `);
    const [{ cnt }] = await duckdbAll(db, "SELECT count(*) AS cnt FROM ctd_chem_gene");
    log(`  ctd_chem_gene: ${Number(cnt).toLocaleString()} rows`);

    await duckdbExec(db, `
      COPY ctd_chem_gene TO '${path.join(PARQUET_DIR, "ctd_chem_gene.parquet")}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  }

  // -- Chemical-disease associations --
  const chemDiseaseFiltered = path.join(FILTERED_DIR, "CTD_chemicals_diseases.tsv");
  if (fs.existsSync(chemDiseaseFiltered)) {
    log("Creating ctd_chem_disease parquet...");
    await duckdbExec(db, `
      CREATE OR REPLACE TABLE ctd_chem_disease AS
      SELECT
        replace("ChemicalID", 'MESH:', '') AS mesh_id,
        "ChemicalName" AS chemical_name,
        "CasRN" AS cas,
        "DiseaseName" AS disease_name,
        "DiseaseID" AS disease_id,
        "DirectEvidence" AS direct_evidence,
        "InferenceGeneSymbol" AS inference_gene_symbol,
        TRY_CAST("InferenceScore" AS DOUBLE) AS inference_score,
        "OmimIDs" AS omim_ids,
        "PubMedIDs" AS pubmed_ids
      FROM read_csv('${chemDiseaseFiltered}',
        delim='\t', header=true, quote='', all_varchar=true,
        ignore_errors=true
      )
    `);
    const [{ cnt }] = await duckdbAll(db, "SELECT count(*) AS cnt FROM ctd_chem_disease");
    log(`  ctd_chem_disease: ${Number(cnt).toLocaleString()} rows`);

    await duckdbExec(db, `
      COPY ctd_chem_disease TO '${path.join(PARQUET_DIR, "ctd_chem_disease.parquet")}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  }

  // -- Chemical-pathway enrichment --
  const chemPathwayFiltered = path.join(FILTERED_DIR, "CTD_chem_pathways_enriched.tsv");
  if (fs.existsSync(chemPathwayFiltered)) {
    log("Creating ctd_chem_pathway parquet...");
    await duckdbExec(db, `
      CREATE OR REPLACE TABLE ctd_chem_pathway AS
      SELECT
        replace("ChemicalID", 'MESH:', '') AS mesh_id,
        "ChemicalName" AS chemical_name,
        "CasRN" AS cas,
        "PathwayName" AS pathway_name,
        "PathwayID" AS pathway_id,
        TRY_CAST("PValue" AS DOUBLE) AS p_value,
        TRY_CAST("CorrectedPValue" AS DOUBLE) AS corrected_p_value,
        CAST(NULL AS VARCHAR) AS target_genes,
        TRY_CAST("TargetMatchQty" AS INTEGER) AS gene_count,
        TRY_CAST("BackgroundTotalQty" AS INTEGER) AS total_genes
      FROM read_csv('${chemPathwayFiltered}',
        delim='\t', header=true, quote='', all_varchar=true,
        ignore_errors=true
      )
    `);
    const [{ cnt }] = await duckdbAll(db, "SELECT count(*) AS cnt FROM ctd_chem_pathway");
    log(`  ctd_chem_pathway: ${Number(cnt).toLocaleString()} rows`);

    await duckdbExec(db, `
      COPY ctd_chem_pathway TO '${path.join(PARQUET_DIR, "ctd_chem_pathway.parquet")}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  }

  // -- Chemical-GO enrichment --
  const chemGoFiltered = path.join(FILTERED_DIR, "CTD_chem_go_enriched.tsv");
  if (fs.existsSync(chemGoFiltered)) {
    log("Creating ctd_chem_go parquet...");
    await duckdbExec(db, `
      CREATE OR REPLACE TABLE ctd_chem_go AS
      SELECT
        replace("ChemicalID", 'MESH:', '') AS mesh_id,
        "ChemicalName" AS chemical_name,
        "CasRN" AS cas,
        "GOTermName" AS go_name,
        "GOTermID" AS go_id,
        "Ontology" AS ontology,
        TRY_CAST("PValue" AS DOUBLE) AS p_value,
        TRY_CAST("CorrectedPValue" AS DOUBLE) AS corrected_p_value,
        CAST(NULL AS VARCHAR) AS target_genes,
        TRY_CAST("TargetMatchQty" AS INTEGER) AS gene_count,
        TRY_CAST("BackgroundTotalQty" AS INTEGER) AS total_genes
      FROM read_csv('${chemGoFiltered}',
        delim='\t', header=true, quote='', all_varchar=true,
        ignore_errors=true
      )
    `);
    const [{ cnt }] = await duckdbAll(db, "SELECT count(*) AS cnt FROM ctd_chem_go");
    log(`  ctd_chem_go: ${Number(cnt).toLocaleString()} rows`);

    await duckdbExec(db, `
      COPY ctd_chem_go TO '${path.join(PARQUET_DIR, "ctd_chem_go.parquet")}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  log("=== CTD ETL for ExposomeQL ===");
  log(`Chemicals to filter: ${CTD_MESH_IDS.size} MeSH IDs`);

  // Create directories
  ensureDir(RAW_DIR);
  ensureDir(FILTERED_DIR);
  ensureDir(PARQUET_DIR);

  // Step 1: Download
  if (!SKIP_DOWNLOAD) {
    log("\n--- Step 1: Download CTD batch files ---");
    for (const file of CTD_FILES) {
      const gzPath = path.join(RAW_DIR, file.filename);
      const tsvName = file.filename.replace(".gz", "");
      const tsvPath = path.join(RAW_DIR, tsvName);

      if (fs.existsSync(gzPath)) {
        log(`Skipping download (exists): ${file.filename}`);
      } else {
        await downloadFile(CTD_BASE_URL + file.filename, gzPath);
      }

      if (fs.existsSync(tsvPath)) {
        log(`Skipping decompress (exists): ${tsvName}`);
      } else {
        await decompressGz(gzPath, tsvPath);
      }
    }
  } else {
    log("\n--- Step 1: SKIPPED (--skip-download) ---");
  }

  // Step 2: Filter to our chemicals
  if (!SKIP_FILTER) {
    log("\n--- Step 2: Filter to NHANES/HHEAR chemicals ---");
    for (const file of CTD_FILES) {
      if (file.table === null) {
        log(`Skipping filter for vocabulary file: ${file.filename}`);
        continue;
      }

      const tsvName = file.filename.replace(".gz", "");
      const inputPath = path.join(RAW_DIR, tsvName);
      const outputPath = path.join(FILTERED_DIR, tsvName);

      if (!fs.existsSync(inputPath)) {
        log(`WARNING: Missing input file: ${tsvName}`);
        continue;
      }

      log(`Filtering ${tsvName}...`);
      await filterTSV(inputPath, outputPath, file.meshIdCol);
    }
  } else {
    log("\n--- Step 2: SKIPPED (--skip-filter) ---");
  }

  // Step 3: Load into DuckDB and export Parquet
  log("\n--- Step 3: Create DuckDB tables and Parquet files ---");

  // Remove old database if it exists
  if (fs.existsSync(DUCKDB_PATH)) {
    fs.unlinkSync(DUCKDB_PATH);
  }

  const db = await new Promise<duckdb.Database>((resolve, reject) => {
    const instance = new duckdb.Database(DUCKDB_PATH, (err) => {
      if (err) reject(err);
      else resolve(instance);
    });
  });

  await createParquetFiles(db);

  // Print summary
  log("\n--- Summary ---");
  const tables = ["ctd_chem_gene", "ctd_chem_disease", "ctd_chem_pathway", "ctd_chem_go"];
  for (const table of tables) {
    try {
      const [row] = await duckdbAll(db, `SELECT count(*) AS cnt FROM ${table}`);
      const parquetFile = path.join(PARQUET_DIR, `${table}.parquet`);
      const sizeMB = fs.existsSync(parquetFile)
        ? (fs.statSync(parquetFile).size / 1048576).toFixed(1)
        : "?";
      log(`  ${table}: ${Number(row.cnt).toLocaleString()} rows (${sizeMB} MB parquet)`);
    } catch {
      log(`  ${table}: not created (no input data)`);
    }
  }

  // Show chemical coverage
  try {
    const chemicals = await duckdbAll(db, `
      SELECT DISTINCT mesh_id, chemical_name
      FROM ctd_chem_gene
      ORDER BY chemical_name
    `);
    log(`\nChemicals with gene interactions: ${chemicals.length}`);
    for (const c of chemicals) {
      const entry = CTD_MESH_TO_ENTRY.get(c.mesh_id);
      log(`  ${c.chemical_name} (${c.mesh_id}) -> HHEAR: ${entry?.hhear_code ?? "?"}`);
    }
  } catch {
    // table may not exist
  }

  await new Promise<void>((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\nDone in ${elapsed}s`);
  log(`Output: ${PARQUET_DIR}`);
  log(`DuckDB: ${DUCKDB_PATH}`);
}

main().catch((err) => {
  console.error("[ctd-etl] FATAL:", err);
  process.exit(1);
});
