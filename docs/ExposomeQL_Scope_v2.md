# ExposomeQL: MCP Server for Exposome Research
## Product Scope & Technical Architecture — v2

---

## Executive Summary

**ExposomeQL** is an MCP (Model Context Protocol) server that gives LLM-powered coding environments (Claude Code, Cursor, etc.) structured, queryable access to exposome datasets and the EP-WAS analytical framework. Researchers interact with fragmented environmental health data through natural language, receiving validated results, reproducible code, and domain-appropriate statistical analyses.

**One-liner:** "Ask questions about exposure-health associations in plain English, get epidemiologically correct answers."

---

## Problem Statement

Exposome research suffers from three compounding friction points:

1. **Data fragmentation** — NHANES, EPA CompTox, ATSDR, biobank-specific datasets each have different formats, variable naming conventions, access patterns, and survey weight structures
2. **Methodological complexity** — Even "simple" descriptive queries (average blood lead in children, BMI by age group) require survey weights, design-corrected standard errors, LOD handling, and NCHS analytic guidelines that most analysts get wrong
3. **Reproducibility gap** — Analyses are typically one-off scripts that can't be easily shared, reproduced, or extended

ExposomeQL addresses all three by packaging data access, domain knowledge, and validated methods as MCP tools that any LLM can invoke correctly.

---

## Target Users

| Persona | Need | Current Pain |
|---------|------|-------------|
| **Policy analyst / journalist** | Population-level descriptive statistics | Can't query NHANES without SAS/R expertise |
| **Epidemiologist / clinician-scientist** | Conditional averages, stratified comparisons | Weeks of data wrangling; easy to misapply weights |
| **Exposome researcher** (core) | EP-WAS, VoE, multi-exposure analysis | Methodological complexity, fragmented data |
| **Students / early-career** | Learn correct methods | Steep learning curve, common statistical errors |

---

## Core Design Principle: Three Query Classes

Researchers interact with exposome data at three distinct levels. ExposomeQL recognizes and serves all three, because even "simple" descriptive queries require the same guardrails as complex associational analyses.

```
         ┌──────────────────────────────────────┐
         │     Class 3: Associational/Causal     │  ← EP-WAS, VoE, ExWAS
         │    "Is cadmium linked to CKD?"         │
         ├──────────────────────────────────────┤
         │    Class 2: Conditional/Exploratory    │  ← Stratified, cross-tabs
         │   "BMI by age and race/ethnicity"      │
         ├──────────────────────────────────────┤
         │       Class 1: Descriptive             │  ← Means, prevalence, trends
         │  "Average blood lead in US children"   │
         └──────────────────────────────────────┘
                   ▲ Same guardrails throughout ▲
                   (weights, LOD, pooling, NCHS)
```

| Query Class | Example | Complexity | User Base |
|------------|---------|------------|-----------|
| **Descriptive** | "What's average blood lead in US children?" | Low | Broadest — students, policy, journalism |
| **Conditional / Exploratory** | "Show me BMI distribution by age, stratified by race/ethnicity" | Medium | Epi researchers, clinician-scientists |
| **Associational / Causal** | "Run EP-WAS for metals against eGFR, with VoE" | High | Exposome researchers, advanced epi |

---

## Phased Development Plan

### Phase 1: MVP (Weeks 1-4)

**Goal:** A working MCP server that exposes the EP-WAS catalog AND basic NHANES descriptive/conditional queries.

---

#### Class 1 Tools: Descriptive Statistics

These handle population-level summaries — the most common use case and the gateway for new users.

```
nhanes.mean(variable, subgroup?, cycles?)
→ Survey-weighted mean with 95% CI and design-corrected SE
→ Example: nhanes.mean("LBXBPB", subgroup="age<5", cycles="2017-2018")
→ Returns: {
    mean: 0.83,
    unit: "µg/dL",
    ci_lower: 0.71,
    ci_upper: 0.95,
    se: 0.06,
    n_unweighted: 512,
    n_weighted: "3.2M",
    pct_below_lod: 12.4,
    lod_method: "LOD/sqrt(2)",
    variable_description: "Blood lead level",
    codebook_name: "LBXBPB",
    cycles_used: ["2017-2018"],
    weight_used: "WTMEC2YR",
    code: "# Reproducible R code\nlibrary(survey)..."
  }

nhanes.prevalence(condition, subgroup?, cycles?)
→ Survey-weighted prevalence with CI
→ Example: nhanes.prevalence("A1C >= 6.5", subgroup="age>=40")
→ Returns: 14.2% (95% CI: 12.8-15.6%), representing ~18.3M adults

nhanes.distribution(variable, subgroup?, cycles?)
→ Weighted percentiles (5th, 25th, 50th, 75th, 95th), 
  geometric mean (auto-detected for log-normal biomarkers), 
  histogram-ready bin data
→ Returns plot-ready JSON for immediate visualization

nhanes.quantile(variable, quantile, subgroup?, cycles?)
→ Specific weighted quantile with CI
→ Example: nhanes.quantile("LBXBCD", 0.95, cycles="2015-2018")
→ "95th percentile of blood cadmium is 1.2 µg/L"

nhanes.count(condition?, subgroup?, cycles?)
→ Weighted population count with CI
→ Example: nhanes.count("LBXBPB > 3.5", subgroup="age<6")
→ "Approximately 187,000 children under 6 exceed 3.5 µg/dL"

nhanes.trend(variable, subgroup?, metric?)
→ Weighted mean/median/prevalence across ALL available cycles
→ Returns time series + trend test (Joinpoint-style change points)
→ Example: nhanes.trend("LBXBPB", subgroup="age<5", metric="geometric_mean")
→ Shows declining blood lead from 1999-2018 with change points identified
```

**Descriptive guardrails:**
- Always reports survey-weighted estimates (refuses unweighted unless explicitly forced)
- Flags small cell sizes (<30 unweighted) per NCHS guidelines
- For biomarkers: auto-reports % below LOD; if >40% below LOD, warns that mean is unreliable and suggests prevalence above threshold instead
- Reports the NHANES variable name + codebook description (so users can verify the right variable)
- For multi-cycle queries: auto-adjusts weights and documents pooling method
- For log-normal biomarkers (most environmental chemicals): reports geometric mean alongside arithmetic mean

---

#### Class 2 Tools: Conditional & Exploratory

These handle stratified analyses, cross-tabulations, and "show me patterns" queries.

```
nhanes.crosstab(var1, var2, subgroup?, cycles?)
→ Survey-weighted cross-tabulation with Rao-Scott chi-square 
  (design-corrected, not naive chi-square)
→ Example: nhanes.crosstab("smoking_status", "diabetes_status")
→ Returns: weighted proportions, row/column %, test statistic

nhanes.stratify(variable, by, subgroup?, cycles?)
→ Weighted summary statistics grouped by one or more variables
→ Example: nhanes.stratify("BMXBMI", by=["age_group", "RIDRETH3"])
→ Returns: table of means/CIs by group, design-adjusted ANOVA F-test
→ Also returns: plot-ready data for grouped bar/box charts

nhanes.conditional(outcome, given, subgroup?, cycles?, bins?)
→ Weighted mean of outcome conditional on another variable
→ THE "BMI over age" query handler
→ Handles both continuous and categorical conditioning variables
→ For continuous: auto-bins into deciles (or user-specified bins)
→ Example: nhanes.conditional("BMXBMI", given="RIDAGEYR", bins=10)
→ Returns: mean BMI at each age decile with CIs + plot data
→ Example: nhanes.conditional("LBXGLU", given="physical_activity_level")
→ Returns: mean fasting glucose by activity category

nhanes.correlation(var1, var2, subgroup?, cycles?)
→ Survey-weighted Pearson/Spearman with CI
→ Auto-selects method based on distribution shape
→ Warns if relationship appears non-linear

nhanes.compare_groups(variable, group_var, subgroup?, cycles?)
→ Weighted comparison across groups
→ Auto-selects appropriate test (t-test, ANOVA, Wilcoxon) with 
  design correction (never naive tests)
→ Reports both absolute and relative differences
→ Example: nhanes.compare_groups("LBXBPB", "income_quintile")
→ "Mean blood lead: Q1=$1.42, Q5=$0.68; ratio=2.1 (p<0.001)"
```

**Conditional/exploratory guardrails:**
- Stratified cells with N<30 flagged as unreliable (NCHS standard)
- For continuous conditioning: auto-bins into meaningful groups rather than allowing arbitrary cutpoints
- Warns about confounded comparisons ("these age groups differ substantially by race/ethnicity — consider adjustment or further stratification")
- Tests for non-linearity and suggests spline/polynomial when linear trend is poor fit
- Reports both absolute and relative differences between groups
- Distinguishes "statistically significant" from "meaningfully different" with effect size metrics

---

#### Class 3 Tools: Associational & Causal (EP-WAS Framework)

```
epwas.search(exposure?, phenotype?, effect_size_min?, replicated?)
→ Returns matching associations from EP-WAS catalog
→ Effect sizes, CIs, p-values, replication status

epwas.summary(exposure)
→ All phenotypes for a given exposure, ranked by evidence strength

epwas.phenotype_profile(phenotype)
→ All exposures associated with a given phenotype (the "exposure profile")

epwas.vibration(exposure, phenotype)
→ Vibration of effects — range of estimates across model specs
→ Returns jitter plot data showing analytic choice sensitivity

epwas.citation(association_id)
→ Formatted citation with DOI link

nhanes.analyze(exposure, outcome, model_type?, covariates?, weights?)
→ Survey-weighted regression with sensible defaults
→ Returns: coefficients, CIs, p-values, diagnostics
→ ALSO returns: the exact R/Python code used

nhanes.exwas(outcome, exposure_category?, covariates?, cycles?)
→ Full exposome-wide association study
→ Iterates over all exposures in category, standard EP-WAS pipeline
→ Returns: ranked results, volcano plot data, VoE summary
→ Auto-applies Bonferroni + FDR correction

nhanes.validate(code_snippet)
→ Checks user-written NHANES analysis code for common errors:
  - Missing survey weights
  - Incorrect cycle pooling
  - Wrong LOD substitution
  - Missing fasting subsample restriction
  - Inappropriate variance estimation
```

---

#### Cross-Cutting: Smart Query Router

A meta-tool that classifies natural language queries and routes to appropriate tools:

```
exposomeql.interpret(natural_language_query)
→ Parses intent → classifies into query class → suggests tool chain

Routing examples:

  "average lead in kids"
  → Class 1: nhanes.mean("LBXBPB", subgroup="RIDAGEYR<12")

  "how does BMI change with age"
  → Class 2: nhanes.conditional("BMXBMI", given="RIDAGEYR")

  "BMI over age by race"
  → Class 2: nhanes.conditional("BMXBMI", given="RIDAGEYR") 
    THEN nhanes.stratify("BMXBMI", by=["age_decile", "RIDRETH3"])

  "compare mercury between fish eaters and non-fish eaters"
  → Class 2: nhanes.compare_groups("LBXTHG", "fish_consumption")

  "is cadmium associated with kidney disease"
  → Class 3: epwas.search(exposure="cadmium", phenotype="CKD")
  → Then optionally: nhanes.analyze("LBXBCD", "eGFR", ...)

  "what percentage of Americans have lead above 5"
  → Class 1: nhanes.prevalence("LBXBPB > 5")

  "has lead exposure decreased over time in children"
  → Class 1: nhanes.trend("LBXBPB", subgroup="age<12", metric="geometric_mean")
  
  "show me the distribution of PFOS levels"
  → Class 1: nhanes.distribution("LBXPFOS")
  → Auto-notes: "67% below LOD — distribution heavily left-censored"
```

---

#### MCP Resources

```
epwas://catalog/metadata          → Schema, variable definitions, N
epwas://catalog/exposures         → All exposures with categories (metals, VOCs, etc.)
epwas://catalog/phenotypes        → All phenotypes with ICD/category mappings
epwas://methods/overview          → Plain-language EP-WAS methodology description
epwas://methods/voe               → Vibration of effects explanation + interpretation guide

nhanes://codebook/{variable}      → Full codebook entry for any NHANES variable
nhanes://codebook/search/{term}   → Fuzzy search codebook ("lead" → LBXBPB, LBXBCD, ...)
nhanes://cycles/available         → Which cycles have which variables (critical for planning)
nhanes://cycles/{cycle}/variables → All variables in a specific cycle
nhanes://guidelines/nchs          → NCHS analytic guidelines (weights, variance est.)
nhanes://guidelines/lod           → LOD handling best practices
nhanes://lod/{variable}           → LOD values by cycle for lab variables
nhanes://weights/guide            → Which weight to use when (MEC vs interview vs fasting)
nhanes://subpopulations           → Pre-defined subgroup definitions (children, elderly, etc.)
```

The resource layer is critical for LLM context. When Claude Code calls `nhanes.mean("LBXBPB")`, it can first read `nhanes://codebook/LBXBPB` to understand what the variable is, then `nhanes://lod/LBXBPB` to understand detection limits, then `nhanes://weights/guide` to pick the right weight. This is how we encode domain knowledge without hardcoding it into the tool logic.

---

#### Phase 1 Deliverables — Three Demo Scenarios

**Scenario 1 — Policy analyst:**
> "What percentage of US children under 6 have blood lead levels above 3.5 µg/dL, and how has this changed since 1999?"

```
→ nhanes.prevalence("LBXBPB > 3.5", subgroup="age<6")
→ nhanes.trend("LBXBPB", subgroup="age<6", metric="prevalence_above_3.5")
→ Returns: current prevalence, 20-year trend with change points, 
  reproducible code, ready-to-plot data
```

**Scenario 2 — Clinical researcher:**
> "Show me average HbA1c by age group, stratified by BMI category and race/ethnicity"

```
→ nhanes.stratify("LBXGH", by=["age_group", "bmi_category", "RIDRETH3"])
→ Returns: multi-way table with weighted means and CIs,
  flags cells with N<30, suggests visualization approach,
  notes that fasting subsample weight is NOT needed for A1c
```

**Scenario 3 — Exposome researcher:**
> "What environmental exposures are associated with CKD, replicated across cohorts, and what's the vibration range for cadmium?"

```
→ epwas.search(phenotype="CKD", replicated=true)
→ epwas.vibration("cadmium", "CKD")
→ Returns: ranked associations, VoE jitter plot data, citations
```

---

### Phase 1.5: Multi-Cohort HHEAR Support

**Goal:** Extend ExposomeQL beyond NHANES to support HHEAR (Human Health Exposure Analysis Resource) targeted datasets — ~40 global cohorts with standardized chemical exposure measurements.

**Motivation:** NHANES provides nationally representative US data but is a single study design. HHEAR provides exposure measurements from diverse cohorts worldwide (9,664 children + 11,764 adults across 35+ studies), enabling cross-population comparisons and broader exposome characterization. The methods follow Lloyd, Tierney, Isaac et al. — "Population Structure of the Chemical Exposome Across Global Cohorts" (Patel lab).

---

#### HHEAR Data Architecture

HHEAR data is CSV-based with a standardized directory structure per cohort:
```
HHEAR Targeted Datasets 2026/
  {cohort_id}/
    {id}_TARGETED_DATA.csv      # Exposure concentrations (semantic column names)
    {id}_EPI_DATA.csv           # Demographics & outcomes (short codes)
    {id}_harmonized.csv         # Standardized data
    {id}_harmonized_codebook.csv # Code → semantic value mapping
    {id}_README.pdf             # Cohort documentation
  AllExposures.csv              # Master long-format exposure table
  object_alignment*.csv         # PID → sample ID mapping
```

Key differences from NHANES:
| Feature | NHANES | HHEAR |
|---------|--------|-------|
| **Design** | Complex survey (PSU, strata, weights) | Cross-sectional (no survey weights) |
| **Statistical engine** | `survey::svyglm()` | `quantreg::rq()` (quantile regression) |
| **Size** | ~10,000/cycle, nationally representative | 67-2,040 per cohort, 35+ cohorts |
| **Exposures** | NHANES variable codes (LBXBPB) | Semantic names + standard abbreviations (BPA, PFOA, Pb) |
| **Population** | US general population | Global: US, South Africa, Mexico, Bangladesh, Europe, etc. |
| **LOD handling** | LOD/√2 substitution | LOD/2 imputation when ≥75% complete |
| **Urinary adjustment** | Creatinine-corrected | Creatinine or specific gravity adjusted |

---

#### HHEAR Analytical Methods

The core analytical framework uses **quantile regression** (`rq()` from R's `quantreg` package) rather than OLS/GLM:

**1. Exposure Intervals (conditional quantiles)**
```
Qy(τ|X) = β0(τ) + β1(τ)·Age + β2(τ)·Sex    [children]
Qy(τ|X) = β0(τ) + β1(τ)·Age                  [adult mothers]
τ ∈ {0.05, 0.25, 0.5, 0.75, 0.95}
```
The range between 5th-95th or 25th-75th percentile is an "exposure interval" — the population reference range for a chemical exposure conditional on demographics.

**2. Within-Cohort Demographic Model**
```
exposure ~ age + sex + sampling_year
```
Fitted via quantile regression at each τ. Returns β coefficients, bootstrapped CIs, and McFadden's pseudo R².

**3. Quantile ExWAS**
Iterate over all exposures as dependent variables with a sociodemographic feature as independent variable. FDR correction at 10%.

**4. Cumulative Exposure Score**
Percentile-rank-based Z-score across all measured chemicals for an individual — captures overall exposure intensity.

---

#### HHEAR Tools

```
cohort.list()
→ List all available HHEAR cohorts with:
  - Cohort name, location, population type (child/adult)
  - N participants, exposures measured, demographic features available
  - Sample matrix (urine/blood)

cohort.variables(cohort_id)
→ List all variables in a specific cohort
→ Maps semantic column names to standard chemical abbreviations
→ Categories: TraceElements, Phenols, Phthalates, PFAS, PAH, PCBs,
  Pesticides, FlameRetardants, Smoking, VOCs

cohort.exposure_intervals(exposure, cohort_id?, population?)
→ Compute age/sex-conditional exposure intervals via quantile regression
→ Returns: predicted quantile values at τ = {0.05, 0.25, 0.5, 0.75, 0.95}
→ Can pool across cohorts or run within a single cohort
→ Example: cohort.exposure_intervals("BPA", cohort="NHBCS")
→ Returns: {
    median: 1.2,           # τ=0.5 predicted value
    iqr: [0.4, 3.8],      # τ=0.25 to τ=0.75
    range_5_95: [0.1, 12.4],
    model: "Qy(τ|X) = β0(τ) + β1(τ)·Age + β2(τ)·Sex",
    n: 1823,
    cohort: "NHBCS",
    unit: "ng/mL"
  }
```

Existing tools gain an optional `cohort` parameter:
```
nhanes.mean("BPA", cohort="1407")
→ Uses cohort_mean.R (simple t-test CI, no survey weights)
→ Includes LOD/2 imputation, creatinine adjustment for urinary measures

nhanes.distribution("PFOA", cohort="NHBCS")
→ Uses cohort_exposure_intervals.R (quantile regression)
→ Returns conditional percentiles instead of survey-weighted quantiles

nhanes.analyze("BPA", "BMI", cohort="1407")
→ Uses cohort_demographic_models.R (quantile regression)
→ Returns β, CI, pseudo R² at each quantile

nhanes.exwas(outcome="BMI", cohort="1407")
→ Uses cohort_exwas.R (quantile ExWAS)
→ FDR correction at 10%
```

---

#### HHEAR Variable Resolution

Chemical abbreviations from the paper's Supplemental Table 2 serve as the resolution index:
```
User says:              Resolves to:                   Category:
"BPA"               →   Bisphenol A                    Phenols
"lead"              →   Pb (Lead)                      TraceElements
"PFOS"              →   Perfluorooctane sulfonate       PFAS
"cotinine"          →   COTT / HCOTT                   Smoking
"phthalates"        →   [MEHP, MEHHP, MECPP, ...]      Phthalates (category)
```

Semantic column names in TARGETED_DATA are parsed: `"Adult-Human-Blood-Serum-Concentration-Lead-Nanogram-Per-Milliliter"` → `Pb`.

---

#### HHEAR Demo Scenarios

**Scenario A — Cross-population comparison:**
> "How do PFAS levels in the NHBCS cohort (New Hampshire) compare to NHANES nationally?"

```
→ cohort.exposure_intervals("PFOA", cohort="NHBCS")
→ nhanes.distribution("LBXPFOA", cycles="2017-2018")
→ Returns: side-by-side exposure intervals showing NHBCS vs NHANES reference range
```

**Scenario B — Within-cohort ExWAS:**
> "Which exposures are associated with child BMI in the TEDDY cohort?"

```
→ nhanes.exwas(outcome="BMI", cohort="TEDDY")
→ Returns: ranked quantile regression results across all measured exposures,
  FDR-corrected, with β at median (τ=0.5)
```

**Scenario C — Exposure intervals by location:**
> "What are the reference ranges for urinary phthalates in the ELEMENT cohort (Mexico City)?"

```
→ cohort.list()  [to identify ELEMENT cohort ID]
→ cohort.variables("ELEMENT")  [to see available phthalate metabolites]
→ cohort.exposure_intervals("MEHP", cohort="ELEMENT")
→ Returns: age/sex-conditional percentiles for MEHP
```

---

### Phase 2: Advanced Analytics & Validation (Weeks 5-10)

**Goal:** Full NHANES analytical pipeline with code validation and advanced conditional analyses.

**New tools:**

```
nhanes.model(outcome, predictors[], model_type?, splines?, interactions?)
→ Flexible regression modeling beyond simple exposure-outcome
→ Supports: linear, logistic, Cox, quantile regression
→ Auto-handles survey design throughout
→ Example: nhanes.model("BMXBMI", ["RIDAGEYR", "RIDRETH3", "income"], 
    splines=["RIDAGEYR"], interactions=[("RIDAGEYR", "RIDRETH3")])

nhanes.predict(model_id, newdata)
→ Predicted values from a fitted model
→ Example: "What BMI does the model predict for a 45-year-old 
  Hispanic woman in the 3rd income quintile?"

nhanes.dose_response(exposure, outcome, method?, covariates?)
→ Non-linear dose-response curve (restricted cubic splines or GAM)
→ Returns: curve data with CIs, test for non-linearity, 
  threshold detection if applicable
→ Critical for environmental health where thresholds matter

nhanes.mediation(exposure, mediator, outcome, covariates?)
→ Survey-weighted causal mediation analysis
→ Returns: direct/indirect effects with CIs

nhanes.interaction(exposure, modifier, outcome, covariates?)
→ Tests for effect modification with proper survey design correction
→ Example: "Does the cadmium-CKD association differ by smoking status?"

nhanes.validate(code_snippet)
→ Reviews user's NHANES code for errors (see Phase 1 scope)
```

---

### Phase 3: Multi-Database Federation + ExpoScale (Weeks 11-20)

**Goal:** Federate across multiple data sources and integrate with the ExpoScale platform.

**New data sources:**
- EPA CompTox Dashboard (chemical properties, toxicity data)
- ATSDR Toxicological Profiles
- UK Biobank exposure variables (for replication queries)
- All of Us (via approved DUA)
- E1000 assay panel reference data

**New tools:**

```
comptox.chemical_profile(chemical_name_or_cas)
→ Returns: toxicity endpoints, exposure routes, regulatory status

federation.replicate(exposure, phenotype, datasets[])
→ Runs same analysis across multiple cohorts, 
  returns heterogeneity statistics (I², Q-test)

exposcale.burden_score(individual_exposures{})
→ Computes Exposome Burden Score (EBS) from individual exposure levels

exposcale.rank_exposures(phenotype, metric?)
→ Ranks exposures by association strength, population attributable 
  fraction, or EBS contribution
```

---

## Technical Architecture

```
┌─────────────────────────────────────────────────┐
│  LLM Client (Claude Code / Cursor / etc.)       │
│  User: "average lead in kids under 5?"          │
└──────────────────────┬──────────────────────────┘
                       │ MCP Protocol (stdio/SSE)
                       ▼
┌─────────────────────────────────────────────────┐
│  ExposomeQL MCP Server                          │
│                                                 │
│  ┌──────────────────────────────────────┐      │
│  │ Query Router                          │      │
│  │ NL → Query Class → Tool Selection     │      │
│  └──────────┬───────────────────────────┘      │
│             │                                   │
│  ┌──────────▼───────────────────────────┐      │
│  │ Tool Layer                            │      │
│  │                                       │      │
│  │ Class 1      Class 2      Class 3     │      │
│  │ nhanes.mean  nhanes.     epwas.*      │      │
│  │ .prevalence  conditional nhanes.      │      │
│  │ .distribution.stratify   analyze      │      │
│  │ .trend       .crosstab   .exwas       │      │
│  │ .quantile    .compare    .vibration   │      │
│  │ .count       .correlation             │      │
│  └──────────┬───────────────────────────┘      │
│             │                                   │
│  ┌──────────▼───────────────────────────┐      │
│  │ Guardrails Layer (shared across all)  │      │
│  │                                       │      │
│  │ • Survey weight enforcement           │      │
│  │ • LOD detection & handling            │      │
│  │ • Cell size validation (N≥30)         │      │
│  │ • Cycle pooling weight adjustment     │      │
│  │ • Multiple comparison correction      │      │
│  │ • Appropriate test selection           │      │
│  │ • Code generation & provenance        │      │
│  └──────────┬───────────────────────────┘      │
│             │                                   │
│  ┌──────────▼───────────────────────────┐      │
│  │ Resource Layer                        │      │
│  │                                       │      │
│  │ Codebooks │ LOD tables │ Weight guide │      │
│  │ NCHS guidelines │ Variable catalog    │      │
│  │ EP-WAS methods │ VoE documentation    │      │
│  └──────────┬───────────────────────────┘      │
│             │                                   │
│  ┌──────────▼───────────────────────────┐      │
│  │ Data Access Layer                     │      │
│  │                                       │      │
│  │ EP-WAS Catalog ──► DuckDB/Parquet    │      │
│  │ NHANES Files   ──► Pre-processed     │      │
│  │                     Parquet by cycle  │      │
│  │ CompTox (Ph3)  ──► API + local cache │      │
│  └──────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| MCP Server | **TypeScript** (official MCP SDK) | Best MCP SDK support, Claude Code native |
| Data storage | **DuckDB + Parquet** | Fast analytical queries, zero-config, portable |
| Statistical engine | **Python subprocess** (statsmodels, scipy, survey) | Survey-weighted methods, established libraries |
| Code generation | Template-based | Generates reproducible R/Python scripts |
| Variable resolution | **Fuzzy matching + codebook index** | User says "lead" → resolves to LBXBPB |
| Packaging | **npm package** | `npx exposomeql` to start server |

### Why DuckDB + Parquet (not Postgres)

- Zero infrastructure — runs locally, no database server
- Parquet files are portable, versionable, shareable via Zenodo/Figshare
- DuckDB handles NHANES-scale data (millions of rows) with sub-second queries
- Researchers can inspect the raw data files directly
- Parquet per NHANES cycle = natural partitioning

---

## The Guardrails Are the Product

This is worth stating explicitly: **the guardrails layer is the primary competitive advantage.** Here's what it enforces across ALL three query classes:

| Guardrail | Applies to | What it does |
|-----------|-----------|-------------|
| **Survey weights** | All classes | Auto-applies correct weight (MEC, interview, fasting); refuses unweighted without explicit override |
| **LOD handling** | All classes | Detects % below LOD; applies LOD/√2; switches to prevalence-based metrics when >40% censored |
| **Cell size** | All classes | Flags N<30 per NCHS guidelines; suppresses unreliable estimates |
| **Cycle pooling** | All classes | Auto-recalculates weights when pooling cycles; documents method |
| **Geometric mean** | Class 1-2 | Auto-reports for log-normal biomarkers (most environmental chemicals) |
| **Design-corrected tests** | Class 2-3 | Uses Rao-Scott chi-square, design-adjusted ANOVA — never naive tests |
| **Multiple testing** | Class 3 | Auto-reports Bonferroni + FDR alongside nominal p-values |
| **Covariate suggestion** | Class 3 | Suggests minimum adjustment set; flags missing standard confounders |
| **VoE integration** | Class 3 | Offers vibration of effects for any association to show analytic sensitivity |
| **Reproducible code** | All classes | Every result includes the exact code that produced it |
| **Variable verification** | All classes | Returns codebook description so user confirms correct variable |

---

## Key Design Decisions

### 1. Progressive Disclosure Across Classes

The same underlying question can be answered at increasing depth:

**"Tell me about lead and children"**

- **Class 1 response:** "The geometric mean blood lead level in US children <6 is 0.83 µg/dL (2017-2018). Down from 2.2 µg/dL in 1999-2000."
- **Class 2 follow-up:** "Lead levels vary by income: lowest quintile mean = 1.24 µg/dL vs highest = 0.52 µg/dL (p<0.001)"
- **Class 3 follow-up:** "Blood lead is significantly associated with ADHD (OR=1.31, 95% CI: 1.08-1.59), reading scores (β=-3.2 points per µg/dL), and IQ (β=-1.5 points per µg/dL). VoE range for IQ: -0.8 to -2.1 across 512 model specifications."

The LLM naturally escalates through classes as the conversation deepens. The tools support this without the user needing to know the taxonomy.

### 2. "Variable Resolution" — Bridging Natural Language and NHANES Codes

A critical UX problem: users say "lead" but the database has "LBXBPB". ExposomeQL includes a fuzzy matching layer:

```
User says:           Resolves to:              Via:
"lead"           →   LBXBPB (blood lead)       codebook search
"blood lead"     →   LBXBPB                    direct match
"BPA"            →   URXBPH (urinary BPA)      chemical name index
"A1C"            →   LBXGH (glycohemoglobin)   common abbreviation
"kidney function"→   LBXSCR → eGFR (derived)   clinical concept mapping
"obesity"        →   BMXBMI ≥ 30 (derived)     condition definition
"diabetes"       →   LBXGH ≥ 6.5 OR DIQ010=1   multi-criteria definition
```

When ambiguous, the tool returns candidates and asks the LLM to clarify:
```
"mercury" → ["LBXTHG (total blood mercury)", 
              "LBXIHG (inorganic blood mercury)", 
              "URXUHG (urinary mercury)"]
→ "Which mercury measure did you mean?"
```

### 3. Reproducibility by Default

Every tool call returns:
- The result (estimates, CIs, etc.)
- The exact R or Python code that produced it
- A metadata block: data version, date, parameters, software versions, weight used
- A provenance hash for verification

---

## Competitive Positioning

| Feature | ExposomeQL | NHANES Explorer (CDC) | EWAS Catalog (Bristol) | ChatGPT + data |
|---------|-----------|----------------------|----------------------|----------------|
| Natural language interface | ✅ | ❌ | ❌ | ✅ (no domain knowledge) |
| Descriptive statistics | ✅ (weighted) | Partial (limited) | ❌ | ❌ (unweighted) |
| Conditional analyses | ✅ (design-corrected) | ❌ | ❌ | ❌ (wrong tests) |
| Survey weight enforcement | ✅ | ❌ (manual) | N/A | ❌ |
| LOD handling | ✅ (auto) | ❌ | N/A | ❌ |
| Vibration of effects | ✅ | ❌ | ❌ | ❌ |
| Multi-cohort replication | ✅ (Phase 3) | ❌ | Partial | ❌ |
| Reproducible code output | ✅ | ❌ | ❌ | Partial (often wrong) |
| EP-WAS catalog integrated | ✅ | ❌ | Similar scope | ❌ |
| Variable fuzzy matching | ✅ | ❌ | ❌ | ❌ |

---

## Funding & Sustainability Strategy

| Mechanism | Timeline | Amount | Notes |
|-----------|----------|--------|-------|
| **NIEHS R21 supplement** | Immediate | $50-100K | "AI tools for exposome data democratization" |
| **NIEHS R01 aim** | Next renewal | $150-300K | Add as Aim 3 to existing EP-WAS grant |
| **NIH STTR/SBIR** (via Modulome.ai) | 6 months | $250K Phase I | "AI-powered exposome analysis platform" |
| **Open-source + hosted** | Phase 3 | Recurring | Free MCP server; paid hosted with pre-loaded data |
| **Human Exposome Project** | Ongoing | Part of HEP | Core infrastructure deliverable |

---

## Success Metrics

### Phase 1 (MVP)
- [ ] Working MCP server installable via `npx exposomeql`
- [ ] All three query classes functional for ≥5 common use cases each
- [ ] 5+ beta users running queries
- [ ] Demo video: descriptive → conditional → associational escalation
- [ ] Blog post / preprint: "ExposomeQL: Natural Language Access to Exposome Evidence"

### Phase 2
- [ ] 50+ external users
- [ ] Validated against published NHANES analyses (results match within CI)
- [ ] Code validation tool catches ≥80% of common NHANES analysis errors
- [ ] Submitted as R21 or supplement
- [ ] Presented at ISEE or SER

### Phase 3
- [ ] Multi-cohort federation working
- [ ] Integrated into NEXUS platform
- [ ] Paper: "Democratizing Exposome Research with AI-Powered Data Infrastructure"

---

## Immediate Next Steps (This Week)

1. **Set up MCP server skeleton** — TypeScript, `@modelcontextprotocol/sdk`, register tool stubs
2. **Prepare EP-WAS data** — Convert catalog to Parquet, define DuckDB schema
3. **Build NHANES codebook index** — Fuzzy-searchable variable names + descriptions
4. **Implement 3 tools** — `nhanes.mean`, `epwas.search`, `nhanes.conditional`
5. **Test with Claude Code** — Connect and run the three demo scenarios
6. **Iterate on tool descriptions** — These are the prompt engineering; they determine whether the LLM calls the right tool with the right parameters

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM misinterprets query → wrong analysis | High | High | Guardrails validate; always return code for human review |
| NHANES variable resolution fails | Medium | Medium | Confidence threshold; ask LLM to clarify when ambiguous |
| Survey-weighted computation slow | Low | Medium | Pre-compute common statistics; cache results |
| MCP protocol changes | Medium | Medium | Abstract protocol layer; stick to stable SDK |
| Researchers don't adopt CLI tools | Medium | High | Phase 3 web UI; target computational researchers first |
| Scope creep beyond exposome | High | Medium | Strict scope; say no to everything else |

---

## Appendix: Example Full Interaction

```
User (in Claude Code):
> "I'm writing a policy brief on lead exposure in children. 
>  What are the current levels, how have they changed, and 
>  are there disparities by income?"

Claude Code calls:
1. nhanes.mean("LBXBPB", subgroup="age<6", cycles="2017-2018")
2. nhanes.trend("LBXBPB", subgroup="age<6", metric="geometric_mean")
3. nhanes.compare_groups("LBXBPB", "family_income_ratio", subgroup="age<6")
4. nhanes.prevalence("LBXBPB > 3.5", subgroup="age<6")

Response synthesized by Claude:
"Current blood lead levels in US children under 6: geometric mean 
0.83 µg/dL (95% CI: 0.71-0.95), representing substantial progress 
from 2.2 µg/dL in 1999-2000. However, disparities persist: children 
in the lowest income quintile have mean BLL of 1.24 µg/dL vs 0.52 in 
the highest (p<0.001). Approximately 1.9% of children under 6 
(~187,000 children) still exceed the CDC reference value of 3.5 µg/dL.

All estimates are survey-weighted using NHANES MEC examination weights 
with Taylor series linearization for variance estimation."

[Reproducible R code attached for all four analyses]
```
