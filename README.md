# ExposomeQL

A primary data agent for environmental epidemiology. ExposomeQL is an MCP server that gives AI agents structured, guardrailed access to population health data — 66 million pre-computed exposure-phenotype associations, NHANES survey microdata, CTD toxicogenomics, HHEAR multi-cohort biomonitoring, and curated RCT evidence — enabling researchers to go from question to triangulated evidence report in seconds.

**46 tools. 17 resources. 6 guardrail systems. 66ms per query.**

## Why ExposomeQL?

A large portion of disease risk is environmental or non-genetic, yet no AI infrastructure existed for exposomics. ExposomeQL fills this gap.

Unlike literature synthesis agents (Elicit, Consensus, Semantic Scholar) that search *what researchers wrote*, ExposomeQL queries *what the data shows* — with proper epidemiological methods (survey weights, LOD handling, meta-analysis, multiple testing correction) that a general-purpose agent cannot improvise.

Unlike molecular biology agents (Biomni, BioMCP) that handle genomics and drug discovery, ExposomeQL handles the environmental side of the G×E equation — the same way Biomni handles the G.

### What it can do that no other agent can

1. **"Is PFOA associated with cholesterol, adjusted for age/sex/race, meta-analyzed across 10 NHANES cycles?"** → β=+0.061, p=0.049 in 63ms
2. **"Does this association show Simpson's paradox?"** → YES: pooled positive, within-cycle negative — ecological confounding detected
3. **"Is the dietary recall evidence for iron trustworthy?"** → 0% concordance with RCTs (fully confounded); serum biomarker achieves 83%
4. **"Which of 9 PFAS compounds affects uric acid most?"** → PFOA (β=+0.111) via SLC22A11/ABCG2 renal transporter inhibition (9 CTD interactions)
5. **"Run a dose-response analysis of lead vs kidney function using restricted cubic splines"** → Executes R code on NHANES microdata with proper survey weights

### Validation

- **92% directional accuracy** against 24 established exposure-health findings from the literature
- **79% nominally significant**, **67% BH-FDR significant**, **17% Bonferroni significant** (across 165,342 meta-analytic tests)
- **66ms mean query time** per association lookup

## Quick Start

```bash
git clone https://github.com/chiragjp/exposomeql
cd exposomeql
npm install
npm run build

# Set up data (requires NHANES/EP-WAS databases)
bash scripts/setup-local-data.sh /path/to/nhanespewas/db

# Test
npm run typecheck    # compile check
npm test             # smoke test (starts server, runs queries)
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "exposomeql": {
      "command": "node",
      "args": ["/path/to/exposomeql/dist/index.js"],
      "env": {
        "EXPOSOMEQL_DATA_DIR": "/path/to/data",
        "HHEAR_DATA_DIR": "/path/to/hhear-data"
      }
    }
  }
}
```

## Example: PFOA Triangulation

```
User: "What are the health effects of PFOA and why?"

→ ctd_triangulate(exposure: "PFOA")

EP-WAS (NHANES, N~100K, meta-analyzed across 5 cycles):
  Lipid:    ↑Cholesterol (β=0.061), ↑Albumin (β=0.177)
  Kidney:   ↑Uric acid (β=0.111, p=7.6e-5)
  Immune:   ↑Lymphocytes (β=0.084), ↓Neutrophils (β=-0.084)

CTD (gene mechanisms, 9,656 PFOA interactions):
  PPARα:     284 interactions → hepatic lipid metabolism
  ALB:       13 interactions → protein binding (confounder!)
  SLC22A11:  9 interactions → renal urate transport
  ABCG2:     7 interactions → urate efflux

Simpson's paradox detected for PFOA→cholesterol:
  Pooled: β=+0.061 (positive)
  Within-cycle: β≈-0.20 (negative in all 5 cycles)
  Explanation: PFAS declining over time + statin use increasing
```

## Example: Nutrient Evidence Triangulation

```
User: "How well do observational dietary studies agree with RCTs?"

→ nutrient_concordance_summary()

Overall: 61% concordance (dietary recall vs RCT direction)
Biomarker exposures: 83% concordance

Per nutrient:
  Magnesium: 86% | Vitamin D: 80% | Fiber: 80% | Vitamin C: 100%
  Iron: 0% (fully confounded) | Omega-3: 0% (dietary pattern bias)

Key finding: dietary recall is equivalent to a coin flip (50%)
for predicting RCT-established causal effects.
```

## Data Sources

| Layer | Source | Scale |
|-------|--------|-------|
| Population biomonitoring | NHANES 1999-2018 (10 cycles) | 14,464 variables, ~100K participants |
| Association atlas | EP-WAS pre-computed results | 66.8M PE + 33.3M EE associations |
| Cohort biomonitoring | HHEAR consortium | 35+ cohorts, 21K+ participants |
| Toxicogenomics | CTD | 415K gene interactions, 607K disease associations |
| Chemical identity | EPA CompTox Dashboard | 54 chemicals with CAS, DTXSID, thresholds |
| Chemical mapping | CTD MeSH crosswalk | 326 chemicals across all data sources |
| Nutrient RCT evidence | Cochrane + high-impact meta-analyses | 64 nutrient-outcome pairs, 17 nutrients |
| Dietary guidelines | IOM/NASEM DRI, DGA 2025-2030 | RDA/AI/UL for 16 nutrients |

## Tools (74)

### Descriptive statistics (8)
`nhanes_mean` · `nhanes_prevalence` · `nhanes_distribution` · `nhanes_quantile` · `nhanes_count` · `nhanes_trend` · `secular_trend` · `nhanes_reference_interval`

### Bivariate & stratified analysis (7)
`nhanes_correlation` · `nhanes_crosstab` · `nhanes_conditional` · `nhanes_stratify` · `nhanes_compare_groups` · `exposure_correlation_matrix` · `phenotype_correlation_matrix`

### ExWAS & EP-WAS catalog (8)
`nhanes_exwas` · `nhanes_exwas_stratified` · `epwas_search` · `epwas_summary` · `epwas_phenotype_profile` · `epwas_vibration` · `epwas_reverse_triangulate` · `exposome_globe`

### Regression & modeling (11)
`nhanes_model` · `nhanes_predict` · `nhanes_interaction` · `nhanes_mediation` · `nhanes_dose_response` · `nhanes_quantile_regression` · `nhanes_sensitivity` · `nhanes_variance_decomposition` · `nhanes_scatter` · `nhanes_analyze` · `nhanes_validate`

### Mortality / survival (2)
`nhanes_survival` · `mortality_search`

### HHEAR cohort analytics (11)
`cohort_list` · `cohort_variables` · `cohort_mean` · `cohort_exwas` · `cohort_outcome_associations` · `cohort_demographic_model` · `cohort_exposure_intervals` · `cohort_cumulative_score` · `cohort_chemical_availability` · `cross_cohort_compare` · `nhanes_hhear_bridge`

### Chemical & CTD toxicogenomics (7)
`chemical_info` · `ctd_query` · `ctd_chemical_genes` · `ctd_chemical_diseases` · `ctd_chemical_pathways` · `ctd_chemical_go` · `ctd_triangulate`

### Nutrient & diet triangulation (7)
`nutrient_rct_evidence` · `nutrient_triangulate` · `nutrient_phenotype_associations` · `nutrient_biomarker_vs_dietary` · `nutrient_concordance_summary` · `diet_assess` · `diet_quality`

### Phenotype derivation (4)
`nhanes_phenotype_derive` · `phenotype_list` · `phenotype_recipe_catalog` · `phenotype_inspect`

### Exposure profiling & diagnostics (9)
`exposure_profile` · `exposure_compare` · `coverage_gap` · `confounder_check` · `measurement_uncertainty` · `guideline_compare` · `my_exposome` · `find_doppelgangers` · `simpson_paradox_test`

## Resources (17)

| Resource | URI |
|----------|-----|
| NHANES codebook | `nhanes://codebook/{variable}` |
| Codebook search | `nhanes://codebook/search/{term}` |
| Cycle inventory | `nhanes://cycles/available` |
| Cycle variables | `nhanes://cycles/{cycle}/variables` |
| NCHS guidelines | `nhanes://guidelines/nchs` |
| LOD guidelines | `nhanes://guidelines/lod` |
| LOD by variable | `nhanes://lod/{variable}` |
| Weight guide | `nhanes://weights/guide` |
| Subpopulations | `nhanes://subpopulations` |
| Exposure catalog | `epwas://catalog/exposures` |
| Phenotype catalog | `epwas://catalog/phenotypes` |
| EP-WAS metadata | `epwas://catalog/metadata` |
| EP-WAS methods | `epwas://methods/overview` |
| Vibration of effects | `epwas://methods/voe` |
| Adjustment models | `epwas://models/adjustment` |
| CompTox chemical | `comptox://chemical/{identifier}` |
| CTD methods | `ctd://methods/overview` |

## Guardrails

Every analysis enforces epidemiological best practices automatically:

- **Survey weights** — Correct weight selection (WTMEC2YR, WTDRD1, WTSAF2YR) based on variable type
- **LOD handling** — Automatic below-LOD detection via comment codes; warnings when >40% censored
- **Cell size** — N ≥ 30 per NCHS guidelines; unreliable estimates flagged
- **Variance estimation** — PSU + strata with nest=TRUE
- **Multiple testing** — Bonferroni (0.05/165,342 = 3.02e-7) and BH-FDR
- **Code provenance** — Every R computation returns the exact code that produced it

## Privacy

The LLM never accesses individual-level data. All tools return only aggregated, disclosure-safe statistics. Cell suppression is enforced for small samples.

## Project Structure

```
src/
  tools/          46 MCP tool implementations
  resources/      17 MCP resource handlers
  r-bridge/       R subprocess executor + 26 R scripts
  data/           DuckDB connection manager
  variables/      Variable resolver, alias maps, CompTox, CTD, NHANES-HHEAR bridge
  guardrails/     Weight enforcement, LOD, cell size, cycle pooling, multiple testing
  codegen/        R code generation templates
  config.ts       Data path resolution (supports EXPOSOMEQL_DATA_DIR env var)
  server.ts       Server initialization
scripts/
  smoke-test.ts         Smoke test suite
  setup-local-data.sh   Local data directory setup (avoids cloud sync issues)
  ctd-etl.ts            CTD data download and Parquet conversion
  nutrient-scope.ts     Nutrient coverage scoping
data/
  nutrient_rct_evidence.csv          64 curated RCT meta-analysis effects
  nutrient_outcome_phenotype_map.csv 75 RCT outcomes → NHANES phenotypes
  ctd/parquet/                       CTD Parquet files
docs/
  USER_GUIDE.md                      Full user guide with examples and prompts
  validation_results.md              Systematic validation (92% accuracy)
  nutrient_guidelines_report.md      Dietary guidelines analysis
  pfas_exposure_report.md            PFAS health effects critique of ATSDR
  nutrient_rct_database.md           RCT evidence database documentation
  positioning_vs_agents.md           Comparison with Biomni, Elicit, BioMCP
  WALKTHROUGH_URIC_ACID.md           Discovery case study
paper/
  PAPER_DRAFT.md                     NMI paper draft
```

## Prerequisites

The server computes its statistics in **R** and **Python** subprocesses, so a
working install needs both runtimes (plus a C/C++ toolchain — `duckdb` and
several R packages compile from source).

| Runtime | Min version | Needed for |
|---|---|---|
| **Node.js** | ≥ 18 | The MCP server itself (TypeScript; `duckdb` is native) |
| **R** | ≥ 4.0 (`Rscript` on `PATH`) | Survey-weighted NHANES statistics — most tools |
| **Python** | 3.x (`python3`, or set `PYTHON_PATH`) | HHEAR cohort tools, phenotype derivation, `nhanes_doppelganger` |

### System packages

```bash
# macOS (Xcode CLT provides the compiler toolchain)
xcode-select --install
brew install node r python@3.12 cmake

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y \
  build-essential cmake \
  r-base r-base-dev \
  libxml2-dev libcurl4-openssl-dev libssl-dev \
  python3 python3-pip
# Node 18+ via NodeSource if your distro ships an older one.
```

### Analysis libraries

Install once after `npm install`:

```bash
npm run setup-r     # CRAN + GitHub R packages (compiles — can take 10-20 min)
npm run setup-py    # pandas numpy scipy statsmodels
#   On PEP-668 systems (Ubuntu 24.04+): use a venv, or
#   pip3 install --break-system-packages pandas numpy scipy statsmodels
```

What those install (listed explicitly so the requirements are clear):

- **R (CRAN):** `survey`, `dplyr`, `tidyr`, `purrr`, `broom`, `stringr`,
  `jsonlite`, `DBI`, `RSQLite`, `mgcv`, `rms`, `mediation`, `quantreg`
- **R (GitHub, via `remotes`):** `chiragjp/nhanespewas`, `timfolsom/hei`
- **Python:** `pandas`, `numpy`, `scipy`, `statsmodels`

### Data

NHANES / EP-WAS SQLite + Parquet (~20+ GB), not included in the repo. Point
`EXPOSOMEQL_DATA_DIR` / `EXPOSOMEQL_DB_PATH` at it; `bash
scripts/setup-local-data.sh /path/to/nhanespewas/db` wires up the expected
layout. See **Quick Start** above.

> For a turnkey single-box production deploy (Node + R + Python + Caddy
> provisioned via cloud-init), see the web app repo's `docs/DEPLOY.md`.

## Citation

If you use ExposomeQL in your research, please cite:

EP-WAS data:
> Patel CJ, Ioannidis JP, Manrai AK. An atlas of exposome–phenome associations in health and disease risk. https://www.nature.com/articles/s41591-026-04266-0

CTD data:
> Davis AP, et al. Comparative Toxicogenomics Database's 20th anniversary: update 2025. Nucleic Acids Research, 2025, 53(D1):D1328-D1338.

## License

MIT

## Author

Chirag J. Patel, Department of Biomedical Informatics, Harvard Medical School
