# ExposomeQL

An MCP server for conducting and interpreting Exposome-Wide Association Studies (ExWAS). ExposomeQL gives LLMs structured, guardrailed access to NHANES biomonitoring data, 66 million pre-computed exposure-phenotype associations, HHEAR multi-cohort data, and the Comparative Toxicogenomics Database (CTD) — enabling researchers to go from statistical association to mechanistic hypothesis in seconds.

## What ExposomeQL Does

ExposomeQL is built for three core workflows:

### 1. Conduct ExWAS
Run survey-weighted exposome-wide association studies on NHANES data, or query 66 million pre-computed associations across 9 adjustment models. Compare results across cohorts using HHEAR data from 35+ global studies.

### 2. Interpret ExWAS Results
The `ctd_triangulate` tool links epidemiological findings to biological mechanisms using three independent evidence streams. Given an exposure, it:
- Retrieves significant EP-WAS phenotype associations from NHANES (meta-analyzed, fully adjusted)
- Pulls exposure levels from HHEAR cohorts that measured the same chemical (independent replication)
- Categorizes associations by biological system (lipid metabolism, hepatic function, immune, etc.)
- Queries CTD for curated gene interactions with directionality (increases/decreases expression, binds, inhibits)
- Generates directional hypotheses: **exposure → gene mechanism → phenotype**

### 3. Contextualize Exposure Levels
Compute population reference ranges, compare to regulatory thresholds (CDC, WHO, German HBM), and evaluate exposure distributions across cohorts and demographic groups.

## Example: PFOA Triangulation

```
User: "What are the health effects of PFOA and why?"

ExposomeQL calls ctd_triangulate("PFOA"):

EP-WAS (NHANES population-level, N~100K):
  Lipid Metabolism:    ↑Cholesterol (β=0.064), ↑Triglycerides (β=0.037)
  Hepatic Function:    ↑ALT (β=0.051), ↑Albumin (β=0.176)
  Uric Acid:           ↑Uric acid (β=0.111, p=1e-16)
  Immune:              ↑Lymphocytes (β=0.079), ↓Neutrophils (β=-0.070)

HHEAR (independent cohort replication):
  5 cohorts measured PFOA across 3 countries
  Median serum levels: 1.2–4.8 ng/mL (children), 2.1–6.3 ng/mL (adults)
  Cross-cohort exposure characterization confirms widespread detection

CTD (gene-level mechanisms):
  Lipid:    PFOA binds PPARα (26 interactions) → ↓HMGCR, ↓LDLR, ↓APOB
  Uric:     PFOA inhibits SLC22A11 (9 interactions) → ↓renal urate clearance
  Immune:   PFOA ↓TNF/IL1B secretion via PPARα → suppressed innate immunity
  Hepatic:  PFOA binds albumin, activates NR1I2/PXR → hepatocyte stress

Directional hypothesis:
  PFOA binds PPARα → disrupted hepatic lipid metabolism → ↑serum cholesterol
  PFOA inhibits SLC22A11/ABCG2 → ↓renal uric acid excretion → hyperuricemia
  PFOA ↓TNF/IL1B via PPARα → ↓innate immunity → lymphocyte/neutrophil shift
```

## Architecture

```
LLM Client → MCP Protocol (stdio) → ExposomeQL Server
                                       ├─ DuckDB (EP-WAS: 66M+ associations, CTD: 1.3M records)
                                       ├─ R subprocess (survey-weighted statistics)
                                       ├─ Variable Resolver (Fuse.js, 14,464 NHANES variables)
                                       ├─ CTD Chemical Map (326 chemicals → gene/disease/pathway)
                                       ├─ CompTox Identity (54 chemicals, CAS/DTXSID/thresholds)
                                       └─ Guardrails (weights, LOD, cell size, multiple testing)
```

## Data Sources

| Layer | Source | Scale |
|-------|--------|-------|
| Population biomonitoring | NHANES 1999-2018 (10 cycles) | 14,464 variables, ~100K participants |
| Association atlas | EP-WAS pre-computed results | 66.8M PE + 33.3M EE associations |
| Cohort biomonitoring | HHEAR consortium | 35+ cohorts, 9,664 children + 11,764 adults |
| Toxicogenomics | CTD (Comparative Toxicogenomics Database) | 415K gene interactions, 607K disease associations, 59K pathways |
| Chemical identity | EPA CompTox Dashboard | 54 chemicals with CAS, DTXSID, IARC, ToxCast |
| Chemical mapping | CTD MeSH crosswalk | 326 chemicals (404 NHANES vars + 150 HHEAR analytes) |
| Biomarker thresholds | CDC, German HBM, WHO, NASEM | 21 thresholds across 8 chemicals |

## Tools (36)

### Descriptive Statistics (6)
Survey-weighted mean, prevalence, quantile, count, trend, and distribution with automatic weight selection and NCHS-compliant variance estimation.

### Conditional & Exploratory Analysis (5)
Conditional analysis, crosstabulation, stratification, correlation, and group comparison — all design-corrected (Rao-Scott, not naive tests).

### Regression & Modeling (7)
Linear, logistic, dose-response, mediation, interaction, prediction, and on-the-fly ExWAS — all survey-weighted via R subprocess.

### EP-WAS Association Search (6)
Query the 66.8M pre-computed association atlas by exposure or phenotype. Vibration of effects across 9 adjustment models. Meta-analysis with heterogeneity statistics.

### HHEAR Cohort Analytics (8)
Cohort-level means, quantile regression ExWAS, demographic models, cross-cohort comparison, cumulative exposure scoring, and exposure intervals with NHANES bridging.

### Chemical Identity (1)
Multi-identifier resolution (name, CAS, DTXSID, NHANES code, HHEAR code) returning regulatory context, biomarker thresholds, and ToxCast annotations.

### CTD Toxicogenomics (5)
- `ctd_chemical_genes` — Curated gene interactions with directionality
- `ctd_chemical_diseases` — Disease associations (curated + inferred)
- `ctd_chemical_pathways` — Enriched KEGG/Reactome pathways
- `ctd_chemical_go` — Enriched Gene Ontology terms
- `ctd_triangulate` — **Three-source triangulation: NHANES EP-WAS (population associations) + HHEAR cohorts (independent exposure levels) + CTD (gene mechanisms) → directional hypotheses linking exposure → gene → phenotype**

### Cross-Cutting Tools (4)
- `cohort_chemical_availability` — Find which HHEAR cohorts measured a given chemical, with summary statistics and cohort metadata
- `cohort_outcome_associations` — Phenotype-wide scan: test one exposure against ALL outcomes in a cohort's epi data (e.g., arsenic × birth weight, gestational age, BMI)
- `epwas_reverse_triangulate` — **Phenotype-first triangulation**: start from a health outcome, find top exposure associations, then pull CTD mechanisms and HHEAR availability for each
- `exposure_profile` — **Personalized exposure contextualization**: given a chemical + demographic profile (age, sex, race/ethnicity, BMI), compute population and subgroup NHANES distributions, then interpret top EP-WAS associations at the individual's expected exposure level with regulatory threshold comparison

## Resources (12)

- NHANES codebook lookup and search
- NHANES cycle inventory
- NCHS survey design guidelines and weight selection guide
- EP-WAS exposure/phenotype catalogs, methodology, and vibration of effects documentation
- CompTox chemical profiles (`comptox://chemical/{identifier}`)
- CTD chemical profiles (`ctd://chemical/{identifier}`)
- CTD methodology overview (`ctd://methods/overview`)

## Guardrails

Every analysis enforces epidemiological best practices:

- **Survey weights** — Automatic selection (WTMEC2YR, WTDRD1, WTSAF2YR) based on variable type
- **Cell size** — N >= 30 per NCHS analytic guidelines; unreliable estimates flagged
- **LOD handling** — Automatic detection of below-LOD values via comment codes (LBX* → LBD*LC)
- **Variance estimation** — PSU (SDMVPSU) and strata (SDMVSTRA) with nest=TRUE
- **Multiple testing** — Bonferroni and Benjamini-Hochberg FDR correction
- **Code provenance** — Every computation returns the exact R code that produced it

## Prerequisites

- **Node.js** >= 18
- **R** >= 4.0 with packages: `survey`, `nhanespewas`, `jsonlite`, `DBI`, `RSQLite`, `dplyr`, `quantreg`
- **nhanespewas** R package: `remotes::install_github("chiragjp/nhanespewas")`

## Setup

```bash
# Install dependencies
npm install

# Ensure data symlink exists
ls -la data/  # should point to ../nhanespewas/db/

# Download and process CTD data
npx tsx scripts/ctd-etl.ts

# Build
npm run build

# Run
npm start        # production (compiled)
npm run dev      # development (tsx)
```

## MCP Client Configuration

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

## Privacy Architecture

The LLM never accesses individual-level data. It invokes tools that return only aggregated, disclosure-safe statistics. Cell suppression is enforced for N < 30. This design makes ExposomeQL suitable for federated deployment behind institutional firewalls.

## Project Structure

```
src/
  tools/          MCP tool implementations (36 tools)
  resources/      MCP resource handlers (12 resources)
  r-bridge/       R subprocess executor + 24 R scripts
  data/           DuckDB connection manager (NHANES + CTD)
  variables/      Variable resolver, alias maps, CompTox, CTD map, NHANES-HHEAR bridge
  guardrails/     Weight enforcement, LOD, cell size, cycle pooling, multiple testing
  codegen/        R code generation templates
  server.ts       Server initialization
scripts/
  ctd-etl.ts      CTD batch download, filter, and Parquet conversion
  ctd-etl.sh      Shell alternative for CTD ETL
data/             Symlink to ../nhanespewas/db/ (SQLite databases)
  ctd/parquet/    CTD Parquet files (generated by ctd-etl)
dist/             Compiled JavaScript output
bin/              CLI entry point
```

## Testing

```bash
# Test R scripts directly
echo '{"variable":"LBXBPB","cycles":["J"],"subgroup":null}' | \
  EXPOSOMEQL_DB_PATH="data/nhanes_031725.sqlite" \
  Rscript src/r-bridge/r-scripts/nhanes_mean.R

# Test server initialization
node -e "import('./dist/server.js').then(({createServer}) => createServer().then(() => {console.log('OK'); process.exit(0)}))"
```

## Citation

If you use ExposomeQL in your research, please cite:

> Patel CJ, Manrai AK. Exposome Agents: How AI Reasoning Over Public Biomonitoring Data Can Accelerate Environmental Health Policy. (2025).

CTD data:
> Davis AP, et al. Comparative Toxicogenomics Database's 20th anniversary: update 2025. Nucleic Acids Research, 2025, 53(D1):D1328-D1338.

## License

MIT

## Author

Chirag J. Patel, Department of Biomedical Informatics, Harvard Medical School
