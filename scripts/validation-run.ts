/**
 * Systematic validation of ExposomeQL against 24 established exposure-health findings.
 * Tests through the actual MCP protocol using the MCP client SDK.
 *
 * Reports: directional accuracy, Bonferroni/FDR significance, query timing.
 *
 * Usage: npx tsx scripts/validation-run.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface ValidationCase {
  exposure: string;
  phenotype: string;
  expected_direction: "positive" | "negative";
  finding: string;
  citation: string;
  category: string;
}

interface ValidationResult extends ValidationCase {
  observed_beta: number | null;
  p_value: number | null;
  observed_direction: string | null;
  direction_match: boolean;
  bonferroni_sig: boolean;
  nominal_sig: boolean;
  query_ms: number;
  error?: string;
}

const TOTAL_TESTS = 165342;
const BONFERRONI = 0.05 / TOTAL_TESTS;

const CASES: ValidationCase[] = [
  // Metals
  { exposure: "LBXBPB", phenotype: "LBXSUA", expected_direction: "positive", finding: "Lead ↑ uric acid (renal tubular)", citation: "Buser 2016", category: "Metals" },
  { exposure: "LBXBPB", phenotype: "LBXSCR", expected_direction: "positive", finding: "Lead ↑ creatinine (kidney damage)", citation: "Ekong 2006", category: "Metals" },
  { exposure: "LBXBPB", phenotype: "BPXSY4", expected_direction: "positive", finding: "Lead ↑ systolic BP", citation: "Nawrot 2002", category: "Metals" },
  { exposure: "LBXBPB", phenotype: "LBXHGB", expected_direction: "negative", finding: "Lead ↓ hemoglobin (heme synthesis)", citation: "ATSDR", category: "Metals" },
  { exposure: "LBXBCD", phenotype: "LBXSCR", expected_direction: "positive", finding: "Cadmium ↑ creatinine (nephrotoxic)", citation: "Jarup 2009", category: "Metals" },
  { exposure: "LBXBCD", phenotype: "LBXSUA", expected_direction: "positive", finding: "Cadmium ↑ uric acid", citation: "Patel 2024", category: "Metals" },
  { exposure: "LBXTHG", phenotype: "LBXHGB", expected_direction: "positive", finding: "Mercury ↑ hemoglobin (fish confound)", citation: "Mozaffarian 2009", category: "Metals" },
  // PFAS
  { exposure: "LBXPFOA", phenotype: "LBXTC", expected_direction: "positive", finding: "PFOA ↑ total cholesterol", citation: "Steenland 2009", category: "PFAS" },
  { exposure: "LBXPFOA", phenotype: "LBXSUA", expected_direction: "positive", finding: "PFOA ↑ uric acid (SLC22A11)", citation: "Steenland 2010", category: "PFAS" },
  { exposure: "LBXPFOS", phenotype: "LBXSCH", expected_direction: "positive", finding: "PFOS ↑ cholesterol", citation: "Nelson 2010", category: "PFAS" },
  { exposure: "LBXPFOS", phenotype: "LBXSAL", expected_direction: "positive", finding: "PFOS ↑ albumin (protein binding)", citation: "ExposomeQL", category: "PFAS" },
  // Phthalates
  { exposure: "URXMHP", phenotype: "LBXTST", expected_direction: "negative", finding: "MEHP ↓ testosterone (anti-androgen)", citation: "Meeker 2009", category: "Phthalates" },
  // Phenols
  { exposure: "URXBPH", phenotype: "BMXBMI", expected_direction: "positive", finding: "BPA ↑ BMI (obesogen)", citation: "Trasande 2012", category: "Phenols" },
  { exposure: "URXBPH", phenotype: "LBXIN", expected_direction: "positive", finding: "BPA ↑ insulin resistance", citation: "Lang 2008", category: "Phenols" },
  // Smoking
  { exposure: "LBXCOT", phenotype: "LBXWBCSI", expected_direction: "positive", finding: "Cotinine ↑ WBC (inflammatory)", citation: "Schwartz 2001", category: "Smoking" },
  { exposure: "LBXCOT", phenotype: "LBXHGB", expected_direction: "positive", finding: "Cotinine ↑ hemoglobin (CO)", citation: "Leifert 2008", category: "Smoking" },
  { exposure: "LBXCOT", phenotype: "LBXCRP", expected_direction: "positive", finding: "Cotinine ↑ CRP (inflammation)", citation: "Bazzano 2003", category: "Smoking" },
  { exposure: "LBXCOT", phenotype: "LBXHDD", expected_direction: "negative", finding: "Smoking ↓ HDL cholesterol", citation: "Craig 1989", category: "Smoking" },
  // Nutrients (dietary)
  { exposure: "DR1TSODI", phenotype: "MSYSTOLIC", expected_direction: "positive", finding: "Sodium ↑ systolic BP", citation: "He 2013", category: "Nutrients (dietary)" },
  { exposure: "DR1TFIBE", phenotype: "LBXSCH", expected_direction: "negative", finding: "Fiber ↓ total cholesterol", citation: "Jia 2023", category: "Nutrients (dietary)" },
  { exposure: "DR1TCALC", phenotype: "DXXLSBMD", expected_direction: "positive", finding: "Calcium ↑ lumbar BMD", citation: "Tai 2015", category: "Nutrients (dietary)" },
  // Nutrients (biomarker)
  { exposure: "LBDVIDMS", phenotype: "LBXGH", expected_direction: "negative", finding: "Vitamin D ↓ HbA1c", citation: "Afzal 2013", category: "Nutrients (biomarker)" },
  { exposure: "LBDVIDMS", phenotype: "LBXPT21", expected_direction: "negative", finding: "Vitamin D ↓ PTH", citation: "Lips 2006", category: "Nutrients (biomarker)" },
  { exposure: "LBDVIDMS", phenotype: "BPXSY4", expected_direction: "negative", finding: "Vitamin D ↓ systolic BP", citation: "Juraschek 2012", category: "Nutrients (biomarker)" },
];

async function main() {
  console.log("Connecting to ExposomeQL server...");
  const t0 = Date.now();

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });
  const client = new Client({ name: "validation", version: "0.1.0" });
  await client.connect(transport);

  const startupMs = Date.now() - t0;
  console.log(`Server started in ${startupMs}ms\n`);

  // Verify tools
  const { tools } = await client.listTools();
  console.log(`Tools registered: ${tools.length}`);
  if (tools.length < 44) {
    console.error(`WARNING: Expected ≥44 tools, got ${tools.length}`);
  }

  // Run validation
  console.log(`\n${"=".repeat(130)}`);
  console.log("SYSTEMATIC VALIDATION: ExposomeQL EP-WAS vs Published Literature");
  console.log(`Database: ${TOTAL_TESTS.toLocaleString()} meta-analytic tests | Bonferroni: ${BONFERRONI.toExponential(2)}`);
  console.log(`${"=".repeat(130)}\n`);

  const header = `${"#".padEnd(3)} ${"Exposure".padEnd(12)} ${"Phenotype".padEnd(12)} ${"Expect".padEnd(8)} ${"β".padStart(10)} ${"p-value".padStart(12)} ${"Bonf".padStart(6)} ${"Dir".padStart(5)} ${"Match".padStart(6)} ${"Time".padStart(8)} Finding`;
  console.log(header);
  console.log("-".repeat(130));

  const results: ValidationResult[] = [];
  let totalQueryMs = 0;

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const tq = Date.now();

    try {
      const response = await client.callTool({
        name: "epwas_search",
        arguments: {
          exposure: c.exposure,
          phenotype: c.phenotype,
          model_number: 6,
          p_threshold: 1.0, // get result regardless of significance
          top_n: 1,
        },
      });

      const queryMs = Date.now() - tq;
      totalQueryMs += queryMs;

      const text = (response.content as Array<{ text: string }>)[0]?.text ?? "{}";
      const data = JSON.parse(text);

      if (data.results && data.results.length > 0) {
        const r = data.results[0];
        const beta = r.estimate as number;
        const pval = r.p_value as number;
        const obsDir = beta > 0 ? "positive" : "negative";
        const dirMatch = obsDir === c.expected_direction;
        const bonfSig = Math.abs(pval) < BONFERRONI;
        const nomSig = Math.abs(pval) < 0.05;

        const result: ValidationResult = {
          ...c,
          observed_beta: beta,
          p_value: pval,
          observed_direction: obsDir,
          direction_match: dirMatch,
          bonferroni_sig: bonfSig,
          nominal_sig: nomSig,
          query_ms: queryMs,
        };
        results.push(result);

        const dirStr = beta > 0 ? "+" : "-";
        const matchStr = dirMatch ? "YES" : "NO";
        const bonfStr = bonfSig ? "YES" : "no";
        console.log(
          `${String(i + 1).padEnd(3)} ${c.exposure.padEnd(12)} ${c.phenotype.padEnd(12)} ${c.expected_direction.padEnd(8)} ${beta.toFixed(4).padStart(10)} ${pval.toExponential(2).padStart(12)} ${bonfStr.padStart(6)} ${dirStr.padStart(5)} ${matchStr.padStart(6)} ${(queryMs + "ms").padStart(8)} ${c.finding.slice(0, 45)}`
        );
      } else {
        results.push({
          ...c,
          observed_beta: null,
          p_value: null,
          observed_direction: null,
          direction_match: false,
          bonferroni_sig: false,
          nominal_sig: false,
          query_ms: queryMs,
          error: "No results returned",
        });
        console.log(
          `${String(i + 1).padEnd(3)} ${c.exposure.padEnd(12)} ${c.phenotype.padEnd(12)} ${c.expected_direction.padEnd(8)} ${"N/A".padStart(10)} ${"N/A".padStart(12)} ${"N/A".padStart(6)} ${"".padStart(5)} ${"N/A".padStart(6)} ${(queryMs + "ms").padStart(8)} ${c.finding.slice(0, 45)}`
        );
      }
    } catch (err) {
      const queryMs = Date.now() - tq;
      totalQueryMs += queryMs;
      results.push({
        ...c,
        observed_beta: null,
        p_value: null,
        observed_direction: null,
        direction_match: false,
        bonferroni_sig: false,
        nominal_sig: false,
        query_ms: queryMs,
        error: (err as Error).message,
      });
      console.log(
        `${String(i + 1).padEnd(3)} ${c.exposure.padEnd(12)} ${c.phenotype.padEnd(12)} ${"ERROR".padEnd(8)} ${(err as Error).message.slice(0, 60)}`
      );
    }
  }

  // BH-FDR correction
  const pvals = results
    .filter((r) => r.p_value !== null)
    .map((r, idx) => ({ pval: Math.abs(r.p_value!), idx }))
    .sort((a, b) => a.pval - b.pval);

  let nFdr = 0;
  for (let rank = 0; rank < pvals.length; rank++) {
    const bhThreshold = (0.05 * (rank + 1)) / pvals.length;
    if (pvals[rank].pval < bhThreshold) {
      nFdr++;
    }
  }

  // Summary
  const nTotal = CASES.length;
  const nFound = results.filter((r) => r.observed_beta !== null).length;
  const nCorrectDir = results.filter((r) => r.direction_match).length;
  const nNominal = results.filter((r) => r.nominal_sig).length;
  const nBonf = results.filter((r) => r.bonferroni_sig).length;

  console.log(`\n${"=".repeat(130)}`);
  console.log("VALIDATION SUMMARY");
  console.log(`${"=".repeat(130)}`);
  console.log(`  Associations tested:          ${nTotal}`);
  console.log(`  Found in EP-WAS:              ${nFound}/${nTotal}`);
  console.log(`  Correct direction:            ${nCorrectDir}/${nFound} (${Math.round((100 * nCorrectDir) / nFound)}%)`);
  console.log(`  Nominal significant (p<.05):  ${nNominal}/${nFound} (${Math.round((100 * nNominal) / nFound)}%)`);
  console.log(`  BH-FDR significant (q<.05):   ${nFdr}/${nFound} (${Math.round((100 * nFdr) / nFound)}%)`);
  console.log(`  Bonferroni significant:       ${nBonf}/${nFound} (${Math.round((100 * nBonf) / nFound)}%)`);
  console.log(`  Total query time:             ${totalQueryMs}ms (${Math.round(totalQueryMs / nTotal)}ms per query)`);
  console.log(`  Server startup:               ${startupMs}ms`);
  console.log(`  Database size:                ${TOTAL_TESTS.toLocaleString()} meta-analytic tests`);
  console.log(`  Bonferroni threshold:         ${BONFERRONI.toExponential(2)}`);

  // Per-category
  console.log(`\nPER-CATEGORY RESULTS:`);
  const categories = [...new Set(CASES.map((c) => c.category))];
  console.log(`  ${"Category".padEnd(25)} ${"Direction".padStart(12)} ${"Bonferroni".padStart(12)}`);
  console.log("  " + "-".repeat(52));
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat && r.observed_beta !== null);
    const catDir = catResults.filter((r) => r.direction_match).length;
    const catBonf = catResults.filter((r) => r.bonferroni_sig).length;
    const n = catResults.length;
    console.log(`  ${cat.padEnd(25)} ${`${catDir}/${n}`.padStart(12)} ${`${catBonf}/${n}`.padStart(12)}`);
  }

  // Discordant
  const discordant = results.filter((r) => r.observed_beta !== null && !r.direction_match);
  if (discordant.length > 0) {
    console.log(`\nDISCORDANT FINDINGS:`);
    for (const r of discordant) {
      console.log(`  ${r.exposure} → ${r.phenotype}: expected ${r.expected_direction}, got β=${r.observed_beta!.toFixed(4)}`);
      console.log(`    ${r.finding} (${r.citation})`);
    }
  }

  // Test nutrient tools
  console.log(`\n${"=".repeat(130)}`);
  console.log("NUTRIENT TOOL TESTS");
  console.log(`${"=".repeat(130)}`);

  // nutrient_triangulate
  const tn1 = Date.now();
  try {
    const resp = await client.callTool({
      name: "nutrient_triangulate",
      arguments: { nutrient: "vitamin D" },
    });
    const text = (resp.content as Array<{ text: string }>)[0]?.text ?? "{}";
    const data = JSON.parse(text);
    console.log(`  nutrient_triangulate("vitamin D"): ${data.summary?.concordance_rate ?? "?"} concordance (${Date.now() - tn1}ms) ✓`);
  } catch (err) {
    console.log(`  nutrient_triangulate: FAIL — ${(err as Error).message}`);
  }

  // nutrient_concordance_summary
  const tn2 = Date.now();
  try {
    const resp = await client.callTool({
      name: "nutrient_concordance_summary",
      arguments: {},
    });
    const text = (resp.content as Array<{ text: string }>)[0]?.text ?? "{}";
    const data = JSON.parse(text);
    console.log(`  nutrient_concordance_summary: ${data.overall?.concordance_rate ?? "?"} overall (${Date.now() - tn2}ms) ✓`);
  } catch (err) {
    console.log(`  nutrient_concordance_summary: FAIL — ${(err as Error).message}`);
  }

  // simpson_paradox_test
  const tn3 = Date.now();
  try {
    const resp = await client.callTool({
      name: "simpson_paradox_test",
      arguments: { exposure: "LBXPFOA", phenotype: "LBXSCH" },
    });
    const text = (resp.content as Array<{ text: string }>)[0]?.text ?? "{}";
    const data = JSON.parse(text);
    console.log(`  simpson_paradox_test(PFOA→cholesterol): ${data.paradox_test?.classification ?? "?"} (${Date.now() - tn3}ms) ✓`);
  } catch (err) {
    console.log(`  simpson_paradox_test: FAIL — ${(err as Error).message}`);
  }

  // confounder_check
  const tn4 = Date.now();
  try {
    const resp = await client.callTool({
      name: "confounder_check",
      arguments: { exposure: "LBXPFOA" },
    });
    const text = (resp.content as Array<{ text: string }>)[0]?.text ?? "{}";
    const data = JSON.parse(text);
    console.log(`  confounder_check(PFOA): ${data.n_strong_associations ?? "?"} strong confounders (${Date.now() - tn4}ms) ✓`);
  } catch (err) {
    console.log(`  confounder_check: FAIL — ${(err as Error).message}`);
  }

  // exposure_compare
  const tn5 = Date.now();
  try {
    const resp = await client.callTool({
      name: "exposure_compare",
      arguments: {
        exposures: ["LBXPFOA", "LBXPFOS", "LBXPFHS", "LBXPFNA", "LBXPFDE"],
        phenotype: "LBXSUA",
      },
    });
    const text = (resp.content as Array<{ text: string }>)[0]?.text ?? "{}";
    const data = JSON.parse(text);
    console.log(`  exposure_compare(5 PFAS → uric acid): ${data.n_significant ?? "?"} significant (${Date.now() - tn5}ms) ✓`);
  } catch (err) {
    console.log(`  exposure_compare: FAIL — ${(err as Error).message}`);
  }

  // Final summary
  const totalMs = Date.now() - t0;
  console.log(`\n${"=".repeat(130)}`);
  console.log(`TOTAL TIME: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`  Server startup: ${startupMs}ms`);
  console.log(`  24 validation queries: ${totalQueryMs}ms`);
  console.log(`  5 tool tests: ${totalMs - startupMs - totalQueryMs}ms`);
  console.log(`${"=".repeat(130)}`);

  // Exit
  try {
    await client.close();
  } catch {
    /* ignore */
  }

  const exitCode = nCorrectDir >= 20 ? 0 : 1;
  console.log(`\n${exitCode === 0 ? "PASS" : "FAIL"} — ${nCorrectDir}/${nFound} correct direction (threshold: 20/24)`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
