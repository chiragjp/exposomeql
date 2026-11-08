import duckdb from "duckdb";
import path from "path";
import os from "os";
import fs from "fs";
import type { ExposomeQLConfig } from "../config.js";
import type { CohortConfig, CohortMetadata, EpiColumnMap } from "../types.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DuckDBManager {
  private db!: duckdb.Database;
  private conn!: duckdb.Connection;
  private config!: ExposomeQLConfig;

  async initialize(config: ExposomeQLConfig): Promise<void> {
    this.config = config;

    return new Promise((resolve, reject) => {
      // In-memory DuckDB instance
      this.db = new duckdb.Database(":memory:", (err) => {
        if (err) return reject(err);

        this.conn = this.db.connect();

        // Install and load sqlite extension, then attach databases
        this.conn.exec(
          `
          INSTALL sqlite;
          LOAD sqlite;
          `,
          (err) => {
            if (err) return reject(err);
            this.attachDatabases().then(resolve).catch(reject);
          }
        );
      });
    });
  }

  private async attachDatabases(): Promise<void> {
    // Attach the main NHANES database for metadata queries
    if (fs.existsSync(this.config.nhanesDbPath)) {
      await this.exec(
        `ATTACH '${this.config.nhanesDbPath}' AS nhanes (TYPE sqlite, READ_ONLY)`
      );
      console.error("[duckdb] Attached nhanes database");
    }

    // Attach PE summary stats
    if (fs.existsSync(this.config.peStatsDbPath)) {
      await this.exec(
        `ATTACH '${this.config.peStatsDbPath}' AS pe_stats (TYPE sqlite, READ_ONLY)`
      );
      console.error("[duckdb] Attached pe_stats database");
    }

    // Attach EE summary stats
    if (fs.existsSync(this.config.eeStatsDbPath)) {
      await this.exec(
        `ATTACH '${this.config.eeStatsDbPath}' AS ee_stats (TYPE sqlite, READ_ONLY)`
      );
      console.error("[duckdb] Attached ee_stats database");
    }

    // Attach PP (phenotype-phenotype) summary stats
    if (fs.existsSync(this.config.ppStatsDbPath)) {
      await this.exec(
        `ATTACH '${this.config.ppStatsDbPath}' AS pp_stats (TYPE sqlite, READ_ONLY)`
      );
      console.error("[duckdb] Attached pp_stats database");
    }

    // If Parquet files exist, register them as views for faster queries
    const parquetDir = this.config.parquetDir;
    if (fs.existsSync(parquetDir)) {
      await this.registerParquetViews(parquetDir);
    }

    // Register CTD Parquet files if available
    await this.registerCTDParquet();

    // Register ExposomeAtlas (literature-curated evidence) Parquet files if available
    await this.registerExposomeAtlasParquet();
  }

  /**
   * Register ExposomeAtlas FAIR export (built by scripts/exposomeatlas-etl.ts) as views:
   * atlas_associations, atlas_entities, atlas_papers. Directory: <dataDir>/exposomeatlas/parquet.
   */
  private async registerExposomeAtlasParquet(): Promise<void> {
    const dir = path.join(this.config.dataDir, "exposomeatlas", "parquet");
    if (!fs.existsSync(dir)) return;
    let registered = 0;
    for (const view of ["atlas_associations", "atlas_entities", "atlas_papers"]) {
      const filePath = path.join(dir, `${view}.parquet`);
      if (fs.existsSync(filePath)) {
        await this.exec(
          `CREATE OR REPLACE VIEW ${view} AS SELECT * FROM read_parquet('${filePath.replace(/'/g, "''")}')`
        );
        registered++;
      }
    }
    const manifestPath = path.join(dir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      await this.exec(
        `CREATE OR REPLACE VIEW atlas_manifest AS SELECT * FROM read_json_auto('${manifestPath.replace(/'/g, "''")}')`
      );
    }
    if (registered > 0) console.error(`[duckdb] Registered ${registered} ExposomeAtlas parquet views`);
  }

  private async registerParquetViews(parquetDir: string): Promise<void> {
    const metaDir = path.join(parquetDir, "metadata");
    if (fs.existsSync(path.join(metaDir, "variable_names.parquet"))) {
      await this.exec(
        `CREATE OR REPLACE VIEW variable_names AS SELECT * FROM read_parquet('${path.join(metaDir, "variable_names.parquet")}')`
      );
      console.error("[duckdb] Registered Parquet view: variable_names");
    }

    const peDir = path.join(parquetDir, "pe_stats");
    if (fs.existsSync(path.join(peDir, "adjusted_meta_uwls.parquet"))) {
      await this.exec(
        `CREATE OR REPLACE VIEW adjusted_meta_uwls AS SELECT * FROM read_parquet('${path.join(peDir, "adjusted_meta_uwls.parquet")}')`
      );
      console.error("[duckdb] Registered Parquet view: adjusted_meta_uwls");
    }
  }

  /** Register CTD (Comparative Toxicogenomics Database) Parquet files as views */
  private async registerCTDParquet(): Promise<void> {
    // Look for CTD parquet files in data/ctd/parquet/
    const ctdParquetDir = path.join(path.dirname(this.config.nhanesDbPath), "ctd", "parquet");
    if (!fs.existsSync(ctdParquetDir)) {
      console.error("[duckdb] No CTD parquet directory found, skipping CTD registration");
      return;
    }

    const ctdTables = [
      { file: "ctd_chem_gene.parquet", view: "ctd_chem_gene" },
      { file: "ctd_chem_disease.parquet", view: "ctd_chem_disease" },
      { file: "ctd_chem_pathway.parquet", view: "ctd_chem_pathway" },
      { file: "ctd_chem_go.parquet", view: "ctd_chem_go" },
    ];

    let registered = 0;
    for (const { file, view } of ctdTables) {
      const filePath = path.join(ctdParquetDir, file);
      if (fs.existsSync(filePath)) {
        await this.exec(
          `CREATE OR REPLACE VIEW ${view} AS SELECT * FROM read_parquet('${filePath}')`
        );
        registered++;
      }
    }

    if (registered > 0) {
      console.error(`[duckdb] Registered ${registered} CTD parquet views`);
    }
  }

  async exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const callback = (err: Error | null, rows: duckdb.TableData) => {
        if (err) reject(err);
        else resolve((rows ?? []) as T[]);
      };

      if (params.length > 0) {
        const stmt = this.conn.prepare(sql, (err) => {
          if (err) return reject(err);
        });
        stmt.all(...params, callback);
        stmt.finalize();
      } else {
        this.conn.all(sql, callback);
      }
    });
  }

  /** Discover and register all HHEAR cohorts from the data directory */
  async discoverCohorts(hhearDataDir: string): Promise<CohortConfig[]> {
    if (!hhearDataDir || !fs.existsSync(hhearDataDir)) {
      console.error("[duckdb] No HHEAR data directory found, skipping cohort registration");
      return [];
    }

    // Load pre-extracted PDF metadata
    const metadataPath = path.join(__dirname, "..", "..", "src", "data", "cohort-metadata.json");
    let pdfMetadata: Record<string, CohortMetadata> = {};
    if (fs.existsSync(metadataPath)) {
      try {
        pdfMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
        console.error(`[duckdb] Loaded PDF metadata for ${Object.keys(pdfMetadata).length} cohorts`);
      } catch {
        console.error("[duckdb] Warning: could not parse cohort-metadata.json");
      }
    }

    // Load epi column mapping
    const epiMapPath = path.join(__dirname, "..", "..", "src", "data", "epi-column-map.json");
    let epiColumnMaps: Record<string, EpiColumnMap> = {};
    if (fs.existsSync(epiMapPath)) {
      try {
        epiColumnMaps = JSON.parse(fs.readFileSync(epiMapPath, "utf-8"));
        console.error(`[duckdb] Loaded epi column map for ${Object.keys(epiColumnMaps).length} cohorts`);
      } catch {
        console.error("[duckdb] Warning: could not parse epi-column-map.json");
      }
    }

    const cohorts: CohortConfig[] = [];
    const entries = fs.readdirSync(hhearDataDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cohortDir = path.join(hhearDataDir, entry.name);

      // Match files case-INSENSITIVELY: HHEAR filenames vary (e.g. "1740_Epi_DATA.csv"
      // vs "1407_EPI_DATA.csv"). On macOS (case-insensitive FS) any case works, but on
      // a case-sensitive Linux deploy an exact-case lookup silently misses the file.
      const dirFiles = fs.readdirSync(cohortDir);
      const lc = (s: string) => s.toLowerCase();
      const findFile = (...names: string[]): string | null => {
        for (const n of names) { const hit = dirFiles.find((f) => lc(f) === lc(n)); if (hit) return hit; }
        return null;
      };

      // Prefer _TARGETED_DATA_2.csv (long format) over _TARGETED_DATA.csv (may be wide)
      const targetedFile = findFile(`${entry.name}_TARGETED_DATA_2.csv`, `${entry.name}_TARGETED_DATA.csv`)
        ?? dirFiles.find((f) => lc(f).endsWith("_targeted_data.csv")) ?? null;

      // Targeted data is required; epi data is optional
      if (!targetedFile) {
        continue;
      }

      // Epi data: standard name, else any *_EPI_DATA.csv in the directory (case-insensitive)
      const epiFile: string | null = findFile(`${entry.name}_EPI_DATA.csv`)
        ?? dirFiles.find((f) => lc(f).endsWith("_epi_data.csv")) ?? null;

      const codebookFile = `${entry.name}_harmonized_codebook.csv`;
      const meta = pdfMetadata[entry.name];
      const cohort = await this.registerCohort({
        id: entry.name,
        dataDir: cohortDir,
        targetedDataFile: targetedFile,
        epiDataFile: epiFile ?? "",
        codebookFile,
        pidColumn: "PID",
        sampleSource: "",
        analytes: [],
        nParticipants: 0,
        projectId: meta?.project_id,
        description: meta?.description,
        pi: meta?.pi,
        populationNote: meta?.population_note,
        country: meta?.country,
        cityRegion: meta?.city_region,
        studyName: meta?.study_name,
        analyteNames: meta?.analyte_names,
        commentCodes: meta?.comment_codes,
      });

      if (cohort) {
        // Attach epi column map from pre-curated mapping file
        if (epiColumnMaps[cohort.id]) {
          cohort.epiColumnMap = epiColumnMaps[cohort.id];
        }
        cohorts.push(cohort);
      }
    }

    // Register AllExposures.csv as a global view
    const allExposuresPath = path.join(hhearDataDir, "AllExposures.csv");
    if (fs.existsSync(allExposuresPath)) {
      await this.exec(
        `CREATE OR REPLACE VIEW hhear_all_exposures AS SELECT * FROM read_csv('${allExposuresPath}', auto_detect=true, ignore_errors=true)`
      );
      console.error("[duckdb] Registered global view: hhear_all_exposures");
    }

    console.error(`[duckdb] Discovered ${cohorts.length} HHEAR cohorts`);
    return cohorts;
  }

  /** Register a single HHEAR cohort: create views and extract metadata */
  private async registerCohort(cohort: CohortConfig): Promise<CohortConfig | null> {
    try {
      const targetedPath = path.join(cohort.dataDir, cohort.targetedDataFile);

      // Create view for targeted data (always present)
      await this.exec(
        `CREATE OR REPLACE VIEW cohort_${cohort.id}_targeted_raw AS SELECT * FROM read_csv('${targetedPath}', auto_detect=true, ignore_errors=true)`
      );

      // Create view for epi data (optional)
      const hasEpi = cohort.epiDataFile && fs.existsSync(path.join(cohort.dataDir, cohort.epiDataFile));
      if (hasEpi) {
        const epiPath = path.join(cohort.dataDir, cohort.epiDataFile);
        await this.exec(
          `CREATE OR REPLACE VIEW cohort_${cohort.id}_epi AS SELECT * FROM read_csv('${epiPath}', auto_detect=true, ignore_errors=true)`
        );
      }

      // Discover column names for this cohort's targeted data
      const targetedCols = await this.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'cohort_${cohort.id}_targeted_raw'`
      );
      const colNames = targetedCols.map((r) => r.column_name);

      // Find the analyte code column — determines long vs wide format
      const analyteCol = colNames.find((c) => c.toLowerCase() === "analyte_code");

      if (analyteCol) {
        // ── Long format: standard Analyte_Code column ──
        await this.exec(
          `CREATE OR REPLACE VIEW cohort_${cohort.id}_targeted AS SELECT * FROM cohort_${cohort.id}_targeted_raw`
        );

        const analyteRows = await this.query<{ ac: string }>(
          `SELECT DISTINCT "${analyteCol}" as ac FROM cohort_${cohort.id}_targeted WHERE "${analyteCol}" IS NOT NULL ORDER BY ac`
        );
        cohort.analytes = analyteRows.map((r) => r.ac);
      } else {
        // ── Wide format: analyte codes are column names (e.g., cohort 34: As, Cd, Mn, Mo, Pb, CRE) ──
        // Detect analyte columns: those that have a corresponding _comment column
        const commentCols = colNames.filter((c) => c.toLowerCase().endsWith("_comment"));
        const analyteCols = commentCols
          .map((c) => c.replace(/_comment$/i, ""))
          .filter((a) => colNames.some((c) => c === a));

        if (analyteCols.length > 0) {
          // Build UNPIVOT SQL to convert wide → long format
          const concatCols = analyteCols.map((a) => `"${a}"`).join(", ");
          const commentCase = analyteCols
            .map((a) => {
              const cc = colNames.find((c) => c.toLowerCase() === `${a.toLowerCase()}_comment`);
              return cc ? `WHEN '${a}' THEN "${cc}"` : "";
            })
            .filter(Boolean)
            .join(" ");

          // Find LOD column (some wide-format files may have per-analyte LOD or a single LOD column)
          const lodCol = colNames.find((c) => c.toLowerCase() === "lod");

          // Find PID and other identifier columns
          const idCols = colNames.filter(
            (c) => !analyteCols.includes(c) && !c.toLowerCase().endsWith("_comment")
          );
          const idSelect = idCols.map((c) => `"${c}"`).join(", ");

          await this.exec(
            `CREATE OR REPLACE VIEW cohort_${cohort.id}_targeted AS
             SELECT ${idSelect},
                    analyte_code AS "Analyte_Code",
                    concentration AS "Concentration",
                    CASE analyte_code ${commentCase} END AS "Comment_Code",
                    ${lodCol ? `"${lodCol}" AS "LOD"` : "NULL AS \"LOD\""},
                    'ng/mL' AS "Units"
             FROM (
               UNPIVOT cohort_${cohort.id}_targeted_raw
               ON ${concatCols}
               INTO NAME analyte_code VALUE concentration
             )`
          );

          cohort.analytes = analyteCols;
          cohort.wideFormat = true;

          // Export UNPIVOT'd view to a temp CSV so R scripts can read long format
          const tmpDir = path.join(os.tmpdir(), "exposomeql");
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const longCsvPath = path.join(tmpDir, `cohort_${cohort.id}_targeted_long.csv`);
          await this.exec(
            `COPY (SELECT * FROM cohort_${cohort.id}_targeted) TO '${longCsvPath}' (HEADER, DELIMITER ',')`
          );
          cohort.targetedLongCsv = longCsvPath;

          console.error(`[duckdb] Cohort ${cohort.id}: wide→long UNPIVOT for ${analyteCols.length} analytes (${analyteCols.join(", ")})`);
        } else {
          // No recognizable analyte columns — create the view anyway
          await this.exec(
            `CREATE OR REPLACE VIEW cohort_${cohort.id}_targeted AS SELECT * FROM cohort_${cohort.id}_targeted_raw`
          );
          console.error(`[duckdb] Cohort ${cohort.id}: no Analyte_Code column and no wide-format _comment columns detected`);
        }
      }

      // Find sample source column
      const sourceCol = colNames.find((c) => c.toLowerCase() === "sample_source");
      if (sourceCol) {
        const sourceRows = await this.query<{ src: string }>(
          `SELECT DISTINCT "${sourceCol}" as src FROM cohort_${cohort.id}_targeted_raw WHERE "${sourceCol}" IS NOT NULL LIMIT 5`
        );
        cohort.sampleSource = sourceRows.map((r) => r.src).join(", ").toLowerCase();
      } else {
        // Try Sample_matrix or Sample_Matrix
        const matrixCol = colNames.find((c) => c.toLowerCase() === "sample_matrix");
        if (matrixCol) {
          const matrixRows = await this.query<{ src: string }>(
            `SELECT DISTINCT "${matrixCol}" as src FROM cohort_${cohort.id}_targeted_raw WHERE "${matrixCol}" IS NOT NULL LIMIT 5`
          );
          cohort.sampleSource = matrixRows.map((r) => r.src).join(", ").toLowerCase();
        }
      }

      // Find PID column and count participants
      const pidCol = colNames.find((c) =>
        ["pid", "child_pid", "subject_id"].includes(c.toLowerCase())
      ) ?? colNames.find((c) => c.toLowerCase().includes("pid"));
      if (pidCol) {
        const countRows = await this.query<{ n: number | bigint }>(
          `SELECT COUNT(DISTINCT "${pidCol}") as n FROM cohort_${cohort.id}_targeted_raw`
        );
        cohort.nParticipants = Number(countRows[0]?.n ?? 0);
      }

      // Detect PID column and store all column names from epi data
      if (hasEpi) {
        const epiCols = await this.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'cohort_${cohort.id}_epi'`
        );
        const epiColNames = epiCols.map((r) => r.column_name);
        cohort.epiColumnNames = epiColNames.map((c) => c.toLowerCase());
        const epiPidCol = epiColNames.find((c) => c.toLowerCase() === "pid");
        if (epiPidCol) {
          cohort.pidColumn = epiPidCol;
        }
      }

      const epiLabel = hasEpi ? "" : " (no epi data)";
      const popLabel = cohort.populationNote ?? (cohort.sampleSource || "");
      console.error(
        `[duckdb] Registered cohort ${cohort.id}: ${cohort.nParticipants} participants, ${cohort.analytes.length} analytes (${popLabel})${epiLabel}`
      );
      return cohort;
    } catch (err) {
      console.error(`[duckdb] Failed to register cohort ${cohort.id}: ${(err as Error).message}`);
      return null;
    }
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close(() => resolve());
    });
  }
}
