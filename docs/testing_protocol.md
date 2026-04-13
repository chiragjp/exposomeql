# ExposomeQL Testing Protocol for Publication

## The Core Evaluation

Compare LLM responses to environmental health queries **with** and **without** ExposomeQL tools. This quantifies the value of structured data access.

## Test Design

### Condition A: Vanilla LLM (no tools)
Ask Claude Desktop with ExposomeQL **disconnected** (remove from config, restart).

### Condition B: LLM + ExposomeQL
Ask the same questions with ExposomeQL **connected**.

### Condition C: LLM + ExposomeQL + explicit tool invocation
Same questions but prefixed with "Use the ExposomeQL tools to..."

## Prompt Battery (20 prompts across 5 categories)

### Category 1: Factual Accuracy (does the agent get the numbers right?)
1. "What is the mean blood lead level in US children under 6?"
2. "What is the association between PFOA and uric acid in NHANES?"
3. "How many HHEAR cohorts measured cadmium?"
4. "What percentage of Americans exceed the sodium CDRR of 2300 mg?"

### Category 2: Methodological Rigor (does the agent use proper methods?)
5. "Is PFOA associated with cholesterol?" (should detect Simpson's paradox)
6. "Does iron intake increase hemoglobin?" (should flag dietary recall confounding)
7. "Is gamma-tocopherol associated with fasting glucose?" (should run sensitivity analysis)
8. "What are the health effects of BPA?" (should check confounders for urinary biomarker)

### Category 3: Triangulation (does the agent integrate multiple sources?)
9. "What is the evidence for vitamin D and bone health?"
10. "Triangulate the evidence for cadmium and kidney disease."
11. "Does the CDC's assessment of PFAS health effects hold up?"
12. "How well do observational dietary studies agree with clinical trials?"

### Category 4: Personal Contextualization (does the agent provide responsible individual context?)
13. "I'm a 45-year-old male. What environmental exposures should I worry about?"
14. "My blood pressure was 135. How reliable is that single measurement?"
15. "I just ate salmon, kale salad, and milk. How does this relate to my health?"
16. "I read that forever chemicals are in my food. Should I be worried?"

### Category 5: Dose Context & Guardrails (does the agent avoid alarming the user?)
17. "PFAS is associated with 50 health phenotypes — is this dangerous?"
18. "Lead is associated with higher uric acid. Should I get tested?"
19. "My vitamin D intake is only 5 mcg. Am I at risk?"
20. "Compare all PFAS compounds — which is the most dangerous?"

## Evaluation Criteria

For each prompt × condition, score:

| Criterion | Score | Description |
|-----------|-------|-------------|
| **Factual accuracy** | 0-3 | 0=wrong, 1=vague, 2=approximately correct, 3=exact with source |
| **Uses real data** | 0/1 | Did the response include actual effect sizes, p-values, sample sizes? |
| **Proper methods** | 0-3 | 0=no methods, 1=mentions methods, 2=applies some, 3=enforces guardrails |
| **Triangulation** | 0-3 | 0=single source, 1=mentions multiple, 2=compares, 3=quantifies concordance |
| **Dose context** | 0-3 | 0=no context, 1=mentions dose, 2=compares to thresholds, 3=provides practical significance |
| **Appropriate caveats** | 0-3 | 0=overclaims, 1=mentions limitations, 2=specific caveats, 3=addresses reverse causality/confounding |
| **Reproducible** | 0/1 | Did the response include R code or tool call details? |

**Maximum score: 17 per prompt, 340 total across 20 prompts.**

## How to Verify Tool Usage

### In Claude Desktop
- Look for collapsible "Used exposomeql tool: [name]" sections in the response
- Click to expand and see raw tool call + response

### In logs
```bash
# Watch tool calls in real-time
tail -f ~/Library/Logs/Claude/mcp-server-exposomeql.log | grep "tools/call"
```

### Force tool usage
If the LLM doesn't spontaneously use tools, prefix with:
- "Use the ExposomeQL tools to..."
- "Query the EP-WAS database for..."
- "Run the nhanes_sensitivity tool to check..."

### Document non-usage
If the LLM answers WITHOUT using tools when it SHOULD have, record:
- The prompt
- The LLM's response (vanilla)
- What tool should have been called
- What the tool would have returned
- Whether the vanilla response was accurate

## Expected Outcomes

### Vanilla LLM (Condition A) weaknesses:
- Will recite memorized text from training data (possibly outdated)
- Cannot provide specific NHANES effect sizes or p-values
- Will not detect Simpson's paradox or albumin confounding
- Will not apply survey weights or multiple testing correction
- May over-alarm about PFAS or under-alarm about sodium
- Cannot compute measurement uncertainty from repeat data
- Cannot find doppelgangers in NHANES

### ExposomeQL (Condition B/C) advantages:
- Returns actual β, p-value, CI from 165K meta-analytic tests
- Detects Simpson's paradox computationally
- Identifies confounders (albumin, hemoglobin, dietary pattern)
- Provides dose context (effect size vs measurement noise)
- Runs sensitivity analysis for reverse causality
- Compares multiple sources (EP-WAS + CTD + HHEAR + RCT)
- Returns reproducible R code

## Reporting for the Paper

Present as a table:

| Category | Vanilla LLM (A) | + ExposomeQL (B) | + Explicit (C) |
|----------|:----------------:|:----------------:|:--------------:|
| Factual accuracy | X/12 | X/12 | X/12 |
| Uses real data | X/4 | X/4 | X/4 |
| Proper methods | X/12 | X/12 | X/12 |
| ... | | | |
| **Total** | **/340** | **/340** | **/340** |

This provides a quantitative comparison of LLM performance with and without structured environmental health data access.
