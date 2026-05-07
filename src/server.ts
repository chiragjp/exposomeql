import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { DuckDBManager } from "./data/duckdb-manager.js";
import { VariableResolver } from "./variables/variable-resolver.js";
import { RExecutor } from "./r-bridge/r-executor.js";
import { PythonExecutor } from "./python-bridge/python-executor.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import type { AppContext } from "./types.js";

// Heavy subsystems (DuckDB connections, variable index, R executor) are shared
// across every MCP session. Only the McpServer + transport are per-session.
let cachedContext: AppContext | null = null;
let contextPromise: Promise<AppContext> | null = null;

async function getContext(): Promise<AppContext> {
  if (cachedContext) return cachedContext;
  if (!contextPromise) {
    contextPromise = (async () => {
      const config = loadConfig();
      const db = new DuckDBManager();
      await db.initialize(config);
      const resolver = new VariableResolver(db);
      await resolver.initialize();
      const rExec = new RExecutor(config);
      const pyExec = new PythonExecutor(config);
      const cohorts = await db.discoverCohorts(config.hhearDataDir);
      cachedContext = { db, resolver, rExec, pyExec, cohorts };
      console.error("[exposomeql] Server initialized with data from:", config.dataDir);
      if (cohorts.length > 0) {
        console.error(`[exposomeql] HHEAR cohorts available: ${cohorts.map(c => c.id).join(", ")}`);
      }
      // Non-blocking Python dependency check
      pyExec.checkPythonDependencies().then((missing) => {
        if (missing === null) {
          console.error("[exposomeql] WARNING: Python3 not found or failed to run. Python-backed tools (HHEAR cohort analytics) will fall back to R.");
        } else if (missing.length > 0) {
          console.error(`[exposomeql] WARNING: missing Python packages: ${missing.join(", ")}. Run: npm run setup-py`);
        } else {
          console.error("[exposomeql] Python dependencies OK");
        }
      });

      // Non-blocking R dependency check — warn but don't fail startup so SQL/EP-WAS
      // tools still work for users who haven't installed R packages yet.
      rExec.checkRDependencies().then((missing) => {
        if (missing === null) {
          console.error("[exposomeql] WARNING: Rscript not found or failed to run. R-backed tools (nhanes_mean, nhanes_model, etc.) will not work. Install R from https://cran.r-project.org, then run: npm run setup-r");
        } else if (missing.length > 0) {
          console.error(`[exposomeql] WARNING: missing R packages: ${missing.join(", ")}. R-backed tools will fail. Run: npm run setup-r`);
        } else {
          console.error("[exposomeql] R dependencies OK");
        }
      });
      return cachedContext;
    })();
  }
  return contextPromise;
}

export async function createServer(): Promise<McpServer> {
  const ctx = await getContext();

  const server = new McpServer({
    name: "exposomeql",
    version: "0.2.0",
  });

  // Register tools, resources, and prompts
  registerTools(server, ctx);
  registerResources(server, ctx);

  // Register MCP prompts — these appear as selectable templates in Claude Desktop
  // and instruct the LLM to use ExposomeQL tools.
  //
  // Every prompt embeds an epistemic-caution preamble so the model's output
  // is scientifically conservative: associations not causation, alternative
  // hypotheses enumerated, and evidence gaps named.
  const EPISTEMIC_PREAMBLE = `IMPORTANT — Epistemic standards for all answers:
- NHANES is cross-sectional: say "associated with," never "causes" or "leads to." Explain why the distinction matters.
- For every association you report, enumerate at least two alternative explanations (confounding, reverse causation, selection bias, measurement error, collider bias).
- Distinguish statistical significance (p-value) from clinical or public health significance (effect size relative to measurement noise and population variability).
- State what evidence would strengthen or weaken the claim (prospective cohort, Mendelian randomization, RCT, dose-response gradient, biological mechanism).
- When multiple interpretations are consistent with the data, present all of them ranked by plausibility rather than selecting one.
- Acknowledge what is NOT in the data: unmeasured confounders, populations not represented in NHANES, exposure windows not captured by a single cross-sectional measurement.
- Be specific about uncertainty: report confidence intervals, heterogeneity (I²), and the number of cycles contributing to each estimate.
`;

  server.prompt(
    "assess-exposure",
    "Assess the health effects of an environmental exposure using ExposomeQL data",
    { exposure: z.string().describe("Chemical or exposure name (e.g., 'PFOA', 'lead', 'cadmium')") },
    ({ exposure }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `${EPISTEMIC_PREAMBLE}
Assess the health effects of ${exposure} using the ExposomeQL tools. You MUST:
1. Use epwas_summary or epwas_search to get the EP-WAS associations from NHANES
2. Use confounder_check to identify potential confounders
3. Use ctd_chemical_genes to get mechanistic evidence
4. For any cardiometabolic phenotype (glucose, cholesterol, BP, uric acid), use nhanes_sensitivity to check for reverse causality
5. Provide dose context: how large are the effects relative to measurement noise?
6. State clearly whether the evidence is observational only or triangulated`,
        },
      }],
    })
  );

  server.prompt(
    "my-health-profile",
    "Get a personalized health profile based on your demographics and measurements",
    {
      age: z.string().describe("Your age"),
      sex: z.string().describe("male or female"),
      measurements: z.string().optional().describe("Your measurements, e.g., 'BP 135, lead 3.2 µg/dL, vitamin D 28 ng/mL'"),
    },
    ({ age, sex, measurements }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `${EPISTEMIC_PREAMBLE}
I am a ${age}-year-old ${sex}. ${measurements ? `My measurements: ${measurements}.` : ""} Using the ExposomeQL tools, please:
1. Use my_exposome to scan relevant environmental exposures for my profile
2. For any measurements I provided, use measurement_uncertainty to quantify how reliable each single reading is
3. Use find_doppelgangers to show me what NHANES participants like me look like health-wise
4. For any concerning associations, use nhanes_sensitivity to check if they survive excluding diagnosed disease
5. Provide practical dose context — are these effects large enough to matter for me personally?
6. Be honest about what is population-level inference vs individual prediction`,
        },
      }],
    })
  );

  server.prompt(
    "fact-check-claim",
    "Fact-check a health claim about environmental exposures using ExposomeQL data",
    { claim: z.string().describe("The health claim to evaluate (e.g., 'PFAS causes cancer', 'vitamin D prevents diabetes')") },
    ({ claim }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `${EPISTEMIC_PREAMBLE}
Evaluate this health claim using ExposomeQL data: "${claim}". You MUST:
1. Use epwas_search to check if the association exists in NHANES data
2. Use simpson_paradox_test to check if the association reverses within NHANES cycles
3. Use confounder_check to identify potential confounders
4. If a nutrient claim, use nutrient_triangulate to compare observational vs experimental evidence
5. Use exposure_compare if multiple chemicals are involved
6. Provide a balanced assessment: what the data supports, what it doesn't, and what remains uncertain
7. Include dose context — is the effect large enough to matter at typical exposure levels?`,
        },
      }],
    })
  );

  server.prompt(
    "diet-assessment",
    "Assess the health implications of your diet using ExposomeQL",
    { diet: z.string().describe("What you ate (e.g., 'salmon, kale salad, glass of milk')") },
    ({ diet }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `${EPISTEMIC_PREAMBLE}
I ate: ${diet}. Using the ExposomeQL tools, please:
1. Estimate the nutrient content of this meal
2. Use diet_assess to compare against DRI thresholds and get EP-WAS associations
3. Use diet_quality to show where this meal falls on the HEI scale
4. For any nutrients below the DRI, use nutrient_rct_evidence to show what the experimental evidence says
5. Be clear that a single meal doesn't determine health — long-term patterns matter
6. Provide practical context, not alarm`,
        },
      }],
    })
  );

  return server;
}
