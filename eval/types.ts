// Shared types for the eval harness.

export interface PromptSpec {
  id: string;
  category: string;
  prompt: string;
  expected?: Record<string, unknown>;
  required_tools?: string[];
  deterministic_checks?: {
    required_terms?: string[];
    forbidden_terms?: string[];
  };
  rubric?: string[];
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  output: unknown;
  error?: string;
  ms: number;
}

export interface RunResult {
  prompt_id: string;
  category: string;
  arm: "with_mcp" | "without_mcp";
  model: string;
  final_text: string;
  tool_trace: ToolCallRecord[];
  stop_reason: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  iterations: number;
  error?: string;
}

export interface DeterministicScore {
  required_present: { term: string; matched: boolean }[];
  forbidden_absent: { term: string; matched: boolean }[];
  required_tools_called: { tool_pattern: string; called: boolean }[];
  pass: boolean;
}

export interface ScoredRun extends RunResult {
  deterministic: DeterministicScore;
}
