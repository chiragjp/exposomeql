# Nutrient RCT Evidence Database: Documentation

## Overview

A curated database of pooled effect estimates from randomized controlled trial (RCT) meta-analyses for 17 dietary nutrients, designed to enable evidence triangulation against EP-WAS observational associations from NHANES. Each nutrient-outcome pair is mapped to the corresponding NHANES phenotype variable, allowing direct comparison of experimental (RCT) and observational (EP-WAS) evidence directions.

## Database Files

### 1. `data/nutrient_rct_evidence.csv`

**Description**: Curated RCT meta-analysis effect estimates for nutrient-health outcome pairs.

| Statistic | Value |
|-----------|-------|
| Total rows | 64 |
| Unique nutrients | 17 |
| Unique outcomes | 51 |
| Biomarker outcomes (NHANES-measurable) | 34 |
| Clinical endpoints (disease/mortality) | 29 |
| Biomarker proxies | 1 |
| Unique source journals | 28 |
| Rows with PubMed ID | 55 (36 unique PMIDs) |
| Source types | 19 Cochrane, 44 other meta-analyses, 1 MR |

#### Schema

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `nutrient` | string | Nutrient name | "Vitamin D" |
| `nhanes_exposure_var` | string | NHANES 24-hour dietary recall variable | "DR1TVD" |
| `outcome` | string | Health outcome description | "HbA1c" |
| `nhanes_phenotype` | string | NHANES phenotype variable(s), semicolon-separated | "LBXGH" |
| `outcome_type` | enum | "biomarker", "clinical_endpoint", or "biomarker_proxy" | "biomarker" |
| `effect_measure` | string | RR, OR, HR, MD, WMD, SMD, Ratio, or RD | "MD" |
| `effect_estimate` | numeric/string | Pooled point estimate (or "NS" for non-significant) | "-0.30" |
| `ci_lower` | numeric | Lower bound 95% CI (blank if unavailable) | "-0.43" |
| `ci_upper` | numeric | Upper bound 95% CI (blank if unavailable) | "-0.18" |
| `direction` | enum | "protective", "beneficial", "harmful", "null", "weakly protective" | "beneficial" |
| `n_trials` | integer | Number of RCTs in the meta-analysis | "39" |
| `n_participants` | integer | Total participants | "2982" |
| `source_type` | string | "Cochrane", "Meta-analysis", or "Landmark RCT" | "Meta-analysis" |
| `source_ref` | string | First author + year or Cochrane ID | "Chen 2024" |
| `journal` | string | Publication journal | "Diabetes Obes Metab" |
| `pmid` | string | PubMed ID | "39355942" |
| `notes` | string | Additional context (dose, population, certainty) | "In diabetic/prediabetic populations" |

#### Effect Measure Definitions

| Measure | Meaning | Used For |
|---------|---------|----------|
| **RR** | Relative Risk | Dichotomous outcomes (disease incidence, mortality) |
| **OR** | Odds Ratio | Dichotomous outcomes (fracture) |
| **HR** | Hazard Ratio | Time-to-event outcomes |
| **MD** | Mean Difference | Continuous biomarkers (absolute units: mg/dL, mmHg) |
| **WMD** | Weighted Mean Difference | Same as MD, named differently in some meta-analyses |
| **SMD** | Standardized Mean Difference | When studies use different scales/units |
| **Ratio** | Proportional change | Percentage reduction (e.g., cold duration -8%) |
| **RD** | Risk Difference | Absolute risk change per 10,000 persons |

#### Direction Coding

| Direction | Meaning | Concordance Logic |
|-----------|---------|-------------------|
| `beneficial` | The effect is in the health-beneficial direction | Compare sign of effect_estimate with EP-WAS β |
| `protective` | Reduces disease risk (RR/OR < 1) | RR < 1 = protective |
| `harmful` | Increases disease risk (RR > 1 or adverse effect) | Flagged separately |
| `null` | Not statistically significant | Excluded from concordance calculation |
| `weakly protective` | Borderline or low-certainty evidence | Treated as protective for concordance |

#### Nutrients Covered

| Nutrient | NHANES DR1 Code | Biomarker Outcomes | Clinical Endpoints | Total |
|----------|----------------|--------------------|--------------------|-------|
| Vitamin D | DR1TVD | 6 | 6 | 12 |
| Omega-3 (EPA/DHA) | DR1TP205/DR1TP226 | 3 | 3 | 6 |
| Magnesium | DR1TMAGN | 5 | 0 | 5 |
| Vitamin C | DR1TVC | 2 | 3 | 5 |
| Fiber | DR1TFIBE | 3 | 1 | 4 |
| Iron | DR1TIRON | 3 | 1 | 4 |
| Calcium | DR1TCALC | 1 | 3 | 4 |
| Folic acid | DR1TFOLA | 2 | 2 | 4 |
| Zinc | DR1TZINC | 1 | 3 | 4 |
| Selenium | DR1TSELE | 2 | 2 | 4 |
| Vitamin E | DR1TATOC | 2 | 2 | 4 |
| Vitamin A | DR1TVARA | 0 | 2 | 2 |
| Sodium | DR1TSODI | 2 | 0 | 2 |
| Potassium | DR1TPOTA | 2 | 0 | 2 |
| Vitamin B12 | DR1TVB12 | 1 | 0 | 1 |
| Vitamin K | DR1TVK | 0 | 1 | 1 |

#### Source Journals

Cochrane Database of Systematic Reviews (19 rows), JAHA (4), BMJ (3), Adv Nutr (2), Nutrients (2), Hypertension (2), AJCN (2), Diabetes Obes Metab (2), Nutr Rev (2), Eur J Pharmacol (1), Eur J Epidemiol (1), Pharmacol Res (1), Front Nutr (1), Sci Rep (1), Clin Nutr (1), Sports Med (1), Arch Intern Med (1), PLOS One (1), Ann Intern Med (1), Osteoporosis Int (2), Int J Epidemiol (1), JAMA (1), Curr Pharm Des (1), Food Sci Nutr (1), Diabetes Metab Syndr (1), and others.

---

### 2. `data/nutrient_outcome_phenotype_map.csv`

**Description**: Maps 75 RCT health outcomes to their corresponding NHANES phenotype variables.

| Statistic | Value |
|-----------|-------|
| Total mappings | 75 |
| Biomarker outcomes (directly measurable) | 56 |
| Clinical endpoints (not measurable in NHANES) | 18 |
| Biomarker proxy | 1 |

#### Schema

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `rct_outcome` | string | Outcome name as reported in RCTs | "Fasting glucose" |
| `nhanes_phenotype` | string | NHANES variable(s), semicolon-separated; "NA" for clinical endpoints | "LBXGLU;LBXSGL" |
| `nhanes_description` | string | Variable description from NHANES codebook | "Fasting Glucose (mg/dL)" |
| `outcome_type` | enum | "biomarker" or "clinical_endpoint" | "biomarker" |
| `mapping_notes` | string | How the mapping was determined | "Direct measurement equivalent" |

#### Mapping Categories

| Category | NHANES Variables | N Outcomes |
|----------|-----------------|------------|
| Glycemic | LBXGLU, LBXSGL, LBXGH, LBXIN, LBXGLT | 5 |
| Lipid | LBXSCH, LBXTC, LBDLDL, LBXHDD, LBXSTR, LBXAPB | 6 |
| Blood pressure | BPXSY4, MSYSTOLIC, MDIASTOLIC | 3 |
| Inflammatory | LBXCRP, LBXFB | 2 |
| Hematology | LBXHGB, LBXHCT, LBXFER, LBXIRN, LBDPCT, LBXRBCSI, LBXPLTSI | 7 |
| Folate/B12 | LBXFOL, LBXRBF, LBXHCY, LBXMMA | 4 |
| Bone | DXDTOBMD, DXXLSBMD, DXXNKBMD, DXXOFBMD | 4 |
| Kidney | LBXSCR, LBXSBU, LBXSUA, URXUMA | 4 |
| Liver | LBXSATSI, LBXSASSI, LBXSGTSI, LBXSAPSI, LBXSAL | 5 |
| Anthropometric | BMXBMI, BMXWT, BMXWAIST | 3 |
| Thyroid | LBXTSH, LBXT4F | 2 |
| Hormonal | LBXTST, LBXEST, LBXSHBG | 3 |
| Other | URXUIO, TeloMean, SPXNFEV1, LBXWBCSI, etc. | 8 |
| Clinical endpoints (unmappable) | NA | 18 |

---

## How the Database Was Created

### Step 1: Nutrient Selection
17 nutrients were selected based on:
- Availability as NHANES 24-hour dietary recall variables (DR1T*)
- Relevance to US Dietary Guidelines (DGA 2025-2030 "nutrients of concern")
- Availability of RCT meta-analysis evidence

### Step 2: Literature Search
For each nutrient, systematic web searches were conducted using the query pattern:
```
[nutrient] AND (supplementation OR supplement) AND (meta-analysis OR systematic review) AND (randomized controlled trial)
```

Sources were prioritized: Cochrane reviews > high-impact journal meta-analyses (NEJM, Lancet, JAMA, BMJ, Circulation) > specialty journal meta-analyses.

### Step 3: Data Extraction
From each meta-analysis, the following were extracted:
- Pooled effect estimate and 95% CI
- Number of trials and participants
- Effect measure type (RR, MD, SMD, etc.)
- Direction of effect
- Source journal and PubMed ID

### Step 4: Phenotype Mapping
Each RCT outcome was manually mapped to the corresponding NHANES phenotype variable in the EP-WAS atlas. Outcomes were classified as "biomarker" (directly triangulatable) or "clinical_endpoint" (retained for context).

### Step 5: Validation
The database was used to run concordance analyses against EP-WAS:
- **Overall concordance**: 61% (dietary recall) vs 83% (serum biomarker)
- Results documented in `docs/nutrient_triangulation_results.md`

### Step 6: Integration
The CSV is loaded by the ExposomeQL MCP server at startup and queried by 5 nutrient triangulation tools.

## Search Date
March 2026

## Update Protocol
To update this database:
1. Search for new Cochrane reviews or major meta-analyses for each nutrient
2. Add new rows to `nutrient_rct_evidence.csv` following the schema above
3. If new outcome types are added, update `nutrient_outcome_phenotype_map.csv`
4. Rebuild the MCP server (`npm run build`)
5. Re-run concordance analysis to update `docs/nutrient_triangulation_results.md`

## Limitations
1. Not an exhaustive systematic review — focused on highest-quality evidence per nutrient-outcome pair
2. RCTs test supplementation (pills), not food-derived nutrients — bioavailability differs
3. Many RCTs conducted in deficient/diseased populations, not general population
4. Effect measures are heterogeneous (RR, MD, SMD) — not directly comparable across nutrients
5. Some CIs are missing from source publications
6. PubMed IDs not available for all entries (55/64 have PMIDs)

## Citation
If using this database, cite both ExposomeQL and the individual source meta-analyses referenced in the `pmid` and `source_ref` columns.
