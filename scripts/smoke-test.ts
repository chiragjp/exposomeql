/**
 * Smoke test for ExposomeQL MCP server.
 * Verifies that the server starts, tools register, and basic queries return results.
 *
 * Usage: npx tsx scripts/smoke-test.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface TestResult {
  name: string;
  passed: boolean;
  duration_ms: number;
  error?: string;
}

async function main() {
  const results: TestResult[] = [];
  let client: Client | null = null;

  try {
    // ── Connect to server ──
    const t0 = Date.now();
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
    });
    client = new Client({ name: "smoke-test", version: "0.1.0" });
    await client.connect(transport);
    results.push({ name: "Server startup", passed: true, duration_ms: Date.now() - t0 });

    // ── List tools ──
    const t1 = Date.now();
    const toolsResponse = await client.listTools();
    const toolCount = toolsResponse.tools.length;
    const passed = toolCount >= 44;
    results.push({
      name: `List tools (expected ≥44, got ${toolCount})`,
      passed,
      duration_ms: Date.now() - t1,
      error: passed ? undefined : `Expected ≥44 tools, got ${toolCount}`,
    });

    // Tool names for validation
    const toolNames = new Set(toolsResponse.tools.map((t) => t.name));
    const requiredTools = [
      "nhanes_mean", "epwas_search", "ctd_triangulate", "cohort_list",
      "chemical_info", "nutrient_triangulate", "simpson_paradox_test",
      "exposure_compare", "confounder_check", "guideline_compare",
    ];
    for (const tool of requiredTools) {
      results.push({
        name: `Tool exists: ${tool}`,
        passed: toolNames.has(tool),
        duration_ms: 0,
        error: toolNames.has(tool) ? undefined : `Tool "${tool}" not found`,
      });
    }

    // ── List resources ──
    const t2 = Date.now();
    const resourcesResponse = await client.listResources();
    const resourceCount = resourcesResponse.resources.length;
    results.push({
      name: `List resources (expected ≥12, got ${resourceCount})`,
      passed: resourceCount >= 12,
      duration_ms: Date.now() - t2,
    });

    // ── EP-WAS search (the core query) ──
    const t3 = Date.now();
    try {
      const epwas = await client.callTool({
        name: "epwas_search",
        arguments: { exposure: "LBXBPB", phenotype: "LBXSUA", model_number: 6 },
      });
      const text = (epwas.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const hasResults = data.n_results > 0;
      results.push({
        name: `EP-WAS search (lead → uric acid): ${data.n_results} results`,
        passed: hasResults,
        duration_ms: Date.now() - t3,
        error: hasResults ? undefined : "No results returned",
      });
    } catch (err) {
      results.push({
        name: "EP-WAS search (lead → uric acid)",
        passed: false,
        duration_ms: Date.now() - t3,
        error: (err as Error).message,
      });
    }

    // ── Nutrient RCT evidence ──
    const t4 = Date.now();
    try {
      const rct = await client.callTool({
        name: "nutrient_rct_evidence",
        arguments: { nutrient: "vitamin D" },
      });
      const text = (rct.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const hasOutcomes = data.n_outcomes > 0;
      results.push({
        name: `Nutrient RCT evidence (vitamin D): ${data.n_outcomes} outcomes`,
        passed: hasOutcomes,
        duration_ms: Date.now() - t4,
        error: hasOutcomes ? undefined : "No outcomes returned",
      });
    } catch (err) {
      results.push({
        name: "Nutrient RCT evidence (vitamin D)",
        passed: false,
        duration_ms: Date.now() - t4,
        error: (err as Error).message,
      });
    }

    // ── Exposure compare ──
    const t5 = Date.now();
    try {
      const cmp = await client.callTool({
        name: "exposure_compare",
        arguments: {
          exposures: ["LBXPFOA", "LBXPFOS"],
          phenotype: "LBXSUA",
        },
      });
      const text = (cmp.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      results.push({
        name: `Exposure compare (PFOA+PFOS → uric acid): ${data.n_exposures_queried} queried`,
        passed: data.n_exposures_queried === 2,
        duration_ms: Date.now() - t5,
      });
    } catch (err) {
      results.push({
        name: "Exposure compare",
        passed: false,
        duration_ms: Date.now() - t5,
        error: (err as Error).message,
      });
    }

    // ── Chemical info ──
    const t6 = Date.now();
    try {
      const chem = await client.callTool({
        name: "chemical_info",
        arguments: { chemical: "lead" },
      });
      const text = (chem.content as Array<{ text: string }>)[0]?.text ?? "";
      results.push({
        name: "Chemical info (lead)",
        passed: text.length > 50,
        duration_ms: Date.now() - t6,
      });
    } catch (err) {
      results.push({
        name: "Chemical info (lead)",
        passed: false,
        duration_ms: Date.now() - t6,
        error: (err as Error).message,
      });
    }

    // ── Derived phenotypes: eGFR built-in + custom expression + list ──
    const t7 = Date.now();
    try {
      const egfr = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "egfr_smoke", recipe: "egfr_ckdepi", cycles: ["2015-2016","2017-2018"] },
      });
      const text = (egfr.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const ok = typeof data.handle_id === "string" && data.handle_id.startsWith("phen_") && data.n > 1000 && data.type === "continuous";
      results.push({
        name: `Phenotype derive (eGFR CKD-EPI): handle=${data.handle_id} n=${data.n}`,
        passed: ok,
        duration_ms: Date.now() - t7,
        error: ok ? undefined : `Unexpected result: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({
        name: "Phenotype derive (eGFR CKD-EPI)",
        passed: false,
        duration_ms: Date.now() - t7,
        error: (err as Error).message,
      });
    }

    const t8 = Date.now();
    try {
      const expr = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: {
          name: "tc_hdl_ratio",
          recipe: "expression",
          formula: "LBXTC / LBDHDD",
          source_variables: ["LBXTC", "LBDHDD"],
          cycles: ["2017-2018"],
        },
      });
      const text = (expr.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const ok = data.recipe === "expression" && data.n > 500 && data.type === "continuous";
      results.push({
        name: `Phenotype derive (TC/HDL expression): n=${data.n}`,
        passed: ok,
        duration_ms: Date.now() - t8,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({
        name: "Phenotype derive (TC/HDL expression)",
        passed: false,
        duration_ms: Date.now() - t8,
        error: (err as Error).message,
      });
    }

    const t9 = Date.now();
    let firstHandleId: string | null = null;
    try {
      const list = await client.callTool({ name: "phenotype_list", arguments: {} });
      const text = (list.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const ok = typeof data.n_handles === "number" && data.n_handles >= 2;
      firstHandleId = data.handles?.[0]?.handle_id ?? null;
      results.push({
        name: `Phenotype list: ${data.n_handles} handles in session`,
        passed: ok,
        duration_ms: Date.now() - t9,
      });
    } catch (err) {
      results.push({
        name: "Phenotype list",
        passed: false,
        duration_ms: Date.now() - t9,
        error: (err as Error).message,
      });
    }

    // ── Handle consumers: nhanes_mean / nhanes_model / nhanes_exwas with phenotype_handle ──
    const t10 = Date.now();
    try {
      const m = await client.callTool({
        name: "nhanes_mean",
        arguments: { phenotype_handle: "egfr_smoke" },
      });
      const text = (m.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const ok = typeof data.mean === "number" && data.mean > 50 && data.mean < 150;
      results.push({
        name: `nhanes_mean(phenotype_handle=egfr_smoke): mean=${data.mean?.toFixed?.(1)}`,
        passed: ok,
        duration_ms: Date.now() - t10,
      });
    } catch (err) {
      results.push({
        name: "nhanes_mean handle path",
        passed: false,
        duration_ms: Date.now() - t10,
        error: (err as Error).message,
      });
    }

    const t11 = Date.now();
    try {
      const m = await client.callTool({
        name: "nhanes_model",
        arguments: {
          phenotype_handle: "egfr_smoke",
          predictors: ["LBXBPB", "RIDAGEYR"],
        },
      });
      const text = (m.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const coefs = (data.coefficients ?? []) as Array<{ term: string; estimate: number; p_value: number }>;
      const ageRow = coefs.find((c) => c.term === "RIDAGEYR");
      const ok = data.n > 1000 && data.survey_weighted === true && ageRow !== undefined && ageRow.p_value < 1e-10;
      results.push({
        name: `nhanes_model(egfr_smoke ~ LBXBPB + RIDAGEYR): n=${data.n}, age p=${ageRow?.p_value?.toExponential?.(1)}`,
        passed: ok,
        duration_ms: Date.now() - t11,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({
        name: "nhanes_model handle path",
        passed: false,
        duration_ms: Date.now() - t11,
        error: (err as Error).message,
      });
    }

    // ── Exposome globe (anchor by BMI — the paper's example) ──
    const t13 = Date.now();
    try {
      const g = await client.callTool({
        name: "exposome_globe",
        arguments: {
          anchor_phenotype: { phenotype: "BMXBMI", top_n: 20 },
          threshold: 0.25,
        },
      });
      const text = (g.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const s = data?.summary;
      const ok = s && s.n_nodes >= 3 && s.n_edges >= 1
        && data.filters?.model_number === 2
        && Array.isArray(data.nodes) && data.nodes[0]?.layout_angle !== undefined
        && Array.isArray(data.categories);
      results.push({
        name: `exposome_globe(BMI anchor): ${s?.n_nodes} nodes, ${s?.n_edges} edges, ${s?.n_subcategories} subcategories`,
        passed: ok,
        duration_ms: Date.now() - t13,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 300)}`,
      });
    } catch (err) {
      results.push({
        name: "exposome_globe(BMI anchor)",
        passed: false,
        duration_ms: Date.now() - t13,
        error: (err as Error).message,
      });
    }

    // ── PHQ-9 depression screen ──
    const tD1 = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "phq9_smoke", recipe: "depression_screen_positive", cycles: ["2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const prev = data?.summary?.prevalence_weighted as number;
      // Published NHANES PHQ-9 ≥10 prevalence ~8%; sanity 4-14%
      const ok = data.type === "binary" && data.n > 2000 && prev > 0.04 && prev < 0.14;
      results.push({
        name: `Phenotype derive (PHQ-9 depression screen): n=${data.n}, prev=${(prev*100)?.toFixed?.(1)}%`,
        passed: ok,
        duration_ms: Date.now() - tD1,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive PHQ-9", passed: false, duration_ms: Date.now() - tD1, error: (err as Error).message });
    }

    // ── Frailty index (Rockwood-style 12-deficit count) ──
    const tFI = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "frailty_smoke", recipe: "frailty_class", cycles: ["2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const lv = data?.summary?.level_weighted_pct ?? {};
      const robust = lv["0"] as number;
      // Published NHANES all-adult: ~50-65% robust; sanity 35-75%
      const ok = data.type === "ordinal" && data.n > 2000 && robust > 35 && robust < 75;
      results.push({
        name: `Phenotype derive (frailty class): n=${data.n}, robust=${robust?.toFixed?.(1)}%`,
        passed: ok,
        duration_ms: Date.now() - tFI,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 250)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive frailty", passed: false, duration_ms: Date.now() - tFI, error: (err as Error).message });
    }

    // ── FRAX-style 10-year major osteoporotic fracture risk ──
    const tFR = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "frax_smoke", recipe: "frax_simplified", cycles: ["2015-2016","2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const wm = data?.summary?.weighted_mean as number;
      // US-adult 40-90 MOF 10-yr probability: weighted mean 5-15% expected
      const ok = data.type === "continuous" && data.n > 3000 && wm > 0.03 && wm < 0.20
        && typeof data.recipe_meta?.frax_relation === "string";
      results.push({
        name: `Phenotype derive (FRAX-simplified): n=${data.n}, wmean=${(wm*100)?.toFixed?.(1)}%`,
        passed: ok,
        duration_ms: Date.now() - tFR,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive FRAX-simplified", passed: false, duration_ms: Date.now() - tFR, error: (err as Error).message });
    }

    // ── eAG (estimated average glucose from HbA1c) ──
    const tE1 = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "eag_smoke", recipe: "eag", cycles: ["2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const wm = data?.summary?.weighted_mean as number;
      // US-adult HbA1c ~5.6% → eAG ~114 mg/dL; sanity 100-150
      const ok = data.type === "continuous" && data.n > 2000 && wm > 100 && wm < 150;
      results.push({
        name: `Phenotype derive (eAG): n=${data.n}, wmean=${wm?.toFixed?.(1)} mg/dL`,
        passed: ok,
        duration_ms: Date.now() - tE1,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive eAG", passed: false, duration_ms: Date.now() - tE1, error: (err as Error).message });
    }

    // ── ASCVD pooled-cohort 10-year risk (race+sex-specific) ──
    const tA1 = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "ascvd_smoke", recipe: "ascvd_10yr_risk", cycles: ["2015-2016","2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const wm = data?.summary?.weighted_mean as number;
      // US adults 40-79: PCE 10-yr risk weighted mean expected 5-15%
      const ok = data.type === "continuous" && data.n > 3000 && wm > 0.03 && wm < 0.20;
      results.push({
        name: `Phenotype derive (ASCVD 10-yr risk): n=${data.n}, wmean=${(wm*100)?.toFixed?.(1)}%`,
        passed: ok,
        duration_ms: Date.now() - tA1,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 250)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive ASCVD", passed: false, duration_ms: Date.now() - tA1, error: (err as Error).message });
    }

    // ── Clinical recipes spot-check: FIB-4 (liver fibrosis) ──
    const tF1 = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "fib4_smoke", recipe: "fib4", cycles: ["2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const wm = data?.summary?.weighted_mean as number;
      // FIB-4 median should be ~1 in US adults; weighted mean 0.8-1.5 sanity bound
      const ok = data.type === "continuous" && data.n > 4000 && wm > 0.5 && wm < 2.0;
      results.push({
        name: `Phenotype derive (FIB-4 liver fibrosis): n=${data.n}, wmean=${wm?.toFixed?.(2)}`,
        passed: ok,
        duration_ms: Date.now() - tF1,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive FIB-4", passed: false, duration_ms: Date.now() - tF1, error: (err as Error).message });
    }

    // ── FibroScan recipe spot-check: liver fibrosis class (cycle J only) ──
    const tF2 = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_phenotype_derive",
        arguments: { name: "fibroscan_smoke", recipe: "liver_fibrosis_class", cycles: ["2017-2018"] },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const f01 = data?.summary?.level_weighted_pct?.["0"] as number;
      // Most adults are F0-F1 (~90%+); sanity bound 75-99%
      const ok = data.type === "ordinal" && data.n > 1000 && f01 > 75 && f01 < 99;
      results.push({
        name: `Phenotype derive (FibroScan fibrosis class): n=${data.n}, F0-F1=${f01?.toFixed?.(1)}%`,
        passed: ok,
        duration_ms: Date.now() - tF2,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 200)}`,
      });
    } catch (err) {
      results.push({ name: "Phenotype derive FibroScan", passed: false, duration_ms: Date.now() - tF2, error: (err as Error).message });
    }

    // ── Scatter: eGFR vs LBXBPB (continuous outcome) ──
    const tS1 = Date.now();
    try {
      const r = await client.callTool({
        name: "nhanes_scatter",
        arguments: { phenotype_handle: "egfr_smoke", exposure: "LBXBPB", n_points: 500 },
      });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const fitOK = data.fit?.method === "loess" && Array.isArray(data.fit?.y) && data.fit.y.length > 50;
      const ptsOK = Array.isArray(data.points) && data.points.length > 100 && data.points.length <= 500;
      const ok = data.phenotype_type === "continuous" && data.exposure === "LBXBPB" && fitOK && ptsOK;
      results.push({
        name: `nhanes_scatter(continuous): ${data.points?.length} pts + LOESS, ρ=${data.summary?.spearman_rho}`,
        passed: ok,
        duration_ms: Date.now() - tS1,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 300)}`,
      });
    } catch (err) {
      results.push({ name: "nhanes_scatter continuous", passed: false, duration_ms: Date.now() - tS1, error: (err as Error).message });
    }

    // ── Stratified ExWAS (sex × 3 metals on derived eGFR) ──
    const t14 = Date.now();
    try {
      const sx = await client.callTool({
        name: "nhanes_exwas_stratified",
        arguments: {
          phenotype_handle: "egfr_smoke",
          exposures: ["LBXBPB", "LBXBCD", "LBXBMN"],
          stratify_by: "sex",
        },
      });
      const text = (sx.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const rs = (data.results ?? []) as Array<{ exposure: string; per_stratum: Record<string, { status: string; estimate?: number }> }>;
      const ok = data.n_results === 3
        && Array.isArray(data.stratifier_levels)
        && data.stratifier_levels.includes("male") && data.stratifier_levels.includes("female")
        && rs.every((r) => r.per_stratum?.male?.status === "ok" && r.per_stratum?.female?.status === "ok");
      results.push({
        name: `nhanes_exwas_stratified(egfr by sex, 3 metals): ${data.n_results}/${data.n_exposures_tested} fit`,
        passed: ok,
        duration_ms: Date.now() - t14,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 300)}`,
      });
    } catch (err) {
      results.push({
        name: "nhanes_exwas_stratified handle path",
        passed: false,
        duration_ms: Date.now() - t14,
        error: (err as Error).message,
      });
    }

    // ── Variance decomposition (m=2, 3 metals) — fast smoke ──
    const t12 = Date.now();
    try {
      const vd = await client.callTool({
        name: "nhanes_variance_decomposition",
        arguments: {
          phenotype_handle: "egfr_smoke",
          exposures: ["LBXBPB", "LBXBCD", "LBXBMN"],
          imputation: "mice",
          m: 2,
          maxit: 2,
        },
      });
      const text = (vd.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = JSON.parse(text);
      const baseR2 = data?.r2_baseline?.mean;
      const expR2 = data?.r2_expanded?.mean;
      const delta = data?.delta_r2;
      const ok = typeof baseR2 === "number" && typeof expR2 === "number" &&
                 typeof delta === "number" && data.n_exposures_loaded === 3 &&
                 expR2 >= baseR2 && delta >= 0;
      results.push({
        name: `nhanes_variance_decomposition(egfr ± 3 metals, m=2): R²base=${baseR2?.toFixed?.(3)}, R²ext=${expR2?.toFixed?.(3)}, ΔR²=${delta?.toFixed?.(4)}`,
        passed: ok,
        duration_ms: Date.now() - t12,
        error: ok ? undefined : `Unexpected: ${text.slice(0, 250)}`,
      });
    } catch (err) {
      results.push({
        name: "nhanes_variance_decomposition handle path",
        passed: false,
        duration_ms: Date.now() - t12,
        error: (err as Error).message,
      });
    }

  } catch (err) {
    results.push({
      name: "Server startup",
      passed: false,
      duration_ms: 0,
      error: (err as Error).message,
    });
  }

  // ── Report ──
  console.log("\n" + "=".repeat(70));
  console.log("ExposomeQL Smoke Test Results");
  console.log("=".repeat(70));

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const status = r.passed ? "✓ PASS" : "✗ FAIL";
    const time = r.duration_ms > 0 ? ` (${r.duration_ms}ms)` : "";
    console.log(`  ${status}  ${r.name}${time}`);
    if (r.error) console.log(`         ${r.error}`);
    if (r.passed) passed++;
    else failed++;
  }

  console.log("\n" + "-".repeat(70));
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("=".repeat(70));

  // Cleanup
  if (client) {
    try { await client.close(); } catch { /* ignore */ }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
