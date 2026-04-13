# Use Case: A Non-Expert Reads a Scary PFAS News Story

## The Scenario

You read a headline like:

> **"Forever Chemicals Are in Your Food, Water, and Blood — And They're Linked to Cancer, Thyroid Disease, and Immune Problems"**

The article claims:
1. PFAS are found in seafood, fast-food packaging, drinking water, and even fresh produce
2. PFAS are linked to cancer (kidney, testicular), thyroid disease, liver damage, immune suppression, cholesterol increases, and reproductive harm
3. PFAS are "forever chemicals" that never break down
4. 97% of Americans have PFAS in their blood
5. There is no safe level of PFAS exposure

**You're worried. Should you be?**

Here's how you'd use ExposomeQL to contextualize these claims with actual population-level data — without needing to be an epidemiologist.

---

## Step 1: "What does the data actually show about PFOA?"

**Prompt:**
> "What are the health effects of PFOA? Show me the strongest associations."

**ExposomeQL calls:** `epwas_summary(exposure: "PFOA", model_number: 6, top_n: 20)`

**What you learn:**
The strongest associations for PFOA in the US population (NHANES, ~100K participants) are:

| Phenotype | Effect (β) | p-value | Direction | Interpretation |
|-----------|-----------|---------|-----------|---------------|
| Albumin | +0.177 | 3.3e-4 | ↑ | Higher albumin with higher PFOA |
| Uric acid | +0.111 | 7.6e-5 | ↑ | Higher uric acid |
| Hemoglobin | +0.130 | 2.3e-3 | ↑ | Higher hemoglobin |
| Cholesterol | +0.061 | 4.9e-2 | ↑ | Slightly higher cholesterol |
| ALT (liver) | +0.051 | 2.4e-3 | ↑ | Slightly higher liver enzyme |
| Glucose | -0.053 | 1.3e-2 | ↓ | Lower glucose (paradoxical) |
| BMI | — | NS | — | No association with obesity |

**Context the news article didn't give you:**
- The cholesterol effect is real but tiny (β=0.061) — not clinically meaningful at population exposure levels
- Glucose is *lower* with higher PFOA, not higher — the opposite of what you'd expect for a harmful chemical
- The strongest signal is albumin, which is actually a marker of *better* health
- No thyroid associations at all (TSH, T4, T3 — all non-significant)

---

## Step 2: "Wait, why is PFOA associated with *better* metabolic markers?"

**Prompt:**
> "Check PFOA for confounders — is something biasing these results?"

**ExposomeQL calls:** `confounder_check(exposure: "LBXPFOA")`

**What you learn:**
PFOA has a **strong positive association with serum albumin** (β=+0.177, p<0.001). This is because:

> "PFAS bind to serum albumin in blood (>99.7% protein-bound). People with higher albumin concentrations have higher measured PFAS — not because PFAS increases albumin, but because albumin is the carrier protein. This creates healthy-participant bias: healthier people have higher albumin → higher measured PFAS → spurious negative associations with disease markers."

**What this means for you:** Many of the "associations" between PFAS and health outcomes are confounded by this pharmacokinetic property. The news article didn't mention this. The negative associations with glucose and BMI are almost certainly artefacts of albumin binding, not real protective effects.

---

## Step 3: "Does PFOA really increase cholesterol?"

**Prompt:**
> "Test if the PFOA-cholesterol association shows Simpson's paradox."

**ExposomeQL calls:** `simpson_paradox_test(exposure: "LBXPFOA", phenotype: "LBXSCH")`

**What you learn:**

| Level | Estimate | Direction |
|-------|---------|-----------|
| Pooled across cycles | β = +0.061 | Positive (matches news claim) |
| Within 2003-2004 | β = -0.198 | **Negative** |
| Within 2005-2006 | β = -0.185 | **Negative** |
| Within 2007-2008 | β = -0.214 | **Negative** |
| Within 2009-2010 | β = -0.206 | **Negative** |
| Within 2011-2012 | β = -0.253 | **Negative** |

**Simpson's paradox detected.** The pooled estimate says PFOA increases cholesterol, but *within every single NHANES cycle*, PFOA is associated with *lower* cholesterol. The reversal happens because both PFAS levels (manufacturing phase-outs) and cholesterol (statin use) are declining over time, creating a spurious positive ecological correlation.

**What this means for you:** The "PFAS increases cholesterol" claim is more complicated than the news article suggests. The evidence depends entirely on the analytic approach. The within-cycle data (which controls for time trends) actually shows the opposite direction.

---

## Step 4: "What about thyroid disease?"

**Prompt:**
> "Compare all PFAS compounds against thyroid markers (TSH, T4)."

**ExposomeQL calls:** `exposure_compare(exposures: ["LBXPFOA","LBXPFOS","LBXPFHS","LBXPFNA","LBXPFDE"], phenotype: "LBXTSH")`

**What you learn:**
No PFAS compound shows a significant association with TSH at the population level (all p > 0.05).

**What this means for you:** The news article's claim about thyroid disease is not supported by population-level NHANES data. The thyroid concern may come from occupational studies of factory workers with much higher exposures than the general public encounters.

---

## Step 5: "What about the uric acid finding — is that real?"

**Prompt:**
> "What's the mechanism behind PFOA and uric acid? Check the gene interactions."

**ExposomeQL calls:** `ctd_chemical_genes(chemical: "PFOA", biological_context: "kidney")`

**What you learn:**
PFOA has **9 curated interactions with SLC22A11** (the renal organic anion transporter that excretes uric acid) and **7 interactions with ABCG2** (the urate efflux pump). PFOA competes with uric acid for these transporters, impairing urate excretion.

**What this means for you:** This is probably the most real and interpretable PFAS health effect. Unlike cholesterol (Simpson's paradox) and thyroid (no signal), the uric acid association has:
- A consistent positive direction (β=+0.111)
- A plausible mechanism (transporter competition)
- Gene-level evidence supporting the mechanism
- No obvious confounding explanation

If you have gout or elevated uric acid, PFAS exposure is a legitimate concern. But the news article probably didn't mention uric acid at all.

---

## Step 6: "How worried should I be about PFAS in food?"

**Prompt:**
> "What is the exposure profile for PFOA in the general US population?"

**ExposomeQL calls:** `exposure_profile(chemical: "PFOA")`

**What you learn:**
- Population median PFOA: ~2 ng/mL (declining since 2000s manufacturing phase-outs)
- German HBM-I threshold (no adverse effects): 2 ng/mL
- German HBM-II threshold (action needed): 10 ng/mL
- Most Americans are at or below the HBM-I threshold
- PFOA levels have been declining for 15+ years due to voluntary industry phase-outs

---

## The Bottom Line

What the news article claimed vs what the data shows:

| News Claim | Data Reality | Worry Level |
|-----------|-------------|-------------|
| "PFAS linked to cancer" | IARC classified PFOA as Group 1 carcinogen, but this is based on occupational cohorts, not general population dietary exposure. No cancer biomarkers are measurable in NHANES. | Context-dependent — occupational exposure ≠ dietary exposure |
| "PFAS increases cholesterol" | Simpson's paradox — the direction depends on the analysis. Within-cycle data shows negative association. | Low — effect is small and direction is disputed |
| "PFAS causes thyroid disease" | No TSH/T4/T3 associations at population level in NHANES | Low — not supported at typical exposure levels |
| "PFAS damages the immune system" | Neutrophil↓/lymphocyte↑ shift confirmed, but CRP is lower (opposite of immune damage) | Uncertain — immune modulation, not clearly "damage" |
| "PFAS causes liver damage" | ALT slightly elevated, but the dominant signal is albumin↑ (protein binding, not toxicity) | Low — confounded by pharmacokinetics |
| "PFAS raises uric acid" | **Confirmed** — β=+0.111, mechanistic support via SLC22A11/ABCG2 transporters | Moderate — relevant if you have gout risk |
| "There is no safe level" | Most Americans are at/below HBM-I threshold; levels declining | The dose makes the poison — current levels are at the threshold, not dramatically above |

**The responsible message:** PFAS are real pollutants with legitimate concerns, especially for communities near contamination sites with very high exposures. But for the average American eating a normal diet, the population-level data suggests the effects are either small (cholesterol), confounded (metabolic markers), unsupported (thyroid), or limited to specific mechanisms (uric acid). The news article's tone of alarm is not proportionate to what the data shows at typical population exposure levels.

---

## Tools Used in This Use Case

| Step | Tool | Time |
|------|------|------|
| 1 | `epwas_summary` | ~240ms |
| 2 | `confounder_check` | ~4s |
| 3 | `simpson_paradox_test` | ~18s |
| 4 | `exposure_compare` | ~3s |
| 5 | `ctd_chemical_genes` | ~240ms |
| 6 | `exposure_profile` | ~240ms |
| **Total** | 6 tool calls | **~26s** |

A non-expert went from "should I panic about PFAS?" to a nuanced, data-grounded understanding in under 30 seconds of compute time — using the same population data that epidemiologists use, with proper statistical methods applied automatically.

---

## What This Demonstrates

1. **ExposomeQL as a public health literacy tool** — not just for researchers, but for anyone trying to interpret environmental health news
2. **Confounder detection matters** — the albumin binding explanation changes the interpretation of most PFAS associations
3. **Simpson's paradox is real** — and detectable with the right tools
4. **Triangulation distinguishes real from spurious** — uric acid has mechanism + association; thyroid has neither
5. **Dose matters** — population exposure levels are different from contamination-site exposures
6. **The news often overestimates risk** — by conflating occupational/contamination-site findings with general population exposures
