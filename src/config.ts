import path from "path";
import fs from "fs";

export interface ExposomeQLConfig {
  /** Path to the nhanespewas db directory containing SQLite files */
  dataDir: string;
  /** Path to the main NHANES individual-level SQLite database */
  nhanesDbPath: string;
  /** Path to the PE summary stats SQLite database */
  peStatsDbPath: string;
  /** Path to the EE summary stats SQLite database */
  eeStatsDbPath: string;
  /** Path to the PP (phenotype-phenotype) summary stats SQLite database */
  ppStatsDbPath: string;
  /** Path to the directory for converted Parquet files */
  parquetDir: string;
  /** Path to the Rscript executable */
  rscriptPath: string;
  /** Path to the nhanespewas R package source (for devtools::load_all) */
  nhanespewasPath: string;
  /** Path to the HHEAR Targeted Datasets directory (optional) */
  hhearDataDir: string;
}

function findDataDir(): string {
  // Priority: env var > symlink > relative path
  const candidates = [
    process.env.EXPOSOMEQL_DATA_DIR,
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "../nhanespewas/db"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "nhanes_031725.sqlite"))) {
      return dir;
    }
  }

  throw new Error(
    "Cannot find NHANES data directory. Set EXPOSOMEQL_DATA_DIR or create a symlink at ./data"
  );
}

function findRscript(): string {
  const envPath = process.env.RSCRIPT_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = ["/usr/local/bin/Rscript", "/usr/bin/Rscript", "/opt/homebrew/bin/Rscript"];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "Rscript"; // fall back to PATH
}

function findNhanespewasPath(): string {
  const envPath = process.env.NHANESPEWAS_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.resolve(process.cwd(), "../nhanespewas"),
    path.resolve(process.cwd(), "../../nhanespewas"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "DESCRIPTION"))) return p;
  }
  return "";
}

function findHhearDataDir(): string {
  const envPath = process.env.HHEAR_DATA_DIR;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.resolve(process.cwd(), "hhear-data"),
    // Legacy macOS Dropbox symlink paths
    path.resolve(process.env.HOME ?? "", "HMS Dropbox/Chirag Patel/HHEAR Targeted Datasets 2026"),
    path.resolve(process.env.HOME ?? "", "Dropbox (HMS)/HHEAR Targeted Datasets 2026"),
    // Modern macOS Dropbox cloud-storage mount (Library/CloudStorage/Dropbox-*)
    path.resolve(process.env.HOME ?? "", "Library/CloudStorage/Dropbox-HMS/Chirag Patel/HHEAR Targeted Datasets 2026"),
    path.resolve(process.env.HOME ?? "", "Library/CloudStorage/Dropbox/Chirag Patel/HHEAR Targeted Datasets 2026"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

export function loadConfig(): ExposomeQLConfig {
  const dataDir = findDataDir();

  return {
    dataDir,
    nhanesDbPath: path.join(dataDir, "nhanes_031725.sqlite"),
    peStatsDbPath: path.join(dataDir, "pe_summary_stats_01_2025.sqlite"),
    eeStatsDbPath: path.join(dataDir, "ee_summary_stats_03_2024.sqlite"),
    ppStatsDbPath: path.join(dataDir, "pp_summary_stats_03_2024.sqlite"),
    parquetDir: path.join(dataDir, "parquet"),
    rscriptPath: findRscript(),
    nhanespewasPath: findNhanespewasPath(),
    hhearDataDir: findHhearDataDir(),
  };
}
