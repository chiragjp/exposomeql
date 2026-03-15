---
name: exposomeql
description: Primary data agent for environmental epidemiology. Query 66 million exposure-phenotype associations, NHANES survey data, CTD toxicogenomics, HHEAR cohort biomonitoring, and curated RCT nutrient evidence with proper epidemiological methods.
version: 0.2.0
author: Chirag J. Patel, Harvard Medical School
tags: [mcp, exposome, nhanes, epidemiology, epwas, environmental-health, toxicogenomics, nutrition, pfas, survey-statistics]
requirements: [node>=18, r>=4.0, survey, nhanespewas, duckdb]
---

# ExposomeQL

A primary data agent for environmental epidemiology — the first MCP server that gives AI agents structured, guardrailed access to population health data with proper epidemiological methods.

## When to Use

Use ExposomeQL when you need to:

- **Query exposure-health associations** — "Is PFOA associated with cholesterol?" "What exposures affect uric acid?"
- **Triangulate evidence** — combine observational (NHANES), experimental (RCT), and mechanistic (CTD gene) evidence
- **Detect confounding** — Simpson's paradox, albumin binding bias, dietary recall vs biomarker discordance
- **Compute population statistics** — survey-weighted means, prevalence, dose-response curves from NHANES
- **Compare chemicals** — rank PFAS compounds by effect on uric acid, compare metals against kidney markers
- **Evaluate nutrient evidence** — compare RCT meta-analyses against observational dietary associations
- **Assess dietary guidelines** — map nutrient intake levels against DRI/RDA thresholds with secular trends

## What Makes This Different

Unlike literature synthesis agents (Elicit, Consensus) that search published text, ExposomeQL queries **primary research data** with **proper statistical methods**:

- Survey-weighted regression (not naive stats on NHANES)
- LOD handling, cell size suppression, multiple testing correction
- Meta-analysis across 10 NHANES cycles (1999-2018)
- Simpson's paradox detection (ecological confounding)
- Biomarker vs dietary recall validation (83% vs 50% concordance with RCTs)

## Data Sources

| Source | Scale |
|--------|-------|
| NHANES 1999-2018 | 14,464 variables, ~100K participants |
| EP-WAS association atlas | 66.8M pre-computed associations |
| HHEAR consortium | 35+ cohorts, 21K+ participants |
| CTD toxicogenomics | 415K gene interactions |
| Nutrient RCT evidence | 64 meta-analysis effects, 17 nutrients |
| Dietary guidelines | DRI/RDA/UL for 16 nutrients |

## Tools (46)

### Descriptive Statistics (6)
`nhanes_mean` · `nhanes_prevalence` · `nhanes_distribution` · `nhanes_quantile` · `nhanes_count` · `nhanes_trend`

### Bivariate Analysis (5)
`nhanes_conditional` · `nhanes_crosstab` · `nhanes_stratify` · `nhanes_correlation` · `nhanes_compare_groups`

### EP-WAS Search (6)
`epwas_search` · `epwas_summary` · `epwas_phenotype_profile` · `epwas_vibration` · `nhanes_analyze` · `nhanes_exwas`

### Regression & Modeling (7)
`nhanes_model` · `nhanes_dose_response` · `nhanes_interaction` · `nhanes_mediation` · `nhanes_predict` · `nhanes_validate` · `nhanes_interaction`

### HHEAR Cohort Analytics (9)
`cohort_list` · `cohort_variables` · `cohort_mean` · `cohort_exposure_intervals` · `cohort_demographic_model` · `cohort_exwas` · `cross_cohort_compare` · `cohort_cumulative_score` · `nhanes_hhear_bridge`

### Chemical & CTD (6)
`chemical_info` · `ctd_chemical_genes` · `ctd_chemical_diseases` · `ctd_chemical_pathways` · `ctd_chemical_go` · `ctd_triangulate`

### Cross-Cutting (4)
`cohort_chemical_availability` · `cohort_outcome_associations` · `epwas_reverse_triangulate` · `exposure_profile`

### Nutrient Triangulation (5)
`nutrient_rct_evidence` · `nutrient_phenotype_associations` · `nutrient_triangulate` · `nutrient_biomarker_vs_dietary` · `nutrient_concordance_summary`

### Meta-Analytic Diagnostics (5)
`simpson_paradox_test` · `secular_trend` · `exposure_compare` · `confounder_check` · `guideline_compare`

## Example Prompts

### Quick Queries
- "What is the average blood lead level in children under 6?"
- "Show me all phenotypes associated with cadmium."
- "Which PFAS compound has the strongest association with uric acid?"

### Triangulation
- "Triangulate the evidence for PFOA and kidney disease."
- "What does the RCT evidence say about vitamin D?"
- "How well do observational dietary studies agree with randomized trials?"

### Methodological
- "Test if PFOA-cholesterol shows Simpson's paradox."
- "Check PFOA for confounders — is albumin binding an issue?"
- "Compare biomarker vs dietary recall concordance for iron."

### Dietary Guidelines
- "How does current vitamin D intake compare to the RDA?"
- "Which nutrients of concern are declining in the US population?"

## Outputs

All tools return structured JSON with:
- Effect estimates (β, SE, p-value, 95% CI)
- Variable descriptions from NHANES codebook
- Guardrail warnings (cell size, LOD, multiple testing)
- Source attribution (model number, n_cycles, PMID)
- Reproducible R code (for R-based computations)

## Performance

- **66ms** mean query time per association lookup (165,342 meta-analytic tests)
- **92% directional accuracy** against 24 established exposure-health findings
- **1.6 seconds** total for 24-association validation with Bonferroni correction

## Installation

```bash
git clone https://github.com/chiragjp/exposomeql
cd exposomeql
npm install && npm run build
bash scripts/setup-local-data.sh /path/to/nhanespewas/db
```

### MCP Client Configuration
```json
{
  "mcpServers": {
    "exposomeql": {
      "command": "node",
      "args": ["/path/to/exposomeql/dist/index.js"],
      "env": {
        "EXPOSOMEQL_DATA_DIR": "/path/to/data"
      }
    }
  }
}
```

## Prerequisites

- Node.js >= 18
- R >= 4.0 with: `survey`, `nhanespewas`, `jsonlite`, `DBI`, `RSQLite`, `dplyr`, `quantreg`
- NHANES/EP-WAS SQLite databases (~12GB total)
- Optional: HHEAR cohort data, CTD Parquet files

## References

- Patel CJ, Ioannidis JP, Manrai AK. An atlas of exposome-phenome associations in health and disease risk. Nature Medicine, 2026.
- Davis AP, et al. CTD 20th anniversary update 2025. Nucleic Acids Research, 2025.

## License

MIT
