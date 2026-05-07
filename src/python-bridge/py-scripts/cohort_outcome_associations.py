#!/usr/bin/env python3
"""Phenotype-wide association study for a single exposure in an HHEAR cohort.
Tests one exposure against ALL numeric outcomes in the epi data.
Model: outcome ~ ln(exposure) + covariates. Returns ranked with BH-FDR."""

import sys, json, math
import pandas as pd
import numpy as np
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests

params = json.load(sys.stdin)
targeted_csv = params["targeted_csv"]
epi_csv = params["epi_csv"]
analyte_code = params["analyte_code"]
creatinine_adjust = params.get("creatinine_adjust", False)
age_column = params.get("age_column")
sex_column = params.get("sex_column")
age_transform = params.get("age_transform")
covariates = params.get("covariates")
wide_format = params.get("wide_format", False)
pid_column = params.get("pid_column", "PID")

def safe_float(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 6)

try:
    targeted = pd.read_csv(targeted_csv)
    epi = pd.read_csv(epi_csv)

    # Handle wide vs long format
    if wide_format or "Analyte_Code" not in targeted.columns:
        # Wide format
        if analyte_code not in targeted.columns:
            # Try case-insensitive
            col_match = [c for c in targeted.columns if c.lower() == analyte_code.lower()]
            if not col_match:
                print(json.dumps({"error": f"Analyte '{analyte_code}' not found in columns: {', '.join(targeted.columns[:20])}"}))
                sys.exit(0)
            analyte_code = col_match[0]

        exposure_df = pd.DataFrame({
            "PID": targeted[pid_column],
            "exposure": pd.to_numeric(targeted[analyte_code], errors="coerce"),
        })
        if creatinine_adjust and "CRE" in targeted.columns:
            exposure_df["CRE"] = pd.to_numeric(targeted["CRE"], errors="coerce")
    else:
        # Long format
        sub = targeted[targeted["Analyte_Code"].str.lower() == analyte_code.lower()]
        if len(sub) == 0:
            # Try with lowercase columns
            targeted.columns = targeted.columns.str.lower()
            sub = targeted[targeted["analyte_code"].str.lower() == analyte_code.lower()]
        if len(sub) == 0:
            print(json.dumps({"error": f"Analyte '{analyte_code}' not found in targeted data"}))
            sys.exit(0)

        result_col = "Result" if "Result" in sub.columns else "concentration" if "concentration" in sub.columns else sub.columns[sub.columns.str.lower().isin(["result", "concentration"])][0]
        exposure_df = pd.DataFrame({
            "PID": sub[pid_column] if pid_column in sub.columns else sub[pid_column.lower()],
            "exposure": pd.to_numeric(sub[result_col], errors="coerce"),
        })
        if creatinine_adjust:
            cre_sub = targeted[targeted.get("Analyte_Code", targeted.get("analyte_code", pd.Series())).str.lower() == "cre"]
            if len(cre_sub) > 0:
                pid_c = pid_column if pid_column in cre_sub.columns else pid_column.lower()
                cre_df = pd.DataFrame({
                    "PID": cre_sub[pid_c],
                    "CRE": pd.to_numeric(cre_sub[result_col], errors="coerce"),
                })
                exposure_df = exposure_df.merge(cre_df, on="PID", how="left")

    # Creatinine adjustment
    if creatinine_adjust and "CRE" in exposure_df.columns:
        valid = exposure_df["CRE"].notna() & (exposure_df["CRE"] > 0)
        exposure_df.loc[valid, "exposure"] = exposure_df.loc[valid, "exposure"] / exposure_df.loc[valid, "CRE"] * 100

    # Merge with epi
    # Normalize PID column name
    epi_pid = next((c for c in epi.columns if c.lower() == pid_column.lower()), epi.columns[0])
    epi = epi.rename(columns={epi_pid: "PID"})
    dat = exposure_df.merge(epi, on="PID", how="inner")

    # Log-transform exposure
    dat["ln_exposure"] = np.log(np.maximum(dat["exposure"], 0.001))
    dat = dat[dat["ln_exposure"].notna() & np.isfinite(dat["ln_exposure"])]

    if len(dat) < 10:
        print(json.dumps({"error": "Fewer than 10 observations after merging."}))
        sys.exit(0)

    # Identify numeric outcome columns
    exclude = {"pid", pid_column.lower(), "exposure", "ln_exposure", "cre", "sid", "sid_u", "sample_id", "sampleid"}
    epi_cols = [c for c in dat.columns if c.lower() not in exclude]

    numeric_outcomes = []
    for col in epi_cols:
        vals = pd.to_numeric(dat[col], errors="coerce")
        n_valid = vals.notna().sum()
        n_unique = vals.dropna().nunique()
        if n_valid >= 10 and n_unique >= 3:
            dat[col] = vals
            numeric_outcomes.append(col)

    if not numeric_outcomes:
        print(json.dumps({"error": "No numeric outcome variables found with sufficient variation."}))
        sys.exit(0)

    # Build covariate list
    cov_terms = []
    if covariates:
        cov_terms = [c for c in covariates if c in dat.columns]
    else:
        if age_column and age_column in dat.columns:
            if age_transform:
                dat["age_std"] = dat.eval(age_transform)
                cov_terms.append("age_std")
            else:
                cov_terms.append(age_column)
        if sex_column and sex_column in dat.columns:
            cov_terms.append(sex_column)

    # Run associations
    results = []
    for outcome in numeric_outcomes:
        if outcome in [analyte_code] + cov_terms:
            continue
        try:
            subset = dat[["ln_exposure", outcome] + cov_terms].dropna()
            if len(subset) < 10:
                continue
            X = sm.add_constant(subset[["ln_exposure"] + cov_terms])
            y = subset[outcome]
            model = sm.OLS(y, X).fit()

            if "ln_exposure" not in model.params.index:
                continue

            results.append({
                "outcome": outcome,
                "beta": safe_float(model.params["ln_exposure"]),
                "se": safe_float(model.bse["ln_exposure"]),
                "t_stat": safe_float(model.tvalues["ln_exposure"]),
                "p_value": safe_float(model.pvalues["ln_exposure"]),
                "n": int(model.nobs),
                "r_squared": safe_float(model.rsquared),
                "direction": "positive" if model.params["ln_exposure"] > 0 else "negative",
            })
        except Exception:
            continue

    if not results:
        print(json.dumps({"error": "No outcome associations could be computed."}))
        sys.exit(0)

    # Sort by p-value and apply BH-FDR
    results.sort(key=lambda x: x["p_value"] if x["p_value"] is not None else 1)

    pvals = [r["p_value"] for r in results if r["p_value"] is not None]
    if pvals:
        _, fdr_vals, _, _ = multipletests(pvals, method="fdr_bh")
        idx = 0
        for r in results:
            if r["p_value"] is not None:
                r["fdr_q"] = safe_float(fdr_vals[idx])
                r["fdr_significant"] = bool(fdr_vals[idx] < 0.1)
                idx += 1

    n_fdr_sig = sum(1 for r in results if r.get("fdr_significant", False))
    cov_formula = " + ".join(cov_terms) if cov_terms else "none"

    output = {
        "n_outcomes_tested": len(results),
        "n_fdr_significant": n_fdr_sig,
        "model": f"outcome ~ ln({analyte_code}{'/CRE*100' if creatinine_adjust else ''}) + {cov_formula}",
        "n_observations": int(len(dat)),
        "covariates": cov_terms if cov_terms else "none",
        "associations": results,
    }
    print(json.dumps(output))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
