---
name: exposomeql
description: Primary data agent for environmental epidemiology — 66 tools for querying 66M exposure-phenotype associations, NHANES survey data, NDI-linked mortality, full CTD toxicogenomics (3.1M gene interactions), HHEAR multi-cohort biomonitoring, and curated RCT evidence, with embedded epidemiological guardrails.
version: 0.3.0
author: Chirag J. Patel, Harvard Medical School
tags: [mcp, exposome, nhanes, epidemiology, epwas, environmental-health, toxicogenomics, nutrition, pfas, mortality, survey-statistics, ctd, hhear]
requirements: [node>=18, r>=4.0, survey, nhanespewas, duckdb]
---

# ExposomeQL

A primary data agent for environmental epidemiology — the MCP server that gives AI agents structured, guardrailed access to population health data with proper epidemiological methods. Queries primary research data (not literature), computes survey-weighted statistics, and encodes guardrails (multiple-testing correction, LOD handling, reverse-causation sensitivity) directly in tool outputs so models can't skip them.

## When to Use

- **"Is X associated with Y in NHANES?"** — Query 66.8M pre-computed exposure-phenotype associations with Bonferroni + BH-FDR correction in every response
- **"Does X predict mortality?"** — Pre-computed Cox PH hazard ratios for 685 exposures × 6 mortality causes (all-cause, heart, cancer, diabetes, cerebrovascular, kidney), linked to the National Death Index
- **"What's the mechanism?"** — Full CTD toxicogenomics: 3.1M gene interactions, 9.7M disease associations for ANY chemical (including microplastics, novel chemicals without NHANES codes)
- **"Is this confounded?"** — Simpson's paradox detection, confounder identification, reverse-causation sensitivity analysis with multi-cycle pooling
- **"What's the RCT evidence?"** — Compare observational NHANES associations against 64 curated RCT meta-analyses for 17 nutrients
- **"What's normal for someone like me?"** — Conditional reference intervals by age + sex via quantile regression
- **"Which exposures cluster together?"** — Pairwise correlation matrices for 420K exposure-exposure and 75K phenotype-phenotype pairs
- **"What can we measure vs what we can't?"** — Coverage gap analysis showing NHANES/HHEAR/CTD-only tiers for any chemical class

## What Makes This Different

Unlike literature agents (Elicit, Consensus) that search what researchers *wrote*, ExposomeQL queries what the data *shows*:

- **Survey-weighted regression** — not naive stats on complex survey data
- **Guardrails in outputs** — every EP-WAS result carries `survives_bonferroni`, `q_value`, and `survives_fdr_05` flags; every response includes epistemic caveats (cross-sectional design, alternative explanations, what would strengthen the evidence)
- **Mortality linkage** — prospective follow-up via NDI, not just cross-sectional associations
- **Full CTD** — 3.1M gene interactions for ALL chemicals, not just the 325 with NHANES biomonitoring codes
- **Epistemic caution** — every prompt template includes a preamble requiring "associated with" not "causes", enumeration of alternative hypotheses, and distinction between statistical and clinical significance

## Data Sources

| Source | Scale |
|--------|-------|
| NHANES 1999–2018 | 14,464 variables, ~100K participants, 10 cycles |
| EP-WAS atlas | 66.8M PE + 420K EE + 75K PP pre-computed associations |
| NDI mortality linkage | 101K participants, 9.2K deaths, follow-up through Dec 2019 |
| Mortality ExWAS | 685 exposures × all-cause + 5 cause-specific (heart, cancer, diabetes, cerebrovascular, kidney) |
| CTD toxicogenomics | 3.1M gene interactions, 9.7M disease associations, 1.7M pathways (full CTD, all chemicals) |
| HHEAR consortium | 35+ cohorts, 21K+ participants, 15+ countries |
| Nutrient RCT evidence | 64 meta-analysis effects, 17 nutrients |

## Tools (66)

### Descriptive Statistics (6)
`nhanes_mean` · `nhanes_prevalence` · `nhanes_distribution` · `nhanes_quantile` · `nhanes_count` · `nhanes_trend`

### Bivariate Analysis (5)
`nhanes_conditional` · `nhanes_crosstab` · `nhanes_stratify` · `nhanes_correlation` · `nhanes_compare_groups`

### EP-WAS Search (6)
`epwas_search` · `epwas_summary` · `epwas_phenotype_profile` · `epwas_vibration` · `nhanes_analyze` · `nhanes_exwas`

All EP-WAS tools return per-row `survives_bonferroni` + `q_value` + `survives_fdr_05` flags and a `multiple_testing` block with the scan-specific BH-FDR threshold.

### Regression & Modeling (8)
`nhanes_model` · `nhanes_dose_response` · `nhanes_interaction` · `nhanes_mediation` · `nhanes_predict` · `nhanes_validate` · `nhanes_quantile_regression` · `nhanes_exwas`

`nhanes_quantile_regression` fits at τ ∈ {0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95} — shows how an exposure's effect varies across the outcome distribution.

### Reference Intervals (1)
`nhanes_reference_interval` — conditional reference ranges by age + sex via quantile regression at τ ∈ {0.025–0.975}. Answers "what's normal for a 50-year-old male?"

### Mortality (2)
`mortality_search` · `nhanes_survival`

`mortality_search` queries pre-computed Cox PH hazard ratios for 685 exposures × 6 mortality causes (all-cause, heart, cancer, diabetes, cerebrovascular, kidney). `nhanes_survival` fits on-the-fly Cox PH for custom exposure/covariate combinations.

### HHEAR Cohort Analytics (9)
`cohort_list` · `cohort_variables` · `cohort_mean` · `cohort_exposure_intervals` · `cohort_demographic_model` · `cohort_exwas` · `cross_cohort_compare` · `cohort_cumulative_score` · `nhanes_hhear_bridge`

### Chemical & CTD (8)
`chemical_info` · `ctd_chemical_genes` · `ctd_chemical_diseases` · `ctd_chemical_pathways` · `ctd_chemical_go` · `ctd_triangulate` · `ctd_query` · `coverage_gap`

`ctd_query` searches the FULL CTD (3.1M gene interactions) for ANY chemical by name or MeSH ID — including chemicals without NHANES biomonitoring codes (e.g., microplastics, polystyrenes, novel chemicals). `coverage_gap` reports which chemicals in a class are measurable in NHANES vs HHEAR vs CTD-only.

### Cross-Cutting (4)
`cohort_chemical_availability` · `cohort_outcome_associations` · `epwas_reverse_triangulate` · `exposure_profile`

### Nutrient Triangulation (5)
`nutrient_rct_evidence` · `nutrient_phenotype_associations` · `nutrient_triangulate` · `nutrient_biomarker_vs_dietary` · `nutrient_concordance_summary`

### Meta-Analytic Diagnostics (5)
`simpson_paradox_test` · `secular_trend` · `exposure_compare` · `confounder_check` · `guideline_compare`

### Correlation Structure (2)
`exposure_correlation_matrix` · `phenotype_correlation_matrix`

Pairwise association matrices from 420K EE and 75K PP pre-computed pairs. Three input modes: explicit list, phenotype-anchored top-N, index-variable zoom.

### Personal & Diet (3)
`my_exposome` · `diet_assess` · `diet_quality`

### Sensitivity & Individual (3)
`nhanes_sensitivity` · `measurement_uncertainty` · `find_doppelgangers`

`nhanes_sensitivity` re-estimates associations after excluding diagnosed individuals or adjusting for disease status, with multi-cycle pooling. Answers "does this survive reverse-causation exclusion?"

## Example Prompts

### Mortality
- "Which environmental exposures predict all-cause mortality in NHANES?"
- "Is blood cadmium associated with cancer mortality?"
- "Compare heart disease mortality risk for lead vs cadmium."

### Exposure-Health Associations
- "Is PFOA associated with uric acid? Give me the pooled β and mechanism."
- "Run an exposure-wide scan against HbA1c — how many survive BH-FDR?"
- "Does the PFOA-cholesterol association show Simpson's paradox?"

### Triangulation & Mechanism
- "Triangulate the evidence for cadmium and kidney disease."
- "What genes does microplastics interact with in CTD?"
- "What's the coverage gap for flame retardants — what can we measure vs what we can't?"

### Reference & Individual
- "What's the normal range of serum uric acid for a 50-year-old male?"
- "Does lead affect uric acid more at the 95th percentile than the 25th?"
- "Find my doppelgangers in NHANES — 45-year-old female, BMI 28."

### Confounding & Methodology
- "Why do PFAS show paradoxical protective metabolic associations?"
- "Check if the iron-hemoglobin association is confounded by dietary recall."
- "Run a sensitivity analysis excluding diagnosed diabetics from the cadmium-glucose association."

### Nutrient Evidence
- "Does vitamin D supplementation lower blood pressure? Compare RCT vs NHANES."
- "Which nutrient associations are concordant between dietary recall and serum biomarkers?"

## Outputs

All tools return structured JSON with:
- Effect estimates (β/HR, SE, p-value, 95% CI)
- Multiple-testing context (`survives_bonferroni`, `q_value`, `survives_fdr_05`)
- Epistemic caveats (study design, alternative explanations, what would strengthen evidence)
- Variable descriptions from NHANES codebook
- Guardrail warnings (cell size, LOD, multiple testing)

## Eval Results

Tested across 5 models from 4 vendors on 20 prompts:

| Model | with MCP | without MCP | Δ |
|---|---|---|---|
| Opus 4.6 | 100% | 70% | +30 pp |
| Haiku 4.5 | 85% | 45% | +40 pp |
| GPT-5 (+nudge) | 70% | 50% | +20 pp |
| Gemini 2.5 Pro (+nudge) | 75% | 60% | +15 pp |
| Gemma 4 8B local | 55% | 50% | +5 pp |

Zero cases where MCP degraded performance on Claude models. Tool value concentrates on data-anchored tasks (quantitative +75pp, hallucination resistance +50pp).

## Installation

```bash
git clone https://github.com/chiragjp/exposomeql
cd exposomeql
npm install && npm run build
npm run setup-r              # install R packages
npx tsx scripts/ctd-etl.ts   # download + load CTD data (add --full for all chemicals)
```

### MCP Client Configuration (Claude Desktop)
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

### HTTP Transport (for OpenAI, Gemini, web deployment)
```bash
npm run start:http   # serves on http://localhost:3001/mcp
```

## Prerequisites

- Node.js >= 18
- R >= 4.0 with: `survey`, `nhanespewas`, `jsonlite`, `DBI`, `RSQLite`, `dplyr`, `quantreg`, `survival`
- NHANES/EP-WAS SQLite databases (~12GB total)
- Optional: HHEAR cohort data, full CTD Parquet files

## References

- Patel CJ, Ioannidis JP, Manrai AK. An atlas of exposome-phenome associations. Nature Medicine, 2026.
- Patel CJ, Rehkopf D, Leppert J, et al. Systematic evaluation of environmental factors and mortality. Int J Epidemiol 42:1795-1810, 2013.
- Davis AP, et al. CTD 20th anniversary update. Nucleic Acids Res 53:D1328-D1338, 2025.

## License

MIT
