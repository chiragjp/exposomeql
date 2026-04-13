# Your Guide to Understanding Environmental Exposures and Health

## Why This Matters to You

Every day, you're exposed to thousands of chemicals — in your food, water, air, household products, and workplace. Scientists call this your "exposome." A landmark Harvard study tested **115,000 connections** between environmental exposures and health outcomes using data from 100,000 Americans over 20 years.

The headline finding? **No single chemical is a smoking gun. But your cumulative "exposure soup" can be just as powerful as your DNA in shaping your health.**

This guide shows you how to use ExposomeQL — an AI-powered tool — to explore what's known about the chemicals you encounter and what they mean for your health. You don't need to be a scientist.

---

## Start Here: Questions Real People Ask

### "Should I be worried about [chemical]?"

Just ask:
> "I saw a news article about PFAS in food. Should I be worried?"

> "Is BPA in plastic water bottles actually harmful?"

> "How dangerous is mercury in fish?"

The tool will check the actual population data (not just news headlines) and tell you: what the evidence shows, how strong it is, and whether the effect at your exposure level is large enough to matter.

### "What about my diet?"

> "I ate fast food for lunch — is that affecting my health?"

> "How does my diet compare to what Americans typically eat?"

> "Am I getting enough vitamin D, calcium, and fiber?"

### "What do people like me look like health-wise?"

> "I'm a 40-year-old woman. What environmental exposures should I know about?"

> "My doctor said my cholesterol is 210. Is that typical for someone my age?"

> "My blood lead was 2.5 µg/dL. Is that high?"

### "How much can I trust a single test result?"

> "My blood pressure was 138 at the doctor. How reliable is one reading?"

> "My fasting glucose came back at 105. Should I be concerned?"

---

## What You'll Learn (And What You Won't)

### What ExposomeQL CAN tell you:
- What the largest US health survey shows about chemical exposures and health
- How your numbers compare to the general population
- Which associations are strong and which are weak
- Whether an association is confounded (the data might be misleading)
- What the experimental evidence (clinical trials) says about nutrients

### What ExposomeQL CANNOT tell you:
- Whether a specific chemical *caused* your health condition
- What will happen to *your* health if you change your exposure
- Medical advice — always consult your doctor for health decisions

### The most important thing to understand:
**Most individual environmental exposures have very small effects.** The typical exposure-health association explains less than 1% of variation. The effect of going from low to high lead exposure on uric acid is about the same as aging 1-2 years. What matters is the cumulative burden — many small exposures adding up over a lifetime.

---

## What Is the Atlas?

In March 2026, Patel, Ioannidis, and Manrai published "An atlas of exposome–phenome associations in health and disease risk" in *Nature Medicine*. The study tested **115,000+ associations** between **619 environmental exposures** and **305 health outcomes** across 20 years of NHANES data — the largest systematic exposome study to date.

Key findings:
- **5,600+ statistically significant associations** identified
- Individual exposures explain **<1% of variation** in health outcomes
- 20 exposures combined explain **up to 43% of variation** in triglycerides
- The cumulative "exposure soup" rivals genetics in explaining disease risk
- **"There's no smoking gun — every exposure matters a little bit"** — Chirag Patel

ExposomeQL is the MCP server that makes this atlas queryable through natural language. This guide shows you how.

---

## Quick Start Prompts

### For Newcomers: "What is the exposome?"

> "What is the exposome and how is it studied?"

> "How many environmental exposures have been systematically tested against health outcomes?"

> "What percentage of disease risk comes from environment vs genetics?"

### For Researchers: "Show me the data"

> "How many significant associations exist in the EP-WAS atlas?"

> "What is the median R-squared for a significant exposome association?"

> "Which phenotype has the most significant environmental associations?"

---

## Learning Prompts by Topic

### 1. Understanding Scale

These prompts help you understand how large the exposome evidence base is:

> "How many total exposure-phenotype associations are in the ExposomeQL database?"

> "How many unique exposures and phenotypes have been tested?"

> "What is the Bonferroni threshold for 165,342 meta-analytic tests?"

> "How many associations survive Bonferroni correction vs BH-FDR correction?"

**What you'll learn:** The atlas contains 66.8 million cycle-specific estimates, meta-analyzed into 165,342 pooled tests. At Bonferroni threshold (p < 3.02e-7), thousands survive — but most effect sizes are small (median R² = 0.6%).

### 2. The "No Smoking Gun" Principle

The key finding: individual exposures explain very little, but they accumulate:

> "What is the strongest single exposure-phenotype association in the atlas?"

> "How does the R-squared of environmental exposures compare to genetic variants?"

> "Show me the top 10 exposures associated with triglycerides."

> "What fraction of cholesterol variation can be explained by environmental exposures?"

> "Compare the effect of cotinine (smoking) on white blood cells versus the effect of lead."

**What you'll learn:** Even the "strongest" associations (smoking → WBC, lead → uric acid) have β < 0.2. The triglycerides example is exceptional — 20 exposures together explain 43% of variation. For most phenotypes, the exposome is distributed across many small effects.

### 3. Exposure Classes

Explore different types of environmental exposures:

> "What are all the PFAS compounds measured in NHANES and what do they do?"

> "Compare the health effects of lead, cadmium, and mercury."

> "What phenotypes are most affected by phthalate metabolites?"

> "Show me associations for BPA (bisphenol A) across all health outcomes."

> "What dietary nutrients have the most associations with health markers?"

> "Which smoking biomarkers have the strongest phenotype associations?"

**Chemical categories available:** Heavy metals (22), PFAS (5+), phthalates (11), phenols (7), parabens (4), PAHs (3), pesticide metabolites (4), flame retardants, smoking biomarkers, dietary nutrients (65+ DR1T* variables)

### 4. Phenotype Categories

Explore health outcomes affected by environmental exposures:

> "What environmental exposures affect blood glucose and HbA1c?"

> "Show me all exposures associated with kidney function (creatinine, uric acid)."

> "Which chemicals are linked to thyroid markers (TSH, T4)?"

> "What affects blood pressure in the exposome data?"

> "Are there exposures associated with bone mineral density?"

> "What environmental factors are linked to inflammation (CRP)?"

**Phenotype systems available:** Lipids, glucose/metabolic, kidney/uric acid, liver, thyroid, immune/inflammatory, hematology, blood pressure, body composition, bone, reproductive hormones, lung function, telomere length

### 5. Triangulation: Going Beyond Association

The atlas provides associations, but ExposomeQL can triangulate with other evidence sources:

> "Triangulate the evidence for cadmium and kidney disease."

> "For the PFOA-uric acid association, what is the gene-level mechanism?"

> "Is the lead-blood pressure association supported by CTD gene data?"

> "How many HHEAR cohorts independently measured mercury?"

> "What is the evidence for omega-3 and triglycerides across RCTs and observational data?"

**Triangulation sources:** EP-WAS (observational, NHANES), CTD (415K gene interactions), HHEAR (35 cohorts, 21K participants), curated meta-analytic evidence (64 nutrient-outcome pairs)

### 6. Methods and Rigor

Understand how the atlas was built and its limitations:

> "What adjustment models were used in the EP-WAS atlas? What does model 6 include?"

> "What is vibration of effects and how does it apply to the atlas?"

> "How does the atlas handle limit of detection in biomarker measurements?"

> "What survey weights are used for NHANES laboratory vs dietary variables?"

> "Show me the 9 adjustment models and how sensitive an association is across them."

### 7. Confounding and Bias

Critical for interpreting the atlas correctly:

> "Check if PFOA associations are confounded by albumin binding."

> "Test the PFOA-cholesterol association for Simpson's paradox."

> "How well do dietary recall associations agree with clinical trial evidence?"

> "Is the iron-hemoglobin association in the atlas confounded?"

> "Why do all dietary nutrients show ~8,000 significant associations?"

**What you'll learn:** Not all atlas associations are causal. Dietary recall concordance with RCTs is 50% (coin flip). PFAS associations are confounded by albumin binding. Simpson's paradox can reverse the direction of pooled estimates. These diagnostic tools help separate signal from noise.

### 8. Temporal Trends

How have exposures and associations changed over 20 years?

> "How has blood lead changed from 1999 to 2018?"

> "Are PFAS levels declining in the US population?"

> "Show the trend in vitamin D dietary intake over NHANES cycles."

> "Has the association between smoking and cholesterol changed over time?"

> "How has HbA1c trended across NHANES cycles?"

### 9. Personal Contextualization

What does the atlas mean for me?

> "I'm a 45-year-old male. What environmental exposures are most relevant to my health?"

> "My blood pressure is 135 and my lead is 3.2 µg/dL. How uncertain is my BP measurement, and what do people like me look like?"

> "I just ate salmon, kale salad, and milk. How does this relate to my health?"

> "How does my diet compare to the Healthy Eating Index population average?"

> "Are the exposures at my level actually large enough to affect my health?"

**Important:** These tools provide population-level context, not individual predictions. The atlas estimates β_between (between-person associations), which may differ from β_within (your personal causal response to changing an exposure).

### 10. Evaluating Health Claims

Use the atlas to fact-check environmental health news:

> "I read that PFAS chemicals cause cancer. What does the NHANES data actually show?"

> "Does microplastic exposure affect health? What associations exist?"

> "A news article says vitamin D prevents diabetes. Is that supported by the data?"

> "Someone told me mercury in fish is dangerous. What does the evidence show?"

> "Are organic foods meaningfully different in terms of pesticide exposure effects?"

---

## Advanced Prompts

### Multi-Chemical Comparison
> "Compare all 5 PFAS compounds against uric acid — which has the strongest effect?"

> "Rank lead, cadmium, and mercury by their effect on kidney markers."

> "Which phthalate metabolite has the strongest association with testosterone?"

### Reverse Causality Testing
> "Is the gamma-tocopherol association with glucose driven by disease status? Run a sensitivity analysis excluding diagnosed diabetics."

> "Test whether the PFOA-cholesterol association survives when people with diagnosed high cholesterol are excluded."

### Diet Quality
> "What is the average HEI score in the US population? How much phenotypic variation does diet quality explain?"

> "Compare the R-squared of the Healthy Eating Index versus individual nutrients for HbA1c."

### Dose-Response
> "Run a dose-response analysis of blood lead versus uric acid using restricted cubic splines."

> "Is the cadmium-creatinine relationship linear or does it have a threshold?"

### Cross-Cohort Comparison
> "Which HHEAR cohorts measured arsenic? How do the levels compare across countries?"

> "Compare lead levels in children across all available HHEAR cohorts."

---

## Understanding Effect Sizes

A critical context for interpreting atlas results:

| Effect Size (|β|) | Meaning | Example |
|-------------------|---------|---------|
| < 0.03 | Negligible | Most individual dietary nutrients |
| 0.03 – 0.08 | Very small | BPA → BMI, many metal associations |
| 0.08 – 0.15 | Small | PFOA → uric acid (0.111), lead → creatinine |
| > 0.15 | Moderate | Cotinine → WBC (0.196), PFOA → albumin (0.177) |

**Median R² for a significant association: 0.6%**
**The effect of going from P25 to P75 of lead on uric acid ≈ aging 1–2 years**

Most individual exposure effects are smaller than day-to-day variation in the outcome. They matter through accumulation (many small effects) and sustained exposure over years — not through single acute events.

---

## What ExposomeQL Cannot Tell You

1. **Causation.** All EP-WAS associations are observational. A significant association does not mean the exposure causes the outcome.
2. **Your personal risk.** Population-level β_between ≠ individual β_within. Your response to changing an exposure may differ from the population average.
3. **Future disease.** Cross-sectional data captures a snapshot, not a trajectory.
4. **Mixture interactions.** The atlas tests exposures one at a time. Real-world co-exposures may interact in ways not captured.
5. **Medical advice.** ExposomeQL provides data context, not clinical recommendations. Consult your physician.

---

## Tools Reference (52 tools)

| Category | Tools | Use For |
|----------|-------|---------|
| Descriptive | nhanes_mean, nhanes_prevalence, nhanes_trend, etc. | Population statistics |
| EP-WAS Search | epwas_search, epwas_summary, epwas_phenotype_profile | Querying the atlas |
| Modeling | nhanes_model, nhanes_dose_response, nhanes_mediation | Advanced analysis |
| HHEAR Cohorts | cohort_list, cohort_mean, cross_cohort_compare | Independent replication |
| CTD | ctd_chemical_genes, ctd_triangulate | Mechanistic evidence |
| Nutrients | nutrient_triangulate, nutrient_concordance_summary | Diet evidence |
| Diagnostics | simpson_paradox_test, confounder_check, exposure_compare | Methodological rigor |
| Personal | my_exposome, find_doppelgangers, measurement_uncertainty | Individual context |
| Diet | diet_assess, diet_quality | Dietary assessment |
| Sensitivity | nhanes_sensitivity | Reverse causality testing |

---

---

## Plain English FAQ

### "If everything causes everything, why bother testing?"
Not everything causes everything. Of the 115,000 associations tested, only about 5% (5,600) were statistically significant — and most of those are small. The point is to find which exposures have the strongest and most consistent signals, so we know where to focus public health efforts.

### "The effect sizes are tiny. Does that mean environment doesn't matter?"
No. It means *individual* chemicals have small effects. But you're exposed to hundreds simultaneously, and they accumulate over years. Think of it like rain: any single drop is negligible, but steady rain fills rivers. The study found that 20 exposures together can explain 43% of triglyceride variation — rivaling genetics.

### "Why should I trust this over what I read in the news?"
News articles often report single studies with dramatic claims. ExposomeQL queries an atlas of **66.8 million** associations meta-analyzed across 20 years of nationally representative data with proper statistical methods. It also checks for confounding, Simpson's paradox, and reverse causality — things news articles never mention.

### "My doctor doesn't ask about environmental exposures. Should I bring this up?"
If you have specific concerns (e.g., living near an industrial site, occupational exposure, contaminated water), yes. For general population-level exposures (PFAS in food, trace metals), the effects are typically too small to warrant individual clinical action. The exception: smoking, which has the largest and most consistent effects across the atlas.

### "What's the single most important thing the atlas shows?"
That the exposome is like the genome: distributed across many small effects, not dominated by a single factor. Just as there's no single "gene for height," there's no single "chemical that causes disease." Environmental health is about patterns, accumulation, and combinations — and we finally have the data to study it at that scale.

### "Can I use this to decide whether to buy organic food / filter my water / avoid plastic?"
ExposomeQL can show you the population-level associations for specific chemicals (pesticide residues, water contaminants, BPA). But remember: the typical effect size is R² < 1%. Whether those effects are worth the cost/effort of avoidance is a personal value judgment, not a scientific one. The data can inform your decision; it can't make it for you.

---

## Further Reading

- Patel CJ, Ioannidis JPA, Manrai AK. An atlas of exposome–phenome associations in health and disease risk. *Nature Medicine* (2026). https://www.nature.com/articles/s41591-026-04266-0
- HMS News: "A Large-Scale Look at the Exposome." https://hms.harvard.edu/news/large-scale-look-exposome
- EP-WAS Atlas Browser: https://pe.exposomeatlas.com
- nhanespewas R package: https://github.com/chiragjp/nhanespewas
- ExposomeQL MCP Server: https://github.com/chiragjp/exposomeql
