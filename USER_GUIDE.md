# ExposomeQL User Guide

ExposomeQL is an MCP server that gives LLMs structured, guardrailed access to exposome data — enabling researchers to conduct and interpret Exposome-Wide Association Studies (ExWAS) through natural language.

This guide covers what ExposomeQL can do, how to use each tool, and the workflows that connect them.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Concepts](#core-concepts)
3. [Data Sources](#data-sources)
4. [Workflows](#workflows)
5. [Tool Reference](#tool-reference)
6. [Resource Reference](#resource-reference)
7. [Guardrails](#guardrails)
8. [Chemical Resolution](#chemical-resolution)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **R** >= 4.0 with packages: `survey`, `nhanespewas`, `jsonlite`, `DBI`, `RSQLite`, `dplyr`, `quantreg`
- **nhanespewas** R package: `remotes::install_github("chiragjp/nhanespewas")`

### Installation

```bash
git clone <repository-url>
cd exposomeql
npm install
npm run build
```

### MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "exposomeql": {
      "command": "node",
      "args": ["/path/to/exposomeql/dist/index.js"]
    }
  }
}
```

### Optional: HHEAR Cohort Data

To enable HHEAR cohort tools, set the `HHEAR_DATA_DIR` environment variable:

```json
{
  "mcpServers": {
    "exposomeql": {
      "command": "node",
      "args": ["/path/to/exposomeql/dist/index.js"],
      "env": {
        "HHEAR_DATA_DIR": "/path/to/HHEAR Targeted Datasets 2026"
      }
    }
  }
}
```

### Optional: CTD Toxicogenomics Data

Download and process CTD data for gene/disease/pathway tools:

```bash
npx tsx scripts/ctd-etl.ts
```

---

## Core Concepts

### What is ExWAS?

An Exposome-Wide Association Study (ExWAS) systematically tests associations between environmental exposures and health outcomes across the full "exposome" — the totality of environmental exposures a person experiences. ExposomeQL provides access to **66.8 million pre-computed associations** from NHANES data, plus the ability to run new analyses on-the-fly.

### Three-Source Triangulation

ExposomeQL's key analytical framework combines three independent lines of evidence:

1. **NHANES EP-WAS** — Population-level associations from ~100K participants across 10 survey cycles (1999–2018). Pre-computed meta-analyses across 9 adjustment models.
2. **HHEAR Cohorts** — Independent exposure measurements from 35+ global cohort studies (children, pregnant mothers, adults). Provides cross-cohort replication and exposure characterization.
3. **CTD (Comparative Toxicogenomics Database)** — Curated gene interactions, disease associations, and enriched pathways from published literature. Provides biological mechanisms.

Together, these move from statistical association to mechanistic hypothesis:
**exposure → gene mechanism → phenotype**

### Survey-Weighted Statistics

All NHANES analyses use survey-weighted methods to produce nationally representative estimates. ExposomeQL automatically:
- Selects the correct weight variable (MEC exam, dietary, fasting subsample)
- Applies design variables (PSU clusters, strata, `nest=TRUE`)
- Adjusts weights when pooling multiple survey cycles
- Returns reproducible R code for every computation

### Variable Resolution

You can refer to variables by NHANES code or natural language:
- `"LBXBPB"` or `"blood lead"` → Blood lead (µg/dL)
- `"LBXGH"` or `"glycohemoglobin"` or `"HbA1c"` → Glycohemoglobin (%)
- `"URXBPH"` or `"BPA"` or `"bisphenol A"` → Urinary Bisphenol A

ExposomeQL uses fuzzy matching (Fuse.js) across 14,464 NHANES variables. When ambiguous, it returns candidates for disambiguation.

---

## Data Sources

| Layer | Source | Scale | Access |
|-------|--------|-------|--------|
| Population biomonitoring | NHANES 1999–2018 (cycles A–J) | 14,464 variables, ~100K participants | All tools |
| Pre-computed associations | EP-WAS meta-analyses | 66.8M PE + 33.3M EE associations | `epwas_*` tools |
| Cohort biomonitoring | HHEAR consortium | 35+ cohorts, 9,664 children + 11,764 adults | `cohort_*` tools |
| Toxicogenomics | CTD (Comparative Toxicogenomics Database) | 415K gene interactions, 607K disease associations | `ctd_*` tools |
| Chemical identity | EPA CompTox Dashboard | 54 chemicals with CAS, DTXSID, thresholds | `chemical_info` tool |
| Chemical mapping | CTD MeSH crosswalk | 326 chemicals mapped across all data sources | Internal resolution |
| Biomarker thresholds | CDC, German HBM, WHO, NASEM | 21 thresholds across 8 chemicals | `chemical_info`, `exposure_profile` |

### NHANES Cycles

| Series | Years | Letter Code |
|--------|-------|-------------|
| Cycle 1 | 1999–2000 | A |
| Cycle 2 | 2001–2002 | B |
| Cycle 3 | 2003–2004 | C |
| Cycle 4 | 2005–2006 | D |
| Cycle 5 | 2007–2008 | E |
| Cycle 6 | 2009–2010 | F |
| Cycle 7 | 2011–2012 | G |
| Cycle 8 | 2013–2014 | H |
| Cycle 9 | 2015–2016 | I |
| Cycle 10 | 2017–2018 | J |

### EP-WAS Adjustment Models

| Model | Covariates | Use Case |
|-------|-----------|----------|
| 1 | Unadjusted | Crude associations |
| 2 | Age + age² + sex + ethnicity + income + education | Fully adjusted (recommended) |
| 3 | Age + sex | Minimal adjustment |
| 4 | Age + sex + ethnicity | Standard demographic |
| 5 | Age + sex + income | Socioeconomic |
| 6 | Age + sex + ethnicity | Default for most tools |
| 7–9 | Various combinations | Sensitivity analyses |

Model 2 (fully adjusted) is recommended for triangulation. Model 6 (age + sex + ethnicity) is the default for browsing.

---

## Workflows

### Workflow 1: Exposure-First Triangulation

*"What are the health effects of PFOA and why?"*

```
1. ctd_triangulate(exposure: "PFOA")
   → EP-WAS: significant phenotype associations grouped by biological system
   → HHEAR: exposure levels across independent cohorts
   → CTD: gene interactions, disease evidence, enriched pathways
   → Directional hypotheses: exposure → gene → phenotype

2. ctd_chemical_genes(chemical: "PFOA", biological_context: "lipid metabolism")
   → Focused gene interactions for a specific system

3. exposure_profile(chemical: "PFOA", age: 50, sex: "female")
   → Population and subgroup exposure distributions
   → Effect sizes contextualized at the individual's exposure level
```

### Workflow 2: Phenotype-First Analysis

*"What environmental exposures are associated with diabetes markers?"*

```
1. epwas_reverse_triangulate(phenotype: "LBXGH")
   → Top exposures associated with HbA1c
   → Each hit enriched with CTD gene count and HHEAR availability

2. ctd_triangulate(exposure: "cadmium")
   → Deep dive into the top hit

3. epwas_vibration(exposure: "LBXBCD", phenotype: "LBXGH")
   → How sensitive is the cadmium-HbA1c association to analytic choices?
```

### Workflow 3: Cohort-Specific Analysis

*"What does arsenic do in the Bangladesh birth cohort?"*

```
1. cohort_chemical_availability(chemical: "arsenic")
   → Which cohorts measured arsenic? (10 cohorts)

2. cohort_outcome_associations(cohort: "34", exposure: "As")
   → Phenotype-wide scan: arsenic × all outcomes (birth weight, gestational age, etc.)

3. ctd_chemical_genes(chemical: "arsenic", biological_context: "birth outcomes")
   → Mechanistic genes relevant to reproductive outcomes
```

### Workflow 4: Personalized Exposure Context

*"How does a 50-year-old woman's lead exposure compare to the population?"*

```
1. exposure_profile(chemical: "lead", age: 50, sex: "female")
   → Population percentiles (P5–P95)
   → Subgroup percentiles for 45–55 year old females
   → CDC/WHO thresholds with comparison
   → Top EP-WAS associations interpreted at her exposure level

2. chemical_info(chemical: "lead")
   → CAS, DTXSID, toxicity class, target organs, ToxCast data
```

### Workflow 5: Descriptive Epidemiology

*"What is the trend in blood lead levels over time?"*

```
1. nhanes_trend(variable: "blood lead")
   → Mean blood lead per cycle (1999–2018)

2. nhanes_distribution(variable: "LBXBPB", subgroup: "RIDAGEYR < 6")
   → Distribution in children under 6

3. nhanes_prevalence(condition: "LBXBPB > 3.5", subgroup: "RIDAGEYR < 6")
   → Prevalence above CDC reference value in children

4. nhanes_compare_groups(variable: "LBXBPB", group_var: "RIDRETH3")
   → Blood lead by race/ethnicity
```

---

## Tool Reference

### Descriptive Statistics (6 tools)

These tools compute survey-weighted statistics from NHANES individual-level data. All accept `variable` (name or code), optional `subgroup` filter, and optional `cycles`.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `nhanes_mean` | Weighted mean with 95% CI | `variable`, `subgroup`, `cycles` |
| `nhanes_prevalence` | Prevalence of a condition | `condition` (e.g., `"LBXBPB > 3.5"`), `subgroup` |
| `nhanes_distribution` | Percentiles (P5–P95), geometric mean, histogram data | `variable`, `subgroup` |
| `nhanes_quantile` | Specific quantile with CI | `variable`, `quantile` (0–1) |
| `nhanes_count` | Weighted population count meeting a condition | `condition`, `subgroup` |
| `nhanes_trend` | Mean/prevalence across all cycles (time series) | `variable`, `metric` |

**Example:**
```
nhanes_mean(variable: "blood lead", subgroup: "RIDAGEYR < 6", cycles: ["2017-2018"])
→ { mean: 0.82, se: 0.03, ci_lower: 0.76, ci_upper: 0.88, n_unweighted: 632, ... }
```

### Conditional & Exploratory Analysis (5 tools)

Design-corrected analyses for exploring relationships between variables.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `nhanes_conditional` | Mean of Y conditional on bins of X | `outcome`, `given`, `bins` (default 10) |
| `nhanes_crosstab` | Cross-tabulation with Rao-Scott χ² | `var1`, `var2` |
| `nhanes_stratify` | Summary stats grouped by one or more variables | `variable`, `by` (array) |
| `nhanes_correlation` | Weighted Pearson/Spearman correlation | `var1`, `var2` |
| `nhanes_compare_groups` | Group comparison (t-test or ANOVA) | `variable`, `group_var` |

**Example:**
```
nhanes_conditional(outcome: "BMI", given: "age", bins: 10)
→ Mean BMI for each age decile
```

### EP-WAS Association Search (6 tools)

Query the 66.8M pre-computed association atlas.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `epwas_search` | Search by exposure, phenotype, or both | `exposure`, `phenotype`, `model_number`, `p_threshold` |
| `epwas_summary` | All phenotypes for one exposure | `exposure`, `model_number`, `top_n` |
| `epwas_phenotype_profile` | All exposures for one phenotype | `phenotype`, `model_number`, `top_n` |
| `epwas_vibration` | Effect across all 9 adjustment models | `exposure`, `phenotype` |
| `nhanes_analyze` | On-the-fly regression (all 9 models) | `exposure`, `outcome`, `cycles` |
| `nhanes_exwas` | Full ExWAS scan (slow, 5–30 min) | `outcome`, `exposure_category` |

**Example:**
```
epwas_search(exposure: "cadmium", phenotype: "kidney", model_number: 2, top_n: 10)
→ Top 10 cadmium-kidney associations from the fully adjusted model
```

### Regression & Modeling (7 tools)

Advanced survey-weighted models run via R subprocess.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `nhanes_analyze` | Regression across 9 adjustment models | `exposure`, `outcome` |
| `nhanes_model` | Flexible multi-predictor regression | `outcome`, `predictors`, `model_type`, `splines`, `interactions` |
| `nhanes_dose_response` | Non-linear dose-response curves (RCS/GAM) | `exposure`, `outcome`, `method`, `n_knots` |
| `nhanes_interaction` | Effect modification testing | `exposure`, `modifier`, `outcome` |
| `nhanes_mediation` | Causal mediation (ACME, ADE, proportion mediated) | `exposure`, `mediator`, `outcome` |
| `nhanes_predict` | Predicted values at specified covariate levels | `outcome`, `predictors`, `newdata` |
| `nhanes_validate` | Code review for methodological errors | `code`, `language` |

**Example:**
```
nhanes_dose_response(exposure: "LBXBPB", outcome: "LBXSCR", method: "rcs", n_knots: 4)
→ Non-linear curve of lead vs. creatinine with test for non-linearity
```

### HHEAR Cohort Analytics (9 tools)

Analyze exposure data from the HHEAR consortium's 35+ global cohort studies.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `cohort_list` | List all loaded cohorts with metadata | (none) |
| `cohort_variables` | List analytes in a cohort | `cohort` |
| `cohort_mean` | Descriptive stats for one analyte | `cohort`, `analyte`, `creatinine_adjust` |
| `cohort_exposure_intervals` | Quantile regression intervals | `cohort`, `analyte`, `population` |
| `cohort_demographic_model` | Exposure ~ age + sex + year | `cohort`, `analyte` |
| `cohort_exwas` | Quantile ExWAS across all analytes | `cohort`, `tau`, `fdr_threshold` |
| `cross_cohort_compare` | Same analyte across multiple cohorts | `analyte`, `cohorts` |
| `cohort_cumulative_score` | Multi-chemical burden score | `cohort`, `analytes`, `method` |
| `nhanes_hhear_bridge` | Map between HHEAR and NHANES codes | `hhear_code` or `nhanes_code` |

**Example:**
```
cohort_mean(cohort: "1461", analyte: "BPA", creatinine_adjust: true)
→ { mean: 3.67, geometric_mean: 2.14, median: 2.31, n: 670, pct_below_lod: 8.2, ... }
```

### Chemical Identity & CTD Toxicogenomics (6 tools)

Chemical profiles and mechanistic evidence from curated databases.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `chemical_info` | CompTox profile (CAS, DTXSID, thresholds) | `chemical` |
| `ctd_chemical_genes` | Curated gene interactions | `chemical`, `biological_context`, `organism` |
| `ctd_chemical_diseases` | Disease associations (curated + inferred) | `chemical`, `direct_only`, `disease_filter` |
| `ctd_chemical_pathways` | Enriched KEGG/Reactome pathways | `chemical`, `significance` |
| `ctd_chemical_go` | Enriched Gene Ontology terms | `chemical`, `ontology` |
| `ctd_triangulate` | **Three-source triangulation** | `exposure`, `disease`, `top_n` |

**Biological context options for `ctd_chemical_genes`:**
`lipid metabolism`, `hepatic function`, `kidney`, `hematology`, `immune`, `thyroid`, `glucose metabolism`, `oxidative stress`, `body composition`, `bone`, `cardiovascular`, `birth outcomes`, `placental`, `neurological`, `neurodevelopment`

**Example:**
```
ctd_chemical_genes(chemical: "PFOA", biological_context: "lipid metabolism")
→ 68 gene interactions filtered to lipid-relevant genes (PPARα, HMGCR, LDLR, APOB, ...)
```

### Cross-Cutting Tools (4 tools)

Tools that integrate across data sources.

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `cohort_chemical_availability` | Which HHEAR cohorts measured a chemical? | `chemical` |
| `cohort_outcome_associations` | Phenotype-wide scan in one cohort | `cohort`, `exposure`, `covariates` |
| `epwas_reverse_triangulate` | Phenotype-first: find exposures + mechanisms | `phenotype`, `model_number`, `p_threshold` |
| `exposure_profile` | Personalized exposure contextualization | `chemical`, `age`, `sex`, `race_ethnicity`, `bmi` |

**Example:**
```
exposure_profile(chemical: "PFOA", age: 50, sex: "female")
→ Population P5–P95, subgroup distribution for 45–55yr females,
  3 biomarker thresholds (HBM-I, HBM-II, HBM-II women),
  top EP-WAS associations with IQR-contextualized effect sizes
```

---

## Resource Reference

Resources provide reference data and documentation accessible via the MCP resource protocol.

| Resource | URI | Returns |
|----------|-----|---------|
| NHANES Codebook Lookup | `nhanes://codebook/{variable}` | Variable metadata (description, data file, cycles) |
| NHANES Codebook Search | `nhanes://codebook/search/{term}` | Fuzzy-matched variable candidates |
| NHANES Cycles | `nhanes://cycles/available` | All cycles with year ranges and variable counts |
| NCHS Guidelines | `nhanes://guidelines/nchs` | Statistical analysis guidelines |
| Weight Selection Guide | `nhanes://weights/guide` | Which survey weight to use and when |
| Exposure Catalog | `epwas://catalog/exposures` | Laboratory + Dietary exposure variables |
| Phenotype Catalog | `epwas://catalog/phenotypes` | Examination + Questionnaire phenotype variables |
| EP-WAS Methods | `epwas://methods/overview` | Methodology overview |
| Vibration of Effects | `epwas://methods/voe` | VOE interpretation guide |
| Adjustment Models | `epwas://models/adjustment` | All 9 adjustment model descriptions |
| CompTox Chemical | `comptox://chemical/{identifier}` | Chemical profile with NHANES codes |
| CTD Chemical | `ctd://chemical/{identifier}` | CTD summary (gene/disease/pathway counts) |
| CTD Methods | `ctd://methods/overview` | CTD data types and triangulation methodology |

---

## Guardrails

Every analysis enforces epidemiological best practices automatically:

### Survey Weights
ExposomeQL selects the correct weight based on variable type:
- **WTMEC2YR** — MEC examination and laboratory variables (default)
- **WTDRD1** — Dietary recall day 1 variables (DR1*)
- **WTSAF2YR** — Fasting subsample (glucose, insulin, triglycerides, LDL)

### Cell Size
Per NCHS analytic guidelines, estimates with N < 30 unweighted observations are flagged as unreliable. The system warns when cell sizes are small.

### Limit of Detection (LOD)
Biomarker variables (LBX*, URX*) are automatically checked for below-LOD censoring via comment code columns (LBD*LC, URD*LC). Estimates are flagged when >40% of values are below LOD.

### Cycle Pooling
When combining multiple 2-year cycles, weights are divided by the number of cycles. The 1999–2002 special case (4-year weights) is handled automatically.

### Multiple Testing
ExWAS-style analyses apply:
- **Bonferroni correction** — conservative, controls family-wise error rate
- **Benjamini-Hochberg FDR** — controls false discovery rate at 10%

### Code Provenance
Every R-based computation returns the exact R code that produced the result, enabling reproducibility and audit.

### Privacy
The LLM never accesses individual-level data directly. All tools return only aggregated, disclosure-safe statistics. Cell suppression is enforced for small samples.

---

## Chemical Resolution

ExposomeQL accepts chemicals in multiple formats and resolves them across all data sources:

| Input Format | Example | Works With |
|-------------|---------|------------|
| Chemical name | `"lead"`, `"bisphenol A"`, `"cadmium"` | All tools |
| NHANES variable code | `"LBXBPB"`, `"URXBPH"` | All tools |
| HHEAR analyte code | `"Pb"`, `"BPA"`, `"Cd"` | All tools |
| CAS number | `"7439-92-1"` | `chemical_info`, CTD tools |
| DTXSID | `"DTXSID5020648"` | `chemical_info` |

### Chemical Categories

| Category | Count | Examples |
|----------|-------|---------|
| Heavy Metals & Trace Elements | 22 | Lead, Cadmium, Mercury, Arsenic, Manganese, Selenium |
| PFAS | 5 | PFOA, PFOS, PFNA, PFHxS, PFDA |
| Phthalate Metabolites | 11 | MEHP, MEHHP, MECPP, MEP, MBZP |
| Phenols & Antimicrobials | 7 | BPA, BPF, BPS, Triclosan, Benzophenone-3 |
| Parabens | 4 | Butylparaben, Ethylparaben, Methylparaben, Propylparaben |
| PAH Metabolites | 3 | 1-Hydroxypyrene, 1-Hydroxynaphthalene, 2-Hydroxynaphthalene |
| Organophosphate Pesticide Metabolites | 4 | DEP, DETP, DMP, DMTP |
| Flame Retardants | 1 | BDE-47 |
| Smoking Biomarkers | 2 | Cotinine, NNAL |

### Biomarker Thresholds

Regulatory reference values are available for 8 chemicals:

| Chemical | Thresholds | Sources |
|----------|-----------|---------|
| Lead | 3.5 µg/dL (children), 5 µg/dL (adults), 10 µg/dL (clinical) | CDC 2021, WHO |
| Cadmium | 1.0 µg/L (HBM-I), 4.0 µg/L (HBM-II blood) | German HBM |
| Mercury | 2.0 µg/L (HBM-I), 5.0 µg/L (HBM-II) | German HBM |
| Manganese | 15 µg/L (neurobehavioral) | Health Canada |
| BPA | 100 µg/L (children), 200 µg/L (adults) | German HBM |
| PFOA | 2 ng/mL (HBM-I), 10 ng/mL (HBM-II) | German HBM |
| PFOS | 5 ng/mL (HBM-I), 20 ng/mL (HBM-II) | German HBM |
| Cotinine | 0.05 ng/mL (secondhand smoke), 10 ng/mL (active) | Benowitz 2009 |

---

## Examples

### Example 1: PFOA Triangulation

```
User: "What are the health effects of PFOA and why?"

→ ctd_triangulate(exposure: "PFOA")

EP-WAS (NHANES, N~100K):
  Lipid Metabolism:    ↑Cholesterol (β=0.064), ↑Triglycerides (β=0.037)
  Hepatic Function:    ↑ALT (β=0.051), ↑Albumin (β=0.176)
  Uric Acid:           ↑Uric acid (β=0.111, p=1e-16)
  Immune:              ↑Lymphocytes (β=0.079), ↓Neutrophils (β=-0.070)

HHEAR (independent replication):
  11 cohorts measured PFOA across multiple countries
  Median serum levels: 1.2–6.3 ng/mL

CTD (gene-level mechanisms):
  PFOA binds PPARα (26 interactions) → ↓HMGCR, ↓LDLR, ↓APOB
  PFOA inhibits SLC22A11 → ↓renal urate clearance
  PFOA ↓TNF/IL1B via PPARα → suppressed innate immunity

Directional hypotheses:
  PFOA → PPARα → disrupted lipid metabolism → ↑cholesterol
  PFOA → SLC22A11/ABCG2 → ↓uric acid excretion → hyperuricemia
  PFOA → TNF/IL1B → ↓innate immunity → lymphocyte/neutrophil shift
```

### Example 2: Personalized Exposure Profile

```
User: "How does a 50-year-old woman's lead exposure compare?"

→ exposure_profile(chemical: "lead", age: 50, sex: "female")

Population (N=17,087):
  Geometric mean: 1.12 µg/dL
  P25: 0.59, P50: 0.94, P75: 1.56, P95: 3.64

Subgroup (females 45–55, N=984):
  Geometric mean: 0.98 µg/dL
  P25: 0.54, P50: 0.84, P75: 1.38, P95: 3.12

Thresholds:
  CDC Reference Value: 3.5 µg/dL (children) — subgroup P95 below
  CDC Adult: 5.0 µg/dL — well below

Top associations at subgroup IQR:
  ↑Uric acid (β=0.08, IQR effect: +0.06)
  ↓eGFR (β=-0.05, IQR effect: -0.04)
  ↑Systolic BP (β=0.03, IQR effect: +0.02)
```

### Example 3: Phenotype-First Analysis

```
User: "What environmental exposures affect HbA1c?"

→ epwas_reverse_triangulate(phenotype: "LBXGH")

40 significant exposures (p < 1e-5):
  Lead (LBXBPB):     β=-0.115, 2908 CTD genes, 10 HHEAR cohorts
  Nitric oxide:      β=0.016, p=1.2e-172
  Vitamin D:         β=0.017, p=1.6e-62
  Cholesterol:       β=0.160, p=1.1e-60
  Alcohol:           β=-0.085, p=2.3e-43

Each hit enriched with:
  - CTD gene count and top interacting genes
  - Direct disease evidence in CTD
  - Number of HHEAR cohorts with the chemical
```

### Example 4: Cross-Cohort Arsenic Analysis

```
User: "Which cohorts have arsenic and what outcomes are associated?"

→ cohort_chemical_availability(chemical: "arsenic")
  10 cohorts: Bangladesh (n=275), Trinidad (n=935), MARBLES (n=670), ...

→ cohort_outcome_associations(cohort: "34", exposure: "As")
  12 outcomes tested, 3 FDR-significant:
    Birth weight: β=-0.15 (p=0.003)
    Gestational age: β=-0.08 (p=0.02)
    Head circumference: β=-0.11 (p=0.01)

→ ctd_chemical_genes(chemical: "arsenic", biological_context: "birth outcomes")
  HIF1A, VEGFA (placental angiogenesis)
  TP53, CASP3 (apoptosis)
  ESR1, PPARG (endocrine disruption)
```

---

## Troubleshooting

### Variable Not Found
If a variable isn't recognized, try:
1. The exact NHANES code (e.g., `LBXBPB` instead of `"lead"`)
2. Check the codebook: use resource `nhanes://codebook/search/{term}`
3. Browse the catalog: use resource `epwas://catalog/exposures`

### No EP-WAS Results
- Try relaxing `p_threshold` (default is 1e-5 for triangulation, 0.05 for search)
- Try a different `model_number` (2 = fully adjusted, 6 = age+sex+ethnicity)
- Check if the variable exists in the pre-computed atlas with `epwas_search`

### Slow Performance
- `nhanes_exwas` scans hundreds of exposures — can take 5–30 minutes
- `cohort_exwas` tests all analytes in a cohort — may take several minutes
- Pre-computed tools (`epwas_search`, `epwas_summary`) are instant

### HHEAR Cohorts Not Loading
- Ensure `HHEAR_DATA_DIR` points to the correct directory
- Each cohort subdirectory needs a `*_TARGETED_DATA.csv` file
- Check server startup logs for cohort registration messages

### CTD Tools Return No Data
- Run the ETL: `npx tsx scripts/ctd-etl.ts`
- Ensure `data/ctd/parquet/` contains the downloaded Parquet files
- Not all chemicals have CTD data — 326 of 14,464 NHANES variables are mapped

---

## Citation

If you use ExposomeQL in your research, please cite:

> Patel CJ, Manrai AK. Exposome Agents: How AI Reasoning Over Public Biomonitoring Data Can Accelerate Environmental Health Policy. (2025).

CTD data:
> Davis AP, et al. Comparative Toxicogenomics Database's 20th anniversary: update 2025. Nucleic Acids Research, 2025, 53(D1):D1328-D1338.

---

## License

MIT

## Author

Chirag J. Patel, Department of Biomedical Informatics, Harvard Medical School
