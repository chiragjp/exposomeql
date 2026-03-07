# ExposomeQL

An MCP server for exposome research. ExposomeQL gives LLMs structured, guardrailed access to NHANES biomonitoring data, 66 million pre-computed exposure-phenotype associations, HHEAR cohort data, and chemical toxicological profiles — enabling natural language queries over environmental health data.

## Overview

ExposomeQL implements the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), allowing AI agents to answer questions like:

- "What fraction of US children have blood lead above the CDC reference value?"
- "What health outcomes are associated with PFOA?"
- "Screen the US population against thresholds for lead, cadmium, mercury, PFOA, and PFOS."
- "How do HHEAR cohort lead levels compare to national NHANES reference values?"

The server chains survey-weighted statistical computation (via R), chemical identity resolution, threshold-aware interpretation, and association atlas lookups — collapsing what previously required days of analyst time into seconds.

## Architecture

```
LLM Client --> MCP Protocol (stdio) --> ExposomeQL Server
                                          |-- DuckDB (pre-computed EP-WAS: 66M+ associations)
                                          |-- R subprocess (survey-weighted statistics)
                                          |-- Variable Resolver (Fuse.js fuzzy match, 14,464 variables)
                                          |-- CompTox Chemical Identity (54 chemicals, CAS/DTXSID/thresholds)
                                          |-- Guardrails (weights, LOD, cell size, multiple testing)
```

## Data Sources

| Layer | Source | Scale |
|-------|--------|-------|
| Population biomonitoring | NHANES 1999-2018 (10 cycles) | 14,464 variables, ~100K participants |
| Association atlas | ExWAS pre-computed results | 66.8M PE + 33.3M EE associations |
| Cohort biomonitoring | HHEAR consortium | 10+ cohorts |
| Chemical identity | EPA CompTox Dashboard | 54 chemicals with CAS, DTXSID, IARC, ToxCast |
| Biomarker thresholds | CDC, German HBM, WHO, NASEM | 21 thresholds across 8 chemicals |

Data files are expected via symlink at `data/` pointing to `../nhanespewas/db/`:
- `nhanes_031725.sqlite` (1.8 GB) - Individual-level NHANES data
- `pe_summary_stats_01_2025.sqlite` (11 GB) - Exposure-phenotype associations
- `ee_summary_stats_03_2024.sqlite` (4 GB) - Exposure-exposure associations

## Tools (33)

### Descriptive Statistics (6)
Survey-weighted mean, prevalence, quantile, count, trend, and distribution with automatic weight selection and NCHS-compliant variance estimation.

### Conditional & Exploratory Analysis (5)
Conditional analysis, crosstabulation, stratification, correlation, and group comparison.

### Regression & Modeling (7)
Linear, logistic, dose-response, mediation, interaction, prediction, and on-the-fly ExWAS — all survey-weighted via R subprocess.

### EP-WAS Association Search (6)
Query the 66.8M pre-computed association atlas by exposure or phenotype. Retrieve vibration of effects across 9 adjustment models, cross-exposure comparison, and categorical analysis.

### HHEAR Cohort Analytics (8)
Cohort-level means, ExWAS, demographic models, cross-cohort comparison, cumulative risk scoring, and exposure interval classification with NHANES bridging.

### Chemical Identity (1)
Multi-identifier resolution (name, CAS, DTXSID, NHANES code, HHEAR code) returning regulatory context, biomarker thresholds, and ToxCast annotations.

## Resources (10)

- NHANES codebook lookup and search
- NHANES cycle inventory
- NCHS survey design guidelines
- Survey weight selection guide
- EP-WAS exposure and phenotype catalogs
- EP-WAS methodology and vibration of effects documentation
- CompTox chemical profiles (`comptox://chemical/{identifier}`)

## Guardrails

- **Survey weight enforcement** - Automatic selection of WTMEC2YR, WTDRD1, or WTSAF2YR based on variable type
- **Cell size minimum** - N >= 30 per NCHS analytic guidelines
- **LOD handling** - Automatic limit-of-detection comment code detection (LBX* -> LBD*LC)
- **Variance estimation** - PSU (SDMVPSU) and strata (SDMVSTRA) with nest=TRUE
- **Multiple testing** - Bonferroni and Benjamini-Hochberg FDR correction
- **Code provenance** - Every computation returns the R code that generated it

## Prerequisites

- **Node.js** >= 18
- **R** >= 4.0 with packages: `survey`, `nhanespewas`, `jsonlite`, `DBI`, `RSQLite`, `dplyr`
- **nhanespewas** R package: `remotes::install_github("chiragjp/nhanespewas")`

## Setup

```bash
# Install dependencies
npm install

# Ensure data symlink exists
ls -la data/  # should point to ../nhanespewas/db/

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
  tools/          MCP tool implementations (33 tools)
  resources/      MCP resource handlers (10 resources)
  r-bridge/       R subprocess executor + 24 R scripts
  data/           DuckDB connection manager
  variables/      Variable resolver, alias maps, CompTox table, NHANES-HHEAR bridge
  guardrails/     Weight enforcement, LOD, cell size, cycle pooling, multiple testing
  codegen/        R code generation templates
  server.ts       Server initialization
data/             Symlink to ../nhanespewas/db/ (SQLite databases)
dist/             Compiled JavaScript output
bin/              CLI entry point
paper/            Manuscript and documentation
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

## License

MIT

## Author

Chirag J. Patel, Department of Biomedical Informatics, Harvard Medical School
