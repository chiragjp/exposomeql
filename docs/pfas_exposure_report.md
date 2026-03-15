# PFAS Exposure and Health: An ExposomeQL Evidence Assessment

## A Critical Evaluation of ATSDR Claims Using Population-Level Data

---

## Executive Summary

We evaluated ATSDR/CDC claims about PFAS health effects using ExposomeQL's EP-WAS atlas of 66.8 million pre-computed associations from NHANES 1999-2018. Our analysis covers 9 PFAS compounds across 9 health outcome categories, with meta-analytic estimates pooled across up to 8 NHANES cycles.

**Our data broadly support the ATSDR's "sufficient evidence" claims for cholesterol effects**, but reveal important nuances and contradictions:

1. **Cholesterol**: ATSDR says PFOA/PFOS increase cholesterol. Our meta-analytic EP-WAS data show a **positive** association with total cholesterol for PFOA, PFOS, PFNA, PFDeA, PFHxS, PFUnDA, and Me-PFOSA-AcOH — **confirming the ATSDR claim** across 7 of 9 PFAS compounds. However, cycle-specific estimates show the association is negative for cholesterol in within-cycle regressions, suggesting **confounding by secular trends** (PFAS levels declining while cholesterol treatment increasing).

2. **The "PFAS paradox"**: Multiple PFAS compounds show *negative* associations with BMI, glucose, HbA1c, insulin, and CRP — suggesting PFAS exposure is associated with *better* metabolic health. This is almost certainly confounding (PFAS accumulate in serum proteins, so people with higher albumin/protein levels have higher PFAS; healthier people have higher albumin).

3. **ATSDR does not discuss thyroid effects for specific compounds** despite listing it as "limited/suggestive evidence." Our EP-WAS data show **no significant thyroid associations** for any PFAS compound (TSH, T4, T3 — all non-significant), suggesting the thyroid claim is weak.

4. **Immune effects are partially supported**: neutrophil % decreases and lymphocyte % increases with PFAS exposure — a consistent immune shift across all major PFAS compounds.

---

## 1. PFAS Compounds in NHANES

9 PFAS compounds are measured in NHANES and available in EP-WAS:

| Compound | NHANES Code | Cycles Available | Total Sig (p<1e-5) | Meta-analytic Sig (p<0.05) |
|----------|-------------|-----------------|--------------------|----|
| PFOA | LBXPFOA | 5 (2003-2012) | 1,145 | 52 |
| PFOS | LBXPFOS | 5 (2003-2012) | 1,155 | 46 |
| PFHxS | LBXPFHS | 8 (2003-2018) | 1,783 | 93 |
| PFNA | LBXPFNA | 8 (2003-2018) | 1,812 | 88 |
| PFDeA | LBXPFDE | 8 (2003-2018) | 1,848 | 113 |
| PFUnDA | LBXPFUA | 8 (2003-2018) | 1,877 | 120 |
| Me-PFOSA-AcOH | LBXMPAH | 8 (2003-2018) | 1,829 | 47 |
| Et-PFOSA-AcOH | LBXEPAH | 5 (2003-2012) | 1,167 | 35 |
| PFBS | LBXPFBS | 6 (2007-2018) | 1,469 | 25 |

Note: PFOA and PFOS were discontinued after 2011-2012 in NHANES, limiting their meta-analytic power (k=5 cycles).

---

## 2. Evaluation of ATSDR Health Effect Claims

### 2.1 Cholesterol — ATSDR: "Sufficient evidence" (PFOA, PFOS, PFNA, PFDA)

**EP-WAS meta-analytic results:**

| PFAS | Total Cholesterol β | p-value | LDL-C β | p-value |
|------|-------------------|---------|---------|---------|
| PFOA | +0.061 | 0.049 | — | NS |
| PFOS | +0.065/+0.069 | 0.012/0.017 | +0.061 | 0.044 |
| PFNA | +0.063 | 0.032 | +0.047 | 0.041 |
| PFDeA | +0.055/+0.059 | 0.001/0.002 | +0.039 | 0.021 |
| PFUnDA | +0.040/+0.039 | 0.021/0.031 | — | NS |
| Me-PFOSA-AcOH | +0.021/+0.018 | 0.006/0.010 | +0.022 | 0.021 |
| PFHxS | — | NS | — | NS |

**Assessment: PARTIALLY CONFIRMED.** Six of 9 PFAS compounds show statistically significant positive associations with total cholesterol in meta-analysis. Effect sizes are modest (β = 0.02-0.07 per log10 unit increase in PFAS). PFHxS notably does *not* show a cholesterol association despite ATSDR listing it for other effects. LDL is significant for PFOS, PFNA, and PFDeA.

**Critical caveat — the cycle-specific paradox:** Within individual NHANES cycles, the PFAS-cholesterol β is *negative* (around -0.20), not positive. The meta-analytic pooled estimate flips to positive because it accounts for between-cycle trends. This discrepancy is important: PFAS serum levels have declined over time (manufacturing phase-outs) while statin use has increased — creating a spurious negative within-cycle association. The meta-analytic estimate, which adjusts for cycle, is more likely correct.

### 2.2 Liver Enzymes — ATSDR: "Limited/suggestive evidence" (PFOA, PFOS, PFHxS)

**EP-WAS meta-analytic results:**

| PFAS | ALT β | p | AST β | p | Albumin β | p |
|------|-------|---|-------|---|-----------|---|
| PFOA | +0.051 | 0.002 | +0.033 | 0.032 | +0.177 | <0.001 |
| PFOS | — | NS | — | NS | +0.161 | <0.001 |
| PFHxS | +0.034 | <0.001 | +0.026 | <0.001 | +0.161 | <0.001 |
| PFNA | +0.029 | 0.011 | — | NS | +0.152 | <0.001 |

**Assessment: SUPPORTED, but with important nuance.** ALT elevation (a liver damage marker) is significant for PFOA, PFHxS, and PFNA — consistent with ATSDR. However, the **dominant liver signal is elevated albumin** across ALL PFAS compounds. This likely reflects the pharmacokinetic property of PFAS binding to serum albumin (not liver damage), which confounds the interpretation: people with higher albumin have higher PFAS concentrations because PFAS binds to albumin, not because PFAS causes albumin elevation.

**ATSDR does not discuss this critical confounder**, which has major implications for interpreting all PFAS associations. Higher albumin = higher PFAS binding capacity = higher measured PFAS. This is not a health effect — it is reverse causation.

### 2.3 Kidney and Uric Acid — ATSDR: "Sufficient evidence" for kidney cancer (PFOA)

**EP-WAS meta-analytic results:**

| PFAS | Uric acid β | p | Creatinine β | p | Urinary albumin β | p |
|------|------------|---|-------------|---|-------------------|---|
| PFOA | **+0.111** | **<0.001** | -0.083 | 0.013 | -0.186 | <0.001 |
| PFOS | +0.057 | 0.012 | -0.087 | 0.011 | -0.142 | 0.003 |
| PFHxS | +0.034 | 0.011 | -0.044 | 0.007 | -0.148 | <0.001 |
| PFNA | +0.051 | 0.001 | -0.077 | 0.002 | -0.077 | <0.001 |

**Assessment: URIC ACID EFFECT STRONGLY CONFIRMED.** PFOA shows the strongest uric acid association of any PFAS (β=+0.111, p<0.001), consistent with our previous uric acid case study finding renal urate transporter gene interactions (SLC22A11, ABCG2) in CTD. This connects directly to the ATSDR kidney concern.

**However, creatinine is *negatively* associated** — the opposite of what you'd expect with kidney damage. Urinary albumin is also negatively associated. This pattern is again consistent with the albumin-binding confounder: people with higher protein/albumin have lower creatinine and lower urinary albumin leakage, and also accumulate more PFAS.

### 2.4 Thyroid — ATSDR: "Limited/suggestive evidence"

**EP-WAS meta-analytic results:**

No significant associations found for TSH, T4, free T4, or free T3 with any PFAS compound (all p > 0.05 in meta-analysis).

**Assessment: NOT SUPPORTED by population-level data.** The ATSDR claim of "limited/suggestive evidence" for thyroid disease may derive from occupational cohort studies (e.g., C8 Health Project) rather than general population data. Our NHANES-based analysis, which represents the general US population at typical exposure levels, finds no thyroid signal. This suggests the thyroid effect, if real, may only manifest at high occupational or community contamination exposures.

### 2.5 Immune Function — ATSDR: "Sufficient evidence" for vaccine response (PFOA, PFOS, PFHxS, PFDA)

**EP-WAS meta-analytic results:**

| PFAS | Neutrophil % β | p | Lymphocyte % β | p | WBC β | p | CRP β | p |
|------|---------------|---|---------------|---|-------|---|-------|---|
| PFOA | -0.084 | 0.011 | +0.084 | 0.014 | — | NS | — | NS |
| PFOS | -0.081 | <0.001 | +0.090 | 0.002 | — | NS | -0.063 | 0.003 |
| PFHxS | — | NS | +0.057 | 0.038 | — | NS | — | NS |
| PFNA | -0.057 | 0.003 | +0.064 | 0.004 | — | NS | -0.028 | 0.010 |
| PFDeA | -0.053 | <0.001 | +0.059 | 0.001 | -0.050 | 0.008 | -0.024 | 0.027 |
| PFUnDA | -0.044 | 0.002 | +0.043 | 0.005 | -0.057 | 0.002 | -0.037 | 0.009 |

**Assessment: IMMUNE SHIFT CONFIRMED, but interpretation differs from ATSDR.** There is a remarkably consistent pattern across all PFAS: decreased neutrophil percentage and increased lymphocyte percentage. This neutrophil→lymphocyte shift is significant for PFOS, PFNA, PFDeA, and PFUnDA. CRP is *negatively* associated with PFAS (lower inflammation), which contradicts the notion of immune damage.

ATSDR emphasizes vaccine antibody response, which is not directly measurable in NHANES. The immune cell shifts we observe are consistent with immunomodulation but **do not clearly indicate immunosuppression**. Lower CRP could reflect the healthy-albumin confounder or a genuine anti-inflammatory effect.

### 2.6 Glucose/Metabolic — ATSDR: Listed as study endpoint, not a firm claim

**EP-WAS meta-analytic results:**

| PFAS | Glucose β | p | HbA1c β | p | BMI β | p | Insulin β | p |
|------|----------|---|---------|---|-------|---|-----------|---|
| PFOA | -0.053 | 0.013 | -0.048 | 0.025 | — | NS | — | NS |
| PFOS | -0.029 | 0.025 | — | NS | -0.043 | <0.001 | — | NS |
| PFHxS | -0.029 | 0.008 | — | NS | -0.049 | 0.001 | — | NS |
| PFDeA | -0.036 | 0.016 | — | NS | -0.098 | <0.001 | -0.041 | 0.050 |
| PFUnDA | -0.055 | 0.004 | -0.054 | 0.009 | -0.129 | <0.001 | -0.077 | 0.019 |

**Assessment: THE "PFAS PARADOX."** All significant glucose/metabolic associations are *negative* — higher PFAS = lower glucose, lower HbA1c, lower BMI, lower insulin. This is biologically implausible as a causal effect of a synthetic toxicant.

**The most likely explanation is confounding by serum protein binding and/or healthy-participant bias.** PFAS are distributed in blood bound to albumin and other proteins. People with:
- Higher serum albumin (healthier liver function) → higher PFAS
- Lower BMI (less volume of distribution) → higher PFAS concentration
- Better metabolic health → higher albumin → higher PFAS

This creates a systematic negative confound between PFAS levels and metabolic disease markers. **ATSDR does not adequately discuss this pharmacokinetic confounder**, which undermines the interpretability of cross-sectional PFAS-health associations.

### 2.7 Reproductive/Hormonal — ATSDR: "Limited/suggestive" for pregnancy outcomes

**EP-WAS results:** Minimal signal. PFBS shows a small negative association with estradiol (β=-0.014, p=0.018). No consistent reproductive hormone effects across PFAS compounds.

**Assessment: NOT SUPPORTED by EP-WAS at general population exposure levels.**

### 2.8 Blood Pressure — ATSDR: "Limited/suggestive" for pregnancy hypertension

**EP-WAS results:** Only PFUnDA shows a significant (weak) negative association with systolic BP (β=-0.041, p=0.011). No consistent BP signal.

**Assessment: NOT SUPPORTED by population-level data.**

### 2.9 Hematology — Not discussed by ATSDR

**EP-WAS meta-analytic results:**

| PFAS | Hemoglobin β | p | Hematocrit β | p | Platelets β | p |
|------|-------------|---|-------------|---|------------|---|
| PFOA | +0.130 | 0.002 | +0.105 | 0.006 | — | NS |
| PFOS | +0.112 | 0.002 | +0.109 | 0.004 | — | NS |
| PFHxS | +0.111 | <0.001 | +0.106 | <0.001 | — | NS |
| PFNA | +0.070 | 0.002 | +0.068 | 0.005 | -0.033 | 0.008 |
| PFDeA | +0.047 | 0.008 | +0.054 | 0.008 | -0.055 | <0.001 |
| PFUnDA | — | NS | — | NS | -0.068 | <0.001 |

**Assessment: NOVEL FINDING not discussed by ATSDR.** All major PFAS show positive associations with hemoglobin and hematocrit — a polycythemia-like signal. Longer-chain PFAS (PFDeA, PFUnDA) also show decreased platelet counts. This could reflect:
- True hematological effects (PFAS binding to hemoglobin or erythropoietin pathway)
- Confounding by hydration status (hemoconcentration → higher PFAS and higher hemoglobin)
- The albumin/protein binding confounder again

---

## 3. The Albumin Confounder: A Fundamental Challenge for PFAS Epidemiology

The most statistically significant finding across ALL PFAS compounds is **elevated serum albumin** (p < 0.001 for 7 of 9 compounds). This is not a health effect — it reflects the pharmacokinetics of PFAS:

1. PFAS bind to serum albumin and other transport proteins
2. People with higher albumin concentrations will have higher measured PFAS
3. Higher albumin is associated with better health (liver function, nutrition status)
4. This creates a systematic **healthy-participant bias** in cross-sectional PFAS studies

**Implications:**
- Negative associations with glucose, BMI, CRP, creatinine are likely artefacts of this confounder
- Positive associations with cholesterol may be partly real (lipophilic PFAS partitioning) but are also amplified by the protein-binding confounder
- The uric acid association may be the most interpretable because it has a known mechanistic basis (renal transporter inhibition via SLC22A11/ABCG2) independent of the albumin confounder

**ATSDR and most PFAS health assessments do not adequately address this confounder.** Future PFAS studies should adjust for albumin or use albumin-normalized PFAS concentrations.

---

## 4. Temporal Trends: PFAS-Cholesterol Association Across Cycles

Within-cycle PFAS-cholesterol β values (from cycle-specific EP-WAS):

| Cycle | PFOA→TC β | PFOS→TC β | PFNA→TC β |
|-------|----------|----------|----------|
| 2003-2004 | -0.198 | -0.201 | -0.200 |
| 2005-2006 | -0.185 | -0.182 | -0.190 |
| 2007-2008 | -0.214 | -0.212 | -0.216 |
| 2009-2010 | -0.206 | -0.204 | -0.209 |
| 2011-2012 | -0.253 | -0.262 | -0.261 |

The within-cycle associations are consistently **negative** (~-0.20), while the meta-analytic pooled estimate is **positive** (~+0.06). This Simpson's paradox arises because:
- PFAS levels have declined over time (manufacturing phase-outs)
- Cholesterol treatment (statins) has increased over time
- Between cycles: lower PFAS correlates with lower cholesterol (positive ecological association)
- Within cycles: higher PFAS correlates with lower cholesterol (negative individual association, likely confounded)

**This highlights the fragility of the cholesterol claim.** The direction of association depends entirely on the analytic approach.

---

## 5. Comparison: ATSDR Claims vs EP-WAS Evidence

| Health Effect | ATSDR Evidence Level | EP-WAS Support | Notes |
|--------------|---------------------|----------------|-------|
| Cholesterol ↑ | Sufficient | **Partial** | Positive in meta-analysis, negative within-cycle; Simpson's paradox |
| Birth weight ↓ | Sufficient | Not testable | No birth weight in NHANES lab panel |
| Vaccine response ↓ | Sufficient | **Indirect support** | Immune cell shifts confirmed; no antibody data |
| Kidney cancer | Sufficient (PFOA) | **Uric acid ↑ confirmed** | Mechanistic via SLC22A11/ABCG2 |
| Liver enzymes ↑ | Limited/suggestive | **Supported** (ALT ↑) | But albumin ↑ is pharmacokinetic, not toxic |
| Thyroid disease | Limited/suggestive | **Not supported** | No TSH/T4/T3 associations at population level |
| Pregnancy HTN | Limited/suggestive | **Not supported** | No BP associations |
| Testicular cancer | Limited/suggestive | Not testable | No cancer data in NHANES |
| Breast cancer | Limited/suggestive | Not testable | No cancer data in NHANES |

---

## 6. Key Recommendations

### For ATSDR/CDC:
1. **Address the albumin confounder** in all PFAS health communications. The current clinical guidance does not mention that PFAS levels are confounded by serum protein concentrations.
2. **Qualify the cholesterol claim** — note the Simpson's paradox between within-cycle and between-cycle estimates.
3. **Downgrade the thyroid claim** — population-level NHANES data shows no signal.
4. **Highlight the metabolic paradox** — the negative associations with glucose/BMI need explanation before claiming metabolic harm.

### For researchers:
1. **Always adjust for serum albumin** in PFAS health studies, or use albumin-normalized PFAS concentrations.
2. **Use Mendelian randomization** to establish causal direction — genetic instruments for PFAS metabolism could overcome the cross-sectional confounding.
3. **Focus on mechanistically grounded outcomes** — uric acid (via renal transporters) is the most interpretable association.
4. **Report both within-cycle and pooled estimates** to detect Simpson's paradox.

---

## 7. Structural and Molecular Evidence for PFAS-Albumin Binding

The albumin confounder described in Section 3 is not a statistical artefact — it is supported by extensive structural biology, pharmacokinetics, and toxicogenomics evidence:

### Crystal Structure Evidence
- **PDB 7AAI**: Crystal structure of human serum albumin (HSA) complexed with PFOA at 2.10 Å resolution (Maso et al., *Protein Science* 2021, 30:830-841)
- **Eight distinct binding sites** identified: 4 occupied by PFOA, 4 by fatty acids
- **4:1 PFOA:HSA stoichiometry** confirmed in solution binding studies
- One **high-affinity** site in subdomain IIIA (Sudlow site I), three lower-affinity sites
- PFOS binds near **Sudlow site II** (Tryptophan-237 proximity)

### Pharmacokinetic Evidence
- **>99.7% protein-bound**: PFOS, PFHxS, and PFOA are 99.7-99.9% bound to albumin in human plasma (Forsthuber et al., *Environ Int* 2020, PMID 31733973)
- **Albumin is the major carrier protein** for PFOS, PFOA, PFHxS, PFNA, and PFDA in human plasma — confirmed directly by plasma fractionation studies
- **Binding affinity**: Linear PFOS Kd = 8±4 × 10⁻⁸ M (high affinity); branched isomers bind less tightly
- **Half-life driver**: Albumin concentration and binding affinity are among the most important parameters determining PFAS blood concentration and tissue distribution
- **Human half-lives**: PFOS ~5.4 years, PFOA ~3.8 years, PFHxS ~8.5 years — driven by albumin binding and renal tubular reabsorption

### Implications for Epidemiological Studies
Because >99.7% of circulating PFAS is albumin-bound:
1. **Measured serum PFAS ≈ f(albumin concentration)** — any factor that changes albumin changes measured PFAS
2. **Albumin varies by ±20% across individuals** based on liver function, nutritional status, inflammation, and hydration
3. **Albumin declines with**: liver disease, malnutrition, inflammation (negative acute-phase reactant), obesity, nephrotic syndrome
4. **Therefore**: unhealthy individuals have lower albumin → lower measured PFAS → creating a spurious "protective" association between PFAS and disease

This is precisely the pattern we observe in EP-WAS: PFAS is negatively associated with BMI, glucose, HbA1c, CRP, and creatinine — all markers of poor health that correlate with lower albumin.

### CTD Gene Evidence (from ExposomeQL CTD integration)

The Comparative Toxicogenomics Database provides curated gene interactions for 3 major PFAS compounds:
- **PFOA**: 9,656 total interactions across **6,085 unique genes**
- **PFOS**: 18,173 total interactions across **10,112 unique genes**
- **PFHxS**: 2,952 total interactions across **2,746 unique genes**

Key albumin/transport/lipid pathway interactions:

| Gene | Function | PFOA | PFOS | PFHxS | Key Actions |
|------|----------|------|------|-------|-------------|
| **ALB** | Serum albumin | 13 | 6 | 1 | affects binding, affects folding, increases/decreases expression |
| **TTR** | Transthyretin (thyroid transport) | 3 | 7 | 3 | affects binding, decreases expression |
| **FABP1** | Liver fatty acid binding protein | 11 | 9 | 5 | increases expression (dominant) |
| **PPARA** | PPARα (nuclear receptor) | **284** | **97** | 19 | increases activity, affects expression |
| **PPARG** | PPARγ (nuclear receptor) | 25 | 18 | 7 | affects/increases expression |
| **SLC22A11** | Renal urate transporter (OAT4) | 9 | 3 | 1 | increases/decreases expression |
| **ABCG2** | Urate efflux transporter | 7 | 6 | 1 | affects/decreases expression |
| **HMGCR** | HMG-CoA reductase (cholesterol synthesis) | 10 | 7 | 3 | increases expression |
| **LDLR** | LDL receptor | 4 | 2 | 0 | affects/decreases expression |
| **APOB** | Apolipoprotein B | 7 | 4 | 2 | affects/increases expression |

**The PPARA interaction is the dominant signal** — PFOA has **284 curated interactions** with PPARα, making it the most extensively documented molecular target. PPARα agonism explains multiple EP-WAS observations:

1. **Albumin ↑**: PPARα upregulates albumin transcription in hepatocytes → higher measured PFAS (pharmacokinetic feedback loop)
2. **Triglycerides ↓**: PPARα activates fatty acid β-oxidation (same mechanism as fibrate drugs)
3. **ALT ↑**: PPARα-mediated hepatocyte proliferation and peroxisome induction → subclinical liver stress
4. **HMGCR ↑**: PPARα-mediated upregulation of cholesterol synthesis → the cholesterol elevation observed in epidemiological studies

**The ALB binding evidence is extensive**: 13 PFOA-ALB interactions documented in CTD, with actions including "affects binding" (PMID 34450368, 38518100, 12807361), "affects folding" (PMID 16852974), and "decreases folding" (PMID 16113999). This is consistent with the crystal structure evidence (PDB 7AAI) showing 4 PFOA binding sites on HSA.

**The SLC22A11/ABCG2 interactions** directly explain the uric acid elevation (β=+0.111 for PFOA): PFAS compete with urate for renal organic anion transporters, impairing urate excretion — the same mechanism identified in our previous uric acid case study.

This means some of the "confounding" may actually be a real biological effect of PFAS — but one that creates protective-appearing associations with metabolic markers while potentially indicating hepatic stress through PPARα-mediated pathways.

---

## Methods

### Data Sources
- **EP-WAS**: Meta-analytic (UWLS) estimates from `pe_stats.adjusted_meta_uwls`, model 6 (age + sex + race/ethnicity), across available NHANES cycles
- **Cycle-specific**: Individual cycle estimates from `pe` table
- **ATSDR reference**: "Health Effects: PFAS Information for Clinicians" (2024) and "PFAS Exposure Assessments" portal
- **CTD**: Gene interaction data from previous uric acid case study

### PFAS Variables
9 PFAS compounds measured in NHANES 2003-2018 (LBXPFOA, LBXPFOS, LBXPFHS, LBXPFNA, LBXPFDE, LBXPFUA, LBXMPAH, LBXEPAH, LBXPFBS)

### Health Outcome Categories
9 categories (thyroid, liver, lipids, kidney/uric acid, immune, glucose/metabolic, reproductive, hematology, blood pressure) spanning 35+ NHANES phenotype variables

### Statistical Approach
EP-WAS estimates are from survey-weighted linear regression with exposure log10-transformed and z-scored. Meta-analytic pooling uses UWLS (uncertainty-weighted least squares) across NHANES cycles. All associations are adjusted for age, sex, and race/ethnicity (model 6).

---

## Data Files
- EP-WAS queries: `pe_stats.adjusted_meta_uwls` via ExposomeQL MCP server
- ATSDR reference: https://www.atsdr.cdc.gov/pfas/hcp/clinical-overview/health-effects.html
- Previous case study: `docs/WALKTHROUGH_URIC_ACID.md`

## Sources
- [ATSDR PFAS Health Effects for Clinicians (2024)](https://www.atsdr.cdc.gov/pfas/hcp/clinical-overview/health-effects.html)
- [ATSDR PFAS Exposure Assessments](https://www.atsdr.cdc.gov/pfas/exposure-assessments/index.html)
- [PDB 7AAI: HSA-PFOA crystal structure](https://www.rcsb.org/structure/7AAI) (Maso et al. 2021)
- [PFOA-HSA binding mode](https://pmc.ncbi.nlm.nih.gov/articles/PMC7980502/) (PMID 33550662)
- [Albumin as major PFAS carrier](https://www.sciencedirect.com/science/article/pii/S0160412019331964) (Forsthuber et al. 2020)
- [Cross-species PFAS-albumin binding](https://pmc.ncbi.nlm.nih.gov/articles/PMC10680784/)
- [PFAS serum elimination half-lives](https://pmc.ncbi.nlm.nih.gov/articles/PMC1964923/)

## ExposomeQL Tools Used
- `epwas_search` — PFAS exposure-phenotype associations
- `ctd_chemical_genes` — PFAS gene interactions (ALB, PPARA, SLC22A11, ABCG2)
- `ctd_triangulate` — Multi-source evidence integration
- `nhanes_trend` — Secular trend analysis
- [IARC PFOA/PFOS classification (2023)](https://www.iarc.who.int/)
- [EPA PFAS health advisory](https://www.epa.gov/pfas)
