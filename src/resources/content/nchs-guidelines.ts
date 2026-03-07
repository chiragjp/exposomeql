export const NCHS_GUIDELINES = `# NCHS Analytic Guidelines for NHANES Data

## Survey Weight Selection
- **WTMEC2YR**: Use for analyses involving MEC examination or laboratory data
- **WTINT2YR**: Use for interview-only variables (demographics, questionnaire)
- **WTDRD1**: Use for dietary recall day 1 variables
- **WTDRD2**: Use for dietary recall day 2 variables
- **WTSAF2YR**: Use for fasting subsample (glucose, insulin, triglycerides, LDL)

## Multi-Cycle Pooling
- When combining C cycles of 2-year data, divide 2-year weights by C
- Exception: Series A+B (1999-2002) have dedicated 4-year weights (WTMEC4YR)
- Document which cycles were pooled and weight adjustment method

## Variance Estimation
- Use Taylor series linearization with:
  - Strata: SDMVSTRA
  - PSU: SDMVPSU
  - Set survey.lonely.psu = "adjust" (R) or MISSUNIT option (SAS)
- NEVER use simple random sample formulas — they underestimate variance

## Cell Size Requirements
- Minimum unweighted count per cell: 30
- Flag estimates based on fewer than 30 observations as potentially unreliable
- Consider suppressing estimates with very small denominators

## Limit of Detection (LOD)
- For environmental chemical data, values below LOD are typically replaced with LOD/√2
- Report the percentage of values below LOD
- If >40% below LOD, mean estimates are unreliable — use prevalence above a threshold instead
- Comment code variables (e.g., LBDBPBLC) indicate below-LOD status (0=at/above LOD, 1=below LOD)

## Subpopulation Analysis
- Always use the full survey design, then subset within svyby() or domain analysis
- Do NOT physically subset the data before creating the survey design
- This ensures correct variance estimation

## Age Standardization
- Use the 2000 US Census standard population when age-standardizing
- Report both crude and age-standardized estimates when relevant
`;
