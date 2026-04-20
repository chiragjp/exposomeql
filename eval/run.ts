// Two-arm eval runner — supports Anthropic, OpenAI, and Gemini models.
//
// Loads YAML prompts under eval/prompts/, runs each one twice:
//   - with_mcp:    tools wired to the ExposomeQL MCP server (subprocess)
//   - without_mcp: same model, no tools
// Captures the ordered tool trace, final assistant text, latency, and tokens.
//
// Usage:
//   EVAL_MODEL=claude-opus-4-6      npm run eval:run       # Anthropic (default)
//   EVAL_MODEL=gpt-5                npm run eval:run       # OpenAI
//   EVAL_MODEL=gemini-2.5-pro       npm run eval:run       # Gemini
//   npm run eval:run -- --only=outcome_pfoa_uric_acid
//   npm run eval:run -- --arm=with_mcp --category=quantitative

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI, type FunctionDeclaration, type Content, type Part, type FunctionCall, Type } from "@google/genai";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ExposomeqlClient, ToolDescriptor } from "./mcp-client.js";
import type { PromptSpec, RunResult, ToolCallRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");
const RUNS_DIR = path.join(__dirname, "runs");

const MODEL = process.env.EVAL_MODEL ?? "claude-opus-4-6";
const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS ?? 15);
const MAX_TOKENS = Number(process.env.EVAL_MAX_TOKENS ?? 4096);
const NUDGE = process.env.EVAL_NUDGE === "true";

const TOOL_NUDGE_SYSTEM = `You have access to ExposomeQL, a comprehensive environmental epidemiology data system with tools for querying NHANES survey data, EP-WAS associations, CTD toxicogenomics, and nutrient RCT evidence. When answering questions about environmental exposures, health associations, or NHANES data, ALWAYS use the available tools to ground your answer in actual data rather than relying on prior knowledge. Call the relevant tools first, then synthesize the results. Do not answer from memory when tools are available.`;

type ModelFamily = "anthropic" | "openai" | "gemini";

function detectFamily(model: string): ModelFamily {
  // OPENAI_BASE_URL set → always use OpenAI-compatible path (Ollama, vLLM, etc.)
  if (process.env.OPENAI_BASE_URL) return "openai";
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "gemini";
  return "anthropic";
}

const FAMILY = detectFamily(MODEL);

// ── CLI ──────────────────────────────────────────────────────────────────────

interface CliOpts {
  only?: string;
  arm?: "with_mcp" | "without_mcp" | "both";
  category?: string;
}

function parseArgs(): CliOpts {
  const out: CliOpts = { arm: "both" };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--only=")) out.only = a.slice(7);
    else if (a.startsWith("--arm=")) out.arm = a.slice(6) as CliOpts["arm"];
    else if (a.startsWith("--category=")) out.category = a.slice(11);
  }
  return out;
}

function loadPrompts(opts: CliOpts): PromptSpec[] {
  const out: PromptSpec[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
        const spec = yaml.load(fs.readFileSync(p, "utf8")) as PromptSpec;
        if (opts.only && spec.id !== opts.only) continue;
        if (opts.category && spec.category !== opts.category) continue;
        out.push(spec);
      }
    }
  };
  walk(PROMPTS_DIR);
  return out;
}

// ── Retry with backoff (works for both SDKs) ────────────────────────────────

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [15_000, 30_000, 60_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      const retryable = err.status === 429 || err.status === 529;
      if (!retryable || attempt >= delays.length) throw e;
      const wait = delays[attempt];
      console.error(`       rate-limited (${err.status}); sleeping ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ── Tool schema converters ──────────────────────────────────────────────────

function toAnthropicTools(tools: ToolDescriptor[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

/** Recursively sanitize JSON Schema for OpenAI compatibility.
 *  OpenAI's function calling uses a restricted JSON Schema subset:
 *  - `items` must be a single schema object, not a tuple array
 *  - `minItems`/`maxItems` on arrays with tuple items are unsupported */
function sanitizeSchemaForOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "items" && Array.isArray(v)) {
      // Tuple items → collapse to first element's type or generic string
      const first = (v as Record<string, unknown>[])[0];
      out[k] = first ? sanitizeSchemaForOpenAI(first) : { type: "string" };
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeSchemaForOpenAI(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function toOpenAITools(tools: ToolDescriptor[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description.slice(0, 1024),
      parameters: sanitizeSchemaForOpenAI(t.input_schema) as OpenAI.FunctionParameters,
    },
  }));
}

function toGeminiTools(tools: ToolDescriptor[]): FunctionDeclaration[] {
  return tools.map((t) => {
    const sanitized = sanitizeSchemaForOpenAI(t.input_schema);
    return {
      name: t.name,
      description: t.description.slice(0, 1024),
      parameters: sanitized as FunctionDeclaration["parameters"],
    };
  });
}

// ── Anthropic runner ────────────────────────────────────────────────────────

async function runAnthropic(
  spec: PromptSpec,
  arm: "with_mcp" | "without_mcp",
  client: Anthropic,
  mcp: ExposomeqlClient | null,
  tools: Anthropic.Tool[]
): Promise<RunResult> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: spec.prompt }];
  const trace: ToolCallRecord[] = [];
  const t0 = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "unknown";
  let finalText = "";
  let iterations = 0;
  let error: string | undefined;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      iterations++;
      const resp = await withBackoff(() =>
        client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: NUDGE && arm === "with_mcp" ? TOOL_NUDGE_SYSTEM : undefined,
          tools: arm === "with_mcp" && tools.length > 0 ? tools : undefined,
          messages,
        })
      );
      inputTokens += resp.usage.input_tokens;
      outputTokens += resp.usage.output_tokens;
      stopReason = resp.stop_reason ?? "unknown";

      const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      finalText = textBlocks.map((b) => b.text).join("\n");

      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0 || resp.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const ts = Date.now();
        if (!mcp) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "MCP server not connected", is_error: true });
          continue;
        }
        try {
          const r = await mcp.callTool(tu.name, tu.input);
          trace.push({ name: tu.name, input: tu.input, output: r.text, ms: Date.now() - ts });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: r.text.slice(0, 50_000), is_error: r.isError });
        } catch (e) {
          const msg = (e as Error).message;
          trace.push({ name: tu.name, input: tu.input, output: null, error: msg, ms: Date.now() - ts });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Tool error: ${msg}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    error = (e as Error).message;
  }

  return {
    prompt_id: spec.id, category: spec.category, arm, model: MODEL,
    final_text: finalText, tool_trace: trace, stop_reason: stopReason,
    input_tokens: inputTokens, output_tokens: outputTokens,
    latency_ms: Date.now() - t0, iterations, error,
  };
}

// ── OpenAI runner ───────────────────────────────────────────────────────────

async function runOpenAI(
  spec: PromptSpec,
  arm: "with_mcp" | "without_mcp",
  client: OpenAI,
  mcp: ExposomeqlClient | null,
  tools: OpenAI.ChatCompletionTool[]
): Promise<RunResult> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (NUDGE && arm === "with_mcp") {
    messages.push({ role: "system", content: TOOL_NUDGE_SYSTEM });
  }
  messages.push({ role: "user", content: spec.prompt });
  const trace: ToolCallRecord[] = [];
  const t0 = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "unknown";
  let finalText = "";
  let iterations = 0;
  let error: string | undefined;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      iterations++;
      const resp = await withBackoff(() =>
        client.chat.completions.create({
          model: MODEL,
          max_completion_tokens: MAX_TOKENS,
          tools: arm === "with_mcp" && tools.length > 0 ? tools : undefined,
          messages,
        })
      );
      inputTokens += resp.usage?.prompt_tokens ?? 0;
      outputTokens += resp.usage?.completion_tokens ?? 0;

      const choice = resp.choices[0];
      stopReason = choice.finish_reason ?? "unknown";
      finalText = choice.message.content ?? "";

      const toolCalls = choice.message.tool_calls;
      if (!toolCalls || toolCalls.length === 0 || choice.finish_reason !== "tool_calls") break;

      messages.push(choice.message);

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        const ts = Date.now();
        const fnName = tc.function.name;
        let fnArgs: unknown;
        try { fnArgs = JSON.parse(tc.function.arguments); } catch { fnArgs = {}; }

        if (!mcp) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: "MCP server not connected" });
          continue;
        }
        try {
          const r = await mcp.callTool(fnName, fnArgs);
          trace.push({ name: fnName, input: fnArgs, output: r.text, ms: Date.now() - ts });
          messages.push({ role: "tool", tool_call_id: tc.id, content: r.text.slice(0, 50_000) });
        } catch (e) {
          const msg = (e as Error).message;
          trace.push({ name: fnName, input: fnArgs, output: null, error: msg, ms: Date.now() - ts });
          messages.push({ role: "tool", tool_call_id: tc.id, content: `Tool error: ${msg}` });
        }
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }

  return {
    prompt_id: spec.id, category: spec.category, arm, model: MODEL,
    final_text: finalText, tool_trace: trace, stop_reason: stopReason,
    input_tokens: inputTokens, output_tokens: outputTokens,
    latency_ms: Date.now() - t0, iterations, error,
  };
}

// ── Gemini runner ───────────────────────────────────────────────────────────

async function runGemini(
  spec: PromptSpec,
  arm: "with_mcp" | "without_mcp",
  client: GoogleGenAI,
  mcp: ExposomeqlClient | null,
  tools: FunctionDeclaration[]
): Promise<RunResult> {
  const contents: Content[] = [{ role: "user", parts: [{ text: spec.prompt }] }];
  const trace: ToolCallRecord[] = [];
  const t0 = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "unknown";
  let finalText = "";
  let iterations = 0;
  let error: string | undefined;

  const toolConfig = arm === "with_mcp" && tools.length > 0
    ? { tools: [{ functionDeclarations: tools }] }
    : {};
  const systemInstruction = NUDGE && arm === "with_mcp" ? TOOL_NUDGE_SYSTEM : undefined;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      iterations++;
      const resp = await withBackoff(() =>
        client.models.generateContent({
          model: MODEL,
          contents,
          config: {
            maxOutputTokens: MAX_TOKENS,
            systemInstruction,
            ...toolConfig,
          },
        })
      );

      inputTokens += resp.usageMetadata?.promptTokenCount ?? 0;
      outputTokens += resp.usageMetadata?.candidatesTokenCount ?? 0;

      const candidate = resp.candidates?.[0];
      stopReason = candidate?.finishReason ?? "unknown";

      // Collect text
      const textParts = candidate?.content?.parts?.filter((p: Part) => "text" in p && p.text) ?? [];
      if (textParts.length > 0) {
        finalText = textParts.map((p: Part) => (p as { text: string }).text).join("\n");
      }

      // Check for function calls
      const fnCalls = resp.functionCalls;
      if (!fnCalls || fnCalls.length === 0) break;

      // Add model's response (with function calls) to history
      if (candidate?.content) {
        contents.push(candidate.content);
      }

      // Execute each function call against MCP
      const responseParts: Part[] = [];
      for (const fc of fnCalls) {
        const ts = Date.now();
        const fnName = fc.name!;
        const fnArgs = fc.args ?? {};

        if (!mcp) {
          responseParts.push({ functionResponse: { name: fnName, response: { error: "MCP server not connected" } } });
          continue;
        }
        try {
          const r = await mcp.callTool(fnName, fnArgs);
          const output = r.text.slice(0, 50_000);
          trace.push({ name: fnName, input: fnArgs, output, ms: Date.now() - ts });
          let parsed: unknown;
          try { parsed = JSON.parse(output); } catch { parsed = { text: output }; }
          responseParts.push({ functionResponse: { name: fnName, response: parsed as Record<string, unknown> } });
        } catch (e) {
          const msg = (e as Error).message;
          trace.push({ name: fnName, input: fnArgs, output: null, error: msg, ms: Date.now() - ts });
          responseParts.push({ functionResponse: { name: fnName, response: { error: msg } } });
        }
      }
      contents.push({ role: "user", parts: responseParts });
    }
  } catch (e) {
    error = (e as Error).message;
  }

  return {
    prompt_id: spec.id, category: spec.category, arm, model: MODEL,
    final_text: finalText, tool_trace: trace, stop_reason: stopReason,
    input_tokens: inputTokens, output_tokens: outputTokens,
    latency_ms: Date.now() - t0, iterations, error,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (FAMILY === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Aborting.");
    process.exit(1);
  }
  if (FAMILY === "openai" && !process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Aborting.");
    process.exit(1);
  }
  if (FAMILY === "gemini" && !process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. Aborting.");
    process.exit(1);
  }

  const opts = parseArgs();
  const prompts = loadPrompts(opts);
  if (prompts.length === 0) {
    console.error("No prompts matched filter. Aborting.");
    process.exit(1);
  }
  console.error(`[eval] ${prompts.length} prompts; arm=${opts.arm}; model=${MODEL} (${FAMILY})${NUDGE ? " +nudge" : ""}`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(RUNS_DIR, ts);
  fs.mkdirSync(runDir, { recursive: true });

  // Connect MCP
  let mcp: ExposomeqlClient | null = null;
  let mcpTools: ToolDescriptor[] = [];
  if (opts.arm !== "without_mcp") {
    mcp = new ExposomeqlClient();
    await mcp.connect();
    mcpTools = await mcp.listTools();
    console.error(`[eval] MCP connected with ${mcpTools.length} tools`);
  }

  // Create LLM client + convert tool schemas
  const anthropicClient = FAMILY === "anthropic" ? new Anthropic() : null;
  const openaiClient = FAMILY === "openai" ? new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
  }) : null;
  const geminiClient = FAMILY === "gemini" ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }) : null;
  const anthropicTools = FAMILY === "anthropic" ? toAnthropicTools(mcpTools) : [];
  const openaiTools = FAMILY === "openai" ? toOpenAITools(mcpTools) : [];
  const geminiTools = FAMILY === "gemini" ? toGeminiTools(mcpTools) : [];

  const arms: ("with_mcp" | "without_mcp")[] =
    opts.arm === "both" ? ["with_mcp", "without_mcp"] : [opts.arm!];

  for (const spec of prompts) {
    for (const arm of arms) {
      console.error(`[eval] ${spec.id} :: ${arm}`);

      let result: RunResult;
      if (FAMILY === "anthropic") {
        result = await runAnthropic(spec, arm, anthropicClient!, arm === "with_mcp" ? mcp : null, anthropicTools);
      } else if (FAMILY === "openai") {
        result = await runOpenAI(spec, arm, openaiClient!, arm === "with_mcp" ? mcp : null, openaiTools);
      } else {
        result = await runGemini(spec, arm, geminiClient!, arm === "with_mcp" ? mcp : null, geminiTools);
      }

      const outPath = path.join(runDir, `${spec.id}__${arm}.json`);
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.error(
        `       ${result.iterations} turns, ${result.tool_trace.length} tool calls, ` +
          `${result.input_tokens}+${result.output_tokens} tok, ${result.latency_ms}ms` +
          (result.error ? ` ERROR: ${result.error}` : "")
      );
    }
  }

  if (mcp) await mcp.close();
  console.error(`[eval] Wrote results to ${runDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
