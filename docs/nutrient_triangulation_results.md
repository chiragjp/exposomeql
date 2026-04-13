# Nutrient Triangulation Results: Meta-Analytic vs EP-WAS Concordance

## Date: March 2026 (updated with source verification corrections)

## Overview
Systematic comparison of published meta-analytic evidence (predominantly from RCTs; 61/64 entries from RCT meta-analyses, plus 1 observational MA, 1 mixed RCT+cohort, 1 MR) against EP-WAS observational associations for 14 nutrients across 41 biomarker-outcome pairs. Each meta-analytic effect direction was compared to the corresponding EP-WAS association direction (using dietary recall DR1T* variables as exposures, model 6 adjustment). Concordance does not establish causality — it evaluates whether observational and experimental/meta-analytic evidence point in the same direction.

## Overall Concordance

| Metric | Count | Percentage |
|--------|-------|-----------|
| Concordant | 25 | 61% |
| Discordant | 13 | 32% |
| RCT null | 5 | — |
| **Total tested** | **41** | — |

## Per-Nutrient Results

| Nutrient | Exposure Var | Concordant | Discordant | RCT Null | Concordance |
|----------|-------------|-----------|------------|----------|-------------|
| Magnesium | DR1TMAGN | 6 | 1 | 0 | 86% |
| Vitamin D | DR1TVD | 4 | 1 | 1 | 80% |
| Fiber | DR1TFIBE | 4 | 1 | 0 | 80% |
| Vitamin C | DR1TVC | 3 | 0 | 0 | 100% |
| Calcium | DR1TCALC | 1 | 0 | 0 | 100% |
| Zinc | DR1TZINC | 1 | 0 | 0 | 100% |
| Vitamin B12 | DR1TVB12 | 1 | 0 | 0 | 100% |
| Sodium | DR1TSODI | 2 | 1 | 0 | 67% |
| Potassium | DR1TPOTA | 2 | 1 | 0 | 67% |
| Vitamin E | DR1TATOC | 1 | 1 | 0 | 50% |
| Folic acid | DR1TFOLA | 0 | 1 | 0 | 0%* |
| Iron | DR1TIRON | 0 | 4 | 0 | 0% |
| Omega-3 | DR1TP226 | 0 | 2 | 2 | 0% |
| Selenium | DR1TSELE | 0 | 0 | 2 | — |

*Folic acid concordance logic affected by Ratio effect measure

## Recurring Discordance Patterns

### 1. Diastolic blood pressure
RCTs show sodium, potassium, and magnesium all reduce diastolic BP. EP-WAS shows *positive* β for MDIASTOLIC across all three nutrients. Likely reverse causation in cross-sectional data (people with higher BP modify diet).

### 2. Iron → hemoglobin/ferritin
RCTs clearly show iron supplementation raises hemoglobin (+2 g/dL in children, +0.9 g/dL in pregnancy) and ferritin. EP-WAS shows *negative* β. Classic confounding: iron supplementation RCTs target anemic/deficient populations; NHANES dietary recall captures total dietary iron in the general population where higher intake correlates with meat consumption and overall caloric intake.

### 3. Omega-3 → triglycerides
RCTs show omega-3 lowers triglycerides (SMD -0.25). EP-WAS shows *positive* β. Dietary DHA (DR1TP226) intake is correlated with overall diet quality and caloric intake.

### 4. LDL cholesterol
Multiple nutrients (fiber, omega-3, vitamin E) show discordance for LDL. The LBDLDL phenotype may have measurement/calculation issues across NHANES cycles (Friedewald equation).

## Biomarker vs Dietary Recall Comparison

Direct comparison of serum biomarker exposures vs 24-hour dietary recall for the same nutrient-phenotype pairs:

| Source | Concordant | Discordant | N/A | Concordance |
|--------|-----------|------------|-----|-------------|
| **Serum biomarker** | 5 | 1 | 9 | **83%** |
| **Dietary recall (DR1)** | 7 | 7 | 1 | **50%** |

### Key Example: Vitamin D → Systolic Blood Pressure
- **Dietary recall (DR1TVD)**: β = +0.04, p = 0.002 → **WRONG** direction (higher intake = higher BP)
- **Serum biomarker (LBDVIDMS)**: β = -0.87, p = 7e-5 → **CORRECT** direction (higher 25(OH)D = lower BP)
- **RCT meta-analysis**: MD = -3.84 mmHg (Juraschek 2012)

This demonstrates that biomarker-based exposures are substantially less confounded than self-reported dietary recall.

### Vitamin D → PTH
- **Dietary recall (DR1TVD)**: No significant association found
- **Serum biomarker (LBDVIDMS)**: β = -0.25, p = 2.6e-6 → **CORRECT** (higher 25(OH)D = lower PTH)
- **RCT meta-analysis**: SMD = -0.38 (Pathak 2017)

Biomarker captures the biological signal that dietary recall completely misses.

## Interpretation

1. **61% overall concordance** between meta-analytic and EP-WAS observational evidence using dietary recall is moderate — better than chance but reflecting substantial confounding in 24-hour recall data. Note: 61/64 entries are from RCT meta-analyses; 3 use non-RCT evidence (1 observational MA, 1 mixed, 1 MR).

2. **Biomarkers outperform dietary recall** (83% vs 50%) when both are available, validating the use of serum biomarkers as less confounded exposure measures.

3. **Discordance is informative** — it identifies nutrient-outcome pairs where observational evidence is misleading due to confounding, reverse causation, or measurement error.

4. **Magnesium, fiber, and vitamin C** show the strongest concordance, suggesting their dietary associations are more robust to confounding.

5. **Iron and omega-3** show systematic discordance, highlighting that these dietary variables are particularly susceptible to confounding in cross-sectional studies.

## Files
- `nutrient_rct_evidence.csv` — 64 nutrient-outcome pairs with effect estimates (17 nutrients, 34 biomarker + 29 clinical + 1 proxy)
- `nutrient_outcome_phenotype_map.csv` — 75 RCT outcomes mapped to NHANES phenotype variables
- `nutrient_rct_search_methodology.md` — Search strategy, inclusion/exclusion criteria, limitations
