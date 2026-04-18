// Aggregator: turns a directory of *.scored.json files into a Markdown report
// + CSV. Pairs with_mcp vs without_mcp by prompt_id and reports per-category
// pass rates and the 2x2 (right_answer × right_process).
//
// Usage:
//   npm run eval:report                         # latest run dir
//   npm run eval:report -- eval/runs/<dir>      # specific run dir

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ScoredRun } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "runs");
const REPORTS_DIR = path.join(__dirname, "reports");

function findLatestRunDir(): string {
  const dirs = fs.readdirSync(RUNS_DIR).filter((d) => fs.statSync(path.join(RUNS_DIR, d)).isDirectory());
  if (dirs.length === 0) throw new Error("No runs found");
  dirs.sort();
  return path.join(RUNS_DIR, dirs[dirs.length - 1]);
}

interface PairedRow {
  id: string;
  category: string;
  with_pass: boolean | null;
  without_pass: boolean | null;
  with_tools_called: number;
  without_tools_called: number;
  with_tokens: number;
  without_tokens: number;
  with_latency_ms: number;
  without_latency_ms: number;
}

function loadScored(dir: string): ScoredRun[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".scored.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as ScoredRun);
}

function pair(runs: ScoredRun[]): PairedRow[] {
  const byId = new Map<string, { with?: ScoredRun; without?: ScoredRun }>();
  for (const r of runs) {
    const slot = byId.get(r.prompt_id) ?? {};
    if (r.arm === "with_mcp") slot.with = r;
    else slot.without = r;
    byId.set(r.prompt_id, slot);
  }
  const rows: PairedRow[] = [];
  for (const [id, slot] of byId) {
    rows.push({
      id,
      category: (slot.with ?? slot.without)!.category,
      with_pass: slot.with ? slot.with.deterministic.pass : null,
      without_pass: slot.without ? slot.without.deterministic.pass : null,
      with_tools_called: slot.with ? slot.with.tool_trace.length : 0,
      without_tools_called: slot.without ? slot.without.tool_trace.length : 0,
      with_tokens: slot.with ? slot.with.input_tokens + slot.with.output_tokens : 0,
      without_tokens: slot.without ? slot.without.input_tokens + slot.without.output_tokens : 0,
      with_latency_ms: slot.with ? slot.with.latency_ms : 0,
      without_latency_ms: slot.without ? slot.without.latency_ms : 0,
    });
  }
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  return rows;
}

function pct(num: number, den: number): string {
  if (den === 0) return "n/a";
  return `${((100 * num) / den).toFixed(0)}%`;
}

function buildMarkdown(runDir: string, rows: PairedRow[]): string {
  const lines: string[] = [];
  lines.push(`# ExposomeQL eval report`);
  lines.push(``);
  lines.push(`Run dir: \`${runDir}\``);
  lines.push(`Total prompts: ${rows.length}`);
  lines.push(``);

  // Aggregate by category
  const byCat = new Map<string, PairedRow[]>();
  for (const r of rows) {
    const arr = byCat.get(r.category) ?? [];
    arr.push(r);
    byCat.set(r.category, arr);
  }

  lines.push(`## Pass rate by category`);
  lines.push(``);
  lines.push(`| Category | n | with_mcp pass | without_mcp pass | Δ |`);
  lines.push(`|---|---|---|---|---|`);
  for (const [cat, arr] of [...byCat.entries()].sort()) {
    const w = arr.filter((r) => r.with_pass).length;
    const wo = arr.filter((r) => r.without_pass).length;
    const wPct = (100 * w) / arr.length;
    const woPct = (100 * wo) / arr.length;
    lines.push(`| ${cat} | ${arr.length} | ${pct(w, arr.length)} | ${pct(wo, arr.length)} | ${(wPct - woPct).toFixed(0)} pp |`);
  }
  const totalWith = rows.filter((r) => r.with_pass).length;
  const totalWithout = rows.filter((r) => r.without_pass).length;
  lines.push(`| **TOTAL** | **${rows.length}** | **${pct(totalWith, rows.length)}** | **${pct(totalWithout, rows.length)}** | **${(((100 * totalWith) / rows.length) - ((100 * totalWithout) / rows.length)).toFixed(0)} pp** |`);
  lines.push(``);

  // 2x2
  const cell = (w: boolean, wo: boolean) =>
    rows.filter((r) => r.with_pass === w && r.without_pass === wo).length;
  lines.push(`## 2×2: with_mcp × without_mcp`);
  lines.push(``);
  lines.push(`|  | without_mcp PASS | without_mcp FAIL |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **with_mcp PASS** | ${cell(true, true)} (both right) | ${cell(true, false)} (mcp wins) |`);
  lines.push(`| **with_mcp FAIL** | ${cell(false, true)} (mcp loses) | ${cell(false, false)} (both fail) |`);
  lines.push(``);

  // Per-prompt detail
  lines.push(`## Per-prompt detail`);
  lines.push(``);
  lines.push(`| ID | Category | with | without | tools(with) | tokens(with→without) | latency(ms) |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    const w = r.with_pass === null ? "—" : r.with_pass ? "✓" : "✗";
    const wo = r.without_pass === null ? "—" : r.without_pass ? "✓" : "✗";
    lines.push(
      `| ${r.id} | ${r.category} | ${w} | ${wo} | ${r.with_tools_called} | ${r.with_tokens}→${r.without_tokens} | ${r.with_latency_ms}/${r.without_latency_ms} |`
    );
  }
  lines.push(``);

  return lines.join("\n");
}

function buildCsv(rows: PairedRow[]): string {
  const head = [
    "id",
    "category",
    "with_pass",
    "without_pass",
    "with_tools_called",
    "without_tools_called",
    "with_tokens",
    "without_tokens",
    "with_latency_ms",
    "without_latency_ms",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.category,
        r.with_pass,
        r.without_pass,
        r.with_tools_called,
        r.without_tools_called,
        r.with_tokens,
        r.without_tokens,
        r.with_latency_ms,
        r.without_latency_ms,
      ].join(",")
    );
  }
  return lines.join("\n");
}

function main() {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : findLatestRunDir();
  const stamp = path.basename(target);
  const runs = loadScored(target);
  if (runs.length === 0) {
    console.error(`No *.scored.json in ${target}. Run \`npm run eval:score\` first.`);
    process.exit(1);
  }
  const rows = pair(runs);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const mdPath = path.join(REPORTS_DIR, `${stamp}.md`);
  const csvPath = path.join(REPORTS_DIR, `${stamp}.csv`);
  fs.writeFileSync(mdPath, buildMarkdown(target, rows));
  fs.writeFileSync(csvPath, buildCsv(rows));
  console.error(`[report] Wrote ${mdPath}`);
  console.error(`[report] Wrote ${csvPath}`);
}

main();
