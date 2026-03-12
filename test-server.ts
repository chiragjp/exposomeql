import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ─── Expected response schemas ─────────────────────────────────────
// Each schema lists required top-level keys and optional nested checks.

interface FieldCheck {
  key: string;
  type?: "string" | "number" | "object" | "array" | "boolean";
  minLength?: number;       // for arrays
  nested?: FieldCheck[];    // for objects / array[0]
}

const SCHEMAS: Record<string, { args: Record<string, any>; fields: FieldCheck[] }> = {
  chemical_info: {
    args: { chemical: "PFOA" },
    fields: [
      { key: "chemical_name", type: "string" },
      { key: "cas_number" },
      { key: "dtxsid" },
      { key: "nhanes_variable_codes", type: "array" },
      { key: "hhear_code", type: "string" },
      { key: "biomarker_thresholds", type: "array" },
    ],
  },
  ctd_chemical_genes: {
    args: { chemical: "PFOA", biological_context: "lipid metabolism" },
    fields: [
      { key: "chemical", type: "string" },
      { key: "mesh_ids", type: "array" },
      { key: "biological_context", type: "string" },
      { key: "total_interactions", type: "number" },
      { key: "unique_genes", type: "number" },
      { key: "interactions", type: "array", minLength: 1 },
      { key: "source", type: "string" },
    ],
  },
  ctd_triangulate: {
    args: { exposure: "cadmium" },
    fields: [
      { key: "exposure", type: "string" },
      { key: "mesh_ids", type: "array", minLength: 1 },
      { key: "nhanes_vars", type: "array" },
      { key: "epwas_by_system", type: "object" },
      { key: "epwas_total_significant", type: "number" },
      { key: "hhear_cohort_evidence", type: "object", nested: [
        { key: "n_cohorts", type: "number" },
      ]},
      { key: "ctd_gene_by_system", type: "object" },
      { key: "directional_hypotheses", type: "array" },
      { key: "total_human_gene_interactions", type: "number" },
      { key: "interpretation", type: "string" },
      { key: "source", type: "string" },
    ],
  },
  epwas_reverse_triangulate: {
    args: { phenotype: "LBXGH" },
    fields: [
      { key: "phenotype", type: "string" },
      { key: "phenotype_description", type: "string" },
      { key: "model", type: "string" },
      { key: "p_threshold", type: "number" },
      { key: "total_significant_exposures", type: "number" },
      { key: "exposures", type: "array", minLength: 1, nested: [
        { key: "exposure_var", type: "string" },
        { key: "beta", type: "number" },
        { key: "direction", type: "string" },
        { key: "p_value", type: "number" },
        { key: "ctd_gene_count", type: "number" },
      ]},
      { key: "source", type: "string" },
    ],
  },
  cohort_chemical_availability: {
    args: { chemical: "cadmium" },
    fields: [
      { key: "chemical", type: "string" },
      { key: "hhear_codes", type: "array" },
      { key: "n_cohorts_available", type: "number" },
      { key: "n_cohorts_total", type: "number" },
      { key: "cohorts", type: "array", minLength: 1, nested: [
        { key: "cohort_id", type: "string" },
        { key: "n_participants", type: "number" },
      ]},
    ],
  },
  exposure_profile: {
    args: { chemical: "lead", age: 50, sex: "female" },
    fields: [
      { key: "chemical", type: "string" },
      { key: "nhanes_variable", type: "string" },
      { key: "demographic_profile", type: "object" },
      { key: "population_distribution", type: "object", nested: [
        { key: "n_unweighted", type: "number" },
        { key: "percentiles", type: "object" },
      ]},
      { key: "subgroup_distribution", type: "object", nested: [
        { key: "n_unweighted", type: "number" },
      ]},
      { key: "top_associations", type: "object", nested: [
        { key: "model", type: "string" },
        { key: "n_significant", type: "number" },
      ]},
      { key: "interpretation", type: "string" },
      { key: "source", type: "string" },
    ],
  },
  nhanes_mean: {
    args: { variable: "LBXBPB", cycles: ["J"] },
    fields: [
      { key: "mean", type: "number" },
      { key: "se", type: "number" },
      { key: "n_unweighted", type: "number" },
    ],
  },
};

// ─── Validation logic ───────────────────────────────────────────────

function validateFields(data: any, fields: FieldCheck[], path: string): string[] {
  const errors: string[] = [];
  for (const f of fields) {
    const fullPath = `${path}.${f.key}`;
    if (!(f.key in data)) {
      errors.push(`missing key: ${fullPath}`);
      continue;
    }
    const val = data[f.key];
    if (val === null || val === undefined) continue; // nullable is ok

    if (f.type === "array") {
      if (!Array.isArray(val)) {
        errors.push(`${fullPath}: expected array, got ${typeof val}`);
      } else {
        if (f.minLength !== undefined && val.length < f.minLength) {
          errors.push(`${fullPath}: expected length >= ${f.minLength}, got ${val.length}`);
        }
        if (f.nested && val.length > 0) {
          errors.push(...validateFields(val[0], f.nested, `${fullPath}[0]`));
        }
      }
    } else if (f.type === "object") {
      if (typeof val !== "object" || Array.isArray(val)) {
        errors.push(`${fullPath}: expected object, got ${Array.isArray(val) ? "array" : typeof val}`);
      } else if (f.nested) {
        errors.push(...validateFields(val, f.nested, fullPath));
      }
    } else if (f.type && typeof val !== f.type) {
      errors.push(`${fullPath}: expected ${f.type}, got ${typeof val}`);
    }
  }
  return errors;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`Connected: ${tools.tools.length} tools registered\n`);

  // Verify all expected tools exist
  const toolNames = new Set(tools.tools.map((t) => t.name));
  const expectedTools = Object.keys(SCHEMAS);
  for (const name of expectedTools) {
    if (!toolNames.has(name)) {
      console.log(`FAIL  ${name} — not registered`);
    }
  }

  let passed = 0;
  let failed = 0;

  for (const [name, schema] of Object.entries(SCHEMAS)) {
    process.stdout.write(`  ${name}...`);
    try {
      const result = await client.callTool({ name, arguments: schema.args });
      const text = (result.content as any)[0]?.text ?? "";

      if (result.isError) {
        console.log(` FAIL (tool error: ${text.substring(0, 100)})`);
        failed++;
        continue;
      }

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        console.log(` FAIL (response not JSON: ${text.substring(0, 80)}...)`);
        failed++;
        continue;
      }

      const errors = validateFields(data, schema.fields, name);
      if (errors.length > 0) {
        console.log(` FAIL`);
        for (const err of errors) console.log(`    ${err}`);
        failed++;
      } else {
        // Print a summary value
        const summary = getSummary(name, data);
        console.log(` PASS ${summary}`);
        passed++;
      }
    } catch (e: any) {
      console.log(` FAIL (threw: ${e.message.substring(0, 100)})`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tools`);
  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

function getSummary(name: string, data: any): string {
  switch (name) {
    case "chemical_info":
      return `(${data.chemical_name}, ${data.biomarker_thresholds?.length || 0} thresholds)`;
    case "ctd_chemical_genes":
      return `(${data.total_interactions} interactions, ${data.unique_genes} genes)`;
    case "ctd_triangulate":
      return `(${data.epwas_total_significant} EP-WAS hits, ${data.hhear_cohort_evidence?.n_cohorts || 0} cohorts, ${data.total_human_gene_interactions} gene interactions)`;
    case "epwas_reverse_triangulate":
      return `(${data.total_significant_exposures} exposures for ${data.phenotype})`;
    case "cohort_chemical_availability":
      return `(${data.n_cohorts_available} cohorts for ${data.chemical})`;
    case "exposure_profile":
      return `(pop n=${data.population_distribution?.n_unweighted}, subgroup n=${data.subgroup_distribution?.n_unweighted})`;
    case "nhanes_mean":
      return `(mean=${data.mean}, n=${data.n_unweighted})`;
    default:
      return "";
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
