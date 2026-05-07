#!/usr/bin/env python3
"""Cross-cohort comparison for a single analyte."""

import sys, json, math
import pandas as pd
import numpy as np
from scipy import stats

params = json.load(sys.stdin)
cohorts = params["cohorts"]  # [{id, targeted_csv, epi_csv}, ...]
analyte = params["analyte"]
creatinine_adjust = params.get("creatinine_adjust", False)

def safe_float(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 6)

try:
    cohort_results = []

    for cohort in cohorts:
        cid = cohort["id"]
        try:
            targeted = pd.read_csv(cohort["targeted_csv"])
            targeted.columns = targeted.columns.str.lower()

            chem = targeted[targeted["analyte_code"].str.lower() == analyte.lower()].copy()
            if len(chem) == 0:
                continue

            chem["concentration"] = pd.to_numeric(chem["concentration"], errors="coerce")

            # LOD imputation
            pct_below_lod = None
            if "comment_code" in chem.columns and "lod" in chem.columns:
                below_lod = chem["comment_code"].isin([37, 199])
                pct_below_lod = round(below_lod.sum() / len(chem) * 100, 2) if len(chem) > 0 else None
                if pct_below_lod is not None and pct_below_lod <= 25:
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

            vals = chem["concentration"].dropna()
            if len(vals) == 0:
                continue

            n = len(vals)
            pos_vals = vals[vals > 0]
            gmean = float(np.exp(np.mean(np.log(pos_vals)))) if len(pos_vals) > 0 else None
            ci = stats.t.interval(0.95, df=n - 1, loc=vals.mean(), scale=stats.sem(vals)) if n > 1 else (None, None)
            pctiles = np.percentile(vals, [25, 75])
            units = chem["units"].dropna().unique()

            cohort_results.append({
                "cohort_id": cid,
                "n": int(n),
                "mean": safe_float(vals.mean()),
                "sd": safe_float(vals.std()),
                "median": safe_float(vals.median()),
                "geometric_mean": safe_float(gmean),
                "ci_lower": safe_float(ci[0]),
                "ci_upper": safe_float(ci[1]),
                "iqr_lower": safe_float(pctiles[0]),
                "iqr_upper": safe_float(pctiles[1]),
                "pct_below_lod": safe_float(pct_below_lod),
                "units": str(units[0]) if len(units) > 0 else None,
            })
        except Exception:
            continue

    result = {
        "analyte": analyte,
        "creatinine_adjusted": creatinine_adjust,
        "n_cohorts": len(cohort_results),
        "cohort_results": cohort_results,
    }
    print(json.dumps(result))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
