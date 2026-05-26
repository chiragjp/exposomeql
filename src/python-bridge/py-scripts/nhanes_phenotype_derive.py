#!/usr/bin/env python3
"""Derive a phenotype from a participant-level data source.

Built-in recipes:
  - egfr_ckdepi       2021 race-free CKD-EPI eGFR (mL/min/1.73m^2)
  - lipid_class_tc    ATP III total-cholesterol bins (0,1,2)
  - lipid_class_ldl   LDL bins (0..4)
  - lipid_class_hdl   HDL bins, sex-specific (0,1,2)
  - lipid_class_tg    Triglyceride bins (0..3)
  - framingham_cvd_10yr  D'Agostino 2008 general-CVD 10-year risk
  - mets_atp3         Metabolic syndrome (ATP III) binary
  - homa_ir           HOMA insulin-resistance index (continuous)
  - homa_beta         HOMA beta-cell function index (continuous)
  - fib4              Liver fibrosis index (age × AST / [plt × √ALT])
  - aip               Atherogenic index of plasma: log10(TG / HDL)
  - non_hdl_cholesterol  TC − HDL (mg/dL)
  - tg_hdl_ratio      TG / HDL (cardio risk marker)
  - tyg_index         Insulin-resistance surrogate: ln(TG × glucose / 2)
  - vai               Visceral adiposity index (Amato 2010, sex-specific)
  - allostatic_load   8-component physiological-dysregulation count (0–8)
  - liver_steatosis_cap    FibroScan controlled-attenuation parameter (dB/m), continuous
  - liver_steatosis_class  S0/S1/S2/S3 ordinal from CAP (Karlas 2017)
  - liver_fibrosis_lsm     FibroScan liver stiffness (kPa), continuous
  - liver_fibrosis_class   F0–F1 / F2 / F3 / F4 ordinal from stiffness (Wong/Boursier NAFLD)
  - ascvd_10yr_risk        ASCVD pooled-cohort 10-yr risk (Goff/Lloyd-Jones 2013, race+sex)
  - nafld_fibrosis_score   Angulo 2007 lab-based fibrosis score
  - nafld_fibrosis_class   Low / indeterminate / high probability of advanced fibrosis
  - apri                   AST-to-platelet ratio index (Wai 2003)
  - tyg_bmi                TyG × BMI (insulin resistance, anthropometry-augmented)
  - tyg_wc                 TyG × waist circumference
  - whtr                   Waist-to-height ratio
  - eag                    Estimated average glucose from HbA1c (Nathan 2008)
  - whr                    Waist-to-hip ratio (NHANES cycle J only)
  - whr_class              WHR risk class, sex-specific WHO cutpoints
  - ost_index              Osteoporosis Self-Assessment Tool (Koh 2001), FRAX substitute
  - ost_class              OST risk class, sex-specific cutpoints
  - frax_simplified        10-yr major osteoporotic fracture risk (FRAX-style Cox approx;
                           NOT the Sheffield-licensed algorithm — see recipe_meta)
  - bilirubin_class        Total bilirubin clinical bins (normal/mild/moderate/marked)
  - meld_classic           Original MELD (Kamath 2001) with INR=1.0 stand-in for NHANES
  - meld_xi                INR-free MELD variant (Heuman 2008), validated
  - phq9_score             PHQ-9 depression severity (0–27), 9-item sum
  - phq9_class             PHQ-9 severity class: minimal / mild / moderate / mod-severe / severe
  - depression_screen_positive  Binary PHQ-9 ≥10 (clinically significant)
  - frailty_index          Rockwood-style 12-deficit index (0–1)
  - frailty_class          4-level class: robust / pre-frail / mild / severe
  - expression        User-supplied formula over whitelisted variables
  - binarize          Threshold/percentile binarization of one variable

Data sources (params.data_source):
  - "nhanes" (default) — load from EXPOSOMEQL_DB_PATH SQLite per-cycle tables,
    write a CSV with NHANES survey-design columns (SEQN, cycle, RIDAGEYR,
    RIAGENDR, WTMEC2YR, SDMVPSU, SDMVSTRA, value, wt_pooled).
  - Future: "csv" / "hhear" / arbitrary registered cohort — same recipe library,
    different loader; the output CSV uses generic columns (pid, value) and the
    survey-design columns are omitted. Downstream tools branch on their
    presence (has_survey_design flag in the returned summary).
"""

import sys, json, os, math, sqlite3, ast
import pandas as pd
import numpy as np

params = json.load(sys.stdin)
db_path = os.environ.get("EXPOSOMEQL_DB_PATH", "data/nhanes_031725.sqlite")

recipe   = params["recipe"]
cycles   = params.get("cycles") or ["A","B","C","D","E","F","G","H","I","J"]
out_csv  = params["out_csv"]
name     = params.get("name", recipe)

RECIPE_VARS = {
    "egfr_ckdepi":         ["LBXSCR"],
    "lipid_class_tc":      ["LBXTC"],
    "lipid_class_ldl":     ["LBDLDL"],
    "lipid_class_hdl":     ["LBDHDD"],
    "lipid_class_tg":      ["LBXTR"],
    "framingham_cvd_10yr": ["LBXTC","LBDHDD","BPXSY1","BPQ050A","BPQ020","SMQ020","DIQ010"],
    "mets_atp3":           ["BMXWAIST","LBXSTR","LBDHDD","BPXSY1","BPXDI1","BPQ050A","LBXGLU","DIQ050"],
    "homa_ir":             ["LBXGLU","LBXIN"],
    "homa_beta":           ["LBXGLU","LBXIN"],
    "fib4":                ["LBXSASSI","LBXSATSI","LBXPLTSI"],
    "aip":                 ["LBXSTR","LBDHDD"],
    "non_hdl_cholesterol": ["LBXTC","LBDHDD"],
    "tg_hdl_ratio":        ["LBXSTR","LBDHDD"],
    "tyg_index":           ["LBXSTR","LBXGLU"],
    "vai":                 ["BMXWAIST","BMXBMI","LBXSTR","LBDHDD"],
    "allostatic_load":     ["BPXSY1","BPXDI1","BMXBMI","BMXWAIST","LBXGH","LBXTC","LBDHDD"],
    # FibroScan recipes — only NHANES cycle J (2017-2018) has these variables.
    # LUXCAPM = controlled attenuation parameter (steatosis), LUXSMED = stiffness
    # (fibrosis); QC indicators are LUXCPIQR / LUXSIQR / LUXSIQRM.
    "liver_steatosis_cap":   ["LUXCAPM","LUXCPIQR"],
    "liver_steatosis_class": ["LUXCAPM","LUXCPIQR"],
    "liver_fibrosis_lsm":    ["LUXSMED","LUXSIQRM","LUXSIQR"],
    "liver_fibrosis_class":  ["LUXSMED","LUXSIQRM","LUXSIQR"],
    # ASCVD Pooled Cohort Equations (Goff/Lloyd-Jones 2013): race+sex-specific
    # 10-year hard-ASCVD-event risk. SMQ020 (ever-smoker) is the required smoker
    # proxy; SMQ040 (current smoker) is loaded via optional_vars and used when
    # available because the PCE definition is current smoker.
    "ascvd_10yr_risk":       ["LBXTC","LBDHDD","BPXSY1","BPQ050A","SMQ020","DIQ010"],
    "nafld_fibrosis_score":  ["BMXBMI","LBXGLU","DIQ010","LBXSASSI","LBXSATSI","LBXPLTSI","LBXSAL"],
    "nafld_fibrosis_class":  ["BMXBMI","LBXGLU","DIQ010","LBXSASSI","LBXSATSI","LBXPLTSI","LBXSAL"],
    "apri":                  ["LBXSASSI","LBXPLTSI"],
    "tyg_bmi":               ["LBXSTR","LBXGLU","BMXBMI"],
    "tyg_wc":                ["LBXSTR","LBXGLU","BMXWAIST"],
    "whtr":                  ["BMXWAIST","BMXHT"],
    "eag":                   ["LBXGH"],
    # WHR needs hip circumference, which NHANES only collected in cycle J (2017-2018).
    "whr":                   ["BMXWAIST","BMXHIP"],
    "whr_class":             ["BMXWAIST","BMXHIP"],
    # OST = 0.2 × (weight_kg - age_years). Stands in for FRAX when BMD + the
    # full FRAX clinical predictor set isn't available — Koh 2001, widely used.
    "ost_index":             ["BMXWT"],
    "ost_class":             ["BMXWT"],
    # FRAX-style 10-yr major-osteoporotic-fracture risk.
    "frax_simplified":       ["BMXBMI","SMQ020","DIQ010"],
    # MELD family (liver dysfunction / cirrhosis short-term mortality).
    "bilirubin_class":       ["LBXSTB"],
    "meld_classic":          ["LBXSTB","LBXSCR"],   # INR=1.0 stand-in (community sample)
    "meld_xi":               ["LBXSTB","LBXSCR"],
    # Mental health — PHQ-9 (Kroenke 2001). NHANES DPQ_D..DPQ_J (2005-2018).
    "phq9_score":                  ["DPQ010","DPQ020","DPQ030","DPQ040","DPQ050","DPQ060","DPQ070","DPQ080","DPQ090"],
    "phq9_class":                  ["DPQ010","DPQ020","DPQ030","DPQ040","DPQ050","DPQ060","DPQ070","DPQ080","DPQ090"],
    "depression_screen_positive":  ["DPQ010","DPQ020","DPQ030","DPQ040","DPQ050","DPQ060","DPQ070","DPQ080","DPQ090"],
    # Frailty (Rockwood deficit accumulation, 12-item NHANES-portable version).
    "frailty_index":               ["MCQ010","MCQ160A","MCQ160B","MCQ160C","MCQ160E","MCQ160F","MCQ160L","MCQ220","DIQ010","BPQ020","BPQ080","HUQ010"],
    "frailty_class":               ["MCQ010","MCQ160A","MCQ160B","MCQ160C","MCQ160E","MCQ160F","MCQ160L","MCQ220","DIQ010","BPQ020","BPQ080","HUQ010"],
}
# allostatic_load also needs CRP, but the variable changed across cycles
# (LBXCRP 1999-2009, LBXHSCRP 2015-2017). We try both at load time and skip
# the CRP component (-1 max score) for cycles where neither is present.
ALLOSTATIC_OPTIONAL_VARS = ["LBXHSCRP", "LBXCRP"]
# ASCVD prefers SMQ040 (current smoker) but falls back to SMQ020 (ever).
ASCVD_OPTIONAL_VARS = ["SMQ040"]

def err(msg, **extra):
    out = {"error": msg}
    out.update(extra)
    print(json.dumps(out))
    sys.exit(1)

def safe_float(x):
    if x is None: return None
    try:
        x = float(x)
    except Exception:
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, 6)

# NHANES survey-questionnaire variables follow a stable <PREFIX>_<CYCLE> table-
# name convention, but the variable_names_epcf catalog is intermittently
# incomplete for questionnaire variables (e.g., DPQ010 lives in DPQ_D..DPQ_J
# but the catalog only lists cycle J). Fall back to this prefix lookup when
# the catalog misses, then verify the variable exists in the candidate table.
QUESTIONNAIRE_TABLE_PREFIXES = (
    "DPQ", "MCQ", "PFQ", "HUQ", "BPQ", "DIQ", "KIQ", "SLQ", "ALQ", "SMQ",
    "HSQ", "OSQ", "CFQ", "OCQ", "PUQ", "RHQ", "FSQ", "INQ",
)

def find_table(con, var, cycle):
    # Strategy 1: catalog lookup (preferred — handles renamed/legacy variables)
    rows = pd.read_sql(
        'SELECT "Data.File.Name" AS f FROM variable_names_epcf '
        'WHERE "Variable.Name"=? AND "Data.File.Name" LIKE ? '
        'AND "Data.File.Name" NOT LIKE "P\\_%" ESCAPE "\\" LIMIT 1',
        con, params=(var, f"%_{cycle}"),
    )
    if len(rows):
        return rows.iloc[0, 0]
    # Strategy 2: questionnaire-prefix fallback
    for prefix in QUESTIONNAIRE_TABLE_PREFIXES:
        if var.startswith(prefix):
            candidate = f"{prefix}_{cycle}"
            try:
                check = pd.read_sql(
                    f'SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',
                    con, params=(candidate,))
                if len(check):
                    # Verify the column actually exists in that table
                    cols = pd.read_sql(f'PRAGMA table_info("{candidate}")', con)
                    if var in set(cols["name"].astype(str)):
                        return candidate
            except Exception:
                pass
            break
    return None

def load_var(con, var, cycle):
    tab = find_table(con, var, cycle)
    if not tab:
        return None
    try:
        df = pd.read_sql(f'SELECT SEQN, "{var}" FROM "{tab}"', con)
    except Exception:
        return None
    df[var] = pd.to_numeric(df[var], errors="coerce")
    return df

DEMO_COLS = ["SEQN","RIDAGEYR","RIAGENDR","RIDRETH3","INDFMPIR","DMDEDUC2","WTMEC2YR","WTINT2YR","SDMVPSU","SDMVSTRA"]

def load_demo(con, cycle):
    tab = f"DEMO_{cycle}"
    cols = ",".join(DEMO_COLS)
    try:
        df = pd.read_sql(f"SELECT {cols} FROM \"{tab}\"", con)
        df["cycle"] = cycle
        return df
    except Exception:
        return None

# Source variable selection
if recipe == "expression":
    src_vars = list(params.get("source_variables") or [])
    formula  = params.get("formula")
    if not formula or not src_vars:
        err("expression recipe requires both 'formula' and 'source_variables'")
elif recipe == "binarize":
    spec = params.get("binarize") or {}
    if not spec.get("variable"):
        err("binarize recipe requires binarize.variable")
    src_vars = [spec["variable"]]
else:
    src_vars = RECIPE_VARS.get(recipe)
    if src_vars is None:
        err(f"unknown recipe '{recipe}'", available_recipes=list(RECIPE_VARS) + ["expression","binarize"])

con = sqlite3.connect(db_path)
try:
    frames = []
    skipped_cycles = {}
    optional_vars: list[str] = []
    if recipe == "allostatic_load":
        optional_vars = ALLOSTATIC_OPTIONAL_VARS
    elif recipe in ("ascvd_10yr_risk", "frax_simplified"):
        # Both prefer SMQ040 (current smoker) when available.
        optional_vars = ASCVD_OPTIONAL_VARS
    for c in cycles:
        demo = load_demo(con, c)
        if demo is None:
            skipped_cycles[c] = "DEMO table missing"
            continue
        merged = demo
        missing_here = []
        for v in src_vars:
            df_v = load_var(con, v, c)
            if df_v is None:
                missing_here.append(v)
                continue
            merged = merged.merge(df_v, on="SEQN", how="left")
        if missing_here:
            skipped_cycles[c] = f"missing: {','.join(missing_here)}"
            continue
        # Optional vars (e.g., CRP variants for allostatic load): try each, keep first that loads.
        for ov in optional_vars:
            df_o = load_var(con, ov, c)
            if df_o is not None:
                merged = merged.merge(df_o, on="SEQN", how="left")
                break
        frames.append(merged)
    if not frames:
        err("no cycles have all required source variables",
            source_variables=src_vars, requested_cycles=cycles,
            skipped_cycles=skipped_cycles)
    raw = pd.concat(frames, ignore_index=True, sort=False)
finally:
    con.close()

# Recipe application
ptype = "continuous"
value = None
recipe_meta = {}

if recipe == "egfr_ckdepi":
    age = raw["RIDAGEYR"].astype(float)
    sex_female = (raw["RIAGENDR"] == 2)
    scr = raw["LBXSCR"].astype(float)
    k = np.where(sex_female, 0.7, 0.9)
    alpha = np.where(sex_female, -0.241, -0.302)
    sex_mult = np.where(sex_female, 1.012, 1.0)
    ratio = scr / k
    value = 142.0 * np.minimum(ratio, 1)**alpha * np.maximum(ratio, 1)**(-1.200) * 0.9938**age * sex_mult
    recipe_meta = {"units":"mL/min/1.73m^2","formula":"CKD-EPI 2021 (race-free)",
                   "reference":"Inker et al. NEJM 2021;385:1737-1749"}

elif recipe == "lipid_class_tc":
    ptype = "ordinal"
    tc = raw["LBXTC"].astype(float)
    value = np.where(np.isnan(tc), np.nan,
            np.where(tc < 200, 0, np.where(tc < 240, 1, 2))).astype(float)
    recipe_meta = {"levels":{"0":"desirable (<200)","1":"borderline (200-239)","2":"high (≥240)"},
                   "units":"mg/dL","reference":"NCEP ATP III"}

elif recipe == "lipid_class_ldl":
    ptype = "ordinal"
    ldl = raw["LBDLDL"].astype(float)
    value = np.where(np.isnan(ldl), np.nan,
            np.where(ldl < 100, 0,
            np.where(ldl < 130, 1,
            np.where(ldl < 160, 2,
            np.where(ldl < 190, 3, 4))))).astype(float)
    recipe_meta = {"levels":{"0":"optimal (<100)","1":"near-optimal (100-129)",
                             "2":"borderline (130-159)","3":"high (160-189)","4":"very high (≥190)"},
                   "units":"mg/dL","reference":"NCEP ATP III"}

elif recipe == "lipid_class_hdl":
    ptype = "ordinal"
    hdl = raw["LBDHDD"].astype(float)
    sex_female = (raw["RIAGENDR"] == 2)
    low_cut = np.where(sex_female, 50, 40)
    value = np.where(np.isnan(hdl), np.nan,
            np.where(hdl < low_cut, 0, np.where(hdl < 60, 1, 2))).astype(float)
    recipe_meta = {"levels":{"0":"low","1":"normal","2":"high (≥60)"},
                   "units":"mg/dL",
                   "note":"sex-specific low cutpoint (men <40, women <50)",
                   "reference":"NCEP ATP III"}

elif recipe == "lipid_class_tg":
    ptype = "ordinal"
    tg = raw["LBXTR"].astype(float)
    value = np.where(np.isnan(tg), np.nan,
            np.where(tg < 150, 0,
            np.where(tg < 200, 1,
            np.where(tg < 500, 2, 3)))).astype(float)
    recipe_meta = {"levels":{"0":"normal (<150)","1":"borderline (150-199)",
                             "2":"high (200-499)","3":"very high (≥500)"},
                   "units":"mg/dL","reference":"NCEP ATP III"}

elif recipe == "framingham_cvd_10yr":
    # D'Agostino RB et al., Circulation 2008;117:743-753 (general CVD)
    age = raw["RIDAGEYR"].astype(float)
    tc  = raw["LBXTC"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    sbp = raw["BPXSY1"].astype(float)
    on_bp_med = (raw["BPQ050A"] == 1)
    smoker    = (raw["SMQ020"] == 1)
    diabetes  = (raw["DIQ010"] == 1)
    sex_female = (raw["RIAGENDR"] == 2)

    with np.errstate(invalid="ignore", divide="ignore"):
        ln_age = np.log(age)
        ln_tc  = np.log(tc)
        ln_hdl = np.log(hdl)
        ln_sbp = np.log(sbp)

    bx_m = (3.06117*ln_age + 1.12370*ln_tc - 0.93263*ln_hdl
            + np.where(on_bp_med, 1.99881, 1.93303)*ln_sbp
            + 0.65451*smoker.astype(float) + 0.57367*diabetes.astype(float))
    bx_f = (2.32888*ln_age + 1.20904*ln_tc - 0.70833*ln_hdl
            + np.where(on_bp_med, 2.82263, 2.76157)*ln_sbp
            + 0.52873*smoker.astype(float) + 0.69154*diabetes.astype(float))
    mean_m, S0_m = 23.9802, 0.88936
    mean_f, S0_f = 26.1931, 0.95012

    with np.errstate(invalid="ignore", over="ignore"):
        risk_m = 1 - S0_m**np.exp(bx_m - mean_m)
        risk_f = 1 - S0_f**np.exp(bx_f - mean_f)
    value = np.where(sex_female, risk_f, risk_m)
    # Out-of-range values (age outside 30-74 etc.) -> NaN
    value = np.where((age < 30) | (age > 74), np.nan, value)
    recipe_meta = {"units":"10-year general-CVD risk probability",
                   "reference":"D'Agostino RB et al. Circulation 2008;117:743-753 (general CVD)",
                   "note":"valid for ages 30-74; smoker = ever-smoker (SMQ020==1)"}

elif recipe == "mets_atp3":
    ptype = "binary"
    sex_female = (raw["RIAGENDR"] == 2)
    waist = raw["BMXWAIST"].astype(float)
    tg = raw["LBXSTR"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    sbp = raw["BPXSY1"].astype(float)
    dbp = raw["BPXDI1"].astype(float)
    on_bp_med = (raw["BPQ050A"] == 1)
    glu = raw["LBXGLU"].astype(float)
    on_dm_med = (raw["DIQ050"] == 1)
    waist_high = np.where(sex_female, waist >= 88, waist >= 102)
    tg_high    = (tg >= 150)
    hdl_low    = np.where(sex_female, hdl < 50, hdl < 40)
    bp_high    = (sbp >= 130) | (dbp >= 85) | on_bp_med
    glu_high   = (glu >= 100) | on_dm_med
    crits = (waist_high.astype(int) + tg_high.astype(int) + hdl_low.astype(int)
             + bp_high.astype(int) + glu_high.astype(int))
    value = (crits >= 3).astype(float)
    # NA if any input missing
    any_na = (waist.isna() | tg.isna() | hdl.isna() | sbp.isna() | dbp.isna() | glu.isna())
    value = np.where(any_na, np.nan, value)
    recipe_meta = {"criteria":"ATP III: ≥3 of {waist (M≥102/F≥88), TG≥150, HDL low (M<40/F<50), BP≥130/85 or treated, fasting glucose≥100 or treated}",
                   "criteria_count_mean": safe_float(np.nanmean(crits)),
                   "note":"requires fasting subsample for LBXGLU (use WTSAF2YR weights downstream for glucose-stratified analyses)"}

elif recipe == "homa_ir":
    glu = raw["LBXGLU"].astype(float)   # fasting glucose mg/dL
    ins = raw["LBXIN"].astype(float)    # fasting insulin µU/mL
    value = (glu * ins) / 405.0
    # Out-of-range / non-fasting / negative-insulin → NaN
    value = np.where((glu <= 0) | (ins <= 0), np.nan, value)
    recipe_meta = {"formula":"(glucose_mgdl * insulin_uIU_mL) / 405",
                   "units":"HOMA-IR (unitless)",
                   "reference":"Matthews DR et al. Diabetologia 1985;28:412-419",
                   "note":"requires fasting subsample (WTSAF2YR weights for downstream analyses); higher = more insulin resistance"}

elif recipe == "homa_beta":
    glu = raw["LBXGLU"].astype(float)
    ins = raw["LBXIN"].astype(float)
    # Standard formula: (360 * insulin) / (glucose - 63)
    denom = glu - 63.0
    with np.errstate(divide="ignore", invalid="ignore"):
        value = (360.0 * ins) / denom
    value = np.where((glu <= 63) | (ins <= 0), np.nan, value)
    recipe_meta = {"formula":"(360 * insulin_uIU_mL) / (glucose_mgdl - 63)",
                   "units":"HOMA-β (%, unitless on glucose mg/dL)",
                   "reference":"Matthews DR et al. Diabetologia 1985;28:412-419",
                   "note":"undefined when fasting glucose ≤ 63 mg/dL; higher = more beta-cell secretion capacity"}

elif recipe == "fib4":
    age = raw["RIDAGEYR"].astype(float)
    ast = raw["LBXSASSI"].astype(float)
    alt = raw["LBXSATSI"].astype(float)
    plt = raw["LBXPLTSI"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        value = (age * ast) / (plt * np.sqrt(alt))
    value = np.where((plt <= 0) | (alt <= 0) | (age <= 0), np.nan, value)
    recipe_meta = {"formula":"(age * AST) / (platelets[10^9/L] * sqrt(ALT))",
                   "units":"FIB-4 (unitless)",
                   "reference":"Sterling RK et al. Hepatology 2006;43:1317-1325",
                   "note":"clinical cutpoints: <1.3 rules out advanced fibrosis; >2.67 suggests advanced fibrosis. Valid for adults; use APRI or age-adjusted FIB-4 in children/elderly."}

elif recipe == "aip":
    tg = raw["LBXSTR"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        value = np.log10(tg / hdl)
    value = np.where((tg <= 0) | (hdl <= 0), np.nan, value)
    recipe_meta = {"formula":"log10(TG_mgdL / HDL_mgdL)",
                   "units":"AIP (unitless)",
                   "reference":"Dobiasova M, Frohlich J. Clin Biochem 2001;34:583-588",
                   "note":"clinical risk bands: <0.11 low, 0.11–0.21 intermediate, >0.21 high cardiovascular risk"}

elif recipe == "non_hdl_cholesterol":
    tc = raw["LBXTC"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    value = tc - hdl
    value = np.where((tc <= 0) | (hdl <= 0), np.nan, value)
    recipe_meta = {"formula":"TC - HDL",
                   "units":"mg/dL",
                   "reference":"NCEP ATP III; AHA/ACC 2018 cholesterol guidelines",
                   "note":"non-HDL ≥ 160 mg/dL flags elevated atherogenic-particle burden"}

elif recipe == "tg_hdl_ratio":
    tg = raw["LBXSTR"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        value = tg / hdl
    value = np.where((tg <= 0) | (hdl <= 0), np.nan, value)
    recipe_meta = {"formula":"TG_mgdL / HDL_mgdL",
                   "units":"ratio (unitless)",
                   "reference":"Hadaegh F et al. Atherosclerosis 2009 (cardiometabolic risk marker)",
                   "note":"clinical cutpoints vary by population; >3 typically flags high cardiometabolic risk"}

elif recipe == "tyg_index":
    tg = raw["LBXSTR"].astype(float)
    glu = raw["LBXGLU"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        value = np.log(tg * glu / 2.0)
    value = np.where((tg <= 0) | (glu <= 0), np.nan, value)
    recipe_meta = {"formula":"ln(TG_mgdL * glucose_mgdL / 2)",
                   "units":"TyG index (unitless)",
                   "reference":"Simental-Mendia LE et al. Metab Syndr Relat Disord 2008;6:299-304",
                   "note":"surrogate for insulin resistance; requires fasting subsample (WTSAF2YR weights downstream)"}

elif recipe == "vai":
    # Visceral Adiposity Index (Amato 2010), sex-specific.
    # waist in cm; convert TG (mg/dL → mmol/L) /88.5; HDL (mg/dL → mmol/L) /38.67
    waist = raw["BMXWAIST"].astype(float)
    bmi = raw["BMXBMI"].astype(float)
    tg_mmol = raw["LBXSTR"].astype(float) / 88.5
    hdl_mmol = raw["LBDHDD"].astype(float) / 38.67
    sex_female = (raw["RIAGENDR"] == 2)
    with np.errstate(invalid="ignore", divide="ignore"):
        wc_denom_m = 39.68 + 1.88 * bmi
        wc_denom_f = 36.58 + 1.89 * bmi
        wc_denom = np.where(sex_female, wc_denom_f, wc_denom_m)
        tg_norm  = np.where(sex_female, tg_mmol / 0.81, tg_mmol / 1.03)
        hdl_norm = np.where(sex_female, 1.52 / hdl_mmol, 1.31 / hdl_mmol)
        value = (waist / wc_denom) * tg_norm * hdl_norm
    value = np.where((bmi <= 0) | (waist <= 0) | (tg_mmol <= 0) | (hdl_mmol <= 0), np.nan, value)
    recipe_meta = {"formula":"(waist_cm / [39.68 + 1.88*BMI]_M or [36.58 + 1.89*BMI]_F) * (TG/1.03_M or TG/0.81_F) * (1.31/HDL_M or 1.52/HDL_F)",
                   "units":"VAI (unitless, sex-specific)",
                   "reference":"Amato MC et al. Diabetes Care 2010;33:920-922",
                   "note":"normal range ~1 in healthy population; higher = more visceral adipose dysfunction"}

elif recipe == "allostatic_load":
    # 8-component count: SBP, DBP, BMI, waist (sex-specific), HbA1c, TC, HDL (sex-specific), CRP.
    sbp = raw["BPXSY1"].astype(float)
    dbp = raw["BPXDI1"].astype(float)
    bmi = raw["BMXBMI"].astype(float)
    waist = raw["BMXWAIST"].astype(float)
    hba1c = raw["LBXGH"].astype(float)
    tc = raw["LBXTC"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    sex_female = (raw["RIAGENDR"] == 2)
    # CRP: prefer LBXHSCRP if loaded, else LBXCRP; either may be absent in some cycles.
    crp = None
    crp_source = None
    if "LBXHSCRP" in raw.columns:
        crp = pd.to_numeric(raw["LBXHSCRP"], errors="coerce")
        crp_source = "LBXHSCRP (mg/L)"
    elif "LBXCRP" in raw.columns:
        # LBXCRP is in mg/dL; convert to mg/L by multiplying by 10
        crp = pd.to_numeric(raw["LBXCRP"], errors="coerce") * 10.0
        crp_source = "LBXCRP × 10 (mg/L)"
    components_present = []
    score = np.zeros(len(raw), dtype=float)
    any_missing = pd.Series(False, index=raw.index)
    # SBP ≥ 140
    components_present.append("SBP≥140")
    score = score + (sbp >= 140).astype(int)
    any_missing = any_missing | sbp.isna()
    # DBP ≥ 90
    components_present.append("DBP≥90")
    score = score + (dbp >= 90).astype(int)
    any_missing = any_missing | dbp.isna()
    # BMI ≥ 30
    components_present.append("BMI≥30")
    score = score + (bmi >= 30).astype(int)
    any_missing = any_missing | bmi.isna()
    # Waist sex-specific (M ≥ 102, F ≥ 88)
    components_present.append("waist≥102M/88F")
    waist_flag = np.where(sex_female, waist >= 88, waist >= 102)
    score = score + waist_flag.astype(int)
    any_missing = any_missing | waist.isna()
    # HbA1c ≥ 6.4
    components_present.append("HbA1c≥6.4")
    score = score + (hba1c >= 6.4).astype(int)
    any_missing = any_missing | hba1c.isna()
    # TC ≥ 240
    components_present.append("TC≥240")
    score = score + (tc >= 240).astype(int)
    any_missing = any_missing | tc.isna()
    # HDL sex-specific (M < 40, F < 50)
    components_present.append("HDL<40M/50F")
    hdl_flag = np.where(sex_female, hdl < 50, hdl < 40)
    score = score + hdl_flag.astype(int)
    any_missing = any_missing | hdl.isna()
    # CRP ≥ 3 mg/L (if available)
    if crp is not None:
        components_present.append(f"CRP≥3 [{crp_source}]")
        score = score + (crp >= 3).astype(int)
        any_missing = any_missing | crp.isna()
    n_components = len(components_present)
    value = np.where(any_missing, np.nan, score)
    ptype = "ordinal"
    recipe_meta = {"formula": f"count of {n_components} dysregulated biomarkers (each scored 0/1)",
                   "components": components_present,
                   "units": f"count (0–{n_components})",
                   "reference":"McEwen BS, Seeman T. Ann NY Acad Sci 1999; Crimmins EM et al. Soc Sci Med 2003",
                   "note":"score uses clinical thresholds (not sample-based quartiles) for portability; participants with any missing input component are dropped"}

elif recipe in ("liver_steatosis_cap", "liver_steatosis_class"):
    # FibroScan CAP — measure of hepatic steatosis (fat). QC: drop measurements
    # whose CAP IQR exceeds 40 dB/m (Karlas 2017 reliability criterion).
    cap = raw["LUXCAPM"].astype(float)
    cap_iqr = raw["LUXCPIQR"].astype(float)
    bad_qc = (cap_iqr > 40)
    if recipe == "liver_steatosis_cap":
        value = np.where(bad_qc | cap.isna(), np.nan, cap)
        recipe_meta = {"units":"dB/m",
                       "reference":"Karlas T et al. J Hepatol 2017;66:1022-1030",
                       "qc":"drop CAP-IQR > 40 dB/m",
                       "note":"NHANES cycle J only (2017-2018). Cutpoints: <248 S0; 248-267 S1; 268-279 S2; ≥280 S3."}
    else:
        ptype = "ordinal"
        cls = np.where(cap < 248, 0,
              np.where(cap < 268, 1,
              np.where(cap < 280, 2, 3))).astype(float)
        value = np.where(bad_qc | cap.isna(), np.nan, cls)
        recipe_meta = {"levels":{"0":"S0 (<248 dB/m)","1":"S1 (248–267)","2":"S2 (268–279)","3":"S3 (≥280)"},
                       "reference":"Karlas T et al. J Hepatol 2017;66:1022-1030 (CAP cutpoints for steatosis grade)",
                       "qc":"drop CAP-IQR > 40 dB/m",
                       "note":"NHANES cycle J only (2017-2018). Steatosis grade S1+ corresponds to >11% hepatic fat."}

elif recipe in ("liver_fibrosis_lsm", "liver_fibrosis_class"):
    # FibroScan stiffness — measure of liver fibrosis. QC follows EASL/FibroScan
    # guidance: relative IQR/median < 30% OR absolute IQR < 1.5 kPa (the latter
    # rescues low-stiffness measurements where small absolute IQRs can yield
    # large relative ratios).  LUXSIQRM is in percent in NHANES (median ~13.5).
    lsm = raw["LUXSMED"].astype(float)
    iqr_pct = raw["LUXSIQRM"].astype(float)
    iqr_abs = raw["LUXSIQR"].astype(float)
    pass_qc = (iqr_pct < 30) | (iqr_abs < 1.5)
    bad_qc = ~pass_qc
    if recipe == "liver_fibrosis_lsm":
        value = np.where(bad_qc | lsm.isna(), np.nan, lsm)
        recipe_meta = {"units":"kPa",
                       "reference":"Wong VW et al. Hepatology 2010 (NAFLD stiffness cutpoints)",
                       "qc":"keep IQR/median < 30% OR absolute IQR < 1.5 kPa (EASL guidance)",
                       "note":"NHANES cycle J only (2017-2018). Cutpoints (NAFLD): <8.2 F0-F1; 8.2-9.7 F2; 9.7-13.6 F3; ≥13.6 F4."}
    else:
        ptype = "ordinal"
        cls = np.where(lsm < 8.2, 0,
              np.where(lsm < 9.7, 1,
              np.where(lsm < 13.6, 2, 3))).astype(float)
        value = np.where(bad_qc | lsm.isna(), np.nan, cls)
        recipe_meta = {"levels":{"0":"F0–F1 (<8.2 kPa, no/minimal fibrosis)",
                                  "1":"F2 (8.2–9.7, significant)",
                                  "2":"F3 (9.7–13.6, advanced)",
                                  "3":"F4 (≥13.6, cirrhosis)"},
                       "reference":"Wong VW et al. Hepatology 2010; Boursier J et al. Aliment Pharmacol Ther 2013 (NAFLD)",
                       "qc":"keep IQR/median < 30% OR absolute IQR < 1.5 kPa (EASL guidance)",
                       "note":"NHANES cycle J only. Cutpoints are NAFLD-specific; different cutpoints apply for HCV, alcoholic liver disease, etc."}

elif recipe == "ascvd_10yr_risk":
    # Goff DC et al. Circulation 2014;129(25 Suppl 2):S49-S73 (PCE)
    age = raw["RIDAGEYR"].astype(float)
    tc  = raw["LBXTC"].astype(float)
    hdl = raw["LBDHDD"].astype(float)
    sbp = raw["BPXSY1"].astype(float)
    on_bp_med = (raw["BPQ050A"] == 1)
    diabetes  = (raw["DIQ010"] == 1)
    sex_female = (raw["RIAGENDR"] == 2)
    # Black coefficients only for NH Black (RIDRETH3 == 4); else White equations
    is_black = (raw["RIDRETH3"] == 4) if "RIDRETH3" in raw.columns else pd.Series(False, index=raw.index)
    # Smoker: prefer SMQ040 (current) if loaded, else SMQ020 (ever)
    if "SMQ040" in raw.columns:
        smq = pd.to_numeric(raw["SMQ040"], errors="coerce")
        smoker = (smq == 1) | (smq == 2)  # every day or some days
        smoker_source = "SMQ040 (current)"
    else:
        smoker = (raw["SMQ020"] == 1)
        smoker_source = "SMQ020 (ever; PCE prefers current — overestimate)"

    with np.errstate(invalid="ignore", divide="ignore"):
        ln_age = np.log(age)
        ln_age_sq = ln_age ** 2
        ln_tc = np.log(tc)
        ln_hdl = np.log(hdl)
        ln_sbp = np.log(sbp)
        ln_age_tc = ln_age * ln_tc
        ln_age_hdl = ln_age * ln_hdl
        ln_age_sbp = ln_age * ln_sbp
        ln_age_smk = ln_age * smoker.astype(float)
        smk_f = smoker.astype(float)
        dm_f = diabetes.astype(float)

    bx = np.full(len(raw), np.nan)

    # White Women — Goff 2014 Appendix Table A
    m = sex_female & ~is_black
    bx_ww = (-29.799 * ln_age + 4.884 * ln_age_sq + 13.540 * ln_tc - 3.114 * ln_age_tc
             - 13.578 * ln_hdl + 3.149 * ln_age_hdl
             + np.where(on_bp_med, 2.019, 1.957) * ln_sbp
             + 7.574 * smk_f - 1.665 * ln_age_smk + 0.661 * dm_f)
    bx = np.where(m, bx_ww, bx)

    # Black Women
    m = sex_female & is_black
    bx_bw = (17.114 * ln_age + 0.940 * ln_tc
             - 18.920 * ln_hdl + 4.475 * ln_age_hdl
             + np.where(on_bp_med, 29.291, 27.820) * ln_sbp
             + np.where(on_bp_med, -6.432, -6.087) * ln_age_sbp
             + 0.691 * smk_f + 0.874 * dm_f)
    bx = np.where(m, bx_bw, bx)

    # White Men
    m = (~sex_female) & ~is_black
    bx_wm = (12.344 * ln_age + 11.853 * ln_tc - 2.664 * ln_age_tc
             - 7.990 * ln_hdl + 1.769 * ln_age_hdl
             + np.where(on_bp_med, 1.797, 1.764) * ln_sbp
             + 7.837 * smk_f - 1.795 * ln_age_smk + 0.658 * dm_f)
    bx = np.where(m, bx_wm, bx)

    # Black Men
    m = (~sex_female) & is_black
    bx_bm = (2.469 * ln_age + 0.302 * ln_tc - 0.307 * ln_hdl
             + np.where(on_bp_med, 1.916, 1.809) * ln_sbp
             + 0.549 * smk_f + 0.645 * dm_f)
    bx = np.where(m, bx_bm, bx)

    # Group-specific baseline survival and mean linear predictor
    mean_bx = np.full(len(raw), np.nan)
    s0 = np.full(len(raw), np.nan)
    mean_bx = np.where(sex_female & ~is_black, -29.18, mean_bx)
    s0      = np.where(sex_female & ~is_black, 0.9665, s0)
    mean_bx = np.where(sex_female & is_black,  86.61,  mean_bx)
    s0      = np.where(sex_female & is_black,  0.9533, s0)
    mean_bx = np.where((~sex_female) & ~is_black, 61.18,  mean_bx)
    s0      = np.where((~sex_female) & ~is_black, 0.9144, s0)
    mean_bx = np.where((~sex_female) & is_black,  19.54,  mean_bx)
    s0      = np.where((~sex_female) & is_black,  0.8954, s0)

    with np.errstate(invalid="ignore", over="ignore"):
        risk = 1 - s0 ** np.exp(bx - mean_bx)
    # Valid for ages 40-79 per AHA guideline
    risk = np.where((age < 40) | (age > 79), np.nan, risk)
    value = risk
    recipe_meta = {"units":"10-year hard-ASCVD-event risk (probability)",
                   "reference":"Goff DC et al. Circulation 2014;129(25 Suppl 2):S49-S73 (Pooled Cohort Equations)",
                   "smoker_source": smoker_source,
                   "race_mapping":"Black coefficients applied to RIDRETH3==4 (NH Black); White coefficients applied to all other race/ethnicity groups (AHA 2018 guideline approximation)",
                   "note":"valid for ages 40-79; cardiology guideline tool for primary-prevention statin/BP decisions"}

elif recipe in ("nafld_fibrosis_score", "nafld_fibrosis_class"):
    # Angulo P et al. Hepatology 2007;45:846-854
    age = raw["RIDAGEYR"].astype(float)
    bmi = raw["BMXBMI"].astype(float)
    glu = raw["LBXGLU"].astype(float)
    dm  = (raw["DIQ010"] == 1)
    ast = raw["LBXSASSI"].astype(float)
    alt = raw["LBXSATSI"].astype(float)
    plt = raw["LBXPLTSI"].astype(float)
    alb = raw["LBXSAL"].astype(float)
    ifg_or_dm = ((glu >= 100) | dm).astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        ast_alt = ast / alt
        nfs = (-1.675 + 0.037 * age + 0.094 * bmi
               + 1.13 * ifg_or_dm + 0.99 * ast_alt
               - 0.013 * plt - 0.66 * alb)
    nfs = np.where((alt <= 0) | (plt <= 0) | (alb <= 0), np.nan, nfs)
    if recipe == "nafld_fibrosis_score":
        value = nfs
        recipe_meta = {"formula":"-1.675 + 0.037*age + 0.094*BMI + 1.13*(IFG/DM) + 0.99*AST/ALT - 0.013*platelets - 0.66*albumin",
                       "units":"NFS (unitless)",
                       "reference":"Angulo P et al. Hepatology 2007;45:846-854",
                       "note":"cutpoints: <-1.455 rules out advanced fibrosis; >0.676 indicates advanced fibrosis. IFG = fasting glucose ≥100 mg/dL; requires fasting subsample for full validity."}
    else:
        ptype = "ordinal"
        cls = np.where(nfs < -1.455, 0,
              np.where(nfs <= 0.676, 1, 2)).astype(float)
        value = np.where(np.isnan(nfs), np.nan, cls)
        recipe_meta = {"levels":{"0":"low probability (<-1.455)",
                                  "1":"indeterminate (-1.455 to 0.676)",
                                  "2":"high probability of advanced fibrosis (>0.676)"},
                       "reference":"Angulo P et al. Hepatology 2007;45:846-854 (NFS cutpoints)",
                       "note":"applies the standard two-cutpoint scheme"}

elif recipe == "apri":
    # Wai CT et al. Hepatology 2003;38:518-526. AST_ULN = 40 U/L (consensus).
    ast = raw["LBXSASSI"].astype(float)
    plt = raw["LBXPLTSI"].astype(float)
    AST_ULN = 40.0
    with np.errstate(invalid="ignore", divide="ignore"):
        value = (ast / AST_ULN) * 100.0 / plt
    value = np.where((ast <= 0) | (plt <= 0), np.nan, value)
    recipe_meta = {"formula":"(AST / 40_U/L) * 100 / platelets[10^9/L]",
                   "units":"APRI (unitless)",
                   "reference":"Wai CT et al. Hepatology 2003;38:518-526",
                   "note":"cutpoints: <0.5 rules out significant fibrosis; >1.5 suggests cirrhosis. Originally validated in chronic HCV; performs reasonably in NAFLD."}

elif recipe == "tyg_bmi":
    tg = raw["LBXSTR"].astype(float)
    glu = raw["LBXGLU"].astype(float)
    bmi = raw["BMXBMI"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        tyg = np.log(tg * glu / 2.0)
        value = tyg * bmi
    value = np.where((tg <= 0) | (glu <= 0) | (bmi <= 0), np.nan, value)
    recipe_meta = {"formula":"ln(TG_mgdL * glucose_mgdL / 2) * BMI",
                   "units":"TyG-BMI (unitless)",
                   "reference":"Er LK et al. PLoS One 2016;11:e0149731 (TyG-BMI as IR surrogate)",
                   "note":"better predictor of insulin resistance than TyG alone; requires fasting subsample"}

elif recipe == "tyg_wc":
    tg = raw["LBXSTR"].astype(float)
    glu = raw["LBXGLU"].astype(float)
    wc = raw["BMXWAIST"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        tyg = np.log(tg * glu / 2.0)
        value = tyg * wc
    value = np.where((tg <= 0) | (glu <= 0) | (wc <= 0), np.nan, value)
    recipe_meta = {"formula":"ln(TG_mgdL * glucose_mgdL / 2) * waist_cm",
                   "units":"TyG-WC (unitless)",
                   "reference":"Er LK et al. PLoS One 2016;11:e0149731 (TyG-WC variant)",
                   "note":"central-adiposity-augmented insulin-resistance surrogate; requires fasting subsample"}

elif recipe == "whtr":
    wc = raw["BMXWAIST"].astype(float)
    ht = raw["BMXHT"].astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        value = wc / ht
    value = np.where((wc <= 0) | (ht <= 0), np.nan, value)
    recipe_meta = {"formula":"waist_cm / height_cm",
                   "units":"WHtR (ratio)",
                   "reference":"Ashwell M, Hsieh SD. Int J Food Sci Nutr 2005",
                   "note":"central adiposity marker; >0.5 ('keep your waist to less than half your height') is the canonical cutpoint for elevated cardiometabolic risk"}

elif recipe == "eag":
    # Nathan DM et al. Diabetes Care 2008;31:1473-1478 (A1C-Derived Average Glucose study)
    hba1c = raw["LBXGH"].astype(float)
    value = 28.7 * hba1c - 46.7
    value = np.where(hba1c <= 0, np.nan, value)
    recipe_meta = {"formula":"28.7 * HbA1c% - 46.7",
                   "units":"mg/dL (estimated average glucose)",
                   "reference":"Nathan DM et al. Diabetes Care 2008;31:1473-1478 (ADAG)",
                   "note":"linear translation of HbA1c to mean plasma glucose over ~3 months; ADA suggests reporting both. Validated over HbA1c 4-12%."}

elif recipe in ("whr", "whr_class"):
    wc = raw["BMXWAIST"].astype(float)
    hip = raw["BMXHIP"].astype(float)
    sex_female = (raw["RIAGENDR"] == 2)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = wc / hip
    ratio = np.where((wc <= 0) | (hip <= 0), np.nan, ratio)
    if recipe == "whr":
        value = ratio
        recipe_meta = {"formula":"waist_cm / hip_cm",
                       "units":"WHR (ratio)",
                       "reference":"WHO. Waist Circumference and Waist-Hip Ratio (Report of a WHO Expert Consultation), 2008",
                       "availability":"NHANES cycle J only (2017-2018) — hip circumference (BMXHIP) was not collected in earlier cycles",
                       "note":"sex-specific risk thresholds: M ≥0.90, F ≥0.85 (WHO abdominal-obesity cutpoints)"}
    else:
        ptype = "ordinal"
        # 0 = low risk; 1 = elevated (WHO abdominal obesity)
        elev = np.where(sex_female, ratio >= 0.85, ratio >= 0.90)
        value = np.where(np.isnan(ratio), np.nan, elev.astype(float))
        recipe_meta = {"levels":{"0":"low (M<0.90 / F<0.85)", "1":"elevated abdominal-obesity risk"},
                       "reference":"WHO 2008 cutpoints",
                       "availability":"NHANES cycle J only",
                       "note":"binary by convention; use whr (continuous) for finer-grained analyses"}

elif recipe == "frax_simplified":
    # Transparent FRAX-style 10-year major osteoporotic fracture (MOF) risk.
    # The Sheffield FRAX algorithm is proprietary; this is a Cox-PH approximation
    # built from openly-published meta-analytic HR estimates and calibrated so
    # baseline US-cohort outputs match published FRAX-without-BMD reference
    # ranges. NHANES carries age, sex, BMI, smoking, diabetes consistently —
    # the remaining FRAX clinical predictors (prior fracture, parental hip
    # fracture, glucocorticoids, RA, alcohol ≥3 units/day) are not available
    # outside cycle J and are treated as absent (downward-biased estimates).
    age = raw["RIDAGEYR"].astype(float)
    bmi = raw["BMXBMI"].astype(float)
    sex_female = (raw["RIAGENDR"] == 2)
    if "SMQ040" in raw.columns:
        smq40 = pd.to_numeric(raw["SMQ040"], errors="coerce")
        smoker = (smq40 == 1) | (smq40 == 2)
        smoker_source = "SMQ040 (current)"
    else:
        smoker = (raw["SMQ020"] == 1)
        smoker_source = "SMQ020 (ever; FRAX prefers current — overestimate)"
    diabetes = (raw["DIQ010"] == 1)

    # log-HR coefficients (meta-analytic; see recipe_meta.references)
    HR_AGE_PER_DECADE = 2.0          # Kanis 2007
    HR_FEMALE = 1.7                  # Kanis 2007 (vs men, age-adjusted)
    HR_BMI_PER_5_BELOW_25 = 1.3      # Holroyd 2007
    HR_SMOKER = 1.3                  # Vestergaard 2006 meta-analysis
    HR_DIABETES = 1.4                # Schwartz 2011 (T2DM)

    lp = (
        np.log(HR_AGE_PER_DECADE) * (age - 65) / 10.0
        + np.log(HR_FEMALE) * sex_female.astype(float)
        + np.log(HR_BMI_PER_5_BELOW_25) * np.maximum(0, (25.0 - bmi) / 5.0)
        + np.log(HR_SMOKER) * smoker.astype(float)
        + np.log(HR_DIABETES) * diabetes.astype(float)
    )
    # Baseline 10-yr survival calibrated so a 65yo man (BMI 25, non-smoker,
    # non-diabetic) yields ~6% MOF — matches published FRAX-without-BMD ranges
    # for low-risk US-cohort men age 65.
    S0_10 = 0.94
    with np.errstate(over="ignore"):
        value = 1 - S0_10 ** np.exp(lp)
    # Valid age range per FRAX guidelines: 40–90.
    value = np.where((age < 40) | (age > 90) | bmi.isna(), np.nan, value)
    recipe_meta = {
        "units": "10-year major-osteoporotic-fracture probability",
        "formula": "Cox-PH: risk = 1 - S0(10)^exp(βx) with S0(10)=0.94 and meta-analytic log-HRs (decade-of-age log(2.0), female log(1.7), low-BMI log(1.3) per 5 units below 25, smoker log(1.3), diabetes log(1.4))",
        "smoker_source": smoker_source,
        "frax_relation": "This is NOT the proprietary Sheffield FRAX algorithm. It is a transparent FRAX-style approximation using openly-published meta-analytic HR estimates, intended to match FRAX-without-BMD-reference outputs for screening purposes. For clinical decisions, use the official Sheffield FRAX calculator with full predictors. NHANES lacks several FRAX clinical predictors (prior fracture, parental hip fracture, glucocorticoid use, RA, alcohol ≥3 units/day) outside cycle J — they are treated as absent here, so estimates are conservative (downward-biased).",
        "references": [
            "Kanis JA et al. Osteoporos Int 2008;19:385-397 (FRAX framework)",
            "Kanis JA et al. Bone 2007;42:467-475 (age/sex HRs)",
            "Holroyd C et al. Osteoporos Int 2008 (BMI HR)",
            "Vestergaard P et al. Osteoporos Int 2006 (smoking HR)",
            "Schwartz AV et al. JAMA 2011;305:2184 (diabetes HR)",
        ],
        "note": "Valid for ages 40–90. Use ost_index for an even simpler validated screening tool when only age + weight are available.",
    }

elif recipe == "bilirubin_class":
    ptype = "ordinal"
    tb = raw["LBXSTB"].astype(float)
    cls = np.where(tb < 1.2, 0,
          np.where(tb < 2.0, 1,
          np.where(tb < 5.0, 2, 3))).astype(float)
    value = np.where(tb.isna() | (tb < 0), np.nan, cls)
    recipe_meta = {"levels":{"0":"normal (<1.2 mg/dL)",
                              "1":"mild elevation (1.2–2.0)",
                              "2":"moderate (2.0–5.0)",
                              "3":"marked (≥5.0)"},
                   "units":"mg/dL (input LBXSTB)",
                   "reference":"American Liver Foundation; standard clinical reference ranges",
                   "note":"4-level ordinal class. Cutpoints follow common clinical practice; jaundice typically visible at ~2.5 mg/dL."}

elif recipe in ("meld_classic", "meld_xi"):
    # Apply UNOS scoring rules: every lab floored at 1.0 (so ln=0 contributes
    # zero), creatinine capped at 4.0 mg/dL. The classic MELD final score is
    # capped to [6, 40] and rounded to int per UNOS allocation rules. MELD-XI
    # is reported on its native continuous scale.
    bili = raw["LBXSTB"].astype(float)
    scr = raw["LBXSCR"].astype(float)
    bili_f = np.maximum(bili, 1.0)
    scr_f = np.minimum(np.maximum(scr, 1.0), 4.0)
    if recipe == "meld_classic":
        # Kamath 2001: 3.78·ln(bilirubin) + 11.2·ln(INR) + 9.57·ln(creatinine) + 6.43
        # INR = 1.0 (community-sample stand-in → ln(INR)=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            score = 3.78 * np.log(bili_f) + 9.57 * np.log(scr_f) + 6.43
        # UNOS bounds + rounding
        score = np.clip(np.round(score), 6, 40)
        value = np.where(bili.isna() | scr.isna() | (bili < 0) | (scr < 0), np.nan, score)
        recipe_meta = {
            "formula":"3.78·ln(bilirubin) + 11.2·ln(INR) + 9.57·ln(creatinine) + 6.43 with INR set to 1.0",
            "units":"MELD score (clinically rounded integer 6–40)",
            "reference":"Kamath PS et al. Hepatology 2001;33:464-470; Wiesner R et al. Gastroenterology 2003;124:91-96 (UNOS adoption)",
            "inr_handling":"NHANES does not measure INR; we substitute INR = 1.0 (population norm for community-dwelling adults). True cirrhotic MELD will be underestimated.",
            "lab_rules":"each input floored at 1.0 (per UNOS), creatinine capped at 4.0 mg/dL. Final score clipped to [6, 40] and rounded.",
            "note":"Designed for clinical cirrhosis prognostication. In NHANES it serves as a continuous liver-dysfunction surrogate; not a transplant-allocation tool here."
        }
    else:
        # MELD-XI = 5.11·ln(bilirubin) + 11.76·ln(creatinine) + 9.44 (Heuman 2008)
        with np.errstate(invalid="ignore", divide="ignore"):
            score = 5.11 * np.log(bili_f) + 11.76 * np.log(scr_f) + 9.44
        value = np.where(bili.isna() | scr.isna() | (bili < 0) | (scr < 0), np.nan, score)
        recipe_meta = {
            "formula":"5.11·ln(bilirubin_mgdL) + 11.76·ln(creatinine_mgdL) + 9.44",
            "units":"MELD-XI score (continuous)",
            "reference":"Heuman DM et al. Hepatology 2008;48:1809 (anticoag/INR-free variant); Heuman et al. validated MELD-XI for cardiac/transplant prognostication",
            "lab_rules":"each input floored at 1.0, creatinine capped at 4.0 mg/dL (same UNOS conventions as MELD)",
            "note":"Designed for patients on anticoagulation (where INR is uninterpretable). Doubles as the natural NHANES-compatible MELD variant because no INR is required."
        }

elif recipe in ("phq9_score", "phq9_class", "depression_screen_positive"):
    # Patient Health Questionnaire-9 (Kroenke, Spitzer, Williams 2001). Each
    # item scored 0-3 (not at all .. nearly every day); 7/9 = refused / don't
    # know → treated as missing. Total score = sum of 9 items (0-27).
    items = ["DPQ010","DPQ020","DPQ030","DPQ040","DPQ050","DPQ060","DPQ070","DPQ080","DPQ090"]
    item_data = {it: pd.to_numeric(raw[it], errors="coerce") for it in items}
    # Mask out refused (7) and don't know (9) responses
    for it in items:
        item_data[it] = item_data[it].where(item_data[it].isin([0, 1, 2, 3]))
    item_df = pd.DataFrame(item_data)
    any_missing = item_df.isna().any(axis=1)
    total = item_df.sum(axis=1)
    if recipe == "phq9_score":
        value = np.where(any_missing, np.nan, total.values)
        recipe_meta = {"formula":"sum of DPQ010..DPQ090, each 0-3",
                       "units":"PHQ-9 score (0-27)",
                       "reference":"Kroenke K, Spitzer RL, Williams JB. J Gen Intern Med 2001;16:606-613",
                       "cutpoints":"0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe",
                       "note":"requires all 9 items non-missing (DPQ100, the functional-impairment item, is NOT part of the 27-point score)"}
    elif recipe == "phq9_class":
        ptype = "ordinal"
        cls = np.where(total < 5, 0,
              np.where(total < 10, 1,
              np.where(total < 15, 2,
              np.where(total < 20, 3, 4)))).astype(float)
        value = np.where(any_missing, np.nan, cls)
        recipe_meta = {"levels":{"0":"minimal/none (0-4)","1":"mild (5-9)","2":"moderate (10-14)","3":"moderately severe (15-19)","4":"severe (20-27)"},
                       "reference":"Kroenke 2001 PHQ-9 severity bands",
                       "note":"5 levels; class ≥2 (≥10) is the conventional clinical-significance threshold"}
    else:  # depression_screen_positive
        ptype = "binary"
        positive = (total >= 10).astype(float)
        value = np.where(any_missing, np.nan, positive)
        recipe_meta = {"formula":"1 if PHQ-9 score ≥ 10",
                       "reference":"Kroenke 2001 (PHQ-9 ≥10 = clinically significant depression, sensitivity 88% / specificity 88% for major depression)",
                       "note":"NHANES weighted prevalence of PHQ-9 ≥10 in US adults ~8% (cycles 2007-2018)"}

elif recipe in ("frailty_index", "frailty_class"):
    # Rockwood-style cumulative deficit frailty index — 12-deficit NHANES-
    # portable subset adapted from Blodgett 2015 (NHANES) and Searle 2008
    # (general FI scoring rules). All deficits coded 0/1; FI = sum / 12.
    # Each input variable is coded NHANES-style (1=yes, 2=no, 7/9=missing).
    # Self-rated health uses HUQ010 ∈ {4,5} ("fair","poor").
    def yes_no(name):
        v = pd.to_numeric(raw[name], errors="coerce")
        return v.where(v.isin([1, 2]))  # mask refused/DK to NaN
    deficits = {}
    binary_items = ["MCQ010","MCQ160A","MCQ160B","MCQ160C","MCQ160E","MCQ160F","MCQ160L","MCQ220","DIQ010","BPQ020","BPQ080"]
    for it in binary_items:
        v = yes_no(it)
        deficits[it] = (v == 1).astype(float).where(~v.isna())
    huq = pd.to_numeric(raw["HUQ010"], errors="coerce")
    huq = huq.where(huq.isin([1, 2, 3, 4, 5]))  # 1=excellent..5=poor
    deficits["HUQ010_fair_poor"] = (huq >= 4).astype(float).where(~huq.isna())
    deficit_df = pd.DataFrame(deficits)
    K = deficit_df.shape[1]
    any_missing = deficit_df.isna().any(axis=1)
    n_deficits = deficit_df.sum(axis=1)
    fi = n_deficits / K
    if recipe == "frailty_index":
        value = np.where(any_missing, np.nan, fi.values)
        recipe_meta = {"formula":"sum(deficits present) / 12",
                       "units":"frailty index (0–1)",
                       "deficits":["asthma (MCQ010)","arthritis (MCQ160A)","CHF (MCQ160B)","CHD (MCQ160C)","heart attack (MCQ160E)","stroke (MCQ160F)","liver problem (MCQ160L)","cancer ever (MCQ220)","diabetes (DIQ010)","high BP (BPQ020)","high cholesterol (BPQ080)","fair/poor self-rated health (HUQ010 ≥ 4)"],
                       "reference":"Rockwood K, Mitnitski A. J Gerontol A Biol Sci Med Sci 2007;62:722-727; Searle SD et al. BMC Geriatr 2008;8:24 (FI standardized procedure); Blodgett J et al. JAMDA 2015 (NHANES adaptation)",
                       "cutpoints":"<0.10 robust; 0.10–0.21 pre-frail; 0.22–0.34 mild frailty; ≥0.35 severe",
                       "note":"12-deficit portable subset for NHANES cross-cycle work. Participants with any missing deficit input are dropped. For more granular FIs (30+ deficits) restricted to specific cycles see Blodgett 2015."}
    else:
        ptype = "ordinal"
        cls = np.where(fi < 0.10, 0,
              np.where(fi < 0.22, 1,
              np.where(fi < 0.35, 2, 3))).astype(float)
        value = np.where(any_missing, np.nan, cls)
        recipe_meta = {"levels":{"0":"robust (<0.10)","1":"pre-frail (0.10–0.21)","2":"mild frailty (0.22–0.34)","3":"severe frailty (≥0.35)"},
                       "reference":"Rockwood 2007; Searle 2008 cutpoints",
                       "note":"NHANES adults 65+ typically: ~30% robust, ~50% pre-frail, ~15% mild, ~5% severe"}

elif recipe in ("ost_index", "ost_class"):
    # Koh LK et al. Osteoporos Int 2001;12:699-705 (Osteoporosis Self-Assessment Tool).
    # OST = 0.2 × (weight_kg − age_years).
    # Standard FRAX substitute when BMD + the full FRAX predictor set are
    # unavailable (NHANES has neither for most cycles). Sex-specific cutpoints
    # from Adler RA et al. Osteoporos Int 2003;14:758-764 for men.
    age = raw["RIDAGEYR"].astype(float)
    wt = raw["BMXWT"].astype(float)
    sex_female = (raw["RIAGENDR"] == 2)
    ost = 0.2 * (wt - age)
    ost = np.where((wt <= 0) | (age <= 0), np.nan, ost)
    if recipe == "ost_index":
        value = ost
        recipe_meta = {"formula":"0.2 * (weight_kg - age_years)",
                       "units":"OST (unitless)",
                       "reference":"Koh LK et al. Osteoporos Int 2001;12:699-705 (women); Adler RA 2003 (men cutpoints)",
                       "frax_relation":"OST is the validated simple screening tool used as a FRAX substitute when BMD and full FRAX clinical predictors (prior fracture, parental hip fracture, glucocorticoids, RA, alcohol) are unavailable. NHANES collected BMD (DXXOFBMD) for 2005-2017 but lacks most FRAX clinical predictors except in cycle J.",
                       "note":"lower values indicate higher fracture risk. Best validated in postmenopausal women; performs adequately in older adults of both sexes with sex-specific cutpoints."}
    else:
        ptype = "ordinal"
        # Sex-specific 3-level cutpoints
        # Women (Koh 2001): low risk OST > 1, moderate -1..1, high < -1
        # Men   (Adler 2003): low risk OST > 3, moderate -1..3,  high < -1
        # 0 = low, 1 = moderate, 2 = high risk
        cls_f = np.where(ost < -1, 2, np.where(ost <= 1, 1, 0)).astype(float)
        cls_m = np.where(ost < -1, 2, np.where(ost <= 3, 1, 0)).astype(float)
        cls = np.where(sex_female, cls_f, cls_m)
        value = np.where(np.isnan(ost), np.nan, cls)
        recipe_meta = {"levels":{"0":"low risk", "1":"moderate risk", "2":"high risk"},
                       "cutpoints":{"women":"high<-1, moderate -1..1, low>1 (Koh 2001)",
                                     "men":"high<-1, moderate -1..3, low>3 (Adler 2003)"},
                       "reference":"Koh LK 2001; Adler RA 2003",
                       "frax_relation":"validated FRAX-substitute screening tool when BMD and full FRAX predictors aren't available"}

elif recipe == "expression":
    SAFE_NAMES = {
        "np": np, "where": np.where, "log": np.log, "log10": np.log10,
        "log2": np.log2, "exp": np.exp, "sqrt": np.sqrt, "abs": np.abs,
        "minimum": np.minimum, "maximum": np.maximum, "min": np.minimum,
        "max": np.maximum, "power": np.power, "pi": np.pi, "isnan": np.isnan,
        "True": True, "False": False, "and_": np.logical_and,
        "or_": np.logical_or, "not_": np.logical_not,
    }
    locs = {v: raw[v].astype(float) if v in raw.columns else None for v in src_vars}
    missing = [v for v, x in locs.items() if x is None]
    if missing:
        err(f"source_variables not loaded: {missing}", source_variables=src_vars)
    # alias common demographics
    locs["age"] = raw["RIDAGEYR"].astype(float)
    locs["sex"] = raw["RIAGENDR"].astype(float)
    locs["sex_female"] = (raw["RIAGENDR"] == 2).astype(float)
    formula = params["formula"]
    try:
        tree = ast.parse(formula, mode="eval")
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                err("attribute access not allowed in expression")
            if isinstance(node, ast.Call):
                fn = node.func
                fn_name = fn.id if isinstance(fn, ast.Name) else None
                if fn_name is None or fn_name not in SAFE_NAMES:
                    err(f"disallowed function call in expression: {ast.dump(fn)}")
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                err("imports not allowed")
            if isinstance(node, ast.Name) and node.id not in SAFE_NAMES and node.id not in locs:
                err(f"unknown name in expression: '{node.id}'",
                    allowed_variables=list(locs), allowed_functions=list(SAFE_NAMES))
        value = eval(compile(tree, "<formula>", "eval"), {"__builtins__": {}}, {**SAFE_NAMES, **locs})
        value = np.asarray(value, dtype=float)
    except SystemExit:
        raise
    except Exception as e:
        err(f"formula evaluation failed: {e}", formula=formula)
    recipe_meta = {"formula": formula, "source_variables": src_vars}
    # Classify
    vc = pd.Series(value).dropna()
    if len(vc):
        u = np.unique(vc.values.astype(float))
        if set(u).issubset({0.0, 1.0}):
            ptype = "binary"
        elif len(u) <= 10 and np.all(np.equal(np.mod(u, 1), 0)):
            ptype = "ordinal"

elif recipe == "binarize":
    spec = params["binarize"]
    var = spec["variable"]
    method = spec.get("method", "threshold")
    direction = spec.get("direction", "above")
    x = raw[var].astype(float)
    if method == "threshold":
        if spec.get("threshold") is None:
            err("binarize.method='threshold' requires binarize.threshold")
        thr = float(spec["threshold"])
        value = np.where(x.isna(), np.nan, (x >= thr).astype(float) if direction == "above" else (x <= thr).astype(float))
        recipe_meta["threshold"] = thr
    elif method == "percentile":
        if spec.get("percentile") is None:
            err("binarize.method='percentile' requires binarize.percentile (0-100)")
        pct = float(spec["percentile"])
        thr = float(np.nanpercentile(x, pct))
        value = np.where(x.isna(), np.nan, (x >= thr).astype(float) if direction == "above" else (x <= thr).astype(float))
        recipe_meta["percentile"] = pct
        recipe_meta["derived_threshold"] = safe_float(thr)
    else:
        err(f"unknown binarize method: {method}")
    ptype = "binary"
    recipe_meta["direction"] = direction
    recipe_meta["source_variable"] = var

else:
    err(f"unhandled recipe '{recipe}'")

# Materialize handle CSV — include the full EP-WAS model-6 covariate set so
# downstream regressions can adjust for race/ethnicity, income, and education
# without re-querying NHANES.
keep_cols = ["SEQN","cycle","RIDAGEYR","RIAGENDR","RIDRETH3","INDFMPIR",
             "DMDEDUC2","WTMEC2YR","WTINT2YR","SDMVPSU","SDMVSTRA"]
keep_cols = [c for c in keep_cols if c in raw.columns]
out = raw[keep_cols].copy()
out["value"] = pd.Series(value, index=out.index)
n_total_before = len(out)
out = out[~out["value"].isna() & ~np.isinf(out["value"])]

# Pooled weight (NCHS multi-cycle guidance: divide by # cycles contributing)
cycles_used = sorted(out["cycle"].unique().tolist())
n_cycles_used = max(1, len(cycles_used))
out["wt_pooled"] = out["WTMEC2YR"] / n_cycles_used

out.to_csv(out_csv, index=False)

# Summary
def weighted_stats(x, w):
    m = (~np.isnan(x)) & (~np.isnan(w)) & (w > 0)
    if not m.any():
        return None, None
    mu = float(np.average(x[m], weights=w[m]))
    if m.sum() < 2:
        return mu, None
    var = float(np.average((x[m]-mu)**2, weights=w[m]))
    return mu, math.sqrt(var)

vals = out["value"].to_numpy()
wts = out["wt_pooled"].to_numpy()

summary = {
    "n": int(len(out)),
    "n_with_demo": int(n_total_before),
    "missing_rate_vs_demo": safe_float(1 - len(out) / max(1, n_total_before)),
    "type": ptype,
    "cycles_used": cycles_used,
}
if ptype == "continuous":
    wmean, wsd = weighted_stats(vals, wts)
    summary["weighted_mean"] = safe_float(wmean)
    summary["weighted_sd"] = safe_float(wsd)
    pcts = np.nanpercentile(vals, [5,25,50,75,95])
    summary["p5"] = safe_float(pcts[0]); summary["p25"] = safe_float(pcts[1])
    summary["median"] = safe_float(pcts[2]); summary["p75"] = safe_float(pcts[3])
    summary["p95"] = safe_float(pcts[4])
elif ptype == "binary":
    summary["prevalence_unweighted"] = safe_float(np.nanmean(vals))
    pw, _ = weighted_stats(vals, wts)
    summary["prevalence_weighted"] = safe_float(pw)
    summary["n_cases"] = int(np.nansum(vals))
elif ptype == "ordinal":
    s = pd.Series(vals).dropna().astype(int)
    counts = s.value_counts().sort_index()
    summary["level_counts"] = {str(k): int(v) for k,v in counts.items()}
    summary["level_weighted_pct"] = {}
    for lvl in counts.index:
        pw, _ = weighted_stats((vals == lvl).astype(float), wts)
        summary["level_weighted_pct"][str(int(lvl))] = safe_float((pw or 0) * 100)

preview = out.head(5)[["SEQN","cycle","value","RIDAGEYR","RIAGENDR"]].to_dict(orient="records")

result = {
    "ok": True,
    "name": name,
    "recipe": recipe,
    "source_variables": src_vars,
    "type": ptype,
    "n": int(len(out)),
    "cycles_used": cycles_used,
    "summary": summary,
    "preview": preview,
    "recipe_meta": recipe_meta,
    "csv_path": out_csv,
    "skipped_cycles": skipped_cycles or None,
    "data_source": "nhanes",
    "has_survey_design": True,
    "id_column": "SEQN",
    "weight_column": "wt_pooled",
    "psu_column": "SDMVPSU",
    "strata_column": "SDMVSTRA",
}
print(json.dumps(result))
