import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../types.js";
import { SERIES_MAP, MODEL_DESCRIPTIONS } from "../types.js";
import { NCHS_GUIDELINES } from "./content/nchs-guidelines.js";
import { EPWAS_METHODS, VOE_GUIDE } from "./content/epwas-methods.js";
import { resolveChemical, COMPTOX_CHEMICALS } from "../variables/comptox-chemicals.js";
import { BRIDGE_BY_HHEAR, BRIDGE_BY_NHANES } from "../variables/nhanes-hhear-bridge.js";
import { resolveChemicalForCTD, CTD_CHEMICAL_MAP, CTD_BY_CATEGORY } from "../variables/ctd-chemical-map.js";

export function registerResources(server: McpServer, ctx: AppContext): void {
  // ─── NHANES Codebook (template resources) ─────────────────────────

  server.resource(
    "nhanes-codebook-variable",
    new ResourceTemplate("nhanes://codebook/{variable}", { list: undefined }),
    async (uri, variables) => {
      const varName = (variables.variable as string).toUpperCase();
      const rows = await ctx.db.query(`
        SELECT "Variable.Name", "Variable.Description", "Data.File.Name",
               "Data.File.Description", "Begin.Year", "EndYear", "Component"
        FROM nhanes.variable_names_epcf
        WHERE "Variable.Name" = '${varName}'
      `);

      if (rows.length === 0) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain" as const,
              text: `Variable ${varName} not found in NHANES codebook.`,
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json" as const,
            text: JSON.stringify(
              {
                variable: varName,
                entries: rows,
                note: "Multiple entries indicate the variable appears in multiple data files/cycles.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.resource(
    "nhanes-codebook-search",
    new ResourceTemplate("nhanes://codebook/search/{term}", { list: undefined }),
    async (uri, variables) => {
      const result = await ctx.resolver.resolve(variables.term as string);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ─── NHANES Cycles (static resource) ──────────────────────────────

  server.resource("nhanes-cycles", "nhanes://cycles/available", async (uri) => {
    const rows = await ctx.db.query(`
      SELECT DISTINCT series,
             MIN("Begin.Year") as begin_year,
             MAX("EndYear") as end_year,
             COUNT(DISTINCT "Variable.Name") as n_variables
      FROM nhanes.variable_names_epcf
      WHERE series IS NOT NULL
      GROUP BY series
      ORDER BY series
    `);

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify(
            {
              cycles: Object.entries(SERIES_MAP).map(([letter, range]) => ({
                series: letter,
                years: range,
              })),
              variable_counts_by_cycle: rows,
            },
            null,
            2
          ),
        },
      ],
    };
  });

  // ─── NHANES Guidelines ────────────────────────────────────────────

  server.resource(
    "nhanes-guidelines-nchs",
    "nhanes://guidelines/nchs",
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown" as const, text: NCHS_GUIDELINES },
      ],
    })
  );

  server.resource(
    "nhanes-weights-guide",
    "nhanes://weights/guide",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown" as const,
          text: `# NHANES Survey Weight Selection Guide

## Which weight to use:

| Data Type | Weight Variable | When to Use |
|-----------|----------------|-------------|
| MEC exam / Lab | WTMEC2YR | Most lab and examination variables |
| Interview only | WTINT2YR | Demographics, questionnaire-only variables |
| Dietary Day 1 | WTDRD1 | Dietary recall day 1 variables (DR1*) |
| Dietary Day 2 | WTDRD2 | Dietary recall day 2 variables (DR2*) |
| Fasting subsample | WTSAF2YR | Glucose, insulin, triglycerides, LDL |
| Environmental chemicals | WTMEC2YR | Most environmental chemical measurements |

## Multi-cycle pooling:
- Divide 2-year weights by the number of cycles being pooled
- Exception: NHANES 1999-2002 (cycles A+B) use 4-year weights (WTMEC4YR)

## Key survey design variables:
- SDMVSTRA: Pseudo-stratum (for variance estimation)
- SDMVPSU: Pseudo-PSU (primary sampling unit)
- Always use nest=TRUE in R survey design
`,
        },
      ],
    })
  );

  // ─── EP-WAS Methods ───────────────────────────────────────────────

  server.resource(
    "epwas-catalog-exposures",
    "epwas://catalog/exposures",
    async (uri) => {
      try {
        const rows = await ctx.db.query(`
          SELECT DISTINCT "Variable.Name" as variable,
                 "Variable.Description" as description,
                 "Component" as component
          FROM nhanes.variable_names_epcf
          WHERE "Component" = 'Laboratory'
             OR "Component" = 'Dietary'
          ORDER BY "Variable.Name"
          LIMIT 1000
        `);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json" as const,
              text: JSON.stringify({ n_exposures: rows.length, exposures: rows }, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain" as const,
              text: "Exposure catalog not yet loaded.",
            },
          ],
        };
      }
    }
  );

  server.resource(
    "epwas-catalog-phenotypes",
    "epwas://catalog/phenotypes",
    async (uri) => {
      try {
        const rows = await ctx.db.query(`
          SELECT DISTINCT "Variable.Name" as variable,
                 "Variable.Description" as description,
                 "Component" as component
          FROM nhanes.variable_names_epcf
          WHERE "Component" = 'Examination'
             OR "Component" = 'Questionnaire'
          ORDER BY "Variable.Name"
          LIMIT 1000
        `);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json" as const,
              text: JSON.stringify({ n_phenotypes: rows.length, phenotypes: rows }, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain" as const,
              text: "Phenotype catalog not yet loaded.",
            },
          ],
        };
      }
    }
  );

  server.resource(
    "epwas-methods-overview",
    "epwas://methods/overview",
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown" as const, text: EPWAS_METHODS },
      ],
    })
  );

  server.resource(
    "epwas-methods-voe",
    "epwas://methods/voe",
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown" as const, text: VOE_GUIDE },
      ],
    })
  );

  // ─── Adjustment Models Reference ──────────────────────────────────

  server.resource(
    "epwas-models",
    "epwas://models/adjustment",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify(
            {
              models: MODEL_DESCRIPTIONS,
              note: "Model numbers correspond to the order of scenarios in nhanespewas/R/adjustment.R. Model 6 (age+sex+ethnicity) is the recommended default.",
            },
            null,
            2
          ),
        },
      ],
    })
  );

  // ─── CompTox Chemical Identity ──────────────────────────────────

  server.resource(
    "comptox-chemical",
    new ResourceTemplate("comptox://chemical/{identifier}", { list: undefined }),
    async (uri, variables) => {
      const identifier = variables.identifier as string;
      const profile = resolveChemical(identifier);

      if (!profile) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain" as const,
              text: `Chemical "${identifier}" not found. Try a CAS number, DTXSID, HHEAR code, or chemical name. ${COMPTOX_CHEMICALS.length} chemicals available.`,
            },
          ],
        };
      }

      // Enrich with NHANES variable codes from bridge
      const bridgeEntry = BRIDGE_BY_HHEAR.get(profile.hhear_code);
      const nhanesCodes = bridgeEntry?.nhanes_codes ?? [];

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json" as const,
            text: JSON.stringify(
              {
                ...profile,
                nhanes_codes: nhanesCodes.map((n) => ({
                  code: n.code,
                  description: n.description,
                  matrix: n.matrix,
                  units: n.units,
                  cycles: n.cycles,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── CTD (Comparative Toxicogenomics Database) ──────────────────

  server.resource(
    "ctd-chemical",
    new ResourceTemplate("ctd://chemical/{identifier}", { list: undefined }),
    async (uri, variables) => {
      const identifier = variables.identifier as string;
      const mappings = resolveChemicalForCTD(identifier);

      if (mappings.length === 0) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain" as const,
              text: `Chemical "${identifier}" not found in CTD mapping. ${CTD_CHEMICAL_MAP.length} chemicals mapped. Try a chemical name, NHANES code, HHEAR code, or CAS number.`,
            },
          ],
        };
      }

      // Aggregate data from all CTD tables for this chemical
      const meshIds = [...new Set(mappings.map((m) => m.mesh_id))];
      const meshList = meshIds.map((id) => `'${id}'`).join(", ");

      let geneCount = 0;
      let diseaseCount = 0;
      let pathwayCount = 0;

      try {
        const gc = await ctx.db.query(`SELECT count(*) as cnt FROM ctd_chem_gene WHERE mesh_id IN (${meshList}) AND organism = 'Homo sapiens'`);
        geneCount = Number((gc[0] as any)?.cnt ?? 0);
      } catch { /* CTD not loaded */ }

      try {
        const dc = await ctx.db.query(`SELECT count(*) as cnt FROM ctd_chem_disease WHERE mesh_id IN (${meshList})`);
        diseaseCount = Number((dc[0] as any)?.cnt ?? 0);
      } catch { /* CTD not loaded */ }

      try {
        const pc = await ctx.db.query(`SELECT count(*) as cnt FROM ctd_chem_pathway WHERE mesh_id IN (${meshList})`);
        pathwayCount = Number((pc[0] as any)?.cnt ?? 0);
      } catch { /* CTD not loaded */ }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json" as const,
            text: JSON.stringify(
              {
                chemical: mappings[0].chemical_name,
                category: mappings[0].category,
                cas: mappings[0].cas ?? null,
                mesh_ids: meshIds,
                nhanes_vars: mappings.flatMap((m) => m.nhanes_vars),
                hhear_codes: mappings.filter((m) => m.hhear_code).map((m) => m.hhear_code),
                ctd_summary: {
                  gene_interactions_human: geneCount,
                  disease_associations: diseaseCount,
                  enriched_pathways: pathwayCount,
                },
                tools_available: [
                  "ctd_chemical_genes — curated gene interactions",
                  "ctd_chemical_diseases — disease associations (curated + inferred)",
                  "ctd_chemical_pathways — enriched KEGG/Reactome pathways",
                  "ctd_chemical_go — enriched Gene Ontology terms",
                  "ctd_triangulate — combine EP-WAS + CTD evidence",
                ],
                source: "Comparative Toxicogenomics Database (CTD), ctdbase.org",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.resource(
    "ctd-methods-overview",
    "ctd://methods/overview",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown" as const,
          text: `# Comparative Toxicogenomics Database (CTD)

## Overview
CTD is a publicly available database that provides manually curated information about
chemical–gene/protein interactions, chemical–disease and gene–disease relationships.
It is maintained by North Carolina State University and updated monthly.

## Data Types in ExposomeQL

### Chemical-Gene Interactions (ctd_chem_gene)
Curated from published literature. Each interaction specifies:
- **Gene symbol** and NCBI Gene ID
- **Interaction type**: increases/decreases expression, activity, phosphorylation, etc.
- **Organism**: filtered to Homo sapiens by default
- **PubMed references**: source publications

### Chemical-Disease Associations (ctd_chem_disease)
Two types of evidence:
- **Direct evidence** (curated): "marker/mechanism" or "therapeutic" — manually extracted from literature
- **Inferred** (computed): chemical→gene→disease inference via shared gene interactions
  - **Inference score**: topology-based network similarity metric (higher = stronger evidence)

### Chemical-Pathway Enrichment (ctd_chem_pathway)
Statistically enriched KEGG and Reactome pathways among genes that interact with a chemical:
- **Hypergeometric test** with Bonferroni correction
- gene_count: number of interacting genes in the pathway
- total_genes: total genes in the pathway

### Chemical-GO Enrichment (ctd_chem_go)
Enriched Gene Ontology terms (Biological Process, Molecular Function, Cellular Component):
- Same statistical framework as pathway enrichment
- Provides functional annotation of chemical effects

## Chemical Coverage
ExposomeQL maps **${CTD_CHEMICAL_MAP.length} chemicals** from NHANES and HHEAR to CTD MeSH identifiers,
covering:
${Array.from(CTD_BY_CATEGORY.entries()).map(([cat, chems]) => `- **${cat}**: ${chems.length} chemicals`).join("\n")}

## Triangulation
The \`ctd_triangulate\` tool combines epidemiological evidence (EP-WAS from NHANES) with
mechanistic evidence (CTD gene/disease/pathway data) to provide multi-level support for
exposure-health associations. This triangulation approach strengthens causal inference
beyond what either data source provides alone.

## Citation
Davis AP, et al. Comparative Toxicogenomics Database's 20th anniversary: update 2025.
Nucleic Acids Research, 2025, 53(D1):D1328-D1338.
`,
        },
      ],
    })
  );

  console.error("[exposomeql] Registered 12 resources");
}
