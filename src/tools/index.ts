import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "path";
import type { AppContext, ResolveResult, CohortConfig } from "../types.js";
import { MODEL_DESCRIPTIONS, CYCLE_TO_SERIES, SERIES_MAP } from "../types.js";
import { formatCellSizeWarning } from "../guardrails/cell-size.js";
import { checkLOD, isLabBiomarker } from "../guardrails/lod-handling.js";
import { generateMeanCode, generateConditionalCode } from "../codegen/r-code-generator.js";
import { NHANES_HHEAR_BRIDGE, BRIDGE_BY_HHEAR, BRIDGE_BY_NHANES } from "../variables/nhanes-hhear-bridge.js";
import { resolveChemical, COMPTOX_BY_HHEAR } from "../variables/comptox-chemicals.js";

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

  console.error(`[exposomeql] Registered 27 tools (6 Class 1, 5 Class 2, 6 Class 3, 9 HHEAR, 1 Chemical)`);
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
