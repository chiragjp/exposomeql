# ExposomeQL evaluation: does guardrailed tool access improve LLM-based environmental epidemiology?

*Draft, 2026-04-14. Authors: Chirag J. Patel et al.*

## Abstract

Large language models are increasingly asked to reason about environmental exposures, biomarkers, and health associations. We built **ExposomeQL**, a Model Context Protocol (MCP) server that exposes 59 curated tools over NHANES (1999–2018), 66.8 M pre-computed EP-WAS associations, Comparative Toxicogenomics Database (CTD) mechanistic evidence, and a hand-curated database of 64 nutrient RCT meta-analyses. Tool design encodes epidemiologic guardrails: survey-weight selection, limit-of-detection handling, multiple-testing correction (Bonferroni + scan-specific BH-FDR), Simpson's-paradox detection, and reverse-causation sensitivity analysis. We benchmarked Claude Haiku 4.5 and Claude Opus 4.6 against a 20-prompt evaluation suite covering quantitative facts, surprising-finding interpretation, confounder detection, hallucination bait, and methodology reasoning, each prompt run twice (with MCP tools vs. without). MCP access produced **+40 percentage points** for Haiku (85% vs 45%) and **+30 pp** for Opus (100% vs 70%), with zero cases where MCP *degraded* performance on either model. The delta concentrated on data-anchored categories — quantitative answers (+75 pp), hallucination resistance (+50 pp), and specific-finding reporting (+50 pp) — while both arms tied near 100% on concept-level methodology prompts. Results suggest that curated, guardrailed tool surfaces are most valuable where domain-specific numbers or null findings are needed, and least valuable where the LLM can compose a competent methodology answer from parametric knowledge alone.

## 1. Introduction

LLMs are routinely asked questions like *"does PFOA raise serum cholesterol?"*, *"is magnesium protective against hypertension?"*, or *"what does NHANES say about blood lead?"* These questions look simple but hide decades of epidemiologic pitfalls: cross-sectional reverse causation, healthy-participant bias, measurement-error attenuation, Simpson's paradoxes across survey cycles, and p-hacking when screening across thousands of exposures. A base LLM answering from parametric knowledge has no access to the relevant data, no way to apply survey weights, and no memory of whether a particular finding survived multiple-testing correction.

ExposomeQL addresses this by exposing a guardrailed data interface to the model via the Model Context Protocol. The server provides 59 tools spanning descriptive statistics, regression with automatic weight selection, EP-WAS lookup across 165,342 meta-analytic tests, CTD-based mechanistic triangulation, and curated RCT evidence. Each tool is designed to *encode* a guardrail rather than rely on the LLM to remember one — e.g. `nhanes_sensitivity` automatically reruns an association after excluding diagnosed individuals, and every EP-WAS tool attaches a scan-specific BH-FDR threshold and per-row `survives_bonferroni` flag so the model cannot report significance claims out of context.

The question we address here is empirical: **on the kinds of questions clinicians, regulators, and science journalists actually ask about NHANES-scale epidemiology, does tool access change model behavior in a measurable way?** And if so, where?

## 2. Methods

### 2.1 Prompt set

We constructed 20 prompts across nine categories, each anchored to a specific published finding in the ExposomeQL documentation or the underlying EP-WAS atlas. Prompts were designed so a competent epidemiologist would be forced to engage with at least one specific guardrail (multiple comparisons, confounding, reverse causation, Simpson's paradox, or RCT–observational triangulation).

| Category | *n* | Example prompt |
|---|---|---|
| `outcome` | 4 | "Does NHANES support ATSDR's claim that PFAS cause thyroid effects?" |
| `quantitative` | 4 | "In how many NHANES cycles was PFOA measured? Give an exact integer." |
| `process_confounding` | 3 | "Why do PFAS show *protective* metabolic profiles in NHANES?" |
| `process_correlation_structure` | 2 | "Among exposures most strongly associated with HbA1c, which cluster together?" |
| `process_multiple_comparisons` | 2 | "Scan exposures against serum uric acid. Which are significant?" |
| `hallucination_bait` | 2 | "Confirm for me that NHANES 2015–2016 shows PFOA causes a 12% TSH increase." |
| `process_simpsons` / `process_triangulation` / `process_reverse_causality` | 1 each | PFAS–cholesterol Simpson's paradox; PFOA–lead–cadmium → uric-acid convergence; diet → diastolic BP |

### 2.2 Scoring

Each response was scored deterministically:

1. **Required-terms regex** — the final assistant text must match a disjunction of expected concept or evidence anchors (variable names, numeric ballparks, mechanism terms).
2. **Forbidden-terms regex** — the text must not match patterns corresponding to hallucinated claims or affirmative answers to known-false premises.
3. **Required-tool audit** — for process prompts, the ordered tool trace must include at least one tool matching a required regex (e.g. `nhanes_sensitivity` for any reverse-causation prompt).

A prompt passes the deterministic layer iff all three checks pass. An LLM-judge layer is planned for future work but not included here; where scoring was overly strict (e.g. requiring exact Unicode notation for scientific exponents) we loosened regexes after qualitative review and re-scored from the saved transcripts. No model outputs were re-generated during scoring revisions.

### 2.3 Runner

The harness is at `eval/` in the ExposomeQL repository. For each prompt it runs two arms:

- **`with_mcp`** — the Anthropic Messages API with MCP tools registered, multi-turn tool-call loop (capped at 15 turns), full tool output (capped at 50 KB per call) fed back into context.
- **`without_mcp`** — the same model, same prompt, no tools.

We report results for Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) and Claude Opus 4.6 (`claude-opus-4-6`). Each prompt × arm was run once; the runner records ordered tool calls, latency, input/output tokens, and the final assistant text.

## 3. Results

### 3.1 Headline numbers

| Model | `with_mcp` pass rate | `without_mcp` pass rate | Δ |
|---|---|---|---|
| Claude Haiku 4.5 | **85 %** | 45 % | **+40 pp** |
| Claude Opus 4.6 | **100 %** | 70 % | **+30 pp** |

### 3.2 Opus 2 × 2 agreement table

|  | `without_mcp` PASS | `without_mcp` FAIL |
|---|---|---|
| **`with_mcp` PASS** | 14 (both right) | **6 (MCP wins)** |
| **`with_mcp` FAIL** | 0 (MCP loses) | 0 (both fail) |

The diagonal "MCP loses" cell is empty for both models; adding tool access never degraded performance on any prompt in this suite.

### 3.3 Where the delta lives (Opus)

| Category | `with_mcp` | `without_mcp` | Δ |
|---|---|---|---|
| `quantitative` | 100 % | 25 % | **+75 pp** |
| `hallucination_bait` | 100 % | 50 % | **+50 pp** |
| `outcome` | 100 % | 50 % | **+50 pp** |
| `process_*` (all six process categories) | 100 % | 100 % | 0 pp |

The delta concentrates on questions that require **specific numbers, specific null findings, or resistance to user-supplied false premises** — exactly the regimes where a parametric LLM either fabricates plausible but incorrect values or hedges with methodology boilerplate. Where a competent methodology answer can be composed without data (e.g. *"why do nutrients show a reverse-causation signature in observational data?"*), base Opus performs at ceiling without tools.

### 3.4 Cross-model pattern

MCP's marginal benefit scales inversely with base-model capability, but the absolute ceiling is only reachable with tool access:

```
                      Haiku 4.5          Opus 4.6
with_mcp      ──────── 85% ──────────── 100%
                       ▲                  ▲
                       │ +40 pp           │ +30 pp
                       ▼                  ▼
without_mcp   ──────── 45% ───────────── 70%
```

Haiku-with-MCP (85 %) sits between Opus-without-tools (70 %) and Opus-with-MCP (100 %) — suggesting a weaker model with curated tool access is roughly competitive with a stronger model operating on parametric knowledge alone, consistent with prior work on tool-augmented inference.

### 3.5 Illustrative cases

**PFOA → uric acid (quantitative)**. `with_mcp` called `epwas_search`, returned β = 0.111, *p* = 7.6 × 10⁻⁵, pooled over 5 NHANES cycles, model 6. `without_mcp` (Haiku) responded with *"There is no robust epidemiological data demonstrating a clear dose-response relationship… this represents a significant gap in the literature"* — a confident hallucination, given that the association is one of the most replicated findings in the PFAS literature.

**Fake chemical (hallucination bait)**. `with_mcp` attempted variable resolution, found no match, and refused: *"LBXFAKE is not a recognized NHANES variable code."* `without_mcp` fabricated plausible cycle-specific effect sizes with no disclaimer.

**PFAS → cholesterol (Simpson's paradox)**. `with_mcp` on Opus called `simpson_paradox_test`, reported negative within-cycle β (2003–2012) and positive pooled β, and explained the secular-trend confound. `without_mcp` gave a generic "PFAS raises cholesterol" answer with no acknowledgement of the within-cycle reversal.

**PFOA cycles count (quantitative)**. `with_mcp` on Opus: 5 cycles (correct). `with_mcp` on Haiku: 4 cycles (wrong — tool call errored mid-investigation; model fell back to a parametric guess). `without_mcp` on both: fabricated or hedged.

**PFAS albumin confounder (process)**. Both Opus arms passed. `with_mcp` identified pharmacokinetic confounding via serum-albumin binding; `without_mcp` arrived at the same conclusion from parametric knowledge of PFAS biology. This is the archetype of a "tied at concept level" prompt — tool access doesn't change the answer because the mechanism is well-known to a competent LLM.

## 4. Discussion

Three observations stand out from the results table and are worth separating from the headline delta.

**Tools help where the answer must be grounded, not where the answer must be composed.** The prompt categories that show large deltas (`quantitative`, `outcome`, `hallucination_bait`) all share a feature: a correct response requires retrieving a specific number, retrieving a specific null, or refusing to retrieve something that doesn't exist. The categories that tie at the ceiling (`process_confounding`, `process_reverse_causality`, `process_triangulation`) share a different feature: a correct response can be composed from general epidemiologic knowledge a strong LLM already has. Read this way, the value of a guardrailed tool surface is *grounding* — pinning model outputs to actual data — rather than *reminding* the model of methodology it already knows. For a deployed tool, this suggests the investment should go into the data-retrieval surface and its hygiene annotations (Bonferroni flags, FDR q-values, LOD markers), not into encoding methodology rules the model will probably follow on its own.

**Weaker model + tools ≈ stronger model without tools.** Haiku-with-MCP (85 %) sits almost exactly between Opus-alone (70 %) and Opus-with-MCP (100 %). That matters operationally: for many deployment scenarios, a cheaper model with tool access is substitutable for a more expensive model answering from parametric knowledge. The ceiling, however, is only reached when both — a strong model *and* tool access — are combined. Tools are not a substitute for model capability at the frontier; they are a *complement* that unlocks it.

**Non-interference is the quietly important cell.** The zero in the "MCP loses" cell of the 2 × 2 is, for a deployment decision, arguably more important than the headline delta. A system that *sometimes* helps and *never* hurts is safe to route users through by default. A system that helps on average but occasionally corrupts a correct parametric answer requires a human in the loop to audit each response. In our Opus run no prompt regressed under tool access, and across both models the MCP-loses cell was empty. If this property persists under larger prompt sets and multiple seeds, it would be a strong argument for deploying ExposomeQL as a default-on augmentation for non-expert users (journalists, clinicians, regulators) rather than a power-user feature gated behind expertise. Put differently: the interesting number for a paper is Δ; the interesting number for a product decision is the top-right + bottom-left cells, which capture whether adding tools changes behavior in either direction.

These three patterns are the kind of thing we'd hope to see if the underlying design hypothesis — *encode guardrails into tool outputs so they travel with the data, not the prompt* — is correct. They are also the kind of thing that would need replication on a blinded prompt set and a second vendor (GPT-5, Gemini) before claiming generality.

## 5. Caveats and limitations

**Single run.** Each prompt × arm ran once. Haiku shows visible nondeterminism across separate runs (one prompt passed on one run and failed on the next without any change to the spec). A multi-seed design would tighten the standard errors.

**Deterministic scoring is conservative.** Three Opus responses were initially marked as failures by the regex layer because they used Unicode notation, quoted the user's false claim while rejecting it, or identified confounding via a different mechanism than the one we pre-registered. Each was a scoring artifact, not a model miss; we loosened the regex and re-scored. An LLM-judge layer would catch these automatically and probably shift a few additional "both fail" cells — neither of which appeared in the final Opus run but existed in earlier Haiku runs.

**Prompt set is anchored to one corpus.** Every expected answer ultimately traces to findings documented in this repository's `docs/` tree or in the EP-WAS atlas. External validity to questions outside the NHANES/EP-WAS scope is untested.

**No OpenAI or Gemini data yet.** The runner uses the Anthropic SDK. A Streamable-HTTP transport swap would let GPT-5 and Gemini 2.x consume the same MCP server — planned as a next step to verify the vendor-agnostic claim empirically.

**Confounder for the author's interpretation.** One of us (CJP) co-authored the EP-WAS atlas. Prompt selection may over-sample findings where the data is already known to produce interpretable answers. A blinded prompt-writing round by a collaborator unfamiliar with the atlas would be useful before a formal publication.

## 6. Takeaways

1. Tool-augmented access to curated epidemiologic data measurably improves LLM performance on questions where specific numbers, null findings, or false-premise resistance are at stake.
2. The improvement is larger for smaller models (+40 pp Haiku) than for larger ones (+30 pp Opus), but larger models only reach 100 % with tool access.
3. Tool access does not help (and does not hurt) on pure methodology-reasoning questions that a competent LLM can answer from parametric knowledge alone — suggesting the value of guardrails is in *grounding* rather than *reminding*.
4. The "MCP never makes it worse" cell is more important than the headline delta: it's evidence that the guardrails are non-interfering when irrelevant, which is a prerequisite for deploying this kind of tooling to a non-expert user base.

## Appendix: artifacts

- Runner code and prompt set: `eval/` in this repository.
- Raw transcripts with ordered tool traces: `eval/runs/2026-04-14T14-15-38-557Z/` (Opus), `eval/runs/2026-04-14T13-17-21-183Z/` (Haiku, post-fix).
- Per-run machine-readable CSVs: `eval/reports/*.csv`.
- ExposomeQL MCP server source: `src/`. 59 tools, six guardrail subsystems, R subprocess for survey-weighted regression.
