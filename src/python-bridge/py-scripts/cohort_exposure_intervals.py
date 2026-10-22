#!/usr/bin/env python3
"""Conditional quantile regression for exposure intervals (HHEAR cohorts)."""

import sys, json, math
import pandas as pd
import numpy as np
import statsmodels.formula.api as smf

params = json.load(sys.stdin)
targeted_csv = params["targeted_csv"]
epi_csv = params.get("epi_csv")
analyte = params["analyte"]
population = params.get("population")  # "child" or "adult"
quantiles = params.get("quantiles") or [0.05, 0.25, 0.50, 0.75, 0.95]
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
        print(json.dumps({"error": "This cohort has no demographic (epi) data — cannot run quantile regression model."}))
        sys.exit(1)

    targeted = pd.read_csv(targeted_csv)
    epi = pd.read_csv(epi_csv)
    targeted.columns = targeted.columns.str.lower()
    epi.columns = epi.columns.str.lower()

    # Filter to analyte
    chem = targeted[targeted["analyte_code"].str.lower() == analyte.lower()].copy()
    if len(chem) == 0:
        print(json.dumps({"error": f"Analyte '{analyte}' not found."}))
        sys.exit(1)

    chem["concentration"] = pd.to_numeric(chem["concentration"], errors="coerce")

    # LOD handling
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
        pid_col = next((c for c in chem.columns if "pid" in c.lower()), "pid")
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
    tgt_pid = next((c for c in chem.columns if "pid" in c.lower()), "pid")
    epi_pid = next((c for c in epi.columns if "pid" in c.lower()), "pid")
    chem["_pj"] = chem[tgt_pid].astype(str).str.lower()
    epi["_pj"] = epi[epi_pid].astype(str).str.lower()
    merged = chem.merge(epi, on="_pj", how="inner", suffixes=("", "_epi"))

    merged["conc"] = pd.to_numeric(merged["concentration"], errors="coerce")

    # Resolve age
    if age_transform:
        merged["age_val"] = merged.eval(age_transform)
    elif age_column and age_column in merged.columns:
        merged["age_val"] = pd.to_numeric(merged[age_column], errors="coerce")
    else:
        # Search for common age column names
        age_candidates = [c for c in merged.columns if "age" in c.lower()]
        if age_candidates:
            merged["age_val"] = pd.to_numeric(merged[age_candidates[0]], errors="coerce")
        else:
            print(json.dumps({"error": "No age column found in epi data. Available columns: " + ", ".join(merged.columns[:20].tolist())}))
            sys.exit(1)

    # Resolve sex
    has_sex = False
    if sex_column and sex_column in merged.columns:
        merged["sex_val"] = merged[sex_column].astype("category")
        has_sex = True
    else:
        for sc in ["sex", "gender", "gender_form03"]:
            if sc in merged.columns:
                merged["sex_val"] = merged[sc].astype("category")
                has_sex = True
                break

    if has_sex and merged["sex_val"].nunique() < 2:
        has_sex = False

    model_vars = ["conc", "age_val"]
    if has_sex:
        model_vars.append("sex_val")
    merged = merged.dropna(subset=model_vars)

    if len(merged) < 10:
        print(json.dumps({"error": f"Insufficient data after merge (n={len(merged)})."}))
        sys.exit(1)

    # Formula
    formula = "conc ~ age_val + sex_val" if has_sex and (population != "adult") else "conc ~ age_val"

    # Quantile regression at each tau
    results = []
    for tau in quantiles:
        mod = smf.quantreg(formula, data=merged)
        fit = mod.fit(q=tau)

        coefs = []
        for term in fit.params.index:
            coefs.append({
                "term": term,
                "estimate": safe_float(fit.params[term]),
                "std_error": safe_float(fit.bse[term]),
                "p_value": safe_float(fit.pvalues[term]),
            })

        # Predicted quantile at median age
        nd = pd.DataFrame({"age_val": [merged["age_val"].median()]})
        if has_sex:
            nd["sex_val"] = merged["sex_val"].cat.categories[0]
        pred = fit.predict(nd)

        results.append({
            "tau": tau,
            "coefficients": coefs,
            "predicted_quantile": safe_float(pred.iloc[0]),
        })

    # Raw percentiles
    raw = np.percentile(merged["conc"].dropna(), [q * 100 for q in quantiles])
    raw_pctiles = {f"p{int(q * 100)}": safe_float(v) for q, v in zip(quantiles, raw)}

    units = chem["units"].dropna().unique()

    output = {
        "analyte": analyte,
        "n": int(len(merged)),
        "model": formula,
        "quantile_results": results,
        "raw_percentiles": raw_pctiles,
        "units": str(units[0]) if len(units) > 0 else None,
        "age_range": {"min": safe_float(merged["age_val"].min()), "max": safe_float(merged["age_val"].max())},
        "method": "Conditional quantile regression via statsmodels.quantreg()",
    }
    print(json.dumps(output))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
