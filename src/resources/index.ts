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

  // ─── Missing resources (5 new) ──────────────────────────────────

  // 1. EP-WAS catalog metadata
  server.resource(
    "epwas-catalog-metadata",
    "epwas://catalog/metadata",
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json" as const,
        text: JSON.stringify({
          database: "pe_summary_stats_01_2025.sqlite",
          description: "Pre-computed exposure-phenotype (PE) and exposure-exposure (EE) association atlas from NHANES 1999-2018",
          pe_associations: "66.8 million (804 exposures × 346 phenotypes × 9 models × ~10 cycles)",
          ee_associations: "33.3 million (exposure-exposure correlations)",
          meta_analytic_tests: "165,342 (model 6, UWLS pooled across cycles)",
          cycles: "A (1999-2000) through J (2017-2018)",
          models: 9,
          method: "Survey-weighted linear regression, exposure log10-transformed and z-scored",
          meta_analysis: "UWLS (uncertainty-weighted least squares) across cycles",
          tables: {
            pe: "Cycle-specific estimates (exposure, phenotype, estimate, p.value, series, model_number)",
            adjusted_meta_uwls: "Meta-analytic pooled estimates (evarname, pvarname, estimate.uwls, p.value.uwls, i.squared.uwls, k.uwls)",
            variable_names_epcf: "Variable codebook (Variable.Name, Variable.Description, Data.File.Name, Begin.Year, EndYear, Component)",
            variable_domain: "Variable domain classification (exposure vs phenotype, category, subcategory)",
          },
          bonferroni_threshold: "3.02e-07 (0.05 / 165,342)",
        }, null, 2),
      }],
    })
  );

  // 2. Variables in a specific NHANES cycle
  server.resource(
    "nhanes-cycle-variables",
    new ResourceTemplate("nhanes://cycles/{cycle}/variables", { list: undefined }),
    async (uri, variables) => {
      const cycle = variables.cycle as string;
      // Map cycle year range to series letter
      const yearToSeries: Record<string, string> = {
        "1999-2000": "A", "2001-2002": "B", "2003-2004": "C", "2005-2006": "D",
        "2007-2008": "E", "2009-2010": "F", "2011-2012": "G", "2013-2014": "H",
        "2015-2016": "I", "2017-2018": "J",
      };
      const series = yearToSeries[cycle] ?? cycle.toUpperCase();

      try {
        const rows = await ctx.db.query(`
          SELECT DISTINCT "Variable.Name" as variable, "Variable.Description" as description,
                 "Data.File.Name" as data_file, "Component" as component
          FROM nhanes.variable_names_epcf
          WHERE "Begin.Year" <= $1 AND "EndYear" >= $2
          ORDER BY "Component", "Variable.Name"
          LIMIT 500
        `, ...(cycle.includes("-") ? [parseInt(cycle.split("-")[0]), parseInt(cycle.split("-")[1])] : [2000, 2000]));

        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json" as const,
            text: JSON.stringify({
              cycle,
              series,
              n_variables: rows.length,
              variables: rows,
              note: rows.length >= 500 ? "Results truncated to 500. Use component filter for full listing." : undefined,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/plain" as const,
            text: `Error querying cycle ${cycle}: ${(err as Error).message}`,
          }],
        };
      }
    }
  );

  // 3. LOD handling best practices
  server.resource(
    "nhanes-guidelines-lod",
    "nhanes://guidelines/lod",
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown" as const,
        text: `# Limit of Detection (LOD) Handling in NHANES

## What is LOD?
The limit of detection is the lowest concentration of an analyte that can be reliably measured by the laboratory method. Values below LOD are reported as below the detection threshold.

## How NHANES Reports LOD
- Laboratory variables (LBX*, URX*) have companion comment code columns (LBD*LC, URD*LC)
- Comment code = 0: at or above LOD (use the measured value)
- Comment code = 1: below LOD (the reported value is LOD/sqrt(2))

## ExposomeQL LOD Handling
ExposomeQL automatically:
1. Checks for LOD comment codes on all laboratory biomarker variables
2. Counts the percentage of observations below LOD
3. Warns when >40% of values are below LOD (estimates may be unreliable)
4. Uses the LOD/sqrt(2) substituted values provided by NCHS (standard approach)

## When LOD Matters
- **Environmental chemicals** (metals, PFAS, phthalates, phenols) frequently have high %<LOD
- **Blood biomarkers** (cholesterol, glucose, HbA1c) are almost never below LOD
- **Urinary biomarkers** are more likely to have LOD issues than serum biomarkers

## Best Practices
1. Always report %<LOD alongside any biomarker estimate
2. Be cautious interpreting results when >40% below LOD
3. Consider sensitivity analyses with different LOD substitution methods
4. For ExWAS: LOD-affected variables may have attenuated associations

## Reference
NCHS Analytic Guidelines, 2013 (updated 2018):
https://wwwn.cdc.gov/nchs/nhanes/analyticguidelines.aspx
`,
      }],
    })
  );

  // 4. LOD values by variable
  server.resource(
    "nhanes-lod-variable",
    new ResourceTemplate("nhanes://lod/{variable}", { list: undefined }),
    async (uri, variables) => {
      const varName = (variables.variable as string).toUpperCase();
      // LOD comment code column naming convention: LBD{stem}LC or URD{stem}LC
      const stem = varName.replace(/^(LBX|URX)/, "");
      const commentCodes = [`LBD${stem}LC`, `URD${stem}LC`];

      // Try to find LOD info from the data
      let lodInfo: Record<string, unknown> = { variable: varName, lod_data: "not_available" };

      try {
        // Check if this variable has a comment code in the variable names table
        for (const cc of commentCodes) {
          const rows = await ctx.db.query(`
            SELECT DISTINCT "Variable.Name", "Variable.Description", "Begin.Year", "EndYear"
            FROM nhanes.variable_names_epcf
            WHERE "Variable.Name" = '${cc}'
            ORDER BY "Begin.Year"
          `);
          if (rows.length > 0) {
            lodInfo = {
              variable: varName,
              comment_code_variable: cc,
              description: (rows[0] as Record<string, unknown>)["Variable.Description"],
              cycles_available: rows.map((r: Record<string, unknown>) =>
                `${r["Begin.Year"]}-${r["EndYear"]}`
              ),
              note: "Comment code 0 = at/above LOD, 1 = below LOD. Values below LOD are reported as LOD/sqrt(2).",
            };
            break;
          }
        }
      } catch {
        // fall through
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify(lodInfo, null, 2),
        }],
      };
    }
  );

  // 5. Pre-defined subpopulations
  server.resource(
    "nhanes-subpopulations",
    "nhanes://subpopulations",
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json" as const,
        text: JSON.stringify({
          description: "Pre-defined subgroup filter expressions for common NHANES subpopulations. Use these with the 'subgroup' parameter in descriptive tools.",
          subpopulations: {
            age_groups: {
              "Children (<6)": "RIDAGEYR < 6",
              "Children (6-11)": "RIDAGEYR >= 6 & RIDAGEYR < 12",
              "Adolescents (12-17)": "RIDAGEYR >= 12 & RIDAGEYR < 18",
              "Adults (18-64)": "RIDAGEYR >= 18 & RIDAGEYR < 65",
              "Older adults (65+)": "RIDAGEYR >= 65",
              "Reproductive age women (15-44)": "RIDAGEYR >= 15 & RIDAGEYR <= 44 & RIAGENDR == 2",
            },
            sex: {
              "Males": "RIAGENDR == 1",
              "Females": "RIAGENDR == 2",
            },
            race_ethnicity: {
              "Mexican American": "RIDRETH3 == 1",
              "Other Hispanic": "RIDRETH3 == 2",
              "Non-Hispanic White": "RIDRETH3 == 3",
              "Non-Hispanic Black": "RIDRETH3 == 4",
              "Non-Hispanic Asian": "RIDRETH3 == 6",
              "Other/Multi-Racial": "RIDRETH3 == 7",
            },
            income: {
              "Below poverty line (PIR < 1.0)": "INDFMPIR < 1",
              "Low income (PIR 1.0-1.99)": "INDFMPIR >= 1 & INDFMPIR < 2",
              "Middle income (PIR 2.0-3.99)": "INDFMPIR >= 2 & INDFMPIR < 4",
              "High income (PIR >= 4.0)": "INDFMPIR >= 4",
            },
            smoking_status: {
              "Current smokers (cotinine > 10 ng/mL)": "LBXCOT > 10",
              "Secondhand smoke exposed (cotinine 0.05-10)": "LBXCOT >= 0.05 & LBXCOT <= 10",
              "Non-exposed (cotinine < 0.05)": "LBXCOT < 0.05",
            },
            clinical: {
              "Obese (BMI >= 30)": "BMXBMI >= 30",
              "Overweight (BMI 25-29.9)": "BMXBMI >= 25 & BMXBMI < 30",
              "Normal weight (BMI 18.5-24.9)": "BMXBMI >= 18.5 & BMXBMI < 25",
              "Diabetic (HbA1c >= 6.5%)": "LBXGH >= 6.5",
              "Prediabetic (HbA1c 5.7-6.4%)": "LBXGH >= 5.7 & LBXGH < 6.5",
              "Hypertensive (SBP >= 140)": "BPXSY1 >= 140",
            },
          },
          note: "These expressions use NHANES variable codes. Not all variables are available in all cycles. Combine with & for intersections (e.g., 'RIDAGEYR < 6 & RIAGENDR == 2' for female children under 6).",
        }, null, 2),
      }],
    })
  );

  console.error("[exposomeql] Registered 17 resources");
}
