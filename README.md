# ExposomeQL

**A guardrailed data agent for exposome research.** ExposomeQL is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants query population exposure–health data with the epidemiologic rules built in — so the model answers from the data, not from memory, and can't skip survey weights, limit-of-detection handling, or multiple-testing correction.

It exposes:

- **66.8 million pre-computed exposure–phenotype associations** from the exposome–phenome atlas ([Patel, Ioannidis & Manrai, *Nature Medicine* 2026](https://www.nature.com/articles/s41591-026-04266-0)), meta-analyzed across NHANES cycles
- **NHANES 1999–2018 microdata** for new survey-weighted analyses, including NDI-linked mortality
- **HHEAR** multi-cohort biomonitoring (36 cohorts)
- **CTD** toxicogenomics (chemical–gene, –disease, –pathway, GO)
- **64 curated RCT meta-analyses** for triangulating nutrient findings

**74 tools · 19 resources · 6 guardrail systems.** Every computed result returns the R or Python code that produced it.

---

## Why guardrails

Exposome data is easy to analyze wrongly. NHANES is a complex survey with subsample-specific weights; biomarkers have limits of detection; associations shift across survey cycles; and a scan across thousands of exposures needs correction for multiple testing. A general-purpose LLM asked "does PFOA raise cholesterol?" will improvise an answer. ExposomeQL turns these rules into the tools themselves rather than prompt instructions:

| Guardrail | What it enforces |
|---|---|
| Survey weights | Picks the correct weight (`WTMEC2YR`, dietary `WTDRD1`, fasting `WTSAF2YR`) and design (PSU, strata, `nest=TRUE`) |
| Limit of detection | Reads LOD comment codes; warns when >40% of values are censored |
| Cell size | Flags or suppresses estimates with N < 30 (NCHS guidance) |
| Cycle pooling | Checks which cycles a variable exists in before pooling |
| Multiple testing | Bonferroni (3.02 × 10⁻⁷ across 165,342 tests) and BH-FDR |
| Provenance | Returns reproducible code with each computed result |

Diagnostic tools go further: `simpson_paradox_test` compares pooled and within-cycle estimates, `confounder_check` screens for confounding by biomarkers like albumin, and `nutrient_biomarker_vs_dietary` compares observational signals against RCT evidence.

## Evidence it works

- **Validation:** 92% directional agreement (22/24) with established exposure–health findings ([docs/validation_results.md](docs/validation_results.md)).
- **Ablation:** across 20 evaluation prompts, tool access raised pass rates from 45% → 85% for Claude Haiku 4.5 and 70% → 100% for Claude Opus 4.6, with the largest gains on quantitative answers and resisting hallucination ([docs/eval_results.md](docs/eval_results.md)). The same tools also work with an 8B open-weight model running locally.
- **Discovery examples:** convergence of PFOA, lead, and cadmium on renal urate transporters ([walkthrough](docs/WALKTHROUGH_URIC_ACID.md)); Simpson's paradox in PFOA–cholesterol; dietary recall agreeing with RCTs no better than chance (50%) versus 83% for serum biomarkers.

## Architecture

```
MCP client (Claude, other LLMs, web app)
        │  stdio  or  Streamable HTTP (:3001/mcp)
        ▼
ExposomeQL server (TypeScript, @modelcontextprotocol/sdk)
  ├─ DuckDB ── NHANES + EP-WAS SQLite (PE / EE / PP), CTD Parquet, HHEAR CSVs
  ├─ R worker pool ── survey-weighted models (survey, nhanespewas)
  ├─ Python ── HHEAR cohort analyses, phenotype derivation
  ├─ Variable resolver ── fuzzy matching over 14,464 NHANES variables
  └─ Guardrails ── weights · LOD · cell size · cycle pooling · multiple testing
```

Pre-computed lookups are SQL queries and return in milliseconds. New analyses (models, dose–response, survival, ExWAS) run in R or Python subprocesses.

## Quick start

```bash
git clone https://github.com/chiragjp/exposomeql
cd exposomeql
npm install
npm run setup-r      # R packages (compiles; 10–20 min)
npm run setup-py     # pandas numpy scipy statsmodels
npm run build

bash scripts/setup-local-data.sh /path/to/nhanespewas/db   # link the data
npm test                                                     # smoke test
```

### Requirements

| Runtime | Version | Used for |
|---|---|---|
| Node.js | ≥ 18 | The server (`duckdb` is a native module) |
| R | ≥ 4.0, `Rscript` on `PATH` | Survey-weighted NHANES statistics |
| Python | 3.x | HHEAR cohort tools, phenotype derivation |

A C/C++ toolchain is needed because `duckdb` and several R packages compile from source:

```bash
# macOS
xcode-select --install
brew install node r python@3.12 cmake

# Ubuntu/Debian
sudo apt-get install -y build-essential cmake r-base r-base-dev \
  libxml2-dev libcurl4-openssl-dev libssl-dev python3 python3-pip
```

R packages: `survey`, `dplyr`, `tidyr`, `purrr`, `broom`, `stringr`, `jsonlite`, `DBI`, `RSQLite`, `mgcv`, `rms`, `mediation`, `quantreg`, plus `chiragjp/nhanespewas` and `timfolsom/hei` from GitHub. On Ubuntu 24.04+, install the Python packages in a venv.

### Data

The data is not in the repo (~20 GB). ExposomeQL looks for `nhanes_031725.sqlite` in `EXPOSOMEQL_DATA_DIR`, then `./data`, then `../nhanespewas/db`. The EP-WAS databases (`pe_summary_stats_01_2025.sqlite`, `ee_summary_stats_03_2024.sqlite`, `pp_summary_stats_03_2024.sqlite`) and `ctd/parquet/` sit alongside it. HHEAR datasets are under a data use agreement and are read from `HHEAR_DATA_DIR`.

**HHEAR-only mode:** if no NHANES database is found, the server still starts. NHANES, EP-WAS, and CTD tools are disabled and the HHEAR cohort tools keep working.

## Connecting a client

**Local (stdio)**, for Claude Desktop or Claude Code:

```json
{
  "mcpServers": {
    "exposomeql": {
      "command": "node",
      "args": ["/path/to/exposomeql/dist/index.js"],
      "env": {
        "EXPOSOMEQL_DATA_DIR": "/path/to/data",
        "HHEAR_DATA_DIR": "/path/to/hhear"
      }
    }
  }
}
```

**HTTP**, for shared or remote use:

```bash
npm run start:http            # http://localhost:3001/mcp  (health: /health)
claude mcp add --transport http exposomeql http://localhost:3001/mcp
```

The HTTP endpoint has no built-in authentication. Put it behind a reverse proxy with access control before exposing it publicly.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `EXPOSOMEQL_DATA_DIR` | `./data` | NHANES / EP-WAS / CTD data directory |
| `HHEAR_DATA_DIR` | auto-detected | HHEAR Targeted Datasets directory |
| `EXPOSOMEQL_PORT` | `3001` | HTTP port |
| `EXPOSOMEQL_R_POOL` | on | Set `0` to spawn a fresh R process per call |
| `EXPOSOMEQL_R_POOL_SIZE` | `2` | Number of persistent R workers |
| `RSCRIPT_PATH` | `Rscript` on `PATH` | Path to Rscript |
| `PYTHON_PATH` | `python3` | Path to Python |
| `NHANESPEWAS_PATH` | auto-detected | Local `nhanespewas` R package source |

## Example

```
User: What are the health effects of PFOA, and why?

→ ctd_triangulate(exposure: "PFOA")

EP-WAS (NHANES, meta-analyzed across cycles)
  ↑ Uric acid (β = 0.111, p = 7.6e-5)   ↑ Albumin (β = 0.177)   ↑ Cholesterol (β = 0.061)
CTD mechanisms
  PPARα (284 interactions) · ALB (13) · SLC22A11 (9) · ABCG2 (7)
Diagnostics
  Simpson's paradox for PFOA → cholesterol: positive pooled, negative within every cycle
  Albumin binding flags possible healthy-participant bias
```

More worked examples and prompts are in the [user guide](docs/USER_GUIDE.md).

## Tools (74)

| Area | Tools |
|---|---|
| Descriptive (8) | `nhanes_mean` `nhanes_prevalence` `nhanes_distribution` `nhanes_quantile` `nhanes_count` `nhanes_trend` `secular_trend` `nhanes_reference_interval` |
| Bivariate & stratified (7) | `nhanes_correlation` `nhanes_crosstab` `nhanes_conditional` `nhanes_stratify` `nhanes_compare_groups` `exposure_correlation_matrix` `phenotype_correlation_matrix` |
| ExWAS & EP-WAS atlas (8) | `nhanes_exwas` `nhanes_exwas_stratified` `epwas_search` `epwas_summary` `epwas_phenotype_profile` `epwas_vibration` `epwas_reverse_triangulate` `exposome_globe` |
| Regression & modeling (11) | `nhanes_model` `nhanes_predict` `nhanes_interaction` `nhanes_mediation` `nhanes_dose_response` `nhanes_quantile_regression` `nhanes_sensitivity` `nhanes_variance_decomposition` `nhanes_scatter` `nhanes_analyze` `nhanes_validate` |
| Mortality (2) | `nhanes_survival` `mortality_search` |
| HHEAR cohorts (11) | `cohort_list` `cohort_variables` `cohort_mean` `cohort_exwas` `cohort_outcome_associations` `cohort_demographic_model` `cohort_exposure_intervals` `cohort_cumulative_score` `cohort_chemical_availability` `cross_cohort_compare` `nhanes_hhear_bridge` |
| Chemical & CTD (7) | `chemical_info` `ctd_query` `ctd_chemical_genes` `ctd_chemical_diseases` `ctd_chemical_pathways` `ctd_chemical_go` `ctd_triangulate` |
| Nutrients & diet (7) | `nutrient_rct_evidence` `nutrient_triangulate` `nutrient_phenotype_associations` `nutrient_biomarker_vs_dietary` `nutrient_concordance_summary` `diet_assess` `diet_quality` |
| Derived phenotypes (4) | `nhanes_phenotype_derive` `phenotype_list` `phenotype_recipe_catalog` `phenotype_inspect` |
| Profiling & diagnostics (9) | `exposure_profile` `exposure_compare` `coverage_gap` `confounder_check` `measurement_uncertainty` `guideline_compare` `my_exposome` `find_doppelgangers` `simpson_paradox_test` |

`cohort_exwas` runs an exposome-wide scan within an HHEAR cohort. Pass `outcome` (e.g. `"bmi"`) to test every exposure as `outcome ~ ln(exposure) + age + sex` (linear, or logistic for binary outcomes); omit it for a quantile scan of exposures by age, sex, and year.

## Resources (19)

| Prefix | Resources |
|---|---|
| `nhanes://` | `codebook/{variable}`, `codebook/search/{term}`, `cycles/available`, `cycles/{cycle}/variables`, `guidelines/nchs`, `guidelines/lod`, `lod/{variable}`, `weights/guide`, `subpopulations` |
| `epwas://` | `catalog/exposures`, `catalog/phenotypes`, `catalog/metadata`, `methods/overview`, `methods/voe`, `models/adjustment` |
| `ctd://` | `chemical/{identifier}`, `methods/overview` |
| `comptox://` | `chemical/{identifier}` |
| `exposomeql://` | `guidance/clinical-interpretation` |

## Privacy

Tools return aggregate statistics, not individual records, and small cells are suppressed. HHEAR data is read in place from `HHEAR_DATA_DIR` and never bundled with the code.

## Development

```bash
npm run dev          # stdio server via tsx
npm run start:http   # HTTP server
npm run typecheck    # type check only
npm test             # smoke tests
npm run eval:run     # with-tools vs. without-tools evaluation (see eval/)
```

Tools are registered in `src/tools/index.ts` and resources in `src/resources/index.ts`. Statistics live in `src/r-bridge/r-scripts/` and `src/python-bridge/py-scripts/`, and guardrails in `src/guardrails/`.

```
src/
  tools/          74 tool registrations
  resources/      19 resources
  r-bridge/       R executor, worker pool, R scripts
  python-bridge/  Python executor and scripts
  data/           DuckDB manager, cohort metadata
  variables/      Variable resolver, aliases, CompTox, CTD map, NHANES–HHEAR bridge
  guardrails/     Weights, LOD, cell size, cycle pooling, multiple testing
  codegen/        Reproducible R / Python code templates
  index.ts        stdio entry point
  index-http.ts   Streamable HTTP entry point
scripts/          Smoke tests, data setup, CTD ETL, mortality precomputation
eval/             Evaluation prompts, runner, scorer, reports
docs/             User guide, validation, case studies
```

## Citation

If you use ExposomeQL, please cite the atlas it is built on:

> Patel CJ, Ioannidis JPA, Manrai AK. An atlas of exposome–phenome associations in health and disease risk. *Nature Medicine*, 2026. https://www.nature.com/articles/s41591-026-04266-0

and, for toxicogenomic results:

> Davis AP, et al. Comparative Toxicogenomics Database's 20th anniversary: update 2025. *Nucleic Acids Research*, 2025;53(D1):D1328–D1338.

## License

The ExposomeQL code is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source available to its users.

Data sources keep their own terms: NHANES is public domain, CTD is free for academic use but [requires a license for commercial use](https://ctdbase.org/about/legal.jsp), and HHEAR data is available only under its data use agreement. None of this data is distributed with the code.

For commercial licensing, contact the author.

## Author

Chirag J. Patel, Department of Biomedical Informatics, Harvard Medical School
