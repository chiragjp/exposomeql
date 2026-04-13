# Nutrient Meta-Analytic Evidence Curation: Search Methodology

## Objective
Curate a reference table of published meta-analytic evidence for nutrient-health outcome pairs, to serve as the third leg of a nutrient triangulation framework (alongside EP-WAS observational associations and Mendelian randomization causal estimates). The database prioritizes RCT meta-analyses but includes observational meta-analyses and MR evidence (3/64 entries) where RCT data are unavailable. The goal is directional concordance assessment, not causal inference.

## Search Strategy

### Data Sources
1. **Cochrane Database of Systematic Reviews (CDSR)** — primary source for high-quality meta-analyses
2. **PubMed** — systematic reviews and meta-analyses from high-impact journals
3. **Journal filter** — prioritized results from: NEJM, Lancet, JAMA, BMJ, Cochrane Library, Annals of Internal Medicine, Circulation, Hypertension (AHA), American Journal of Clinical Nutrition

### Search Terms
For each nutrient, we searched for: `[nutrient name] AND (supplementation OR supplement) AND (meta-analysis OR systematic review) AND (randomized controlled trial OR RCT)`

### Nutrients Searched (17 total)
Mapped to NHANES 24-hour dietary recall variables (DR1T*):
- **Vitamins:** Vitamin A (DR1TVARA), Vitamin B12 (DR1TVB12), Vitamin C (DR1TVC), Vitamin D (DR1TVD), Vitamin E (DR1TATOC), Vitamin K (DR1TVK), Folate/Folic acid (DR1TFOLA)
- **Minerals:** Calcium (DR1TCALC), Iron (DR1TIRON), Zinc (DR1TZINC), Selenium (DR1TSELE), Magnesium (DR1TMAGN), Sodium (DR1TSODI), Potassium (DR1TPOTA)
- **Fatty acids:** Omega-3 EPA (DR1TP205), Omega-3 DHA (DR1TP226)
- **Other:** Fiber (DR1TFIBE)

### Outcomes Mapped to NHANES Phenotypes
Each RCT outcome was mapped to the corresponding NHANES phenotype variable available in the EP-WAS atlas (pe_summary_stats_01_2025.sqlite, 351 phenotypes). Mapping was performed manually based on clinical equivalence:

| RCT Outcome Category | NHANES Phenotype(s) |
|----------------------|---------------------|
| Blood pressure (systolic) | BPXSY4, MSYSTOLIC |
| Blood pressure (diastolic) | MDIASTOLIC |
| BMI / body weight | BMXBMI, BMXWT |
| Waist circumference | BMXWAIST |
| Fasting glucose | LBXGLU, LBXSGL |
| HbA1c / glycohemoglobin | LBXGH |
| Insulin | LBXIN, LBXINSI |
| OGTT 2-hour glucose | LBXGLT |
| Total cholesterol | LBXSCH, LBXTC |
| LDL cholesterol | LBDLDL |
| HDL cholesterol | LBXHDD |
| Triglycerides | LBXSTR, LBXTR |
| Apolipoprotein B | LBXAPB |
| C-reactive protein | LBXCRP |
| Fibrinogen | LBXFB |
| Hemoglobin | LBXHGB |
| Hematocrit | LBXHCT |
| Ferritin | LBXFER, LBDFER |
| Serum iron | LBXIRN, LBXSIR |
| Transferrin saturation | LBDPCT |
| Serum folate | LBXFOL, LBXFOLSI, LBDFOT |
| RBC folate | LBXRBF, LBXRBFSI, LBDRFO |
| Homocysteine | LBXHCY |
| Methylmalonic acid | LBXMMA, LBXMMASI |
| Serum calcium | LBXSCA |
| Phosphorus | LBXSPH |
| PTH | LBXPT21 |
| Selenium (serum) | LBXSEL |
| Uric acid | LBXSUA |
| Creatinine | LBXSCR |
| BUN | LBXSBU |
| GGT | LBXSGTSI |
| ALT | LBXSATSI |
| AST | LBXSASSI |
| Alkaline phosphatase | LBXSAPSI |
| Albumin | LBXSAL |
| Urinary albumin | URXUMA |
| Urinary iodine | URXUIO |
| Bone mineral density (total) | DXDTOBMD |
| BMD lumbar spine | DXXLSBMD |
| BMD femoral neck | DXXNKBMD |
| BMD total femur | DXXOFBMD |
| Thyroid (TSH) | LBXTSH |
| Thyroid (T4) | LBXT4, LBXT4F |
| Testosterone | LBXTST |
| WBC count | LBXWBCSI |
| Platelet count | LBXPLTSI |
| RBC count | LBXRBCSI |
| FEV1 | SPXNFEV1 |
| FVC | SPXNFVC |
| Telomere length | TeloMean |

### Inclusion Criteria
1. Published systematic review or meta-analysis of RCTs
2. Nutrient supplementation as intervention (not dietary pattern)
3. Quantitative pooled effect estimate reported (RR, OR, HR, MD, SMD)
4. 95% confidence interval available
5. Outcome mappable to an NHANES phenotype in the EP-WAS atlas
6. Preference for most recent Cochrane review where available; otherwise most recent comprehensive meta-analysis from a high-impact journal

### Exclusion Criteria
1. Observational studies only (no RCT component)
2. Single RCTs (unless landmark trial with >10,000 participants, e.g., VITAL, REDUCE-IT)
3. Outcomes not measurable in NHANES (e.g., fracture incidence, cancer incidence, mortality — these are clinical endpoints not lab phenotypes; however, they are retained in the table for context as "clinical_endpoint" type outcomes)

### Data Extraction
For each nutrient-outcome pair, the following fields were extracted:
- `nutrient`: Nutrient name
- `nhanes_exposure_var`: NHANES dietary recall variable (DR1T*)
- `outcome`: Clinical outcome description
- `nhanes_phenotype`: Mapped NHANES phenotype variable(s) in EP-WAS
- `outcome_type`: "biomarker" (mappable to NHANES lab) or "clinical_endpoint" (disease/mortality outcome)
- `effect_measure`: RR, OR, HR, MD (mean difference), SMD, or Ratio
- `effect_estimate`: Point estimate
- `ci_lower`: Lower 95% CI bound
- `ci_upper`: Upper 95% CI bound
- `direction`: protective, harmful, beneficial, null
- `n_trials`: Number of RCTs in the meta-analysis
- `n_participants`: Total participants
- `source_type`: Cochrane, Meta-analysis, Landmark RCT
- `source_ref`: First author + year or Cochrane ID
- `journal`: Publication journal
- `pmid`: PubMed ID
- `notes`: Additional context (dose, population, certainty of evidence)

### Limitations
1. **Search not exhaustive for all possible nutrient-outcome combinations** — focused on outcomes with NHANES phenotype equivalents
2. **Publication bias** — meta-analyses themselves may be affected by publication bias in underlying RCTs
3. **Heterogeneity in RCT designs** — doses, durations, populations, and formulations vary across trials
4. **Outcome mapping imprecision** — RCT outcomes (e.g., "blood pressure") may not perfectly correspond to NHANES measurement protocols
5. **Temporal gap** — RCTs span decades while EP-WAS uses NHANES 1999-2018 cross-sectional data
6. **Not all nutrients have well-powered RCTs** — some nutrient-outcome pairs rely on small trials

## Date of Search
March 2026

## Software
Search conducted programmatically using web search APIs and ClinicalTrials.gov API v2. Manual verification of all extracted effect estimates against source publications.
