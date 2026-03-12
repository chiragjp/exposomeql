import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "path";
import type { AppContext, ResolveResult, CohortConfig } from "../types.js";
import { MODEL_DESCRIPTIONS, CYCLE_TO_SERIES, SERIES_MAP } from "../types.js";
import { formatCellSizeWarning } from "../guardrails/cell-size.js";
import { checkLOD, isLabBiomarker } from "../guardrails/lod-handling.js";
import { generateMeanCode, generateConditionalCode } from "../codegen/r-code-generator.js";
import { NHANES_HHEAR_BRIDGE, BRIDGE_BY_HHEAR, BRIDGE_BY_NHANES } from "../variables/nhanes-hhear-bridge.js";
import { resolveChemical, COMPTOX_BY_HHEAR, THRESHOLDS_BY_NHANES_VAR } from "../variables/comptox-chemicals.js";
import { resolveChemicalForCTD, CTD_BY_NHANES, CTD_BY_CATEGORY, type CTDChemicalMapping } from "../variables/ctd-chemical-map.js";

/** JSON replacer that converts BigInt to Number */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

/** Format a resolve result for display when ambiguous */
function formatCandidates(result: ResolveResult): string {
  if (!result.candidates || result.candidates.length === 0) {
    return "No matching variables found.";
  }
  return result.candidates
    .map((c) => `- ${c.variableName}: ${c.description}`)
    .join("\n");
}

/** Valid series letters for NHANES cycles */
const VALID_SERIES_LETTERS = new Set(Object.keys(SERIES_MAP));

/** Biological system definitions for phenotype categorization and gene filtering */
interface SystemDef {
  name: string;
  phenotype_patterns: string[];
  marker_genes: string[];
}

const BIOLOGICAL_SYSTEMS: SystemDef[] = [
  {
    name: "Lipid Metabolism",
    phenotype_patterns: ["cholesterol", "triglyceride", "hdl", "ldl", "lipid", "lipoprotein", "LBXTC", "LBXTR", "LBDLDL", "LBDHDD"],
    marker_genes: ["PPARA", "PPARG", "PPARD", "SCD", "FASN", "HMGCR", "LDLR", "APOB", "APOA1", "APOE", "SREBF1", "SREBF2", "ABCA1", "HNF4A", "NR1H3", "NR1H2"],
  },
  {
    name: "Hepatic Function",
    phenotype_patterns: ["alt", "ast", "ggt", "albumin", "bilirubin", "protein, total", "globulin", "liver", "hepat", "LBXSATSI", "LBXSASSI", "LBXSGTSI", "LBXSAL", "LBXSTB", "LBXSTP", "LBXSGB"],
    marker_genes: ["ALB", "CYP3A4", "CYP1A2", "CYP2E1", "NR1I2", "AHR", "HNF4A", "HNF1A", "ABCB1", "SLC22A1"],
  },
  {
    name: "Kidney / Uric Acid",
    phenotype_patterns: ["creatinine", "uric acid", "kidney", "renal", "gfr", "bun", "urea", "LBXSCR", "LBXSUA", "LBXSBU"],
    marker_genes: ["SLC22A11", "SLC22A12", "ABCG2", "SLC2A9", "UMOD", "HAVCR1", "MT1A", "MT2A", "SOD1", "CAT"],
  },
  {
    name: "Hematology / Iron",
    phenotype_patterns: ["hemoglobin", "hematocrit", "red blood", "red cell", "mcv", "mch", "rdw", "platelet", "iron", "ferritin", "transferrin", "LBXHGB", "LBXHCT", "LBXRBCSI", "LBXRDW", "LBXMCVSI", "LBXMC", "LBXPLTSI", "LBXSIR"],
    marker_genes: ["HFE", "TF", "TFRC", "SLC40A1", "EPO", "EPOR", "HBB", "HBA1", "HBA2", "HAMP", "FTH1", "FTL"],
  },
  {
    name: "Immune / Inflammatory",
    phenotype_patterns: ["white blood", "lymphocyte", "neutrophil", "monocyte", "eosinophil", "basophil", "wbc", "immunoglobulin", "crp", "LBXWBCSI", "LBXLYPCT", "LBXNEPCT", "LBDLYMNO", "LBDNENO", "LBXEOPCT"],
    marker_genes: ["IL6", "TNF", "IL1B", "IL10", "IL4", "IL2", "IFNG", "NFKB1", "NFKB2", "RELA", "PTGS2", "CXCL8", "CCL2"],
  },
  {
    name: "Thyroid",
    phenotype_patterns: ["thyroid", "tsh", "t4", "t3", "thyrox", "LBXT4", "LBXTSH"],
    marker_genes: ["TSHB", "TG", "TPO", "DIO1", "DIO2", "DIO3", "NIS", "SLC5A5", "TSHR", "TTR", "TBG"],
  },
  {
    name: "Glucose / Metabolic",
    phenotype_patterns: ["glucose", "insulin", "a1c", "glyco", "homa", "diabetes", "LBXGLU", "LBXGH", "LBXIN"],
    marker_genes: ["INS", "INSR", "IRS1", "SLC2A4", "GCK", "PCK1", "G6PC", "PPARGC1A", "FOXO1", "AKT1", "AKT2"],
  },
  {
    name: "Oxidative Stress / Apoptosis",
    phenotype_patterns: ["homocysteine", "folate", "vitamin", "LBXHCY", "LBXFOL"],
    marker_genes: ["SOD1", "SOD2", "CAT", "GPX1", "GPX4", "HMOX1", "NQO1", "NFE2L2", "KEAP1", "CASP3", "CASP9", "BAX", "BCL2", "TP53", "CDKN1A"],
  },
  {
    name: "Body Composition",
    phenotype_patterns: ["bmi", "fat", "weight", "waist", "DXD", "DXX", "BMXBMI", "BMXWT"],
    marker_genes: ["LEP", "LEPR", "ADIPOQ", "PPARG", "UCP1", "UCP2", "FTO", "MC4R"],
  },
  {
    name: "Bone",
    phenotype_patterns: ["bone", "bmd", "bmc", "calcium", "phosph", "alkaline", "DXXOSBMD", "LBXSCA", "LBXSPH"],
    marker_genes: ["BGLAP", "SPP1", "RUNX2", "TNFSF11", "TNFRSF11B", "VDR", "CYP27B1", "PTH", "PTHLH", "CALCA"],
  },
  {
    name: "Cardiovascular",
    phenotype_patterns: ["blood pressure", "systolic", "diastolic", "heart", "cardio", "pulse", "BPXSY", "BPXDI"],
    marker_genes: ["ACE", "AGT", "AGTR1", "NOS3", "EDN1", "EDNRA", "NPPA", "NPPB", "REN"],
  },
  {
    name: "Reproductive / Birth Outcomes",
    phenotype_patterns: ["birth", "gestation", "pregnan", "fetal", "placent", "fertility", "sperm", "ovul"],
    marker_genes: ["IGF1", "IGF2", "IGFBP1", "IGFBP3", "VEGFA", "FLT1", "KDR", "PGF", "HIF1A", "EPAS1", "ESR1", "ESR2", "PGR", "CYP19A1", "HSD11B2", "CRH", "MMP2", "MMP9", "PTGS2", "DNMT1", "DNMT3A", "DNMT3B"],
  },
  {
    name: "Neurological",
    phenotype_patterns: ["cognit", "memory", "brain", "neuro", "depression", "anxiety", "CFDDS", "CFDCCS"],
    marker_genes: ["BDNF", "NTRK2", "SLC6A3", "SLC6A4", "DRD2", "GRIN1", "GRIN2B", "ACHE", "BCHE", "MAOA", "MAOB", "TH", "GAD1"],
  },
];

/** Biological context gene sets for targeted CTD queries */
const BIOLOGICAL_CONTEXT_GENES: Record<string, string[]> = (() => {
  const ctx: Record<string, string[]> = {};
  for (const sys of BIOLOGICAL_SYSTEMS) {
    ctx[sys.name.toLowerCase()] = sys.marker_genes;
  }
  // Additional context aliases
  ctx["placental"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Reproductive / Birth Outcomes")!.marker_genes;
  ctx["birth outcomes"] = ctx["placental"];
  ctx["pregnancy"] = ctx["placental"];
  ctx["glucose metabolism"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Glucose / Metabolic")!.marker_genes;
  ctx["diabetes"] = ctx["glucose metabolism"];
  ctx["kidney"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Kidney / Uric Acid")!.marker_genes;
  ctx["liver"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Hepatic Function")!.marker_genes;
  ctx["immune"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Immune / Inflammatory")!.marker_genes;
  ctx["inflammation"] = ctx["immune"];
  ctx["lipid"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Lipid Metabolism")!.marker_genes;
  ctx["cholesterol"] = ctx["lipid"];
  ctx["thyroid"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Thyroid")!.marker_genes;
  ctx["cardiovascular"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Cardiovascular")!.marker_genes;
  ctx["heart"] = ctx["cardiovascular"];
  ctx["blood pressure"] = ctx["cardiovascular"];
  ctx["hematology"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Hematology / Iron")!.marker_genes;
  ctx["iron"] = ctx["hematology"];
  ctx["oxidative stress"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Oxidative Stress / Apoptosis")!.marker_genes;
  ctx["apoptosis"] = ctx["oxidative stress"];
  ctx["bone"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Bone")!.marker_genes;
  ctx["obesity"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Body Composition")!.marker_genes;
  ctx["body composition"] = ctx["obesity"];
  ctx["neurological"] = BIOLOGICAL_SYSTEMS.find(s => s.name === "Neurological")!.marker_genes;
  ctx["brain"] = ctx["neurological"];
  ctx["neurodevelopment"] = ctx["neurological"];
  return ctx;
})();

/** Map user-facing cycle strings to series letters. Throws on invalid cycles. */
function mapCyclesToSeries(cycles?: string[]): string[] | undefined {
  if (!cycles || cycles.length === 0) return undefined;
  const mapped = cycles.map((c) => {
    const letter = CYCLE_TO_SERIES[c];
    if (letter) return letter;
    // Maybe already a series letter
    if (VALID_SERIES_LETTERS.has(c.toUpperCase())) return c.toUpperCase();
    throw new Error(
      `Invalid NHANES cycle "${c}". Valid cycles: ${Object.keys(CYCLE_TO_SERIES).join(", ")}`
    );
  });
  return mapped;
}

export function registerTools(server: McpServer, ctx: AppContext): void {
  // ═══════════════════════════════════════════════════════════════════
  // CLASS 1: DESCRIPTIVE STATISTICS
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    "nhanes_mean",
    "Compute survey-weighted mean with 95% CI and design-corrected SE for an NHANES variable. Handles LOD detection, weight selection, and cycle pooling automatically. Returns the estimate plus reproducible R code.",
    {
      variable: z
        .string()
        .describe(
          "NHANES variable name or natural language description (e.g., 'LBXBPB' or 'blood lead')"
        ),
      subgroup: z
        .string()
        .optional()
        .describe(
          "Subgroup filter expression (e.g., 'RIDAGEYR < 5' for children under 5)"
        ),
      cycles: z
        .array(z.string())
        .optional()
        .describe(
          "Survey cycles to include (e.g., ['2017-2018']). Omit for most recent cycle."
        ),
    },
    async ({ variable, subgroup, cycles }) => {
      // 1. Resolve variable
      const resolved = await ctx.resolver.resolve(variable);
      if (!resolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: resolved.candidates
                ? `Ambiguous variable "${variable}". Did you mean one of:\n${formatCandidates(resolved)}\n\nPlease specify the exact NHANES variable name.`
                : `Could not find variable matching "${variable}". Try using the exact NHANES variable code (e.g., LBXBPB for blood lead).`,
            },
          ],
        };
      }

      const v = resolved.variable!;
      const series = mapCyclesToSeries(cycles);

      // 2. Execute R script
      try {
        const rResult = await ctx.rExec.execute("nhanes_mean.R", {
          variable: v.variableName,
          cycles: series,
          subgroup: subgroup ?? null,
        });

        // 3. Apply guardrails
        const warnings: string[] = [];

        const cellWarning = formatCellSizeWarning(
          rResult.n_unweighted as number
        );
        if (cellWarning) warnings.push(cellWarning);

        if (
          isLabBiomarker(v.variableName) &&
          typeof rResult.pct_below_lod === "number"
        ) {
          const lodResult = checkLOD(rResult.pct_below_lod);
          if (lodResult.warning) warnings.push(lodResult.warning);
        }

        // 4. Generate code
        const code = generateMeanCode(v, { subgroup, cycles });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  variable: v.variableName,
                  variable_description: v.description,
                  mean: rResult.mean,
                  se: rResult.se,
                  ci_lower: rResult.ci_lower,
                  ci_upper: rResult.ci_upper,
                  geometric_mean: rResult.geometric_mean ?? null,
                  n_unweighted: rResult.n_unweighted,
                  weight_used: rResult.weight_used,
                  cycles_used: rResult.cycles_used,
                  pct_below_lod: rResult.pct_below_lod ?? null,
                  lod_method: rResult.pct_below_lod
                    ? "LOD/sqrt(2) substitution"
                    : null,
                  warnings,
                  reproducible_code: code,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error computing mean for ${v.variableName}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_prevalence",
    "Compute survey-weighted prevalence of a condition with 95% CI. Example: prevalence of blood lead > 3.5 µg/dL in children under 6.",
    {
      condition: z
        .string()
        .describe(
          "Condition expression (e.g., 'LBXBPB > 3.5' or 'LBXGH >= 6.5')"
        ),
      subgroup: z
        .string()
        .optional()
        .describe("Subgroup filter (e.g., 'RIDAGEYR < 6')"),
      cycles: z.array(z.string()).optional().describe("Survey cycles to include"),
    },
    async ({ condition, subgroup, cycles }) => {
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_prevalence.R", {
          condition,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        const warnings: string[] = [];
        const cellWarning = formatCellSizeWarning(rResult.n_unweighted as number);
        if (cellWarning) warnings.push(cellWarning);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...rResult, warnings }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error computing prevalence: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_distribution",
    "Compute survey-weighted distribution: percentiles (5th, 25th, 50th, 75th, 95th), geometric mean for biomarkers, and histogram-ready bin data.",
    {
      variable: z.string().describe("NHANES variable name or description"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles to include"),
    },
    async ({ variable, subgroup, cycles }) => {
      const resolved = await ctx.resolver.resolve(variable);
      if (!resolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: resolved.candidates
                ? `Ambiguous variable. Candidates:\n${formatCandidates(resolved)}`
                : `Variable "${variable}" not found.`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_distribution.R", {
          variable: resolved.variable!.variableName,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { variable: resolved.variable!.variableName, variable_description: resolved.variable!.description, ...rResult },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_quantile",
    "Compute a specific survey-weighted quantile with CI.",
    {
      variable: z.string().describe("NHANES variable name or description"),
      quantile: z
        .number()
        .min(0)
        .max(1)
        .describe("Quantile to compute (e.g., 0.95 for 95th percentile)"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ variable, quantile, subgroup, cycles }) => {
      const resolved = await ctx.resolver.resolve(variable);
      if (!resolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: resolved.candidates
                ? `Ambiguous variable. Candidates:\n${formatCandidates(resolved)}`
                : `Variable "${variable}" not found.`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_quantile.R", {
          variable: resolved.variable!.variableName,
          quantile,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_count",
    "Estimate the weighted population count meeting a condition with CI. Example: how many children under 6 have blood lead above 3.5 µg/dL.",
    {
      condition: z.string().describe("Condition expression (e.g., 'LBXBPB > 3.5')"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ condition, subgroup, cycles }) => {
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_count.R", {
          condition,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_trend",
    "Compute survey-weighted mean/prevalence across all available NHANES cycles to show temporal trends. Returns time series data with trend test.",
    {
      variable: z.string().describe("NHANES variable name or description"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      metric: z
        .enum(["mean", "geometric_mean", "median"])
        .optional()
        .default("mean")
        .describe("Which metric to track over time"),
    },
    async ({ variable, subgroup, metric }) => {
      const resolved = await ctx.resolver.resolve(variable);
      if (!resolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: resolved.candidates
                ? `Ambiguous variable. Candidates:\n${formatCandidates(resolved)}`
                : `Variable "${variable}" not found.`,
            },
          ],
        };
      }
      try {
        const rResult = await ctx.rExec.execute("nhanes_trend.R", {
          variable: resolved.variable!.variableName,
          subgroup: subgroup ?? null,
          metric,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // CLASS 2: CONDITIONAL & EXPLORATORY
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    "nhanes_conditional",
    "Compute survey-weighted mean of an outcome variable conditional on bins of another variable. The classic 'BMI over age' query. Auto-bins continuous conditioning variables into deciles.",
    {
      outcome: z
        .string()
        .describe(
          "Outcome variable (e.g., 'BMXBMI' or 'BMI')"
        ),
      given: z
        .string()
        .describe(
          "Conditioning variable (e.g., 'RIDAGEYR' or 'age')"
        ),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
      bins: z
        .number()
        .min(2)
        .max(100)
        .optional()
        .default(10)
        .describe("Number of bins for continuous conditioning variable (2-100)"),
    },
    async ({ outcome, given, subgroup, cycles, bins }) => {
      const outcomeResolved = await ctx.resolver.resolve(outcome);
      const givenResolved = await ctx.resolver.resolve(given);

      if (!outcomeResolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve outcome variable "${outcome}".\n${formatCandidates(outcomeResolved)}`,
            },
          ],
        };
      }
      if (!givenResolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve conditioning variable "${given}".\n${formatCandidates(givenResolved)}`,
            },
          ],
        };
      }

      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_conditional.R", {
          outcome: outcomeResolved.variable!.variableName,
          given: givenResolved.variable!.variableName,
          subgroup: subgroup ?? null,
          cycles: series,
          bins: bins ?? 10,
        });

        const code = generateConditionalCode(
          outcomeResolved.variable!,
          givenResolved.variable!,
          { bins, subgroup }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { ...rResult, reproducible_code: code },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_crosstab",
    "Survey-weighted cross-tabulation with Rao-Scott chi-square test (design-corrected). For comparing categorical variables.",
    {
      var1: z.string().describe("First variable"),
      var2: z.string().describe("Second variable"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ var1, var2, subgroup, cycles }) => {
      const r1 = await ctx.resolver.resolve(var1);
      const r2 = await ctx.resolver.resolve(var2);
      if (!r1.resolved || !r2.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve variables: ${!r1.resolved ? var1 : ""} ${!r2.resolved ? var2 : ""}`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_crosstab.R", {
          var1: r1.variable!.variableName,
          var2: r2.variable!.variableName,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_stratify",
    "Survey-weighted summary statistics grouped by one or more variables with design-adjusted ANOVA. Returns table of means/CIs by group.",
    {
      variable: z.string().describe("Variable to summarize"),
      by: z
        .array(z.string())
        .describe("Variables to stratify by (e.g., ['age_group', 'RIDRETH3'])"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ variable, by, subgroup, cycles }) => {
      const resolved = await ctx.resolver.resolve(variable);
      if (!resolved.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve variable "${variable}".`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_stratify.R", {
          variable: resolved.variable!.variableName,
          by,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_correlation",
    "Survey-weighted Pearson or Spearman correlation with CI between two variables.",
    {
      var1: z.string().describe("First variable"),
      var2: z.string().describe("Second variable"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ var1, var2, subgroup, cycles }) => {
      const r1 = await ctx.resolver.resolve(var1);
      const r2 = await ctx.resolver.resolve(var2);
      if (!r1.resolved || !r2.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve variables: ${!r1.resolved ? var1 : ""} ${!r2.resolved ? var2 : ""}`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_correlation.R", {
          var1: r1.variable!.variableName,
          var2: r2.variable!.variableName,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_compare_groups",
    "Survey-weighted comparison of a variable across groups. Auto-selects t-test (2 groups) or design-adjusted ANOVA (>2 groups).",
    {
      variable: z.string().describe("Variable to compare"),
      group_var: z.string().describe("Grouping variable"),
      subgroup: z.string().optional().describe("Subgroup filter"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ variable, group_var, subgroup, cycles }) => {
      const r1 = await ctx.resolver.resolve(variable);
      const r2 = await ctx.resolver.resolve(group_var);
      if (!r1.resolved || !r2.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve variables.`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_compare_groups.R", {
          variable: r1.variable!.variableName,
          group_var: r2.variable!.variableName,
          subgroup: subgroup ?? null,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // CLASS 3: ASSOCIATIONAL / EP-WAS
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    "epwas_search",
    "Search the EP-WAS catalog of pre-computed exposure-phenotype associations. Returns ranked associations with effect sizes, CIs, p-values, and heterogeneity metrics from UWLS meta-analysis across NHANES cycles.",
    {
      exposure: z
        .string()
        .optional()
        .describe("Exposure variable or name (e.g., 'cadmium', 'LBXBCD')"),
      phenotype: z
        .string()
        .optional()
        .describe("Phenotype variable or name (e.g., 'CKD', 'LBXSCR')"),
      model_number: z
        .number()
        .optional()
        .default(6)
        .describe(
          "Adjustment model (1=base, 6=age+sex+ethnicity [default], 2=fully adjusted)"
        ),
      p_threshold: z
        .number()
        .optional()
        .default(0.05)
        .describe("P-value threshold"),
      top_n: z
        .number()
        .min(1)
        .max(500)
        .optional()
        .default(20)
        .describe("Maximum results to return (1-500)"),
    },
    async ({ exposure, phenotype, model_number, p_threshold, top_n }) => {
      if (!exposure && !phenotype) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Please specify at least one of: exposure or phenotype.",
            },
          ],
        };
      }

      let exposureVar: string | null = null;
      let phenotypeVar: string | null = null;

      if (exposure) {
        const r = await ctx.resolver.resolve(exposure);
        if (!r.resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: r.candidates
                  ? `Ambiguous exposure "${exposure}". Candidates:\n${formatCandidates(r)}`
                  : `Exposure "${exposure}" not found.`,
              },
            ],
          };
        }
        exposureVar = r.variable!.variableName;
      }

      if (phenotype) {
        const r = await ctx.resolver.resolve(phenotype);
        if (!r.resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: r.candidates
                  ? `Ambiguous phenotype "${phenotype}". Candidates:\n${formatCandidates(r)}`
                  : `Phenotype "${phenotype}" not found.`,
              },
            ],
          };
        }
        phenotypeVar = r.variable!.variableName;
      }

      try {
        // Query the pre-computed meta-analysis results
        // expo_name='expo' filters to the main continuous exposure model
        // model_number is BIGINT, cast to INTEGER for JSON serialization
        const params: unknown[] = [];
        let paramIdx = 0;
        let sql = `
          SELECT
            evarname as exposure,
            pvarname as phenotype,
            "estimate.uwls" as estimate,
            "std.error.uwls" as std_error,
            "p.value.uwls" as p_value,
            "p.value.stouffer" as p_value_stouffer,
            "i.squared.uwls" as i_squared,
            "h.squared.uwls" as h_squared,
            "k.uwls" as n_studies,
            CAST(model_number AS INTEGER) as model_number
          FROM pe_stats.adjusted_meta_uwls
          WHERE expo_name = 'expo'
            AND CAST(model_number AS INTEGER) = $${++paramIdx}
        `;
        params.push(model_number ?? 6);

        if (exposureVar) {
          sql += ` AND evarname = $${++paramIdx}`;
          params.push(exposureVar);
        }
        if (phenotypeVar) {
          sql += ` AND pvarname = $${++paramIdx}`;
          params.push(phenotypeVar);
        }

        sql += ` AND ABS("p.value.uwls") < $${++paramIdx}`;
        params.push(p_threshold ?? 0.05);
        sql += ` ORDER BY ABS("estimate.uwls") DESC`;
        sql += ` LIMIT $${++paramIdx}`;
        params.push(top_n ?? 20);

        const results = await ctx.db.query(sql, ...params);

        // Enrich with variable descriptions
        const enriched = await Promise.all(
          results.map(async (row: Record<string, unknown>) => {
            const eVar = ctx.resolver.get(row.exposure as string);
            const pVar = ctx.resolver.get(row.phenotype as string);
            return {
              ...row,
              exposure_description: eVar?.description ?? "Unknown",
              phenotype_description: pVar?.description ?? "Unknown",
            };
          })
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  query: { exposure: exposureVar, phenotype: phenotypeVar },
                  model: MODEL_DESCRIPTIONS[model_number ?? 6],
                  n_results: enriched.length,
                  results: enriched,
                  note: "Effect sizes are from survey-weighted linear regression with exposure log10-transformed and z-scored. P-values are nominal — apply Bonferroni or FDR for multiple comparisons.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching EP-WAS catalog: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "epwas_summary",
    "Get all phenotypes associated with a given exposure, ranked by evidence strength. Shows the full association profile of an environmental exposure.",
    {
      exposure: z.string().describe("Exposure variable or name"),
      model_number: z
        .number()
        .optional()
        .default(6)
        .describe("Adjustment model"),
      top_n: z.number().optional().default(30).describe("Max results"),
    },
    async ({ exposure, model_number, top_n }) => {
      const r = await ctx.resolver.resolve(exposure);
      if (!r.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: r.candidates
                ? `Ambiguous exposure. Candidates:\n${formatCandidates(r)}`
                : `Exposure "${exposure}" not found.`,
            },
          ],
        };
      }
      try {
        const sql = `
          SELECT evarname as exposure, pvarname as phenotype,
            "estimate.uwls" as estimate, "std.error.uwls" as std_error,
            "p.value.uwls" as p_value, "i.squared.uwls" as i_squared,
            "k.uwls" as n_studies
          FROM pe_stats.adjusted_meta_uwls
          WHERE expo_name = 'expo'
            AND evarname = $1
            AND CAST(model_number AS INTEGER) = $2
          ORDER BY ABS("estimate.uwls") DESC
          LIMIT $3
        `;
        const results = await ctx.db.query(sql, r.variable!.variableName, model_number ?? 6, top_n ?? 30);
        const enriched = results.map((row: Record<string, unknown>) => {
          const pVar = ctx.resolver.get(row.phenotype as string);
          return { ...row, phenotype_description: pVar?.description ?? "Unknown" };
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  exposure: r.variable!.variableName,
                  exposure_description: r.variable!.description,
                  model: MODEL_DESCRIPTIONS[model_number ?? 6],
                  n_results: enriched.length,
                  results: enriched,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "epwas_phenotype_profile",
    "Get all exposures associated with a given phenotype (the 'exposure profile'). Shows which environmental factors are linked to a health outcome.",
    {
      phenotype: z.string().describe("Phenotype variable or name"),
      model_number: z
        .number()
        .optional()
        .default(6)
        .describe("Adjustment model"),
      top_n: z.number().optional().default(30).describe("Max results"),
    },
    async ({ phenotype, model_number, top_n }) => {
      const r = await ctx.resolver.resolve(phenotype);
      if (!r.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: r.candidates
                ? `Ambiguous phenotype. Candidates:\n${formatCandidates(r)}`
                : `Phenotype "${phenotype}" not found.`,
            },
          ],
        };
      }
      try {
        const sql = `
          SELECT evarname as exposure, pvarname as phenotype,
            "estimate.uwls" as estimate, "std.error.uwls" as std_error,
            "p.value.uwls" as p_value, "i.squared.uwls" as i_squared,
            "k.uwls" as n_studies
          FROM pe_stats.adjusted_meta_uwls
          WHERE expo_name = 'expo'
            AND pvarname = $1
            AND CAST(model_number AS INTEGER) = $2
          ORDER BY ABS("estimate.uwls") DESC
          LIMIT $3
        `;
        const results = await ctx.db.query(sql, r.variable!.variableName, model_number ?? 6, top_n ?? 30);
        const enriched = results.map((row: Record<string, unknown>) => {
          const eVar = ctx.resolver.get(row.exposure as string);
          return { ...row, exposure_description: eVar?.description ?? "Unknown" };
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  phenotype: r.variable!.variableName,
                  phenotype_description: r.variable!.description,
                  model: MODEL_DESCRIPTIONS[model_number ?? 6],
                  n_results: enriched.length,
                  results: enriched,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "epwas_vibration",
    "Vibration of Effects: show the range of effect estimates for an exposure-phenotype pair across all 9 adjustment models. Reveals how sensitive the association is to analytic choices.",
    {
      exposure: z.string().describe("Exposure variable or name"),
      phenotype: z.string().describe("Phenotype variable or name"),
    },
    async ({ exposure, phenotype }) => {
      const re = await ctx.resolver.resolve(exposure);
      const rp = await ctx.resolver.resolve(phenotype);
      if (!re.resolved || !rp.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve: ${!re.resolved ? exposure : ""} ${!rp.resolved ? phenotype : ""}`,
            },
          ],
        };
      }
      try {
        const sql = `
          SELECT
            CAST(model_number AS INTEGER) as model_number,
            "estimate.uwls" as estimate,
            "std.error.uwls" as std_error,
            "p.value.uwls" as p_value,
            "i.squared.uwls" as i_squared,
            "k.uwls" as n_studies
          FROM pe_stats.adjusted_meta_uwls
          WHERE expo_name = 'expo'
            AND evarname = $1
            AND pvarname = $2
          ORDER BY model_number
        `;
        const results = await ctx.db.query(sql, re.variable!.variableName, rp.variable!.variableName);

        const enriched = results.map((row: Record<string, unknown>) => ({
          ...row,
          model_description:
            MODEL_DESCRIPTIONS[row.model_number as number] ?? "Unknown",
        }));

        const estimates = results.map(
          (r: Record<string, unknown>) => r.estimate as number
        );
        const minEst = Math.min(...estimates);
        const maxEst = Math.max(...estimates);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  exposure: re.variable!.variableName,
                  exposure_description: re.variable!.description,
                  phenotype: rp.variable!.variableName,
                  phenotype_description: rp.variable!.description,
                  vibration_range: { min: minEst, max: maxEst, range: maxEst - minEst },
                  n_models: enriched.length,
                  results: enriched,
                  interpretation:
                    maxEst - minEst > Math.abs(maxEst + minEst) / 2
                      ? "HIGH sensitivity: effect estimate varies substantially across adjustment models. Interpret with caution."
                      : "LOW sensitivity: effect estimate is relatively stable across adjustment models.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_analyze",
    "Run a survey-weighted regression of an exposure on an outcome using the nhanespewas pipeline. Returns coefficients across all 9 adjustment scenarios with R code.",
    {
      exposure: z.string().describe("Exposure variable or name"),
      outcome: z.string().describe("Outcome/phenotype variable or name"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ exposure, outcome, cycles }) => {
      const re = await ctx.resolver.resolve(exposure);
      const ro = await ctx.resolver.resolve(outcome);
      if (!re.resolved || !ro.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve: ${!re.resolved ? exposure : ""} ${!ro.resolved ? outcome : ""}`,
            },
          ],
        };
      }
      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_analyze.R", {
          exposure: re.variable!.variableName,
          outcome: ro.variable!.variableName,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_exwas",
    "Run a full Exposome-Wide Association Study: iterate over all exposures in a category against a single outcome. WARNING: This can take 5-30 minutes depending on the number of exposures.",
    {
      outcome: z.string().describe("Outcome phenotype variable or name"),
      exposure_category: z
        .string()
        .optional()
        .describe("Exposure category to scan (e.g., 'metals', 'VOCs')"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ outcome, exposure_category, cycles }) => {
      const ro = await ctx.resolver.resolve(outcome);
      if (!ro.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve outcome "${outcome}".`,
            },
          ],
        };
      }

      // Query DuckDB for exposure list by category/subcategory
      try {
        let exposureSql: string;
        if (exposure_category) {
          exposureSql = `
            SELECT DISTINCT varname
            FROM pe_stats.variable_domain
            WHERE epcf = 'e'
              AND (subcategory LIKE '%${exposure_category}%' OR category LIKE '%${exposure_category}%')
              AND varname LIKE 'LBX%' OR varname LIKE 'URX%'
              AND (subcategory LIKE '%${exposure_category}%' OR category LIKE '%${exposure_category}%')
              AND epcf = 'e'
              AND varname NOT LIKE '%LC'
              AND varname NOT LIKE '%SI'
              AND varname NOT LIKE 'WT%'
            ORDER BY varname
          `;
        } else {
          exposureSql = `
            SELECT DISTINCT varname
            FROM pe_stats.variable_domain
            WHERE epcf = 'e'
              AND (varname LIKE 'LBX%' OR varname LIKE 'URX%')
              AND varname NOT LIKE '%LC'
              AND varname NOT LIKE '%SI'
              AND varname NOT LIKE 'WT%'
            ORDER BY varname
          `;
        }

        const exposureRows = await ctx.db.query<{ varname: string }>(exposureSql);
        const exposures = exposureRows.map((r) => r.varname);

        if (exposures.length === 0) {
          // List available categories for the user
          const catRows = await ctx.db.query<{ subcategory: string }>(
            `SELECT DISTINCT subcategory FROM pe_stats.variable_domain WHERE epcf = 'e' AND subcategory IS NOT NULL ORDER BY subcategory`
          );
          const cats = catRows.map((r) => r.subcategory);
          return {
            content: [
              {
                type: "text" as const,
                text: `No exposures found for category "${exposure_category}". Available subcategories:\n${cats.join(", ")}`,
              },
            ],
          };
        }

        const series = mapCyclesToSeries(cycles);
        const rResult = await ctx.rExec.execute(
          "nhanes_exwas.R",
          {
            outcome: ro.variable!.variableName,
            exposures,
            cycles: series,
          },
          600000 // 10 minute timeout for ExWAS
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: ADVANCED NHANES ANALYTICS
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    "nhanes_validate",
    "Review user-written NHANES analysis code for common methodological errors: missing survey weights, wrong weight variable, incorrect LOD handling, cycle pooling errors, fasting subsample issues, and small cell sizes.",
    {
      code: z.string().describe("R or Python code snippet to validate"),
      language: z
        .enum(["r", "python"])
        .optional()
        .describe("Code language (default: r)"),
    },
    async ({ code, language }) => {
      const lang = language ?? "r";
      const issues: Array<{
        severity: "error" | "warning" | "info";
        check: string;
        message: string;
      }> = [];

      // Detect NHANES variable usage
      const nhanesVarPattern = /\b(LBX|URX|SMQ|BPQ|DIQ|MCQ|BMX|RID|SDM|WHQ|DR[12])[A-Z0-9]{2,}/g;
      const usesNhanes = nhanesVarPattern.test(code);

      if (!usesNhanes) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  n_issues: 0,
                  issues: [],
                  note: "No NHANES variables detected in code. Validation checks are specific to NHANES analysis.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (lang === "r") {
        // Check 1: Missing survey weights
        const hasSurveyDesign =
          /svydesign|svrepdesign/i.test(code);
        const hasUnweightedRegression =
          /\b(lm|glm|t\.test|chisq\.test|cor\.test|aov)\s*\(/i.test(code);
        if (!hasSurveyDesign && hasUnweightedRegression) {
          issues.push({
            severity: "error",
            check: "missing_survey_weights",
            message:
              "Code uses unweighted statistical functions (lm/glm/t.test) on NHANES data. NHANES requires survey-weighted analysis via survey::svydesign() + svyglm()/svymean()/etc. Unweighted estimates will be biased and standard errors incorrect.",
          });
        }

        // Check 2: svydesign missing strata or PSU
        if (hasSurveyDesign) {
          const svyDesignCall = code.match(
            /svydesign\s*\([^)]{0,500}\)/gs
          );
          if (svyDesignCall) {
            const call = svyDesignCall[0];
            if (!/strata\s*=/.test(call)) {
              issues.push({
                severity: "error",
                check: "missing_strata",
                message:
                  "svydesign() call is missing strata= argument. Use strata=~SDMVSTRA for correct variance estimation.",
              });
            }
            if (!/\bid\s*=/.test(call) && !/ids\s*=/.test(call)) {
              issues.push({
                severity: "error",
                check: "missing_psu",
                message:
                  "svydesign() call is missing id= (cluster/PSU) argument. Use id=~SDMVPSU.",
              });
            }
            if (!/nest\s*=\s*TRUE/i.test(call)) {
              issues.push({
                severity: "warning",
                check: "missing_nest",
                message:
                  "svydesign() should include nest=TRUE for NHANES (PSUs are nested within strata).",
              });
            }
          }
        }

        // Check 3: Wrong weight variable for dietary/fasting
        const dietaryVars =
          /\b(DR[12]T|DR[12]I)[A-Z]{3,}/g.test(code);
        const fastingVars =
          /\b(LBX(GLU|GHB|INS|TRI|LDL|TC|GLC|SGL|STR|SCR))\b/.test(
            code
          );
        const usesWTMEC = /WTMEC2YR/i.test(code);
        const usesWTDRD = /WTDRD1/i.test(code);
        const usesWTSAF = /WTSAF2YR/i.test(code);

        if (dietaryVars && usesWTMEC && !usesWTDRD) {
          issues.push({
            severity: "error",
            check: "wrong_weight_dietary",
            message:
              "Code uses dietary variables (DR1*/DR2*) with WTMEC2YR. Dietary analyses require WTDRD1 (Day 1) or WTDR2D (Day 1+2) weights.",
          });
        }
        if (fastingVars && usesWTMEC && !usesWTSAF) {
          issues.push({
            severity: "warning",
            check: "fasting_subsample",
            message:
              "Code uses fasting laboratory variables with WTMEC2YR. Fasting subsample analyses should use WTSAF2YR weight and restrict to fasting participants.",
          });
        }

        // Check 4: LOD handling — LOD/2 instead of LOD/√2
        if (/lod\s*\/\s*2\b/i.test(code) && !/sqrt\s*\(\s*2\s*\)/i.test(code)) {
          issues.push({
            severity: "warning",
            check: "lod_substitution",
            message:
              "Code uses LOD/2 substitution. NHANES convention is LOD/√2 for values below the limit of detection. Use LOD/sqrt(2).",
          });
        }

        // Check 5: Multi-cycle pooling without weight adjustment
        const multipleCycles =
          code.match(
            /\b(1999|2001|2003|2005|2007|2009|2011|2013|2015|2017)\b/g
          );
        const uniqueCycles = multipleCycles
          ? [...new Set(multipleCycles)]
          : [];
        if (
          uniqueCycles.length > 1 &&
          !/\/(2|3|4|5|6|7|8|9|10)\b/.test(code) &&
          !/n_cycles/i.test(code)
        ) {
          issues.push({
            severity: "warning",
            check: "cycle_pooling_weights",
            message: `Code appears to pool ${uniqueCycles.length} NHANES cycles without adjusting weights. When combining cycles, divide weights by the number of cycles pooled (e.g., WTMEC2YR / ${uniqueCycles.length}).`,
          });
        }

        // Check 6: Using mean() instead of svymean()
        if (
          hasSurveyDesign &&
          /\bmean\s*\(/.test(code) &&
          !/svymean/.test(code)
        ) {
          issues.push({
            severity: "warning",
            check: "unweighted_mean",
            message:
              "Code calls mean() alongside survey design. Use svymean() for survey-weighted estimates.",
          });
        }
      } else {
        // Python checks
        const hasSurvey = /import\s+survey|from\s+survey/i.test(code);
        const hasStatsmodels =
          /statsmodels|smf?\./i.test(code);

        if (!hasSurvey && hasStatsmodels) {
          issues.push({
            severity: "error",
            check: "missing_survey_weights",
            message:
              "Code uses statsmodels without survey design correction. NHANES requires survey-weighted analysis. Use the 'survey' package or statsmodels with freq_weights/var_weights.",
          });
        }

        if (/lod\s*\/\s*2\b/i.test(code) && !/np\.sqrt\s*\(\s*2\s*\)/i.test(code) && !/math\.sqrt\s*\(\s*2\s*\)/i.test(code)) {
          issues.push({
            severity: "warning",
            check: "lod_substitution",
            message:
              "Code uses LOD/2 substitution. NHANES convention is LOD/√2. Use LOD/np.sqrt(2).",
          });
        }
      }

      // Severity summary
      const errors = issues.filter((i) => i.severity === "error").length;
      const warnings = issues.filter((i) => i.severity === "warning").length;

      const output = {
        n_issues: issues.length,
        n_errors: errors,
        n_warnings: warnings,
        issues,
        verdict:
          errors > 0
            ? "FAIL — critical methodological errors detected"
            : warnings > 0
              ? "PASS with warnings — review suggested improvements"
              : "PASS — no common NHANES analysis errors detected",
      };

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "nhanes_interaction",
    "Test for effect modification (interaction) in a survey-weighted model. Tests whether the exposure→outcome association differs by levels of a modifier variable. Returns main effects, interaction p-value, and stratified effects.",
    {
      exposure: z.string().describe("Exposure variable or name"),
      modifier: z.string().describe("Effect modifier variable or name"),
      outcome: z.string().describe("Outcome/phenotype variable or name"),
      covariates: z
        .array(z.string())
        .optional()
        .describe("Additional covariate variables"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ exposure, modifier, outcome, covariates, cycles }) => {
      const re = await ctx.resolver.resolve(exposure);
      const rm = await ctx.resolver.resolve(modifier);
      const ro = await ctx.resolver.resolve(outcome);
      const unresolved = [
        !re.resolved ? exposure : null,
        !rm.resolved ? modifier : null,
        !ro.resolved ? outcome : null,
      ].filter(Boolean);
      if (unresolved.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve: ${unresolved.join(", ")}`,
            },
          ],
        };
      }

      let resolvedCovariates: string[] | null = null;
      if (covariates && covariates.length > 0) {
        resolvedCovariates = [];
        for (const cov of covariates) {
          const rc = await ctx.resolver.resolve(cov);
          if (!rc.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not resolve covariate "${cov}".`,
                },
              ],
            };
          }
          resolvedCovariates.push(rc.variable!.variableName);
        }
      }

      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_interaction.R", {
          exposure: re.variable!.variableName,
          modifier: rm.variable!.variableName,
          outcome: ro.variable!.variableName,
          covariates: resolvedCovariates,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_model",
    "Fit a flexible survey-weighted regression model with multiple predictors, optional restricted cubic splines, and interactions. Supports linear, logistic, and quantile regression.",
    {
      outcome: z.string().describe("Outcome variable"),
      predictors: z.array(z.string()).describe("Predictor variables"),
      model_type: z
        .enum(["linear", "logistic", "quantile"])
        .optional()
        .describe("Model type (default: linear)"),
      splines: z
        .array(z.string())
        .optional()
        .describe(
          "Variables to model with restricted cubic splines (3 knots)"
        ),
      interactions: z
        .array(z.tuple([z.string(), z.string()]))
        .optional()
        .describe("Pairs of variables to interact"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ outcome, predictors, model_type, splines, interactions, cycles }) => {
      const ro = await ctx.resolver.resolve(outcome);
      if (!ro.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve outcome "${outcome}".`,
            },
          ],
        };
      }

      const resolvedPredictors: string[] = [];
      for (const p of predictors) {
        const rp = await ctx.resolver.resolve(p);
        if (!rp.resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not resolve predictor "${p}".`,
              },
            ],
          };
        }
        resolvedPredictors.push(rp.variable!.variableName);
      }

      let resolvedSplines: string[] | null = null;
      if (splines && splines.length > 0) {
        resolvedSplines = [];
        for (const s of splines) {
          const rs = await ctx.resolver.resolve(s);
          if (!rs.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not resolve spline variable "${s}".`,
                },
              ],
            };
          }
          resolvedSplines.push(rs.variable!.variableName);
        }
      }

      let resolvedInteractions: Array<[string, string]> | null = null;
      if (interactions && interactions.length > 0) {
        resolvedInteractions = [];
        for (const [a, b] of interactions) {
          const ra = await ctx.resolver.resolve(a);
          const rb = await ctx.resolver.resolve(b);
          if (!ra.resolved || !rb.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not resolve interaction variables "${a}" / "${b}".`,
                },
              ],
            };
          }
          resolvedInteractions.push([
            ra.variable!.variableName,
            rb.variable!.variableName,
          ]);
        }
      }

      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_model.R", {
          outcome: ro.variable!.variableName,
          predictors: resolvedPredictors,
          model_type: model_type ?? "linear",
          splines: resolvedSplines,
          interactions: resolvedInteractions,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_dose_response",
    "Compute a non-linear dose-response curve between an exposure and outcome using restricted cubic splines (RCS) or GAMs. Returns predicted curve data with CIs and a test for non-linearity. Critical for environmental health threshold detection.",
    {
      exposure: z.string().describe("Exposure variable"),
      outcome: z.string().describe("Outcome variable"),
      method: z
        .enum(["rcs", "gam"])
        .optional()
        .describe("Method: restricted cubic splines or GAM (default: rcs)"),
      covariates: z
        .array(z.string())
        .optional()
        .describe("Covariate variables to adjust for"),
      n_knots: z
        .number()
        .min(3)
        .max(10)
        .optional()
        .describe("Number of knots for RCS (3-10, default: 4)"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ exposure, outcome, method, covariates, n_knots, cycles }) => {
      const re = await ctx.resolver.resolve(exposure);
      const ro = await ctx.resolver.resolve(outcome);
      if (!re.resolved || !ro.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve: ${!re.resolved ? exposure : ""} ${!ro.resolved ? outcome : ""}`,
            },
          ],
        };
      }

      let resolvedCovariates: string[] | null = null;
      if (covariates && covariates.length > 0) {
        resolvedCovariates = [];
        for (const cov of covariates) {
          const rc = await ctx.resolver.resolve(cov);
          if (!rc.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not resolve covariate "${cov}".`,
                },
              ],
            };
          }
          resolvedCovariates.push(rc.variable!.variableName);
        }
      }

      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute(
          "nhanes_dose_response.R",
          {
            exposure: re.variable!.variableName,
            outcome: ro.variable!.variableName,
            method: method ?? "rcs",
            covariates: resolvedCovariates,
            n_knots: n_knots ?? 4,
            cycles: series,
          },
          120000
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_predict",
    "Generate predicted values from a survey-weighted regression model at user-specified covariate values. Re-fits the model (stateless) and predicts. Returns predicted value, SE, and 95% CI.",
    {
      outcome: z.string().describe("Outcome variable (same as model)"),
      predictors: z.array(z.string()).describe("Predictor variables (same as model)"),
      model_type: z
        .enum(["linear", "logistic"])
        .optional()
        .describe("Model type (default: linear)"),
      splines: z
        .array(z.string())
        .optional()
        .describe("Variables modeled with splines"),
      newdata: z
        .record(z.union([z.number(), z.string()]))
        .describe(
          "Covariate values for prediction (e.g., { RIDAGEYR: 45, RIDRETH3: '3' })"
        ),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ outcome, predictors, model_type, splines, newdata, cycles }) => {
      const ro = await ctx.resolver.resolve(outcome);
      if (!ro.resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve outcome "${outcome}".`,
            },
          ],
        };
      }

      const resolvedPredictors: string[] = [];
      for (const p of predictors) {
        const rp = await ctx.resolver.resolve(p);
        if (!rp.resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not resolve predictor "${p}".`,
              },
            ],
          };
        }
        resolvedPredictors.push(rp.variable!.variableName);
      }

      let resolvedSplines: string[] | null = null;
      if (splines && splines.length > 0) {
        resolvedSplines = [];
        for (const s of splines) {
          const rs = await ctx.resolver.resolve(s);
          if (!rs.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not resolve spline variable "${s}".`,
                },
              ],
            };
          }
          resolvedSplines.push(rs.variable!.variableName);
        }
      }

      // Resolve newdata keys to canonical variable names
      const resolvedNewdata: Record<string, number | string> = {};
      for (const [key, val] of Object.entries(newdata)) {
        const rk = await ctx.resolver.resolve(key);
        if (!rk.resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not resolve newdata key "${key}".`,
              },
            ],
          };
        }
        resolvedNewdata[rk.variable!.variableName] = val;
      }

      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute("nhanes_predict.R", {
          outcome: ro.variable!.variableName,
          predictors: resolvedPredictors,
          model_type: model_type ?? "linear",
          splines: resolvedSplines,
          newdata: resolvedNewdata,
          cycles: series,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "nhanes_mediation",
    "Survey-weighted causal mediation analysis: tests whether an exposure's effect on an outcome is mediated through an intermediate variable. Returns ACME (indirect), ADE (direct), total effect, and proportion mediated.",
    {
      exposure: z.string().describe("Exposure variable"),
      mediator: z.string().describe("Mediator variable"),
      outcome: z.string().describe("Outcome variable"),
      covariates: z
        .array(z.string())
        .optional()
        .describe("Additional covariate variables"),
      cycles: z.array(z.string()).optional().describe("Survey cycles"),
    },
    async ({ exposure, mediator, outcome, covariates, cycles }) => {
      const re = await ctx.resolver.resolve(exposure);
      const rmed = await ctx.resolver.resolve(mediator);
      const ro = await ctx.resolver.resolve(outcome);
      const unresolved = [
        !re.resolved ? exposure : null,
        !rmed.resolved ? mediator : null,
        !ro.resolved ? outcome : null,
      ].filter(Boolean);
      if (unresolved.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not resolve: ${unresolved.join(", ")}`,
            },
          ],
        };
      }

      let resolvedCovariates: string[] | null = null;
      if (covariates && covariates.length > 0) {
        resolvedCovariates = [];
        for (const cov of covariates) {
          const rc = await ctx.resolver.resolve(cov);
          if (!rc.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not resolve covariate "${cov}".`,
                },
              ],
            };
          }
          resolvedCovariates.push(rc.variable!.variableName);
        }
      }

      const series = mapCyclesToSeries(cycles);
      try {
        const rResult = await ctx.rExec.execute(
          "nhanes_mediation.R",
          {
            exposure: re.variable!.variableName,
            mediator: rmed.variable!.variableName,
            outcome: ro.variable!.variableName,
            covariates: resolvedCovariates,
            cycles: series,
          },
          300000
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(rResult, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // HHEAR COHORT TOOLS
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    "cohort_list",
    "List all available HHEAR cohorts with participant counts, analyte counts, and sample source (child/adult/maternal). Use this to discover which cohorts are loaded.",
    {},
    async () => {
      if (ctx.cohorts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No HHEAR cohorts are currently loaded. Set HHEAR_DATA_DIR environment variable to point to the HHEAR Targeted Datasets directory.",
            },
          ],
        };
      }

      const summary = ctx.cohorts.map((c) => ({
        id: c.id,
        project_id: c.projectId ?? null,
        description: c.description ?? null,
        pi: c.pi ?? null,
        population: c.populationNote ?? (c.sampleSource || null),
        country: c.country ?? null,
        city_region: c.cityRegion ?? null,
        study_name: c.studyName ?? null,
        n_participants: c.nParticipants,
        n_analytes: c.analytes.length,
        sample_source: c.sampleSource,
        analytes_preview: c.analytes.slice(0, 10).join(", ") + (c.analytes.length > 10 ? "..." : ""),
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                n_cohorts: ctx.cohorts.length,
                cohorts: summary,
              },
              bigintReplacer,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "cohort_variables",
    "List all analyte codes (chemical exposures) measured in a specific HHEAR cohort. Returns the full list of analyte codes, chemical groups, and sample count per analyte.",
    {
      cohort: z.string().describe("Cohort ID (e.g., '1407', '00496')"),
    },
    async ({ cohort }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cohort "${cohort}" not found. Available cohorts: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
            },
          ],
        };
      }

      try {
        const rows = await ctx.db.query<{
          analyte_code: string;
          chemical_group: string;
          n_samples: number;
          units: string;
        }>(`
          SELECT
            Analyte_Code as analyte_code,
            COUNT(*) as n_samples,
            FIRST(Units) as units
          FROM cohort_${cohortConfig.id}_targeted
          WHERE Analyte_Code IS NOT NULL
          GROUP BY 1
          ORDER BY analyte_code
        `);

        // Enrich with full chemical names from PDF metadata
        const enrichedRows = rows.map((r) => ({
          ...r,
          chemical_name: cohortConfig.analyteNames?.[r.analyte_code] ?? null,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  cohort: cohortConfig.id,
                  project_id: cohortConfig.projectId ?? null,
                  description: cohortConfig.description ?? null,
                  pi: cohortConfig.pi ?? null,
                  population: cohortConfig.populationNote ?? cohortConfig.sampleSource ?? null,
                  n_participants: cohortConfig.nParticipants,
                  n_analytes: enrichedRows.length,
                  analytes: enrichedRows,
                  epi_variables: cohortConfig.epiColumnNames ?? [],
                  epi_column_map: cohortConfig.epiColumnMap ?? null,
                  subgroup_hints: cohortConfig.epiColumnMap
                    ? Object.entries(cohortConfig.epiColumnMap)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k} → ${v!.column}${v!.unit ? ` (${v!.unit})` : ""}${v!.transform ? ` [transform: ${v!.transform}]` : ""}`)
                    : [],
                },
                bigintReplacer,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing variables for cohort ${cohort}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "cohort_mean",
    "Compute descriptive statistics (mean, SD, geometric mean, median, 95% CI, percentiles) for a chemical analyte in an HHEAR cohort. Handles LOD imputation (LOD/2 when >=75% complete). Supports optional creatinine adjustment for urinary measures.",
    {
      cohort: z.string().describe("Cohort ID (e.g., '1407')"),
      analyte: z.string().describe("Analyte code or name (e.g., 'BPA', 'lead', 'bisphenol a', 'PFOA')"),
      subgroup: z.string().optional().describe("Optional subgroup filter on epi data (e.g., 'age < 10')"),
      creatinine_adjust: z.boolean().optional().default(false).describe("Adjust urinary concentrations by creatinine (concentration/CRE*100)"),
    },
    async ({ cohort, analyte, subgroup, creatinine_adjust }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cohort "${cohort}" not found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
            },
          ],
        };
      }

      const resolved = resolveAnalyte(ctx, analyte, cohortConfig);
      if ("error" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.error }] };
      }

      try {
        const translatedSubgroup = subgroup
          ? translateSubgroup(subgroup, cohortConfig)
          : null;

        const rResult = await ctx.rExec.execute("cohort_mean.R", {
          targeted_csv: cohortConfig.targetedLongCsv ?? path.join(cohortConfig.dataDir, cohortConfig.targetedDataFile),
          epi_csv: cohortConfig.epiDataFile ? path.join(cohortConfig.dataDir, cohortConfig.epiDataFile) : null,
          analyte: resolved.code,
          subgroup: translatedSubgroup,
          creatinine_adjust: creatinine_adjust ?? false,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ cohort: cohortConfig.id, analyte_name: resolved.name, ...rResult }, bigintReplacer, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error computing mean for ${resolved.code} in cohort ${cohort}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "cohort_exposure_intervals",
    "Compute conditional exposure intervals using quantile regression (quantreg::rq). Estimates exposure distribution at τ ∈ {0.05, 0.25, 0.50, 0.75, 0.95} conditional on age and sex. Based on Lloyd, Tierney, Isaac et al. methodology.",
    {
      cohort: z.string().describe("Cohort ID"),
      analyte: z.string().describe("Analyte code or name (e.g., 'BPA', 'lead', 'bisphenol a')"),
      population: z
        .enum(["child", "adult"])
        .optional()
        .describe("Population type. Children: model includes age+sex. Adults: age only."),
      quantiles: z
        .array(z.number())
        .optional()
        .describe("Quantiles to estimate (default: [0.05, 0.25, 0.50, 0.75, 0.95])"),
      creatinine_adjust: z.boolean().optional().default(false).describe("Adjust urinary concentrations by creatinine"),
    },
    async ({ cohort, analyte, population, quantiles, creatinine_adjust }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cohort "${cohort}" not found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
            },
          ],
        };
      }

      const resolved = resolveAnalyte(ctx, analyte, cohortConfig);
      if ("error" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.error }] };
      }

      try {
        const rResult = await ctx.rExec.execute("cohort_exposure_intervals.R", {
          targeted_csv: cohortConfig.targetedLongCsv ?? path.join(cohortConfig.dataDir, cohortConfig.targetedDataFile),
          epi_csv: cohortConfig.epiDataFile ? path.join(cohortConfig.dataDir, cohortConfig.epiDataFile) : null,
          analyte: resolved.code,
          population: population ?? null,
          quantiles: quantiles ?? null,
          creatinine_adjust: creatinine_adjust ?? false,
          age_column: cohortConfig.epiColumnMap?.age?.column ?? null,
          sex_column: cohortConfig.epiColumnMap?.sex?.column ?? null,
          age_transform: cohortConfig.epiColumnMap?.age?.transform ?? null,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ cohort: cohortConfig.id, analyte_name: resolved.name, ...rResult }, bigintReplacer, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error computing exposure intervals for ${resolved.code} in cohort ${cohort}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "cohort_demographic_model",
    "Fit a within-cohort demographic model: exposure ~ age + sex + sampling_year using quantile regression at τ ∈ {0.05, 0.25, 0.5, 0.75, 0.95}. Returns coefficients and McFadden's pseudo R² at each quantile.",
    {
      cohort: z.string().describe("Cohort ID"),
      analyte: z.string().describe("Analyte code or name"),
      quantiles: z
        .array(z.number())
        .optional()
        .describe("Quantiles (default: [0.05, 0.25, 0.50, 0.75, 0.95])"),
      creatinine_adjust: z.boolean().optional().default(false).describe("Adjust urinary concentrations by creatinine"),
    },
    async ({ cohort, analyte, quantiles, creatinine_adjust }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cohort "${cohort}" not found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
            },
          ],
        };
      }

      const resolved = resolveAnalyte(ctx, analyte, cohortConfig);
      if ("error" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.error }] };
      }

      try {
        const rResult = await ctx.rExec.execute("cohort_demographic_models.R", {
          targeted_csv: cohortConfig.targetedLongCsv ?? path.join(cohortConfig.dataDir, cohortConfig.targetedDataFile),
          epi_csv: cohortConfig.epiDataFile ? path.join(cohortConfig.dataDir, cohortConfig.epiDataFile) : null,
          analyte: resolved.code,
          quantiles: quantiles ?? null,
          creatinine_adjust: creatinine_adjust ?? false,
          age_column: cohortConfig.epiColumnMap?.age?.column ?? null,
          sex_column: cohortConfig.epiColumnMap?.sex?.column ?? null,
          age_transform: cohortConfig.epiColumnMap?.age?.transform ?? null,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ cohort: cohortConfig.id, analyte_name: resolved.name, ...rResult }, bigintReplacer, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fitting demographic model for ${resolved.code} in cohort ${cohort}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "cohort_exwas",
    "Run a quantile ExWAS across all analytes in an HHEAR cohort. Regresses each exposure on age + sex + year using quantile regression. Returns ranked associations with BH-FDR correction at 10%. WARNING: Can take several minutes.",
    {
      cohort: z.string().describe("Cohort ID"),
      tau: z
        .number()
        .optional()
        .default(0.5)
        .describe("Quantile to test (default: 0.5 = median)"),
      fdr_threshold: z
        .number()
        .optional()
        .default(0.1)
        .describe("FDR threshold (default: 0.10)"),
      creatinine_adjust: z.boolean().optional().default(false).describe("Adjust urinary concentrations by creatinine"),
    },
    async ({ cohort, tau, fdr_threshold, creatinine_adjust }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cohort "${cohort}" not found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
            },
          ],
        };
      }

      try {
        const rResult = await ctx.rExec.execute(
          "cohort_exwas.R",
          {
            targeted_csv: cohortConfig.targetedLongCsv ?? path.join(cohortConfig.dataDir, cohortConfig.targetedDataFile),
            epi_csv: cohortConfig.epiDataFile ? path.join(cohortConfig.dataDir, cohortConfig.epiDataFile) : null,
            analytes: cohortConfig.analytes.filter((a) => a !== "CRE" && a !== "SG"),
            tau: tau ?? 0.5,
            fdr_threshold: fdr_threshold ?? 0.1,
            creatinine_adjust: creatinine_adjust ?? false,
            age_column: cohortConfig.epiColumnMap?.age?.column ?? null,
            sex_column: cohortConfig.epiColumnMap?.sex?.column ?? null,
            age_transform: cohortConfig.epiColumnMap?.age?.transform ?? null,
          },
          300000 // 5 minute timeout
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ cohort: cohortConfig.id, ...rResult }, bigintReplacer, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running ExWAS for cohort ${cohort}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  // ── Cross-Cohort Comparison ──

  server.tool(
    "cross_cohort_compare",
    "Compare the same analyte across multiple HHEAR cohorts. Returns descriptive statistics (mean, median, CI, geometric mean, %<LOD) per cohort for side-by-side comparison. Supports creatinine adjustment.",
    {
      analyte: z.string().describe("Analyte code or name (e.g., 'BPA', 'Pb', 'PFOA')"),
      cohorts: z
        .array(z.string())
        .optional()
        .describe("Cohort IDs to compare (default: all cohorts that have the analyte)"),
      creatinine_adjust: z.boolean().optional().default(false).describe("Adjust urinary concentrations by creatinine"),
    },
    async ({ analyte, cohorts: cohortIds, creatinine_adjust }) => {
      // Resolve analyte globally first (no cohort constraint) to get canonical code
      const globalResolved = ctx.resolver.resolveHhear(analyte);
      if (!globalResolved.resolved || !globalResolved.analyteCode) {
        // Fall back to checking per-cohort
        if (globalResolved.candidates && globalResolved.candidates.length > 0) {
          const candidateList = globalResolved.candidates
            .map((c) => `- ${c.code}: ${c.name}`)
            .join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `Ambiguous analyte "${analyte}". Did you mean one of:\n${candidateList}`,
            }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Analyte "${analyte}" not recognized. Try using the exact analyte code (e.g., 'Pb', 'BPA', 'PFOA').`,
          }],
        };
      }

      const resolvedCode = globalResolved.analyteCode;
      const resolvedName = globalResolved.analyteName ?? resolvedCode;

      // Find cohorts that have this exact analyte code
      let targetCohorts = ctx.cohorts;
      if (cohortIds && cohortIds.length > 0) {
        targetCohorts = ctx.cohorts.filter((c) => cohortIds.includes(c.id));
        if (targetCohorts.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `None of the specified cohorts found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
            }],
          };
        }
      }

      // Filter to cohorts that have this analyte (case-insensitive)
      const resolvedCodeLower = resolvedCode.toLowerCase();
      const cohortParams: { id: string; targeted_csv: string; epi_csv: string | null }[] = [];
      for (const c of targetCohorts) {
        if (c.analytes.some((a) => a.toLowerCase() === resolvedCodeLower)) {
          cohortParams.push({
            id: c.id,
            targeted_csv: c.targetedLongCsv ?? path.join(c.dataDir, c.targetedDataFile),
            epi_csv: c.epiDataFile ? path.join(c.dataDir, c.epiDataFile) : null,
          });
        }
      }

      if (cohortParams.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Analyte "${resolvedCode}" (${resolvedName}) not found in any of the specified cohorts.`,
          }],
        };
      }

      const resolved = { code: resolvedCode, name: resolvedName };

      try {
        const rResult = await ctx.rExec.execute(
          "cohort_cross_compare.R",
          {
            cohorts: cohortParams,
            analyte: resolved.code,
            creatinine_adjust: creatinine_adjust ?? false,
          },
          120000
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ analyte_name: resolved.name, ...rResult }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error in cross-cohort comparison: ${(err as Error).message}`,
          }],
        };
      }
    }
  );

  // ── Cumulative Exposure Score ──

  server.tool(
    "cohort_cumulative_score",
    "Compute a cumulative exposure score for each participant in an HHEAR cohort. Averages percentile ranks (or Z-scores) across all detected chemicals per person. Tests association with age and sex if epi data available.",
    {
      cohort: z.string().describe("Cohort ID"),
      analytes: z
        .array(z.string())
        .optional()
        .describe("Analyte codes to include (default: all analytes except CRE/SG)"),
      method: z
        .enum(["percentile_rank", "z_score"])
        .optional()
        .default("percentile_rank")
        .describe("Scoring method: percentile_rank (0-1) or z_score"),
      creatinine_adjust: z.boolean().optional().default(false).describe("Adjust urinary concentrations by creatinine"),
    },
    async ({ cohort, analytes, method, creatinine_adjust }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [{
            type: "text" as const,
            text: `Cohort "${cohort}" not found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
          }],
        };
      }

      try {
        const rResult = await ctx.rExec.execute(
          "cohort_cumulative_score.R",
          {
            targeted_csv: cohortConfig.targetedLongCsv ?? path.join(cohortConfig.dataDir, cohortConfig.targetedDataFile),
            epi_csv: cohortConfig.epiDataFile ? path.join(cohortConfig.dataDir, cohortConfig.epiDataFile) : null,
            analytes: analytes ?? null,
            method: method ?? "percentile_rank",
            creatinine_adjust: creatinine_adjust ?? false,
          },
          120000
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ cohort: cohortConfig.id, ...rResult }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error computing cumulative score for cohort ${cohort}: ${(err as Error).message}`,
          }],
        };
      }
    }
  );

  // ── NHANES ↔ HHEAR Bridge ──

  server.tool(
    "nhanes_hhear_bridge",
    "Map between HHEAR analyte codes and NHANES variable codes. Look up equivalent measurements across the two data sources. Useful for comparing HHEAR cohort results with nationally representative NHANES data.",
    {
      hhear_code: z.string().optional().describe("HHEAR analyte code (e.g., 'Pb', 'BPA', 'PFOA')"),
      nhanes_code: z.string().optional().describe("NHANES variable code (e.g., 'LBXBPB', 'URXBPH')"),
      list_all: z.boolean().optional().default(false).describe("List all available mappings"),
    },
    async ({ hhear_code, nhanes_code, list_all }) => {
      if (list_all) {
        const summary = NHANES_HHEAR_BRIDGE.map((e) => {
          const comptox = COMPTOX_BY_HHEAR.get(e.hhear_code.toLowerCase());
          return {
            hhear_code: e.hhear_code,
            chemical_name: e.chemical_name,
            nhanes_codes: e.nhanes_codes.map((n) => n.code).join(", "),
            cas_number: comptox?.cas_number ?? null,
            dtxsid: comptox?.dtxsid ?? null,
          };
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ n_mappings: summary.length, mappings: summary }, null, 2),
          }],
        };
      }

      if (hhear_code) {
        // Look up by HHEAR code (case-insensitive)
        const entry = BRIDGE_BY_HHEAR.get(hhear_code) ??
          BRIDGE_BY_HHEAR.get(hhear_code.toUpperCase()) ??
          [...BRIDGE_BY_HHEAR.values()].find(
            (e) => e.hhear_code.toLowerCase() === hhear_code.toLowerCase()
          );

        if (!entry) {
          // Try fuzzy match on chemical name
          const byName = NHANES_HHEAR_BRIDGE.find(
            (e) => e.chemical_name.toLowerCase().includes(hhear_code.toLowerCase())
          );
          if (byName) {
            const comptox = COMPTOX_BY_HHEAR.get(byName.hhear_code.toLowerCase());
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ ...byName, comptox_profile: comptox ?? null }, null, 2),
              }],
            };
          }
          return {
            content: [{
              type: "text" as const,
              text: `No NHANES mapping found for HHEAR code "${hhear_code}". Use list_all=true to see available mappings.`,
            }],
          };
        }
        const comptox = COMPTOX_BY_HHEAR.get(entry.hhear_code.toLowerCase());
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ...entry, comptox_profile: comptox ?? null }, null, 2),
          }],
        };
      }

      if (nhanes_code) {
        const entries = BRIDGE_BY_NHANES.get(nhanes_code) ??
          BRIDGE_BY_NHANES.get(nhanes_code.toUpperCase());

        if (!entries || entries.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No HHEAR mapping found for NHANES code "${nhanes_code}". Use list_all=true to see available mappings.`,
            }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ nhanes_code, hhear_matches: entries }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: "Please specify hhear_code, nhanes_code, or list_all=true.",
        }],
      };
    }
  );

  // ── Chemical Identity Lookup ──

  server.tool(
    "chemical_info",
    "Look up chemical identity and toxicological profile from the CompTox database. Accepts chemical name, CAS number, DTXSID, NHANES variable code, or HHEAR analyte code. Returns CAS, DTXSID, toxicity class, regulatory notes, target organs, and exposure routes.",
    {
      chemical: z
        .string()
        .describe(
          "Chemical name, CAS number, DTXSID, NHANES variable code, or HHEAR analyte code (e.g., 'lead', '7439-92-1', 'LBXBPB', 'Pb')"
        ),
    },
    async ({ chemical }) => {
      // Try direct CompTox resolution first
      let profile = resolveChemical(chemical);

      // If not found, try via NHANES code → HHEAR bridge → CompTox
      if (!profile) {
        const bridgeEntries = BRIDGE_BY_NHANES.get(chemical) ??
          BRIDGE_BY_NHANES.get(chemical.toUpperCase());
        if (bridgeEntries && bridgeEntries.length > 0) {
          profile = COMPTOX_BY_HHEAR.get(bridgeEntries[0].hhear_code.toLowerCase());
        }
      }

      if (!profile) {
        return {
          content: [{
            type: "text" as const,
            text: `Chemical "${chemical}" not found in the CompTox database. Try using a CAS number, HHEAR code (e.g., 'Pb'), NHANES code (e.g., 'LBXBPB'), or full chemical name.`,
          }],
        };
      }

      // Enrich with all known variable codes (NHANES + HHEAR)
      const bridgeEntry = BRIDGE_BY_HHEAR.get(profile.hhear_code);
      const nhanesCodes = bridgeEntry?.nhanes_codes ?? [];

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            {
              hhear_code: profile.hhear_code,
              chemical_name: profile.chemical_name,
              cas_number: profile.cas_number,
              dtxsid: profile.dtxsid,
              molecular_formula: profile.molecular_formula ?? null,
              category: profile.category,
              toxicity_class: profile.toxicity_class ?? null,
              regulatory_notes: profile.regulatory_notes ?? null,
              exposure_routes: profile.exposure_routes ?? [],
              target_organs: profile.target_organs ?? [],
              half_life: profile.half_life ?? null,
              nhanes_variable_codes: nhanesCodes.map((n) => ({
                code: n.code,
                description: n.description,
                matrix: n.matrix,
                units: n.units,
                cycles: n.cycles,
              })),
              biomarker_thresholds: profile.biomarker_thresholds ?? [],
              toxcast: profile.toxcast ?? null,
            },
            null,
            2
          ),
        }],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // CTD (COMPARATIVE TOXICOGENOMICS DATABASE) TOOLS
  // ═══════════════════════════════════════════════════════════════════

  // ── Tool 28: ctd_chemical_genes ──────────────────────────────────
  server.tool(
    "ctd_chemical_genes",
    "Look up curated gene interactions for a chemical from the Comparative Toxicogenomics Database (CTD). Returns genes that interact with the chemical, interaction types, and PubMed references. Accepts chemical name, NHANES variable code, HHEAR code, or CAS number. Use biological_context to filter to genes relevant to a specific system (e.g., 'birth outcomes', 'glucose metabolism', 'kidney').",
    {
      chemical: z
        .string()
        .describe(
          "Chemical identifier: name ('lead'), NHANES code ('LBXBPB'), HHEAR code ('Pb'), or CAS number"
        ),
      biological_context: z
        .string()
        .optional()
        .describe(
          "Filter to genes relevant to a biological context. Options: 'lipid metabolism', 'hepatic function', 'kidney', 'hematology', 'immune', 'thyroid', 'glucose metabolism', 'diabetes', 'oxidative stress', 'body composition', 'bone', 'cardiovascular', 'birth outcomes', 'placental', 'pregnancy', 'neurological', 'neurodevelopment'. If omitted, returns all gene interactions."
        ),
      organism: z
        .string()
        .optional()
        .describe(
          "Filter by organism (e.g., 'Homo sapiens'). Defaults to human only."
        ),
      limit: z
        .number()
        .optional()
        .describe(
          "Maximum number of gene interactions to return (default: 50)"
        ),
    },
    async ({ chemical, biological_context, organism, limit }) => {
      const mappings = resolveChemicalForCTD(chemical);
      if (mappings.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Chemical "${chemical}" not found in the CTD chemical mapping. Try a chemical name (e.g., 'lead', 'benzene'), NHANES code (e.g., 'LBXBPB'), or CAS number.`,
          }],
        };
      }

      const meshIds = [...new Set(mappings.map((m) => m.mesh_id))];
      const meshList = meshIds.map((id) => `'${id}'`).join(", ");
      const orgFilter = organism
        ? `AND organism = '${organism}'`
        : "AND organism = 'Homo sapiens'";
      const maxRows = limit ?? 50;

      // Optional biological context gene filter
      let geneFilter = "";
      let contextGenes: string[] | null = null;
      if (biological_context) {
        const key = biological_context.toLowerCase();
        contextGenes = BIOLOGICAL_CONTEXT_GENES[key] ?? null;
        if (!contextGenes) {
          return {
            content: [{
              type: "text" as const,
              text: `Unknown biological context "${biological_context}". Available contexts: ${Object.keys(BIOLOGICAL_CONTEXT_GENES).join(", ")}`,
            }],
          };
        }
        geneFilter = `AND gene_symbol IN (${contextGenes.map(g => `'${g}'`).join(", ")})`;
      }

      try {
        const rows = await ctx.db.query(
          `SELECT mesh_id, chemical_name, gene_symbol, gene_id, organism,
                  interaction, interaction_actions, pubmed_ids
           FROM ctd_chem_gene
           WHERE mesh_id IN (${meshList}) ${orgFilter} ${geneFilter}
           ORDER BY gene_symbol
           LIMIT ${maxRows}`
        );

        const totalCount = await ctx.db.query(
          `SELECT count(*) as cnt FROM ctd_chem_gene WHERE mesh_id IN (${meshList}) ${orgFilter} ${geneFilter}`
        );

        const uniqueGenes = await ctx.db.query(
          `SELECT count(DISTINCT gene_symbol) as cnt FROM ctd_chem_gene WHERE mesh_id IN (${meshList}) ${orgFilter} ${geneFilter}`
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              chemical: mappings[0].chemical_name,
              mesh_ids: meshIds,
              nhanes_vars: mappings.flatMap((m) => m.nhanes_vars),
              organism: organism ?? "Homo sapiens",
              biological_context: biological_context ?? "all",
              context_genes_queried: contextGenes,
              total_interactions: Number((totalCount[0] as any)?.cnt ?? 0),
              unique_genes: Number((uniqueGenes[0] as any)?.cnt ?? 0),
              showing: Math.min(maxRows, rows.length),
              interactions: rows,
              source: "Comparative Toxicogenomics Database (CTD), ctdbase.org",
            }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `CTD gene interaction query failed: ${(err as Error).message}. Make sure CTD data has been loaded (run: npx tsx scripts/ctd-etl.ts).`,
          }],
        };
      }
    }
  );

  // ── Tool 29: ctd_chemical_diseases ───────────────────────────────
  server.tool(
    "ctd_chemical_diseases",
    "Look up disease associations for a chemical from the Comparative Toxicogenomics Database (CTD). Returns curated and inferred chemical-disease associations with evidence type and inference scores. Accepts chemical name, NHANES code, HHEAR code, or CAS number.",
    {
      chemical: z
        .string()
        .describe(
          "Chemical identifier: name ('cadmium'), NHANES code ('LBXBCD'), HHEAR code ('Cd'), or CAS number"
        ),
      direct_only: z
        .boolean()
        .optional()
        .describe(
          "If true, return only directly curated associations (not inferred). Default: false."
        ),
      disease_filter: z
        .string()
        .optional()
        .describe(
          "Filter diseases by name substring (e.g., 'kidney', 'cancer', 'diabetes')"
        ),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of disease associations to return (default: 50)"),
    },
    async ({ chemical, direct_only, disease_filter, limit }) => {
      const mappings = resolveChemicalForCTD(chemical);
      if (mappings.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Chemical "${chemical}" not found in the CTD chemical mapping.`,
          }],
        };
      }

      const meshIds = [...new Set(mappings.map((m) => m.mesh_id))];
      const meshList = meshIds.map((id) => `'${id}'`).join(", ");
      const directFilter = direct_only
        ? "AND direct_evidence IS NOT NULL AND direct_evidence != ''"
        : "";
      const diseaseClause = disease_filter
        ? `AND LOWER(disease_name) LIKE '%${disease_filter.toLowerCase().replace(/'/g, "''")}%'`
        : "";
      const maxRows = limit ?? 50;

      try {
        // Get direct evidence associations first, then inferred sorted by score
        const rows = await ctx.db.query(
          `SELECT mesh_id, chemical_name, disease_name, disease_id,
                  direct_evidence, inference_gene_symbol, inference_score,
                  pubmed_ids
           FROM ctd_chem_disease
           WHERE mesh_id IN (${meshList}) ${directFilter} ${diseaseClause}
           ORDER BY
             CASE WHEN direct_evidence IS NOT NULL AND direct_evidence != '' THEN 0 ELSE 1 END,
             inference_score DESC NULLS LAST
           LIMIT ${maxRows}`
        );

        const totalCount = await ctx.db.query(
          `SELECT count(*) as cnt,
                  count(CASE WHEN direct_evidence IS NOT NULL AND direct_evidence != '' THEN 1 END) as direct_cnt
           FROM ctd_chem_disease
           WHERE mesh_id IN (${meshList}) ${diseaseClause}`
        );

        const stats = totalCount[0] as any;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              chemical: mappings[0].chemical_name,
              mesh_ids: meshIds,
              nhanes_vars: mappings.flatMap((m) => m.nhanes_vars),
              total_associations: Number(stats?.cnt ?? 0),
              direct_evidence_count: Number(stats?.direct_cnt ?? 0),
              showing: Math.min(maxRows, rows.length),
              filter: {
                direct_only: direct_only ?? false,
                disease_filter: disease_filter ?? null,
              },
              associations: rows,
              note: "direct_evidence: 'marker/mechanism' = curated from literature; 'therapeutic' = therapeutic association. Rows without direct_evidence are inferred via shared gene interactions (inference_score = network similarity).",
              source: "Comparative Toxicogenomics Database (CTD), ctdbase.org",
            }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `CTD disease association query failed: ${(err as Error).message}. Make sure CTD data has been loaded (run: npx tsx scripts/ctd-etl.ts).`,
          }],
        };
      }
    }
  );

  // ── Tool 30: ctd_chemical_pathways ───────────────────────────────
  server.tool(
    "ctd_chemical_pathways",
    "Look up enriched biological pathways (KEGG/Reactome) for a chemical from the Comparative Toxicogenomics Database (CTD). Returns pathways that are statistically enriched among genes interacting with the chemical. Accepts chemical name, NHANES code, HHEAR code, or CAS number.",
    {
      chemical: z
        .string()
        .describe(
          "Chemical identifier: name ('BPA'), NHANES code ('URXBPH'), HHEAR code ('BPA'), or CAS number"
        ),
      significance: z
        .number()
        .optional()
        .describe(
          "P-value threshold for pathway significance (default: 0.05, uses corrected p-value)"
        ),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of pathways to return (default: 50)"),
    },
    async ({ chemical, significance, limit }) => {
      const mappings = resolveChemicalForCTD(chemical);
      if (mappings.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Chemical "${chemical}" not found in the CTD chemical mapping.`,
          }],
        };
      }

      const meshIds = [...new Set(mappings.map((m) => m.mesh_id))];
      const meshList = meshIds.map((id) => `'${id}'`).join(", ");
      const pThreshold = significance ?? 0.05;
      const maxRows = limit ?? 50;

      try {
        const rows = await ctx.db.query(
          `SELECT mesh_id, chemical_name, pathway_name, pathway_id,
                  p_value, corrected_p_value, gene_count, total_genes
           FROM ctd_chem_pathway
           WHERE mesh_id IN (${meshList})
             AND (corrected_p_value <= ${pThreshold} OR corrected_p_value IS NULL)
           ORDER BY corrected_p_value ASC NULLS LAST, p_value ASC NULLS LAST
           LIMIT ${maxRows}`
        );

        const totalCount = await ctx.db.query(
          `SELECT count(*) as cnt FROM ctd_chem_pathway WHERE mesh_id IN (${meshList})`
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              chemical: mappings[0].chemical_name,
              mesh_ids: meshIds,
              nhanes_vars: mappings.flatMap((m) => m.nhanes_vars),
              total_pathways: Number((totalCount[0] as any)?.cnt ?? 0),
              significant_at: pThreshold,
              showing: Math.min(maxRows, rows.length),
              pathways: rows,
              note: "Pathways are statistically enriched among genes that interact with this chemical (hypergeometric test, Bonferroni-corrected).",
              source: "Comparative Toxicogenomics Database (CTD), ctdbase.org",
            }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `CTD pathway query failed: ${(err as Error).message}. Make sure CTD data has been loaded (run: npx tsx scripts/ctd-etl.ts).`,
          }],
        };
      }
    }
  );

  // ── Tool 31: ctd_chemical_go ─────────────────────────────────────
  server.tool(
    "ctd_chemical_go",
    "Look up enriched Gene Ontology (GO) terms for a chemical from the Comparative Toxicogenomics Database (CTD). Returns biological processes, molecular functions, and cellular components enriched among genes interacting with the chemical. Accepts chemical name, NHANES code, HHEAR code, or CAS number.",
    {
      chemical: z
        .string()
        .describe(
          "Chemical identifier: name ('mercury'), NHANES code ('LBXTHG'), HHEAR code ('Hg'), or CAS number"
        ),
      ontology: z
        .enum(["Biological Process", "Molecular Function", "Cellular Component"])
        .optional()
        .describe(
          "Filter by GO ontology domain. Omit for all domains."
        ),
      significance: z
        .number()
        .optional()
        .describe("P-value threshold (default: 0.01, uses corrected p-value)"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of GO terms to return (default: 50)"),
    },
    async ({ chemical, ontology, significance, limit }) => {
      const mappings = resolveChemicalForCTD(chemical);
      if (mappings.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Chemical "${chemical}" not found in the CTD chemical mapping.`,
          }],
        };
      }

      const meshIds = [...new Set(mappings.map((m) => m.mesh_id))];
      const meshList = meshIds.map((id) => `'${id}'`).join(", ");
      const pThreshold = significance ?? 0.01;
      const ontologyFilter = ontology
        ? `AND ontology = '${ontology}'`
        : "";
      const maxRows = limit ?? 50;

      try {
        const rows = await ctx.db.query(
          `SELECT mesh_id, chemical_name, go_name, go_id, ontology,
                  p_value, corrected_p_value, gene_count, total_genes
           FROM ctd_chem_go
           WHERE mesh_id IN (${meshList})
             AND (corrected_p_value <= ${pThreshold} OR corrected_p_value IS NULL)
             ${ontologyFilter}
           ORDER BY corrected_p_value ASC NULLS LAST, p_value ASC NULLS LAST
           LIMIT ${maxRows}`
        );

        // Count by ontology domain
        const domainCounts = await ctx.db.query(
          `SELECT ontology, count(*) as cnt
           FROM ctd_chem_go
           WHERE mesh_id IN (${meshList})
           GROUP BY ontology`
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              chemical: mappings[0].chemical_name,
              mesh_ids: meshIds,
              nhanes_vars: mappings.flatMap((m) => m.nhanes_vars),
              go_terms_by_domain: domainCounts,
              significant_at: pThreshold,
              ontology_filter: ontology ?? "all",
              showing: Math.min(maxRows, rows.length),
              go_terms: rows,
              note: "GO terms enriched among genes interacting with this chemical (hypergeometric test, Bonferroni-corrected).",
              source: "Comparative Toxicogenomics Database (CTD), ctdbase.org",
            }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `CTD GO enrichment query failed: ${(err as Error).message}. Make sure CTD data has been loaded (run: npx tsx scripts/ctd-etl.ts).`,
          }],
        };
      }
    }
  );

  // ── Tool 32: ctd_triangulate ─────────────────────────────────────
  server.tool(
    "ctd_triangulate",
    "Triangulate an exposure-health association by combining three independent lines of evidence: (1) NHANES EP-WAS — population-level associations from 66M pre-computed meta-analyses, (2) HHEAR cohorts — exposure levels and demographics from 35+ global studies, and (3) CTD — curated gene interactions, disease associations, and enriched pathways. Returns directional hypotheses linking exposure → gene mechanism → phenotype. This is the key interpretability tool for ExWAS results.",
    {
      exposure: z
        .string()
        .describe(
          "Exposure chemical: name ('cadmium'), NHANES code ('LBXBCD'), or HHEAR code ('Cd')"
        ),
      disease: z
        .string()
        .optional()
        .describe(
          "Optional disease/phenotype filter (e.g., 'kidney disease', 'diabetes'). If omitted, returns the full ExWAS profile with all significant phenotype associations."
        ),
      top_n: z
        .number()
        .optional()
        .describe("Number of top results to return per category (default: 15)"),
    },
    async ({ exposure, disease, top_n }) => {
      const mappings = resolveChemicalForCTD(exposure);
      if (mappings.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Chemical "${exposure}" not found in the CTD chemical mapping.`,
          }],
        };
      }

      const meshIds = [...new Set(mappings.map((m) => m.mesh_id))];
      const meshList = meshIds.map((id) => `'${id}'`).join(", ");
      const n = top_n ?? 15;
      const chemName = mappings[0].chemical_name;
      const nhanesVars = mappings.flatMap((m) => m.nhanes_vars);

      const results: Record<string, unknown> = {
        exposure: chemName,
        mesh_ids: meshIds,
        nhanes_vars: nhanesVars,
        hhear_codes: mappings.filter((m) => m.hhear_code).map((m) => m.hhear_code),
        disease_query: disease ?? "all (full ExWAS profile)",
      };

      // Uses module-level BIOLOGICAL_SYSTEMS for phenotype categorization

      // ── 1. EP-WAS: Significant phenotype associations (meta-analysis) ──
      interface EpwasRow {
        pvarname: string;
        desc: string;
        estimate: number;
        se: number;
        p_value: number;
        i_squared: number | null;
        k: number;
      }

      let epwasAssociations: EpwasRow[] = [];
      try {
        if (nhanesVars.length > 0) {
          const varList = nhanesVars.map((v) => `'${v}'`).join(", ");
          const diseaseFilter = disease
            ? `AND (LOWER(vn.desc) LIKE '%${disease.toLowerCase().replace(/'/g, "''")}%' OR LOWER(am.pvarname) LIKE '%${disease.toLowerCase().replace(/'/g, "''")}%')`
            : "";

          epwasAssociations = await ctx.db.query<EpwasRow>(
            `SELECT
               am.pvarname,
               vn.desc,
               am.estimate,
               am."std.error" as se,
               am."p.value" as p_value,
               am."i.squared" as i_squared,
               am.nobs as k
             FROM pe_stats.adjusted_meta am
             LEFT JOIN (
               SELECT "Variable.Name" as vname, MIN("Variable.Description") as desc
               FROM pe_stats.variable_names_epcf
               GROUP BY "Variable.Name"
             ) vn ON am.pvarname = vn.vname
             WHERE am.evarname IN (${varList})
               AND am.model_number = 2
               AND am.expo_name = 'overall'
               AND am."p.value" < 0.05
               ${diseaseFilter}
             ORDER BY am."p.value" ASC
             LIMIT 50`
          );
        }
      } catch {
        // EP-WAS database may not be attached
      }

      // ── Categorize EP-WAS results by biological system ──
      interface CategorizedAssoc {
        system: string;
        phenotype: string;
        description: string;
        beta: number;
        direction: string;
        se: number;
        p_value: number;
        i_squared: number | null;
        n_cycles: number;
      }

      const categorized: CategorizedAssoc[] = [];
      const uncategorized: CategorizedAssoc[] = [];

      for (const row of epwasAssociations) {
        const desc = (row.desc || row.pvarname).toLowerCase();
        const varName = row.pvarname.toUpperCase();
        const direction = row.estimate > 0 ? "↑" : "↓";
        const entry: CategorizedAssoc = {
          system: "Other",
          phenotype: row.pvarname,
          description: row.desc || row.pvarname,
          beta: Math.round(row.estimate * 10000) / 10000,
          direction,
          se: Math.round(row.se * 10000) / 10000,
          p_value: row.p_value,
          i_squared: row.i_squared != null ? Math.round(row.i_squared * 10) / 10 : null,
          n_cycles: row.k,
        };

        let matched = false;
        for (const sys of BIOLOGICAL_SYSTEMS) {
          if (sys.phenotype_patterns.some((p) =>
            p.startsWith("LBX") || p.startsWith("DX") || p.startsWith("BM") || p.startsWith("BP")
              ? varName.includes(p)
              : desc.includes(p.toLowerCase())
          )) {
            entry.system = sys.name;
            categorized.push(entry);
            matched = true;
            break;
          }
        }
        if (!matched) {
          uncategorized.push(entry);
        }
      }

      // Group by system
      const epwasBySys: Record<string, CategorizedAssoc[]> = {};
      for (const a of categorized) {
        if (!epwasBySys[a.system]) epwasBySys[a.system] = [];
        epwasBySys[a.system].push(a);
      }

      results.epwas_by_system = epwasBySys;
      results.epwas_other = uncategorized.length > 0 ? uncategorized : undefined;
      results.epwas_total_significant = epwasAssociations.length;

      // ── 2. HHEAR cohort evidence ──
      // Find all HHEAR cohorts that measured this chemical and pull summary statistics
      interface HhearCohortEvidence {
        cohort_id: string;
        study_name?: string;
        country?: string;
        population?: string;
        n_participants: number;
        hhear_code: string;
        n_measured: number;
        mean: number | null;
        geometric_mean: number | null;
        median: number | null;
        p25: number | null;
        p75: number | null;
        pct_below_lod: number | null;
        units: string | null;
      }

      const hhearEvidence: HhearCohortEvidence[] = [];
      const hhearCodes = mappings.filter((m) => m.hhear_code).map((m) => m.hhear_code!);

      if (hhearCodes.length > 0 && ctx.cohorts.length > 0) {
        for (const cohortConfig of ctx.cohorts) {
          // Check if any HHEAR code for this chemical is measured in this cohort
          const matchedCode = hhearCodes.find((hc) =>
            cohortConfig.analytes.some((a) => a.toLowerCase() === hc.toLowerCase())
          );
          if (!matchedCode) continue;

          // Query basic descriptive stats from the targeted data via DuckDB
          const tableName = `cohort_${cohortConfig.id}_targeted`;
          try {
            const stats = await ctx.db.query<{
              n: number | bigint;
              mean_val: number | null;
              median_val: number | null;
              p25: number | null;
              p75: number | null;
              pct_lod: number | null;
              units: string | null;
            }>(`
              SELECT
                COUNT(*) as n,
                AVG(CASE WHEN conc > 0 THEN conc END) as mean_val,
                MEDIAN(conc) as median_val,
                QUANTILE_CONT(conc, 0.25) as p25,
                QUANTILE_CONT(conc, 0.75) as p75,
                100.0 * SUM(CASE WHEN LOWER(CAST(Comment_Code AS VARCHAR)) IN ('below lod', '<lod') OR conc <= 0 OR conc IS NULL THEN 1 ELSE 0 END) / COUNT(*) as pct_lod,
                MIN(CAST(Units AS VARCHAR)) as units
              FROM (
                SELECT *, TRY_CAST(Concentration AS DOUBLE) as conc
                FROM ${tableName}
                WHERE LOWER(CAST(Analyte_Code AS VARCHAR)) = LOWER('${matchedCode}')
              ) sub
              WHERE conc IS NOT NULL
            `);

            if (stats.length > 0 && Number(stats[0].n) > 0) {
              const s = stats[0];
              const meanVal = s.mean_val;
              // Geometric mean: exp(mean(log(x))) for positive values
              let geoMean: number | null = null;
              try {
                const gm = await ctx.db.query<{ gm: number | null }>(`
                  SELECT EXP(AVG(LN(TRY_CAST(Concentration AS DOUBLE)))) as gm
                  FROM ${tableName}
                  WHERE LOWER(CAST(Analyte_Code AS VARCHAR)) = LOWER('${matchedCode}')
                    AND TRY_CAST(Concentration AS DOUBLE) > 0
                `);
                geoMean = gm[0]?.gm ?? null;
              } catch { /* OK */ }

              hhearEvidence.push({
                cohort_id: cohortConfig.id,
                study_name: cohortConfig.studyName,
                country: cohortConfig.country,
                population: cohortConfig.populationNote,
                n_participants: cohortConfig.nParticipants,
                hhear_code: matchedCode,
                n_measured: Number(s.n),
                mean: meanVal != null ? Math.round(meanVal * 1000) / 1000 : null,
                geometric_mean: geoMean != null ? Math.round(geoMean * 1000) / 1000 : null,
                median: s.median_val != null ? Math.round(Number(s.median_val) * 1000) / 1000 : null,
                p25: s.p25 != null ? Math.round(Number(s.p25) * 1000) / 1000 : null,
                p75: s.p75 != null ? Math.round(Number(s.p75) * 1000) / 1000 : null,
                pct_below_lod: s.pct_lod != null ? Math.round(Number(s.pct_lod) * 10) / 10 : null,
                units: s.units,
              });
            }
          } catch {
            // Cohort table not loaded or query failed — skip
          }
        }
      }

      if (hhearEvidence.length > 0) {
        results.hhear_cohort_evidence = {
          n_cohorts: hhearEvidence.length,
          hhear_codes: hhearCodes,
          cohorts: hhearEvidence,
          note: "Exposure levels from HHEAR consortium cohorts. These are independent from NHANES and provide cross-cohort replication context.",
        };
      } else {
        results.hhear_cohort_evidence = {
          n_cohorts: 0,
          hhear_codes: hhearCodes,
          note: hhearCodes.length > 0
            ? "No HHEAR cohorts currently loaded with this chemical."
            : "No HHEAR analyte code mapped for this chemical.",
        };
      }

      // ── 3. CTD gene interactions by biological system ──
      // For each system that has EP-WAS hits, query CTD for relevant gene interactions
      interface GeneInteraction {
        gene_symbol: string;
        interaction_count: number;
        interactions: string[];
        action_summary: string;
      }

      const geneBySys: Record<string, GeneInteraction[]> = {};

      const systemsWithHits = disease
        ? BIOLOGICAL_SYSTEMS
        : BIOLOGICAL_SYSTEMS.filter((s) => epwasBySys[s.name]);

      for (const sys of systemsWithHits) {
        if (sys.marker_genes.length === 0) continue;
        const geneList = sys.marker_genes.map((g) => `'${g}'`).join(", ");
        try {
          const geneRows = await ctx.db.query<{
            gene_symbol: string;
            n: number | bigint;
            interactions: string;
            actions: string;
          }>(
            `SELECT gene_symbol,
                    count(*) as n,
                    STRING_AGG(DISTINCT interaction, ' || ') as interactions,
                    STRING_AGG(DISTINCT interaction_actions, ' | ') as actions
             FROM ctd_chem_gene
             WHERE mesh_id IN (${meshList})
               AND organism = 'Homo sapiens'
               AND gene_symbol IN (${geneList})
             GROUP BY gene_symbol
             ORDER BY count(*) DESC`
          );
          if (geneRows.length > 0) {
            geneBySys[sys.name] = geneRows.map((r) => ({
              gene_symbol: r.gene_symbol,
              interaction_count: Number(r.n),
              interactions: (r.interactions || "").split(" || ").slice(0, 5),
              action_summary: r.actions || "",
            }));
          }
        } catch {
          // CTD not loaded
        }
      }

      results.ctd_gene_by_system = geneBySys;

      // ── 3. Generate directional hypotheses ──
      const hypotheses: string[] = [];

      for (const sys of BIOLOGICAL_SYSTEMS) {
        const epwasHits = epwasBySys[sys.name];
        const geneHits = geneBySys[sys.name];
        if (!epwasHits && !geneHits) continue;

        // Build phenotype summary
        const phenoSummary = epwasHits
          ? epwasHits
              .slice(0, 4)
              .map((a) => `${a.direction}${a.description} (β=${a.beta})`)
              .join(", ")
          : "(no significant EP-WAS associations)";

        // Build gene mechanism summary
        let mechSummary = "";
        if (geneHits && geneHits.length > 0) {
          const geneDetails = geneHits.slice(0, 4).map((g) => {
            // Extract directionality from interactions
            const dirs: string[] = [];
            for (const ix of g.interactions) {
              if (ix.includes("increases")) dirs.push("↑");
              if (ix.includes("decreases")) dirs.push("↓");
              if (ix.includes("binds to")) dirs.push("binds");
              if (ix.includes("inhibits")) dirs.push("inhibits");
            }
            const dirStr = [...new Set(dirs)].join("/");
            return `${chemName} ${dirStr} ${g.gene_symbol} (${g.interaction_count} interactions)`;
          });
          mechSummary = geneDetails.join("; ");
        }

        if (epwasHits || geneHits) {
          let hypothesis = `**${sys.name}**: `;
          if (mechSummary) {
            hypothesis += `${mechSummary}`;
          }
          if (epwasHits && epwasHits.length > 0) {
            hypothesis += ` → Population-level: ${phenoSummary}`;
          }
          hypotheses.push(hypothesis);
        }
      }

      results.directional_hypotheses = hypotheses;

      // ── 4. CTD disease associations ──
      const diseaseLower = disease ? disease.toLowerCase().replace(/'/g, "''") : "";
      try {
        const diseaseFilter = disease
          ? `AND LOWER(disease_name) LIKE '%${diseaseLower}%'`
          : "";
        const diseaseRows = await ctx.db.query(
          `SELECT disease_name, disease_id, direct_evidence,
                  inference_gene_symbol, inference_score, pubmed_ids
           FROM ctd_chem_disease
           WHERE mesh_id IN (${meshList})
             ${diseaseFilter}
             AND (direct_evidence IS NOT NULL AND direct_evidence != '')
           ORDER BY
             LENGTH(pubmed_ids) - LENGTH(REPLACE(pubmed_ids, '|', '')) DESC
           LIMIT ${n}`
        );
        results.ctd_direct_disease_evidence = {
          count: diseaseRows.length,
          associations: diseaseRows,
          note: "Directly curated disease associations from published literature (marker/mechanism or therapeutic).",
        };
      } catch {
        results.ctd_direct_disease_evidence = { count: 0, note: "CTD disease data not loaded" };
      }

      // ── 5. Top enriched pathways ──
      try {
        const pathwayRows = await ctx.db.query(
          `SELECT pathway_name, pathway_id, corrected_p_value, gene_count
           FROM ctd_chem_pathway
           WHERE mesh_id IN (${meshList})
             AND corrected_p_value IS NOT NULL
           ORDER BY corrected_p_value ASC
           LIMIT ${n}`
        );
        results.ctd_pathways = {
          count: pathwayRows.length,
          top_pathways: pathwayRows,
        };
      } catch {
        results.ctd_pathways = { count: 0, note: "CTD pathway data not loaded" };
      }

      // ── 6. Total gene interaction count ──
      try {
        const totalGenes = await ctx.db.query<{ cnt: number | bigint }>(
          `SELECT count(DISTINCT gene_symbol) as cnt
           FROM ctd_chem_gene
           WHERE mesh_id IN (${meshList}) AND organism = 'Homo sapiens'`
        );
        results.total_human_gene_interactions = Number(totalGenes[0]?.cnt ?? 0);
      } catch {
        results.total_human_gene_interactions = 0;
      }

      const hhearSummary = hhearEvidence.length > 0
        ? `3. COHORT (HHEAR): Exposure levels from ${hhearEvidence.length} independent cohort(s) in the HHEAR consortium, providing cross-population replication and exposure characterization.`
        : "3. COHORT (HHEAR): No HHEAR cohorts available for this chemical.";

      results.interpretation = [
        `TRIANGULATION SUMMARY for ${chemName}${disease ? ` × ${disease}` : ""}:`,
        "",
        "This analysis combines three independent lines of evidence:",
        `1. EPIDEMIOLOGICAL (EP-WAS): ${epwasAssociations.length} significant phenotype associations from survey-weighted NHANES analysis (fully adjusted model: age + age² + sex + ethnicity + income + education), meta-analyzed across available cycles.`,
        hhearSummary,
        `2. MECHANISTIC (CTD): Curated gene interactions, disease associations, and pathway enrichment from published literature in the Comparative Toxicogenomics Database.`,
        "",
        "The directional_hypotheses field links these evidence streams: CTD gene interactions (with directionality: increases/decreases expression, binds, inhibits) are mapped to EP-WAS phenotype categories to generate mechanistic hypotheses explaining population-level associations.",
        "",
        "Convergence across all three lines of evidence — population associations (NHANES), independent cohort measurements (HHEAR), and molecular mechanisms (CTD) — strengthens the case for a causal relationship. Divergence suggests confounding, reverse causation, or incomplete mechanistic understanding.",
      ].join("\n");
      results.source = "EP-WAS: Patel lab NHANES meta-analyses (adjusted_meta, model 2); HHEAR: Human Health Exposure Analysis Resource consortium; CTD: Comparative Toxicogenomics Database (ctdbase.org)";

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(results, bigintReplacer, 2),
        }],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // CROSS-CUTTING TOOLS
  // ═══════════════════════════════════════════════════════════════════

  // ── Tool 33: cohort_chemical_availability ──────────────────────────
  server.tool(
    "cohort_chemical_availability",
    "Find which HHEAR cohorts measured a given chemical. Returns cohort metadata (study name, country, population, PI), sample sizes, and summary statistics (mean, median, %<LOD) for each cohort. Use this before running cohort-specific analyses to know what data is available.",
    {
      chemical: z
        .string()
        .describe("Chemical name ('arsenic'), HHEAR code ('As'), NHANES code ('LBXBPB'), or CAS number"),
    },
    async ({ chemical }) => {
      // Resolve to HHEAR codes
      const ctdMappings = resolveChemicalForCTD(chemical);
      const hhearCodes = ctdMappings.filter((m) => m.hhear_code).map((m) => m.hhear_code!);

      // Also try direct HHEAR alias resolution
      const aliasResult = ctx.resolver.resolveHhear(chemical);
      if (aliasResult.resolved && aliasResult.analyteCode) {
        const code = aliasResult.analyteCode;
        if (!hhearCodes.some((h) => h.toLowerCase() === code.toLowerCase())) {
          hhearCodes.push(code);
        }
      }

      if (hhearCodes.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Could not resolve "${chemical}" to an HHEAR analyte code. Try a chemical name (e.g., 'lead', 'BPA'), HHEAR code (e.g., 'Pb'), or NHANES code (e.g., 'LBXBPB').`,
          }],
        };
      }

      interface CohortAvailability {
        cohort_id: string;
        study_name?: string;
        country?: string;
        population?: string;
        pi?: string;
        n_participants: number;
        hhear_code: string;
        n_measured: number;
        mean: number | null;
        geometric_mean: number | null;
        median: number | null;
        p25: number | null;
        p75: number | null;
        pct_below_lod: number | null;
        units: string | null;
        has_epi_data: boolean;
        epi_variables: string[];
      }

      const available: CohortAvailability[] = [];

      for (const cohortConfig of ctx.cohorts) {
        const matchedCode = hhearCodes.find((hc) =>
          cohortConfig.analytes.some((a) => a.toLowerCase() === hc.toLowerCase())
        );
        if (!matchedCode) continue;

        const tableName = `cohort_${cohortConfig.id}_targeted`;
        try {
          const stats = await ctx.db.query<{
            n: number | bigint;
            mean_val: number | null;
            median_val: number | null;
            p25: number | null;
            p75: number | null;
            pct_lod: number | null;
            units: string | null;
          }>(`
            SELECT
              COUNT(*) as n,
              AVG(CASE WHEN conc > 0 THEN conc END) as mean_val,
              MEDIAN(conc) as median_val,
              QUANTILE_CONT(conc, 0.25) as p25,
              QUANTILE_CONT(conc, 0.75) as p75,
              100.0 * SUM(CASE WHEN LOWER(CAST(Comment_Code AS VARCHAR)) IN ('below lod', '<lod') OR conc <= 0 OR conc IS NULL THEN 1 ELSE 0 END) / COUNT(*) as pct_lod,
              MIN(CAST(Units AS VARCHAR)) as units
            FROM (
              SELECT *, TRY_CAST(Concentration AS DOUBLE) as conc, Analyte_Code, Comment_Code, Units
              FROM ${tableName}
              WHERE LOWER(CAST(Analyte_Code AS VARCHAR)) = LOWER('${matchedCode}')
            ) sub
            WHERE conc IS NOT NULL
          `);

          if (stats.length > 0 && Number(stats[0].n) > 0) {
            const s = stats[0];
            let geoMean: number | null = null;
            try {
              const gm = await ctx.db.query<{ gm: number | null }>(`
                SELECT EXP(AVG(LN(TRY_CAST(Concentration AS DOUBLE)))) as gm FROM ${tableName}
                WHERE LOWER(CAST(Analyte_Code AS VARCHAR)) = LOWER('${matchedCode}') AND TRY_CAST(Concentration AS DOUBLE) > 0
              `);
              geoMean = gm[0]?.gm ?? null;
            } catch { /* OK */ }

            // Get epi column names
            const epiVars: string[] = [];
            if (cohortConfig.epiColumnMap) {
              for (const [stdName] of Object.entries(cohortConfig.epiColumnMap)) {
                if (stdName) epiVars.push(stdName);
              }
            }

            available.push({
              cohort_id: cohortConfig.id,
              study_name: cohortConfig.studyName,
              country: cohortConfig.country,
              population: cohortConfig.populationNote,
              pi: cohortConfig.pi,
              n_participants: cohortConfig.nParticipants,
              hhear_code: matchedCode,
              n_measured: Number(s.n),
              mean: s.mean_val != null ? Math.round(Number(s.mean_val) * 1000) / 1000 : null,
              geometric_mean: geoMean != null ? Math.round(geoMean * 1000) / 1000 : null,
              median: s.median_val != null ? Math.round(Number(s.median_val) * 1000) / 1000 : null,
              p25: s.p25 != null ? Math.round(Number(s.p25) * 1000) / 1000 : null,
              p75: s.p75 != null ? Math.round(Number(s.p75) * 1000) / 1000 : null,
              pct_below_lod: s.pct_lod != null ? Math.round(Number(s.pct_lod) * 10) / 10 : null,
              units: s.units,
              has_epi_data: !!cohortConfig.epiDataFile,
              epi_variables: epiVars,
            });
          }
        } catch { /* cohort query failed — column mismatch or data issue */ }
      }

      // Also check NHANES bridge
      const nhanesVars = ctdMappings.flatMap((m) => m.nhanes_vars);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            chemical: ctdMappings[0]?.chemical_name ?? chemical,
            hhear_codes: hhearCodes,
            nhanes_codes: nhanesVars,
            n_cohorts_available: available.length,
            n_cohorts_total: ctx.cohorts.length,
            cohorts: available,
            note: available.length > 0
              ? "Use cohort_mean, cohort_outcome_associations, or cohort_exwas for detailed analysis."
              : "No HHEAR cohorts have this chemical in their targeted data.",
          }, bigintReplacer, 2),
        }],
      };
    }
  );

  // ── Tool 34: cohort_outcome_associations ───────────────────────────
  server.tool(
    "cohort_outcome_associations",
    "Run a phenotype-wide association study for a single exposure in an HHEAR cohort. Tests one exposure against ALL available outcomes in the epi data (e.g., birth weight, gestational age, BMI, cognitive scores). Returns ranked associations with BH-FDR correction. Model: outcome ~ ln(exposure) + covariates.",
    {
      cohort: z.string().describe("Cohort ID"),
      exposure: z
        .string()
        .describe("Exposure analyte code or name (e.g., 'As', 'lead', 'BPA')"),
      creatinine_adjust: z
        .boolean()
        .optional()
        .default(false)
        .describe("Adjust urinary exposure by creatinine (default: false)"),
      covariates: z
        .array(z.string())
        .optional()
        .describe("Covariate epi columns to include (default: ['age', 'sex'] if available)"),
    },
    async ({ cohort, exposure, creatinine_adjust, covariates }) => {
      const cohortConfig = findCohort(ctx, cohort);
      if (!cohortConfig) {
        return {
          content: [{
            type: "text" as const,
            text: `Cohort "${cohort}" not found. Available: ${ctx.cohorts.map((c) => c.id).join(", ")}`,
          }],
        };
      }

      // Resolve analyte
      const resolved = resolveAnalyte(ctx, exposure, cohortConfig);
      if ("error" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.error }] };
      }

      if (!cohortConfig.epiDataFile) {
        return {
          content: [{
            type: "text" as const,
            text: `Cohort ${cohort} has no epidemiological data file. Cannot test outcome associations without epi variables.`,
          }],
        };
      }

      try {
        const rResult = await ctx.rExec.execute(
          "cohort_outcome_associations.R",
          {
            targeted_csv: cohortConfig.targetedLongCsv ?? path.join(cohortConfig.dataDir, cohortConfig.targetedDataFile),
            epi_csv: path.join(cohortConfig.dataDir, cohortConfig.epiDataFile),
            analyte_code: resolved.code,
            creatinine_adjust: creatinine_adjust ?? false,
            age_column: cohortConfig.epiColumnMap?.age?.column ?? null,
            sex_column: cohortConfig.epiColumnMap?.sex?.column ?? null,
            age_transform: cohortConfig.epiColumnMap?.age?.transform ?? null,
            covariates: covariates ?? null,
            wide_format: cohortConfig.wideFormat ?? false,
            pid_column: cohortConfig.pidColumn,
          },
          300000 // 5 minute timeout
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              cohort: cohortConfig.id,
              study_name: cohortConfig.studyName,
              exposure: resolved.code,
              exposure_name: resolved.name,
              ...rResult,
            }, bigintReplacer, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error running outcome associations for ${resolved.code} in cohort ${cohort}: ${(err as Error).message}`,
          }],
        };
      }
    }
  );

  // ── Tool 35: epwas_reverse_triangulate ─────────────────────────────
  server.tool(
    "epwas_reverse_triangulate",
    "Reverse triangulation: start from a phenotype (e.g., 'HbA1c', 'birth weight', 'blood pressure') and find which environmental exposures are associated with it. For each chemical exposure hit, pulls CTD gene mechanisms and HHEAR cohort availability. Returns a ranked table of exposures with mechanistic evidence, enabling phenotype-first ExWAS interpretation.",
    {
      phenotype: z
        .string()
        .describe("Phenotype variable or name (e.g., 'glycohemoglobin', 'LBXGH', 'fasting glucose', 'LBXGLU')"),
      model_number: z
        .number()
        .optional()
        .default(2)
        .describe("EP-WAS adjustment model (2=fully adjusted [default], 6=age+sex+ethnicity)"),
      p_threshold: z
        .number()
        .optional()
        .default(1e-5)
        .describe("P-value threshold for EP-WAS hits (default: 1e-5)"),
      top_n: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of top exposure hits to triangulate (default: 20)"),
    },
    async ({ phenotype, model_number, p_threshold, top_n }) => {
      // Resolve phenotype
      const r = await ctx.resolver.resolve(phenotype);
      if (!r.resolved) {
        return {
          content: [{
            type: "text" as const,
            text: r.candidates
              ? `Ambiguous phenotype "${phenotype}". Candidates:\n${formatCandidates(r)}`
              : `Phenotype "${phenotype}" not found.`,
          }],
        };
      }

      const phenoVar = r.variable!.variableName;
      const phenoDesc = r.variable!.description;
      const model = model_number ?? 2;
      const pThresh = p_threshold ?? 1e-5;
      const maxN = top_n ?? 20;

      // 1. Query EP-WAS for top exposures associated with this phenotype
      interface EpwasHit {
        evarname: string;
        estimate: number;
        se: number;
        p_value: number;
        i_squared: number | null;
        k: number;
        desc: string;
      }

      let epwasHits: EpwasHit[] = [];
      try {
        epwasHits = await ctx.db.query<EpwasHit>(
          `SELECT
             am.evarname,
             am.estimate,
             am."std.error" as se,
             am."p.value" as p_value,
             am."i.squared" as i_squared,
             am.nobs as k,
             COALESCE(vn.desc, am.evarname) as desc
           FROM pe_stats.adjusted_meta am
           LEFT JOIN (
             SELECT "Variable.Name" as vname, MIN("Variable.Description") as desc
             FROM pe_stats.variable_names_epcf
             GROUP BY "Variable.Name"
           ) vn ON am.evarname = vn.vname
           WHERE am.pvarname = '${phenoVar}'
             AND am.model_number = ${model}
             AND am.expo_name = 'overall'
             AND am."p.value" < ${pThresh}
           ORDER BY am."p.value" ASC
           LIMIT ${maxN * 2}`
        );
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `EP-WAS query failed: ${(err as Error).message}`,
          }],
        };
      }

      if (epwasHits.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No significant exposures found for ${phenoVar} (${phenoDesc}) at p < ${pThresh} in model ${model}. Try relaxing the p-value threshold.`,
          }],
        };
      }

      // 2. For each exposure, check if it maps to a chemical in CTD and HHEAR
      interface TriangulatedExposure {
        exposure_var: string;
        exposure_description: string;
        beta: number;
        direction: string;
        se: number;
        p_value: number;
        i_squared: number | null;
        n_cycles: number;
        chemical_name: string | null;
        ctd_mesh_id: string | null;
        ctd_gene_count: number;
        ctd_top_genes: string[];
        ctd_disease_direct: boolean;
        hhear_n_cohorts: number;
        hhear_codes: string[];
      }

      const triangulated: TriangulatedExposure[] = [];

      for (const hit of epwasHits.slice(0, maxN)) {
        const entry: TriangulatedExposure = {
          exposure_var: hit.evarname,
          exposure_description: hit.desc,
          beta: Math.round(hit.estimate * 10000) / 10000,
          direction: hit.estimate > 0 ? "↑" : "↓",
          se: Math.round(hit.se * 10000) / 10000,
          p_value: hit.p_value,
          i_squared: hit.i_squared != null ? Math.round(hit.i_squared * 10) / 10 : null,
          n_cycles: hit.k,
          chemical_name: null,
          ctd_mesh_id: null,
          ctd_gene_count: 0,
          ctd_top_genes: [],
          ctd_disease_direct: false,
          hhear_n_cohorts: 0,
          hhear_codes: [],
        };

        // Check CTD mapping
        const ctdMapping = CTD_BY_NHANES.get(hit.evarname);
        if (ctdMapping) {
          const mapping = ctdMapping;
          entry.chemical_name = mapping.chemical_name;
          entry.ctd_mesh_id = mapping.mesh_id;
          entry.hhear_codes = mapping.hhear_code ? [mapping.hhear_code] : [];

          // Query CTD gene count and top genes
          try {
            const gc = await ctx.db.query<{ cnt: number | bigint }>(`
              SELECT count(DISTINCT gene_symbol) as cnt FROM ctd_chem_gene
              WHERE mesh_id = '${mapping.mesh_id}' AND organism = 'Homo sapiens'
            `);
            entry.ctd_gene_count = Number(gc[0]?.cnt ?? 0);

            const topG = await ctx.db.query<{ gene_symbol: string; n: number | bigint }>(`
              SELECT gene_symbol, count(*) as n FROM ctd_chem_gene
              WHERE mesh_id = '${mapping.mesh_id}' AND organism = 'Homo sapiens'
              GROUP BY gene_symbol ORDER BY n DESC LIMIT 5
            `);
            entry.ctd_top_genes = topG.map((g) => g.gene_symbol);
          } catch { /* CTD not loaded */ }

          // Check for direct disease evidence
          try {
            const dc = await ctx.db.query<{ cnt: number | bigint }>(`
              SELECT count(*) as cnt FROM ctd_chem_disease
              WHERE mesh_id = '${mapping.mesh_id}'
                AND direct_evidence IS NOT NULL AND direct_evidence != ''
            `);
            entry.ctd_disease_direct = Number(dc[0]?.cnt ?? 0) > 0;
          } catch { /* CTD not loaded */ }

          // Count HHEAR cohorts
          if (entry.hhear_codes.length > 0) {
            for (const cc of ctx.cohorts) {
              if (entry.hhear_codes.some((hc) =>
                cc.analytes.some((a) => a.toLowerCase() === hc.toLowerCase())
              )) {
                entry.hhear_n_cohorts++;
              }
            }
          }
        }

        triangulated.push(entry);
      }

      // Sort: chemicals with CTD data first, then by p-value
      triangulated.sort((a, b) => {
        if (a.ctd_gene_count > 0 && b.ctd_gene_count === 0) return -1;
        if (a.ctd_gene_count === 0 && b.ctd_gene_count > 0) return 1;
        return a.p_value - b.p_value;
      });

      // Determine which biological system this phenotype belongs to
      const phenoDescLower = phenoDesc.toLowerCase();
      const phenoSystem = BIOLOGICAL_SYSTEMS.find((sys) =>
        sys.phenotype_patterns.some((p) =>
          p.startsWith("LBX") || p.startsWith("DX") || p.startsWith("BM") || p.startsWith("BP")
            ? phenoVar.includes(p)
            : phenoDescLower.includes(p.toLowerCase())
        )
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            phenotype: phenoVar,
            phenotype_description: phenoDesc,
            biological_system: phenoSystem?.name ?? "Other",
            system_marker_genes: phenoSystem?.marker_genes ?? [],
            model: MODEL_DESCRIPTIONS[model],
            p_threshold: pThresh,
            total_significant_exposures: epwasHits.length,
            showing: triangulated.length,
            exposures: triangulated,
            interpretation: [
              `Found ${epwasHits.length} exposures significantly associated with ${phenoDesc} (${phenoVar}) at p < ${pThresh}.`,
              `${triangulated.filter((t) => t.ctd_gene_count > 0).length} exposures have CTD mechanistic data.`,
              `${triangulated.filter((t) => t.hhear_n_cohorts > 0).length} exposures have HHEAR cohort data.`,
              phenoSystem
                ? `This phenotype maps to the "${phenoSystem.name}" biological system. Use ctd_triangulate on individual chemicals for full directional hypotheses using the ${phenoSystem.marker_genes.length} marker genes for this system.`
                : "Use ctd_triangulate on individual chemical hits for full directional hypotheses.",
            ].join(" "),
            source: "EP-WAS: Patel lab NHANES meta-analyses; CTD: Comparative Toxicogenomics Database; HHEAR: Human Health Exposure Analysis Resource",
          }, bigintReplacer, 2),
        }],
      };
    }
  );

  // ── Tool 36: exposure_profile ────────────────────────────────────
  server.tool(
    "exposure_profile",
    "Given a chemical and optional demographic profile (age, sex, race/ethnicity, BMI), compute the expected exposure distribution from NHANES, then contextualize top EP-WAS associations within that range. Returns: (1) population-wide exposure percentiles, (2) subgroup-specific percentiles matching the profile, (3) biomarker thresholds if available, and (4) top phenotype associations with effect sizes interpreted at the subgroup's exposure level.",
    {
      chemical: z
        .string()
        .describe("Chemical name ('lead'), NHANES code ('LBXBPB'), HHEAR code ('Pb'), or CAS number"),
      age: z
        .number()
        .optional()
        .describe("Age in years (uses ±5 year window)"),
      sex: z
        .enum(["male", "female"])
        .optional()
        .describe("Sex"),
      race_ethnicity: z
        .enum(["mexican_american", "other_hispanic", "non_hispanic_white", "non_hispanic_black", "other_multiracial"])
        .optional()
        .describe("Race/ethnicity (RIDRETH1 categories)"),
      bmi: z
        .number()
        .optional()
        .describe("BMI in kg/m² (uses WHO category: <18.5, 18.5-25, 25-30, ≥30)"),
      cycles: z
        .array(z.string())
        .optional()
        .describe("NHANES cycles (default: most recent 3 available)"),
      model_number: z
        .number()
        .optional()
        .default(2)
        .describe("EP-WAS adjustment model for associations (default: 2 = fully adjusted)"),
      top_n: z
        .number()
        .optional()
        .default(15)
        .describe("Number of top associations to contextualize (default: 15)"),
    },
    async ({ chemical, age, sex, race_ethnicity, bmi, cycles, model_number, top_n }) => {
      // ── 1. Resolve chemical to NHANES variable code ──
      let nhanesVar: string | null = null;
      let chemName: string = chemical;
      let units: string | null = null;

      // Try direct NHANES variable resolution
      const directResolve = await ctx.resolver.resolve(chemical);
      if (directResolve.resolved && directResolve.variable) {
        nhanesVar = directResolve.variable.variableName;
        chemName = directResolve.variable.description;
      }

      // Try CompTox → HHEAR → NHANES bridge
      if (!nhanesVar) {
        const profile = resolveChemical(chemical);
        if (profile) {
          chemName = profile.chemical_name;
          const bridgeEntry = BRIDGE_BY_HHEAR.get(profile.hhear_code);
          if (bridgeEntry && bridgeEntry.nhanes_codes.length > 0) {
            // Prefer blood matrix, fall back to first
            const bloodCode = bridgeEntry.nhanes_codes.find((n) => n.matrix === "blood" || n.matrix === "serum");
            const chosen = bloodCode ?? bridgeEntry.nhanes_codes[0];
            nhanesVar = chosen.code;
            units = chosen.units;
          }
        }
      }

      // Try CTD mapping
      if (!nhanesVar) {
        const ctdMappings = resolveChemicalForCTD(chemical);
        if (ctdMappings.length > 0 && ctdMappings[0].nhanes_vars.length > 0) {
          nhanesVar = ctdMappings[0].nhanes_vars[0];
          chemName = ctdMappings[0].chemical_name;
        }
      }

      if (!nhanesVar) {
        return {
          content: [{
            type: "text" as const,
            text: `Could not resolve "${chemical}" to an NHANES variable code. Try a specific NHANES code (e.g., 'LBXBPB'), chemical name ('lead'), or HHEAR code ('Pb').`,
          }],
        };
      }

      // ── 2. Build demographic subgroup filter ──
      const filterParts: string[] = [];
      const profileDesc: Record<string, unknown> = {};

      if (age != null) {
        const ageLow = Math.max(0, age - 5);
        const ageHigh = age + 5;
        filterParts.push(`RIDAGEYR >= ${ageLow} & RIDAGEYR <= ${ageHigh}`);
        profileDesc.age = `${ageLow}-${ageHigh}`;
      }

      if (sex) {
        const sexCode = sex === "male" ? 1 : 2;
        filterParts.push(`RIAGENDR == ${sexCode}`);
        profileDesc.sex = sex;
      }

      if (race_ethnicity) {
        const raceMap: Record<string, number> = {
          mexican_american: 1,
          other_hispanic: 2,
          non_hispanic_white: 3,
          non_hispanic_black: 4,
          other_multiracial: 5,
        };
        filterParts.push(`RIDRETH1 == ${raceMap[race_ethnicity]}`);
        profileDesc.race_ethnicity = race_ethnicity;
      }

      if (bmi != null) {
        if (bmi < 18.5) {
          filterParts.push("BMXBMI < 18.5");
          profileDesc.bmi_category = "underweight (<18.5)";
        } else if (bmi < 25) {
          filterParts.push("BMXBMI >= 18.5 & BMXBMI < 25");
          profileDesc.bmi_category = "normal (18.5-25)";
        } else if (bmi < 30) {
          filterParts.push("BMXBMI >= 25 & BMXBMI < 30");
          profileDesc.bmi_category = "overweight (25-30)";
        } else {
          filterParts.push("BMXBMI >= 30");
          profileDesc.bmi_category = "obese (≥30)";
        }
      }

      const subgroupFilter = filterParts.length > 0 ? filterParts.join(" & ") : null;

      // ── 3. Run R script for distributions ──
      let seriesCycles: string[] | undefined;
      if (cycles) {
        seriesCycles = mapCyclesToSeries(cycles);
      }

      let rResult: Record<string, unknown>;
      try {
        rResult = await ctx.rExec.execute(
          "exposure_profile.R",
          {
            variable: nhanesVar,
            cycles: seriesCycles ?? null,
            subgroup: subgroupFilter,
          },
          120000
        ) as Record<string, unknown>;
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `R computation failed: ${(err as Error).message}`,
          }],
        };
      }

      if (rResult.error) {
        return {
          content: [{
            type: "text" as const,
            text: `Exposure profile computation failed: ${rResult.error}`,
          }],
        };
      }

      // ── 4. Query EP-WAS top associations ──
      const model = model_number ?? 2;
      const maxAssoc = top_n ?? 15;

      interface EpwasAssoc {
        pvarname: string;
        desc: string;
        estimate: number;
        se: number;
        p_value: number;
        i_squared: number | null;
        k: number;
      }

      let associations: EpwasAssoc[] = [];
      try {
        associations = await ctx.db.query<EpwasAssoc>(
          `SELECT
             am.pvarname,
             COALESCE(vn.desc, am.pvarname) as desc,
             am.estimate,
             am."std.error" as se,
             am."p.value" as p_value,
             am."i.squared" as i_squared,
             am.nobs as k
           FROM pe_stats.adjusted_meta am
           LEFT JOIN (
             SELECT "Variable.Name" as vname, MIN("Variable.Description") as desc
             FROM pe_stats.variable_names_epcf
             GROUP BY "Variable.Name"
           ) vn ON am.pvarname = vn.vname
           WHERE am.evarname = '${nhanesVar}'
             AND am.model_number = ${model}
             AND am.expo_name = 'overall'
             AND am."p.value" < 0.05
           ORDER BY am."p.value" ASC
           LIMIT ${maxAssoc}`
        );
      } catch {
        // EP-WAS not loaded
      }

      // ── 5. Contextualize associations at subgroup exposure level ──
      // Extract log10 stats for conversion
      const subDist = rResult.subgroup as Record<string, unknown> | null;
      const popDist = rResult.population as Record<string, unknown>;
      const activeDist = subDist && !subDist.error ? subDist : popDist;
      const activePercs = activeDist?.percentiles as Record<string, number> | null;
      const log10Mean = (activeDist as any)?.log10_mean as number | null;
      const log10Sd = (activeDist as any)?.log10_sd as number | null;

      interface ContextualizedAssoc {
        phenotype: string;
        phenotype_description: string;
        beta: number;
        direction: string;
        se: number;
        p_value: number;
        n_cycles: number;
        interpretation: string;
      }

      const contextualizedAssocs: ContextualizedAssoc[] = associations.map((a) => {
        const direction = a.estimate > 0 ? "↑" : "↓";
        let interpretation = "";

        if (activePercs && log10Sd && log10Sd > 0) {
          const p25 = activePercs.p25;
          const p75 = activePercs.p75;
          const p50 = activePercs.p50;

          if (p25 > 0 && p75 > 0 && p50 > 0) {
            // EP-WAS beta is per 1 SD of log10(exposure)
            // IQR in log10 space / SD = number of SDs across IQR
            const iqrLog10 = Math.log10(p75) - Math.log10(p25);
            const iqrSDs = iqrLog10 / log10Sd;
            const expectedChange = a.estimate * iqrSDs;

            interpretation = `At the subgroup median (${p50}${units ? " " + units : ""}), moving across the IQR (${p25}–${p75}) spans ${Math.round(iqrSDs * 100) / 100} SDs of log₁₀-exposure, corresponding to an estimated ${direction}${Math.abs(Math.round(expectedChange * 1000) / 1000)} change in ${a.desc}.`;
          }
        }

        if (!interpretation) {
          interpretation = `${direction}${a.desc} per 1-SD increase in log₁₀(${chemName}), β=${Math.round(a.estimate * 10000) / 10000}.`;
        }

        return {
          phenotype: a.pvarname,
          phenotype_description: a.desc,
          beta: Math.round(a.estimate * 10000) / 10000,
          direction,
          se: Math.round(a.se * 10000) / 10000,
          p_value: a.p_value,
          n_cycles: a.k,
          interpretation,
        };
      });

      // ── 6. Look up biomarker thresholds ──
      const thresholds = THRESHOLDS_BY_NHANES_VAR.get(nhanesVar) ?? [];
      const thresholdContext = thresholds.map((t) => {
        const result: Record<string, unknown> = {
          reference_value: t.reference_value,
          units: t.units,
          source: t.reference_source,
          level: t.level,
          description: t.description,
          population: t.population,
        };

        // Check if subgroup percentiles exceed threshold
        if (activePercs) {
          const p50 = activePercs.p50;
          const p95 = activePercs.p95;
          if (p50 != null) result.subgroup_median_vs_threshold = p50 > t.reference_value ? "ABOVE" : "below";
          if (p95 != null) result.subgroup_p95_vs_threshold = p95 > t.reference_value ? "ABOVE" : "below";
        }

        return result;
      });

      // ── 7. Cell size warning ──
      const warnings: string[] = [];
      const subN = subDist ? Number((subDist as any)?.n_unweighted ?? 0) : 0;
      if (subDist && subN > 0 && subN < 30) {
        warnings.push(`Subgroup sample size (N=${subN}) is below NCHS minimum of 30. Estimates may be unreliable. Consider broadening the demographic filters.`);
      }
      const pctLod = (activeDist as any)?.pct_below_lod;
      if (pctLod != null && pctLod > 40) {
        warnings.push(`${pctLod}% of values are below the limit of detection. Distribution estimates may be imprecise.`);
      }

      // ── 8. Assemble output ──
      const output: Record<string, unknown> = {
        chemical: chemName,
        nhanes_variable: nhanesVar,
        units,
        demographic_profile: Object.keys(profileDesc).length > 0 ? profileDesc : "none (population-wide)",
        population_distribution: popDist,
        subgroup_distribution: subDist,
        biomarker_thresholds: thresholdContext.length > 0 ? thresholdContext : undefined,
        top_associations: {
          model: MODEL_DESCRIPTIONS[model],
          n_significant: associations.length,
          associations: contextualizedAssocs,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
        interpretation: [
          subDist && !subDist.error
            ? `For a ${Object.values(profileDesc).join(", ")} individual, the expected ${chemName} level is around the subgroup median of ${activePercs?.p50 ?? "unknown"}${units ? " " + units : ""} (IQR: ${activePercs?.p25}–${activePercs?.p75}).`
            : `Population-wide ${chemName} median: ${activePercs?.p50 ?? "unknown"}${units ? " " + units : ""}.`,
          associations.length > 0
            ? `The top EP-WAS associations are contextualized at this exposure level, showing the expected phenotype changes across the subgroup's interquartile range.`
            : "No significant EP-WAS associations found for this exposure.",
          thresholdContext.length > 0
            ? `Regulatory thresholds are available for comparison.`
            : "",
        ].filter(Boolean).join(" "),
        source: "NHANES survey-weighted distributions; EP-WAS: Patel lab meta-analyses (adjusted_meta); Thresholds: CDC/WHO/German HBM/NASEM",
      };

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(output, bigintReplacer, 2),
        }],
      };
    }
  );

  console.error(`[exposomeql] Registered 36 tools (6 Class 1, 5 Class 2, 6 Class 3, 9 HHEAR, 1 Chemical, 5 CTD, 4 Cross-cutting)`);
}

/** Find a cohort config by ID */
function findCohort(ctx: AppContext, cohortId: string): CohortConfig | undefined {
  return ctx.cohorts.find((c) => c.id === cohortId);
}

/** Translate a user-facing subgroup expression to use cohort-specific epi column names.
 *  E.g., "age < 18" → "(mslchronage / 12) < 18" for cohort 1461 (age in months). */
function translateSubgroup(
  subgroup: string,
  cohortConfig: CohortConfig
): string {
  const map = cohortConfig.epiColumnMap;
  if (!map) return subgroup;

  let translated = subgroup;
  for (const [stdName, mapping] of Object.entries(map)) {
    if (!mapping) continue;
    const pattern = new RegExp(`\\b${stdName}\\b`, "gi");
    if (pattern.test(translated)) {
      // Use transform (R expression in standard units) or just the column name
      const replacement = mapping.transform
        ? `(${mapping.transform})`
        : mapping.column;
      translated = translated.replace(
        new RegExp(`\\b${stdName}\\b`, "gi"),
        replacement
      );
    }
  }
  return translated;
}

/** Resolve an analyte query for a cohort, returning the code or an error message.
 *  Uses global-first resolution to avoid fuzzy mis-matches (e.g., "Pb" → "BUPB"),
 *  then verifies the resolved code exists in the cohort. Falls back to per-cohort
 *  resolution for cohort-specific codes not in the global dictionary. */
function resolveAnalyte(
  ctx: AppContext,
  query: string,
  cohortConfig: CohortConfig
): { code: string; name: string } | { error: string } {
  // Step 1: Resolve globally first (no cohort constraint)
  const globalResult = ctx.resolver.resolveHhear(query);

  if (globalResult.resolved && globalResult.analyteCode) {
    // Step 2: Check if globally-resolved code exists in this cohort
    const resolvedCodeLower = globalResult.analyteCode.toLowerCase();
    const cohortMatch = cohortConfig.analytes.find(
      (a) => a.toLowerCase() === resolvedCodeLower
    );
    if (cohortMatch) {
      return { code: cohortMatch, name: globalResult.analyteName ?? cohortMatch };
    }
    // Globally resolved but NOT in this cohort — clear error
    return {
      error: `${globalResult.analyteName ?? globalResult.analyteCode} (${globalResult.analyteCode}) is not measured in cohort ${cohortConfig.id}. Available analytes: ${cohortConfig.analytes.slice(0, 15).join(", ")}${cohortConfig.analytes.length > 15 ? "..." : ""}`,
    };
  }

  // Step 3: Global resolution failed — fall back to per-cohort resolution
  // (handles cohort-specific codes not in the global dictionary)
  const cohortResult = ctx.resolver.resolveHhear(query, cohortConfig);
  if (cohortResult.resolved && cohortResult.analyteCode) {
    return { code: cohortResult.analyteCode, name: cohortResult.analyteName ?? cohortResult.analyteCode };
  }

  // Step 4: Neither worked — show candidates or error
  const candidates = globalResult.candidates ?? cohortResult.candidates;
  if (candidates && candidates.length > 0) {
    const candidateList = candidates
      .map((c) => `- ${c.code}: ${c.name}`)
      .join("\n");
    return {
      error: `Ambiguous analyte "${query}" in cohort ${cohortConfig.id}. Did you mean one of:\n${candidateList}`,
    };
  }
  return {
    error: `Analyte "${query}" not found in cohort ${cohortConfig.id}. Available analytes: ${cohortConfig.analytes.slice(0, 15).join(", ")}${cohortConfig.analytes.length > 15 ? "..." : ""}`,
  };
}
