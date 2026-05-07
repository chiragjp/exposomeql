#!/usr/bin/env python3
"""Quantile ExWAS for HHEAR cohort data — scan all analytes against age+sex+year."""

import sys, json, math
import pandas as pd
import numpy as np
import statsmodels.formula.api as smf
from statsmodels.stats.multitest import multipletests

params = json.load(sys.stdin)
targeted_csv = params["targeted_csv"]
epi_csv = params.get("epi_csv")
analytes = params.get("analytes")
tau_val = params.get("tau", 0.5)
fdr_threshold = params.get("fdr_threshold", 0.10)
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
        print(json.dumps({"error": "This cohort has no demographic (epi) data — cannot run ExWAS."}))
        sys.exit(1)

    targeted = pd.read_csv(targeted_csv)
    epi = pd.read_csv(epi_csv)
    targeted.columns = targeted.columns.str.lower()
    epi.columns = epi.columns.str.lower()

    pid_col = next((c for c in ["pid", "child_pid", "subject_id"] if c in targeted.columns),
                   next((c for c in targeted.columns if "pid" in c.lower()), "pid"))
    epi_pid = next((c for c in ["pid", "child_pid", "subject_id"] if c in epi.columns),
                   next((c for c in epi.columns if "pid" in c.lower()), "pid"))

    epi["_pj"] = epi[epi_pid].astype(str).str.lower()

    # Creatinine data
    cre_data = None
    if creatinine_adjust:
        cre_df = targeted[targeted["analyte_code"].str.lower() == "cre"].copy()
        if len(cre_df) > 0:
            cre_df["_pj"] = cre_df[pid_col].astype(str).str.lower()
            cre_df["cre_val"] = pd.to_numeric(cre_df["concentration"], errors="coerce")
            cre_data = cre_df[["_pj", "cre_val"]].dropna()

    # Resolve sex
    has_sex = False
    sex_col_name = None
    if sex_column and sex_column in epi.columns:
        sex_col_name = sex_column
        has_sex = True
    else:
        for sc in ["sex", "gender", "gender_form03"]:
            if sc in epi.columns:
                sex_col_name = sc
                has_sex = True
                break

    # Detect year
    has_year = "sample_collection_year" in targeted.columns

    # Auto-detect analytes
    if not analytes:
        analytes = [a for a in targeted["analyte_code"].unique()
                    if str(a).upper() not in ("CRE", "SG")]

    results = []
    errors = []

    for a in analytes:
        try:
            chem = targeted[targeted["analyte_code"].str.lower() == a.lower()].copy()
            if len(chem) < 20:
                continue

            chem["concentration"] = pd.to_numeric(chem["concentration"], errors="coerce")

            # LOD
            if "comment_code" in chem.columns and "lod" in chem.columns:
                below_lod = chem["comment_code"].isin([37, 199])
                pct_below = below_lod.sum() / len(chem) * 100 if len(chem) > 0 else 100
                if pct_below > 25:
                    continue
                lod_vals = pd.to_numeric(chem["lod"], errors="coerce")
                lod_val = lod_vals[lod_vals > 0].median()
                if pd.notna(lod_val) and lod_val > 0:
                    chem.loc[below_lod, "concentration"] = lod_val / 2

            chem["_pj"] = chem[pid_col].astype(str).str.lower()

            # Creatinine
            if cre_data is not None and len(cre_data) > 0:
                chem = chem.merge(cre_data, on="_pj", how="inner")
                chem["concentration"] = chem["concentration"] / chem["cre_val"] * 100

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
                continue

            # Build formula
            terms = "age_val"
            model_cols = ["conc", "age_val"]
            if has_sex and sex_col_name in merged.columns:
                merged["sex_val"] = merged[sex_col_name].astype("category")
                if merged["sex_val"].nunique() >= 2:
                    terms += " + C(sex_val)"
                    model_cols.append("sex_val")
            if has_year and "sample_collection_year" in merged.columns:
                merged["year_val"] = pd.to_numeric(merged["sample_collection_year"], errors="coerce")
                terms += " + year_val"
                model_cols.append("year_val")

            merged = merged.dropna(subset=model_cols)
            if len(merged) < 20:
                continue

            formula = f"conc ~ {terms}"
            mod = smf.quantreg(formula, data=merged)
            fit = mod.fit(q=tau_val)

            # Extract age coefficient
            if "age_val" in fit.params.index:
                results.append({
                    "analyte": a,
                    "term": "age_val",
                    "estimate": safe_float(fit.params["age_val"]),
                    "std_error": safe_float(fit.bse["age_val"]),
                    "p_value": safe_float(fit.pvalues["age_val"]),
                    "n": int(len(merged)),
                    "tau": tau_val,
                })
        except Exception as e:
            errors.append(f"{a}: {str(e)}")

    # Sort by p-value and apply FDR
    results.sort(key=lambda x: x["p_value"] if x["p_value"] is not None else 1)

    if results:
        pvals = [r["p_value"] for r in results if r["p_value"] is not None]
        n_tests = len(pvals)
        bonf = [min(p * n_tests, 1.0) for p in pvals]
        _, fdr_vals, _, _ = multipletests(pvals, method="fdr_bh")

        idx = 0
        for r in results:
            if r["p_value"] is not None:
                r["p_bonferroni"] = safe_float(bonf[idx])
                r["p_fdr_bh"] = safe_float(fdr_vals[idx])
                idx += 1

    n_fdr_sig = sum(1 for r in results if r.get("p_fdr_bh") is not None and r["p_fdr_bh"] < fdr_threshold)

    output = {
        "n_analytes_tested": len(analytes),
        "n_results": len(results),
        "n_errors": len(errors),
        "tau": tau_val,
        "fdr_threshold": fdr_threshold,
        "n_significant_fdr": n_fdr_sig,
        "results": results,
        "errors": errors if errors else None,
        "note": f"Quantile regression at tau={tau_val}. P-values corrected: p_bonferroni and p_fdr_bh (BH). FDR threshold = {int(fdr_threshold*100)}%.",
    }
    print(json.dumps(output))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
