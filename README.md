# ExposomeQL

A primary data agent for environmental epidemiology. ExposomeQL is an MCP server that gives AI agents structured, guardrailed access to population health data — 66 million pre-computed exposure-phenotype associations, NHANES survey microdata, CTD toxicogenomics, HHEAR multi-cohort biomonitoring, and curated RCT evidence — enabling researchers to go from question to triangulated evidence report in seconds.

**46 tools. 17 resources. 6 guardrail systems. 66ms per query.**

## Why ExposomeQL?

70-90% of chronic disease risk is environmental, yet no AI infrastructure existed for exposomics. ExposomeQL fills this gap.

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

## Tools (46)

### Descriptive Statistics (6)
`nhanes_mean` · `nhanes_prevalence` · `nhanes_distribution` · `nhanes_quantile` · `nhanes_count` · `nhanes_trend`

### Bivariate Analysis (5)
`nhanes_conditional` · `nhanes_crosstab` · `nhanes_stratify` · `nhanes_correlation` · `nhanes_compare_groups`

### EP-WAS Association Search (6)
`epwas_search` · `epwas_summary` · `epwas_phenotype_profile` · `epwas_vibration` · `nhanes_analyze` · `nhanes_exwas`

### Regression & Modeling (7)
`nhanes_model` · `nhanes_dose_response` · `nhanes_interaction` · `nhanes_mediation` · `nhanes_predict` · `nhanes_validate` · `nhanes_interaction`

### HHEAR Cohort Analytics (9)
`cohort_list` · `cohort_variables` · `cohort_mean` · `cohort_exposure_intervals` · `cohort_demographic_model` · `cohort_exwas` · `cross_cohort_compare` · `cohort_cumulative_score` · `nhanes_hhear_bridge`

### Chemical & CTD Toxicogenomics (6)
`chemical_info` · `ctd_chemical_genes` · `ctd_chemical_diseases` · `ctd_chemical_pathways` · `ctd_chemical_go` · `ctd_triangulate`

### Cross-Cutting (4)
`cohort_chemical_availability` · `cohort_outcome_associations` · `epwas_reverse_triangulate` · `exposure_profile`

### Nutrient Triangulation (5)
`nutrient_rct_evidence` · `nutrient_phenotype_associations` · `nutrient_triangulate` · `nutrient_biomarker_vs_dietary` · `nutrient_concordance_summary`

### Meta-Analytic Diagnostics (3)
`simpson_paradox_test` · `secular_trend` · `exposure_compare` · `confounder_check` · `guideline_compare`

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

- **Node.js** >= 18
- **R** >= 4.0 with packages: `survey`, `nhanespewas`, `jsonlite`, `DBI`, `RSQLite`, `dplyr`, `quantreg`
- **nhanespewas** R package: `remotes::install_github("chiragjp/nhanespewas")`
- **Data**: NHANES SQLite databases (see setup instructions)

## Citation

If you use ExposomeQL in your research, please cite:

> Patel CJ, Manrai AK. Exposome Agents: How AI Reasoning Over Public Biomonitoring Data Can Accelerate Environmental Health Policy. (2025).

EP-WAS data:
> Patel CJ. An Environment-Wide Association Study (EWAS) on Type 2 Diabetes Mellitus. PLoS One, 2010.

CTD data:
> Davis AP, et al. Comparative Toxicogenomics Database's 20th anniversary: update 2025. Nucleic Acids Research, 2025, 53(D1):D1328-D1338.

## License

MIT

## Author

Chirag J. Patel, Department of Biomedical Informatics, Harvard Medical School
