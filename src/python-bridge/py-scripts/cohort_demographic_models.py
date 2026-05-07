#!/usr/bin/env python3
"""Within-cohort demographic model: exposure ~ age + sex + year via quantile regression."""

import sys, json, math
import pandas as pd
import numpy as np
import statsmodels.formula.api as smf

params = json.load(sys.stdin)
targeted_csv = params["targeted_csv"]
epi_csv = params.get("epi_csv")
analyte = params["analyte"]
quantiles = params.get("quantiles", [0.05, 0.25, 0.50, 0.75, 0.95])
creatinine_adjust = params.get("creatinine_adjust", False)
age_column = params.get("age_column")
sex_column = params.get("sex_column")
age_transform = params.get("age_transform")

def safe_float(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 6)

try:
    if not epi_csv:
        print(json.dumps({"error": "This cohort has no demographic (epi) data — cannot run demographic model."}))
        sys.exit(1)

    targeted = pd.read_csv(targeted_csv)
    epi = pd.read_csv(epi_csv)
    targeted.columns = targeted.columns.str.lower()
    epi.columns = epi.columns.str.lower()

    pid_col = next((c for c in ["pid", "child_pid", "subject_id"] if c in targeted.columns),
                   next((c for c in targeted.columns if "pid" in c.lower()), "pid"))

    chem = targeted[targeted["analyte_code"].str.lower() == analyte.lower()].copy()
    if len(chem) == 0:
        print(json.dumps({"error": f"Analyte '{analyte}' not found."}))
        sys.exit(1)

    chem["concentration"] = pd.to_numeric(chem["concentration"], errors="coerce")

    # LOD imputation
    if "comment_code" in chem.columns and "lod" in chem.columns:
        below_lod = chem["comment_code"].isin([37, 199])
        pct_below = below_lod.sum() / len(chem) * 100 if len(chem) > 0 else 0
        if pct_below <= 25:
            lod_vals = pd.to_numeric(chem["lod"], errors="coerce")
            lod_val = lod_vals[lod_vals > 0].median()
            if pd.notna(lod_val) and lod_val > 0:
                chem.loc[below_lod, "concentration"] = lod_val / 2

    # Creatinine adjustment
    if creatinine_adjust:
        cre_dat = targeted[targeted["analyte_code"].str.lower() == "cre"].copy()
        if len(cre_dat) > 0:
            cre_pid = next((c for c in cre_dat.columns if "pid" in c.lower()), pid_col)
            cre_dat["_pj"] = cre_dat[cre_pid].astype(str).str.lower()
            chem["_pj"] = chem[pid_col].astype(str).str.lower()
            cre_dat["cre_conc"] = pd.to_numeric(cre_dat["concentration"], errors="coerce")
            chem = chem.merge(cre_dat[["_pj", "cre_conc"]], on="_pj", how="left")
            valid = chem["cre_conc"].notna() & (chem["cre_conc"] > 0)
            chem = chem[valid].copy()
            chem["concentration"] = chem["concentration"] / chem["cre_conc"] * 100

    # Merge with epi
    epi_pid = next((c for c in ["pid", "child_pid", "subject_id"] if c in epi.columns),
                   next((c for c in epi.columns if "pid" in c.lower()), "pid"))
    chem["_pj"] = chem[pid_col].astype(str).str.lower()
    epi["_pj"] = epi[epi_pid].astype(str).str.lower()
    merged = chem.merge(epi, on="_pj", how="inner", suffixes=("", "_epi"))

    merged["conc"] = pd.to_numeric(merged["concentration"], errors="coerce")

    # Resolve age
    if age_transform:
        merged["age_val"] = merged.eval(age_transform)
    elif age_column and age_column in merged.columns:
        merged["age_val"] = pd.to_numeric(merged[age_column], errors="coerce")
    elif "age" in merged.columns:
        merged["age_val"] = pd.to_numeric(merged["age"], errors="coerce")
    else:
        merged["age_val"] = np.nan

    # Resolve sex
    has_sex = False
    if sex_column and sex_column in merged.columns:
        merged["sex_val"] = merged[sex_column].astype("category")
        has_sex = merged["sex_val"].nunique() >= 2
    else:
        for sc in ["sex", "gender", "gender_form03"]:
            if sc in merged.columns:
                merged["sex_val"] = merged[sc].astype("category")
                has_sex = merged["sex_val"].nunique() >= 2
                break

    # Detect year
    has_year = False
    for yc in ["sample_collection_year"]:
        if yc in merged.columns:
            merged["year_val"] = pd.to_numeric(merged[yc], errors="coerce")
            has_year = True
            break

    # Build formula
    terms = "age_val"
    if has_sex:
        terms += " + C(sex_val)"
    if has_year:
        terms += " + year_val"
    formula = f"conc ~ {terms}"

    model_cols = ["conc", "age_val"]
    if has_sex:
        model_cols.append("sex_val")
    if has_year:
        model_cols.append("year_val")
    merged = merged.dropna(subset=model_cols)

    if len(merged) < 10:
        print(json.dumps({"error": f"Insufficient data (n={len(merged)})."}))
        sys.exit(1)

    # Quantile regression at each tau
    results = []
    for tau in quantiles:
        mod = smf.quantreg(formula, data=merged)
        fit = mod.fit(q=tau)

        # Null model for pseudo R²
        null_mod = smf.quantreg("conc ~ 1", data=merged)
        null_fit = null_mod.fit(q=tau)

        def rho(u, t):
            return np.sum(u * (t - (u < 0)))

        pseudo_r2 = 1 - rho(fit.resid, tau) / rho(null_fit.resid, tau)

        coefs = []
        for term in fit.params.index:
            coefs.append({
                "term": term,
                "estimate": safe_float(fit.params[term]),
                "std_error": safe_float(fit.bse[term]),
                "p_value": safe_float(fit.pvalues[term]),
            })

        results.append({
            "tau": tau,
            "pseudo_r_squared": safe_float(pseudo_r2),
            "coefficients": coefs,
        })

    output = {
        "analyte": analyte,
        "n": int(len(merged)),
        "model": formula,
        "quantile_results": results,
        "method": "Quantile regression via statsmodels.quantreg(); pseudo R² = McFadden's",
    }
    print(json.dumps(output))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
