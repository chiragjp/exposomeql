import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
  const client = new Client({ name: "nutrient-scope", version: "0.1.0" });
  await client.connect(transport);

  // 1. Search for dietary/nutrient variables in NHANES
  const searches = [
    "vitamin", "folate", "iron", "calcium", "zinc", "selenium",
    "omega", "fiber", "sodium", "potassium", "magnesium",
    "vitamin D", "vitamin A", "vitamin C", "vitamin E", "vitamin B12",
    "carotenoid", "lycopene", "retinol"
  ];

  // 2. Check which nutrients are in the EP-WAS catalog (have associations)
  console.log("=== NUTRIENT BIOMARKERS IN EP-WAS ===");
  const nutrientVars = await client.callTool({ 
    name: "epwas_search", 
    arguments: { exposure: "vitamin", model: 6, p_threshold: 0.00001 } 
  });
  const nvText = (nutrientVars.content as any)[0]?.text ?? "";
  const nvData = JSON.parse(nvText);
  console.log(`Vitamin search: ${nvData.total_associations || nvData.n_results || 'N/A'} associations`);
  if (nvData.associations) {
    const uniqueExposures = [...new Set(nvData.associations.map((a: any) => `${a.exposure_var || a.evarname} (${a.exposure_description || ''})`))];
    console.log(`Unique vitamin exposure variables: ${uniqueExposures.length}`);
    for (const e of uniqueExposures.slice(0, 20)) console.log(`  ${e}`);
  }

  // 3. Check dietary variables
  console.log("\n=== DIETARY INTAKE VARIABLES ===");
  const dietVars = await client.callTool({
    name: "epwas_search",
    arguments: { exposure: "dietary", model: 6, p_threshold: 0.00001 }
  });
  const dText = (dietVars.content as any)[0]?.text ?? "";
  const dData = JSON.parse(dText);
  console.log(`Dietary search: ${dData.total_associations || dData.n_results || 'N/A'} associations`);
  if (dData.associations) {
    const uniqueDiet = [...new Set(dData.associations.map((a: any) => `${a.exposure_var || a.evarname} (${a.exposure_description || ''})`))];
    console.log(`Unique dietary variables: ${uniqueDiet.length}`);
    for (const e of uniqueDiet.slice(0, 30)) console.log(`  ${e}`);
  }

  // 4. Check CTD coverage for nutrients
  console.log("\n=== CTD COVERAGE FOR NUTRIENTS ===");
  const nutrients = ["vitamin D", "retinol", "folate", "selenium", "zinc", "iron", "calcium", "magnesium", "vitamin C", "vitamin E", "omega-3", "vitamin B12", "niacin", "thiamine"];
  for (const n of nutrients) {
    try {
      const result = await client.callTool({ name: "ctd_chemical_genes", arguments: { chemical: n } });
      const text = (result.content as any)[0]?.text ?? "";
      if (text.startsWith("{")) {
        const data = JSON.parse(text);
        console.log(`  ${n}: ${data.total_interactions || 0} gene interactions, ${data.unique_genes || 0} unique genes`);
      } else {
        console.log(`  ${n}: ${text.substring(0, 80)}`);
      }
    } catch (e: any) {
      console.log(`  ${n}: ERROR - ${e.message.substring(0, 60)}`);
    }
  }

  // 5. Check what nutrient-related chemical_info exists
  console.log("\n=== CHEMICAL_INFO FOR NUTRIENTS ===");
  const nutrientChems = ["vitamin D", "selenium", "zinc", "iron", "folate", "retinol", "calcium"];
  for (const n of nutrientChems) {
    try {
      const result = await client.callTool({ name: "chemical_info", arguments: { chemical: n } });
      const text = (result.content as any)[0]?.text ?? "";
      if (text.startsWith("{")) {
        const data = JSON.parse(text);
        console.log(`  ${n}: ${data.chemical_name || 'found'}, NHANES codes: ${JSON.stringify(data.nhanes_variable_codes?.map((v: any) => v.code) || [])}`);
      } else {
        console.log(`  ${n}: ${text.substring(0, 100)}`);
      }
    } catch {
      console.log(`  ${n}: not found`);
    }
  }

  // 6. Reverse triangulate a key nutrition outcome - vitamin D
  console.log("\n=== REVERSE TRIANGULATE: VITAMIN D (LBDVIDMS) ===");
  const vitD = await client.callTool({ name: "epwas_reverse_triangulate", arguments: { phenotype: "LBDVIDMS" } });
  const vitDText = (vitD.content as any)[0]?.text ?? "";
  const vitDData = JSON.parse(vitDText);
  console.log(`Total significant exposures for vitamin D: ${vitDData.total_significant_exposures}`);
  if (vitDData.exposures) {
    for (const e of vitDData.exposures.slice(0, 15)) {
      console.log(`  ${e.exposure_var} (${e.exposure_description}): β=${e.beta}, p=${e.p_value.toExponential(2)}, dir=${e.direction}, CTD=${e.ctd_gene_count}, HHEAR=${e.hhear_n_cohorts}`);
    }
  }

  await client.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
