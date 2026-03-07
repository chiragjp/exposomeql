export const EPWAS_METHODS = `# EP-WAS (Exposome-Phenome Wide Association Study) Methods

## Overview
EP-WAS systematically tests associations between environmental exposures and health phenotypes
using survey-weighted regression across multiple NHANES cycles. The approach mirrors GWAS methodology
applied to the exposome.

## Pipeline
1. **Variable Pairing**: Each of 619 exposures is paired with each of 305 phenotypes
2. **Data Type Detection**: Exposures are classified as continuous, continuous-rank, or categorical
3. **Transformation**: Continuous exposures are log10-transformed and z-scored by survey-weighted mean/SD
4. **Adjustment Scenarios**: Each pair is tested under 9 covariate adjustment models:
   - Model 1: Base (unadjusted)
   - Model 2: Fully adjusted (age + sex + ethnicity + income + education)
   - Model 3: Age + sex
   - Model 4: Age only
   - Model 5: Sex only
   - Model 6: Age + sex + ethnicity
   - Model 7: Age + sex + income + education
   - Model 8: Income + education
   - Model 9: Ethnicity only
5. **Domain-Specific Adjustments**: Dietary exposures add calorie adjustment; urinary exposures add creatinine
6. **Meta-Analysis**: UWLS (Unrestricted Weighted Least Squares) pools estimates across NHANES cycles
7. **Heterogeneity**: Reports I², H², and Cochran's Q for cross-cycle consistency

## Vibration of Effects (VoE)
VoE quantifies analytic sensitivity by showing how effect estimates vary across the 9 adjustment models.
A wide vibration range (large difference between min and max estimates) indicates the association is
sensitive to covariate choice — interpret with caution.

## Interpretation
- Effect sizes represent the change in phenotype per 1-SD increase in log10-transformed exposure
- P-values are nominal — apply Bonferroni or FDR correction for multiple comparisons
- I² > 50% suggests substantial heterogeneity across NHANES cycles
- Associations that replicate across cycles (low I²) with consistent direction are more robust

## Reference
Patel CJ. "Benchmarking exposome research: An atlas of exposome-phenome associations."
medRxiv 10.1101/2025.06.05.25329055v2
`;

export const VOE_GUIDE = `# Vibration of Effects (VoE) Interpretation Guide

## What is VoE?
VoE measures how much an estimated association changes when you vary the analytic approach —
specifically, which covariates are included in the model. A robust finding should be relatively
stable regardless of model specification.

## Reading VoE Results
- **Range (max - min estimate)**: The spread of effect estimates across models
- **Direction consistency**: Do all models agree on the direction of association?
- **Relative range**: Range / |mean estimate| — if > 1.0, the association is highly sensitive

## Interpretation
- **Low VoE** (relative range < 0.5): Effect estimate is stable. Interpretation is robust.
- **Moderate VoE** (0.5-1.0): Some sensitivity. Report the fully adjusted estimate with caveat.
- **High VoE** (> 1.0): High sensitivity to model specification. Interpret with caution.
  The exposure-phenotype association may be confounded or unstable.

## Common Patterns
- Adding ethnicity changes estimate: suggests confounding by sociodemographic factors
- Adding income/education changes estimate: suggests socioeconomic confounding
- Base model very different from adjusted: unmeasured confounding likely
`;
