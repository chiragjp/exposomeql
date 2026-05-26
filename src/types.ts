import { DuckDBManager } from "./data/duckdb-manager.js";
import { VariableResolver } from "./variables/variable-resolver.js";
import { RExecutor } from "./r-bridge/r-executor.js";
import { PythonExecutor } from "./python-bridge/python-executor.js";
import { PhenotypeRegistry } from "./derived/phenotype-registry.js";

export interface AppContext {
  db: DuckDBManager;
  resolver: VariableResolver;
  rExec: RExecutor;
  pyExec: PythonExecutor;
  cohorts: CohortConfig[];
  phenotypes: PhenotypeRegistry;
}

/** HHEAR cohort configuration — one per study directory */
export interface CohortConfig {
  /** Cohort identifier (directory name, e.g., "1407") */
  id: string;
  /** Path to the cohort directory */
  dataDir: string;
  /** Filename of the targeted data CSV */
  targetedDataFile: string;
  /** Filename of the epi data CSV */
  epiDataFile: string;
  /** Filename of the harmonized codebook CSV */
  codebookFile: string;
  /** Name of the PID column in epi data */
  pidColumn: string;
  /** Sample source: "child", "adult", "maternal" */
  sampleSource: string;
  /** List of unique analyte codes in this cohort */
  analytes: string[];
  /** Number of unique participants */
  nParticipants: number;
  /** HHEAR project ID (e.g., "2016-1407") */
  projectId?: string;
  /** Study description from README PDF */
  description?: string;
  /** Principal Investigator name */
  pi?: string;
  /** Population note (e.g., "152 school aged asthmatic children age 4-13") */
  populationNote?: string;
  /** Map of analyte code → full chemical name (from README PDF) */
  analyteNames?: Record<string, string>;
  /** Map of comment code → definition */
  commentCodes?: Record<string, string>;
  /** Country or countries where data was collected */
  country?: string;
  /** City or region where data was collected */
  cityRegion?: string;
  /** Study name or acronym */
  studyName?: string;
  /** All column names from epi CSV (lowercase) */
  epiColumnNames?: string[];
  /** Mapping of standardized names → actual epi column info */
  epiColumnMap?: EpiColumnMap;
  /** If true, original CSV is wide format — R scripts should use targetedLongCsv instead */
  wideFormat?: boolean;
  /** Path to exported long-format CSV (for wide-format cohorts) */
  targetedLongCsv?: string;
}

/** Metadata extracted from README PDFs (loaded from cohort-metadata.json) */
export interface CohortMetadata {
  project_id?: string;
  description?: string;
  pi?: string;
  population_note?: string;
  country?: string;
  city_region?: string;
  study_name?: string;
  analyte_names?: Record<string, string>;
  comment_codes?: Record<string, string>;
}

/** Mapping for a single standardized epi variable to cohort-specific column */
export interface EpiColumnMapping {
  /** Actual column name in epi CSV (lowercase) */
  column: string;
  /** Unit of measurement (e.g., "years", "months", "days") */
  unit?: string;
  /** R expression to transform to standard unit (e.g., "childagemos / 12" for months→years) */
  transform?: string;
  /** Value mapping for categorical variables (e.g., { "male": "1", "female": "2" }) */
  values?: Record<string, string>;
}

/** Per-cohort mapping of standardized demographic variable names */
export interface EpiColumnMap {
  age?: EpiColumnMapping;
  sex?: EpiColumnMapping;
  bmi?: EpiColumnMapping;
  [key: string]: EpiColumnMapping | undefined;
}

export interface VariableEntry {
  variableName: string;
  description: string;
  component: string;
  dataFileName: string;
  dataFileDescription: string;
  beginYear: number;
  endYear: number;
  category?: string;
  subcategory?: string;
}

export interface ResolveResult {
  resolved: boolean;
  variable?: VariableEntry;
  candidates?: VariableEntry[];
  confidence: number;
}

export interface RResult {
  [key: string]: unknown;
}

/** NHANES survey cycle mapping: letter → year range */
export const SERIES_MAP: Record<string, string> = {
  A: "1999-2000",
  B: "2001-2002",
  C: "2003-2004",
  D: "2005-2006",
  E: "2007-2008",
  F: "2009-2010",
  G: "2011-2012",
  H: "2013-2014",
  I: "2015-2016",
  J: "2017-2018",
};

/** Reverse mapping: year range → series letter */
export const CYCLE_TO_SERIES: Record<string, string> = Object.fromEntries(
  Object.entries(SERIES_MAP).map(([k, v]) => [v, k])
);

/** EP-WAS multiple-testing reference — attached to every EP-WAS tool response
 *  so downstream consumers see the correction context alongside raw p-values.
 *  Numbers come from `pe_stats.adjusted_meta_uwls` for model 6. */
export const EPWAS_MULTIPLE_TESTING = {
  total_tests: 165_342,
  bonferroni_threshold: 3.02e-7,
  note: "P-values are nominal. Bonferroni threshold for the full EP-WAS catalog is 3.02e-07 (0.05 / 165,342 tests on model 6). For a hypothesis-driven single test you may use nominal p<0.05; for screening across many exposures/phenotypes apply Bonferroni or BH-FDR.",
} as const;

/** Epistemic caveats — embedded in every EP-WAS tool response so the model
 *  encounters them while reading results, not just in system instructions. */
export const EPWAS_CAVEATS = {
  study_design: "Cross-sectional (NHANES) — no temporal ordering; associations, not causation.",
  causal_language: "Do not use causal language ('causes', 'leads to', 'prevents'). Use 'is associated with'.",
  alternative_explanations: [
    "Unmeasured or residual confounding (variables not in the adjustment model)",
    "Reverse causation (disease status alters exposure, e.g., medication use, dietary change after diagnosis)",
    "Healthy-participant / selection bias (healthier individuals may have different exposure profiles)",
    "Measurement error (single time-point exposure may not reflect chronic exposure)",
    "Collider bias (conditioning on a common effect of exposure and outcome)",
  ],
  what_would_strengthen: [
    "Prospective cohort replication with temporal ordering",
    "Mendelian randomization (genetic instrument for the exposure)",
    "Randomized controlled trial (where ethical and feasible)",
    "Dose-response gradient across exposure levels",
    "Biological mechanism from CTD or experimental literature",
    "Consistency across independent populations (HHEAR cohorts)",
  ],
  effect_context: "Beta is per 1-SD change in log₁₀(exposure). Compare effect magnitude to within-person measurement variability before interpreting as clinically meaningful.",
} as const;

/** EP-WAS adjustment model descriptions (matches adjustment.R scenario order) */
export const MODEL_DESCRIPTIONS: Record<number, string> = {
  1: "base (unadjusted)",
  2: "age + age² + sex + ethnicity + income + education (fully adjusted)",
  3: "age + age² + sex",
  4: "age + age²",
  5: "sex",
  6: "age + age² + sex + ethnicity",
  7: "age + age² + sex + income + education",
  8: "income + education",
  9: "ethnicity",
};
