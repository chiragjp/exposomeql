// Deterministic scoring layer.
//
// For each run record under eval/runs/<timestamp>/:
//   1. Match the prompt's required_terms regex list against final_text.
//   2. Match forbidden_terms; any match = fail.
//   3. Match required_tools regex list against the tool trace (with_mcp arm only).
// Writes <id>__<arm>.scored.json next to the input.
//
// LLM-judge layer is a separate pass (not implemented in this starter); the
// deterministic layer is sufficient for a first comparative report.

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";
import type { PromptSpec, RunResult, ScoredRun, DeterministicScore } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");
const RUNS_DIR = path.join(__dirname, "runs");

function loadPromptIndex(): Map<string, PromptSpec> {
  const idx = new Map<string, PromptSpec>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".yaml") || e.name.endsWith(".yml")) {
        const spec = yaml.load(fs.readFileSync(p, "utf8")) as PromptSpec;
        idx.set(spec.id, spec);
      }
    }
  };
  walk(PROMPTS_DIR);
  return idx;
}

function scoreOne(spec: PromptSpec, run: RunResult): DeterministicScore {
  const text = run.final_text ?? "";
  const required = spec.deterministic_checks?.required_terms ?? [];
  const forbidden = spec.deterministic_checks?.forbidden_terms ?? [];
  const requiredTools = spec.required_tools ?? [];

  const required_present = required.map((term) => ({
    term,
    matched: new RegExp(term, "i").test(text),
  }));
  const forbidden_absent = forbidden.map((term) => ({
    term,
    matched: new RegExp(term, "i").test(text),
  }));

  // Tool checks only meaningful for the with_mcp arm.
  const calledNames = run.tool_trace.map((t) => t.name);
  const required_tools_called =
    run.arm === "with_mcp"
      ? requiredTools.map((pat) => ({
          tool_pattern: pat,
          called: calledNames.some((n) => new RegExp(`^(${pat})$`).test(n)),
        }))
      : [];

  const allRequiredMet = required_present.every((r) => r.matched);
  const noForbidden = forbidden_absent.every((r) => !r.matched);
  const allToolsMet = required_tools_called.every((r) => r.called);

  return {
    required_present,
    forbidden_absent,
    required_tools_called,
    pass: allRequiredMet && noForbidden && (run.arm === "without_mcp" || allToolsMet),
  };
}

function findLatestRunDir(): string {
  const dirs = fs.readdirSync(RUNS_DIR).filter((d) => {
    const full = path.join(RUNS_DIR, d);
    return fs.statSync(full).isDirectory();
  });
  if (dirs.length === 0) throw new Error("No runs found");
  dirs.sort();
  return path.join(RUNS_DIR, dirs[dirs.length - 1]);
}

function scoreOneTextOnly(spec: PromptSpec, run: RunResult): DeterministicScore {
  const text = run.final_text ?? "";
  const required = spec.deterministic_checks?.required_terms ?? [];
  const forbidden = spec.deterministic_checks?.forbidden_terms ?? [];

  const required_present = required.map((term) => ({
    term,
    matched: new RegExp(term, "i").test(text),
  }));
  const forbidden_absent = forbidden.map((term) => ({
    term,
    matched: new RegExp(term, "i").test(text),
  }));

  return {
    required_present,
    forbidden_absent,
    required_tools_called: [],
    pass: required_present.every((r) => r.matched) && forbidden_absent.every((r) => !r.matched),
  };
}

function main() {
  const textOnly = process.argv.includes("--text-only");
  const target = (() => {
    const explicit = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);
    return explicit ? path.resolve(explicit) : findLatestRunDir();
  })();
  console.error(`[score] Scoring run dir: ${target}${textOnly ? " (text-only mode)" : ""}`);
  const idx = loadPromptIndex();

  const files = fs.readdirSync(target).filter((f) => f.endsWith(".json") && !f.endsWith(".scored.json"));
  let pass = 0;
  let fail = 0;
  for (const f of files) {
    const run = JSON.parse(fs.readFileSync(path.join(target, f), "utf8")) as RunResult;
    const spec = idx.get(run.prompt_id);
    if (!spec) {
      console.error(`[score] WARN no spec for ${run.prompt_id}, skipping`);
      continue;
    }
    const det = textOnly ? scoreOneTextOnly(spec, run) : scoreOne(spec, run);
    const scored: ScoredRun = { ...run, deterministic: det };
    const outPath = path.join(target, f.replace(/\.json$/, ".scored.json"));
    fs.writeFileSync(outPath, JSON.stringify(scored, null, 2));
    if (det.pass) pass++;
    else fail++;
    console.error(`[score] ${run.prompt_id} ${run.arm}: ${det.pass ? "PASS" : "FAIL"}`);
  }
  console.error(`[score] ${pass} pass, ${fail} fail`);
}

main();
