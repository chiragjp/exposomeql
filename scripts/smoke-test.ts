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
