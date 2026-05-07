#!/usr/bin/env python3
"""Descriptive statistics for a single analyte in an HHEAR cohort."""

import sys, json, math
import pandas as pd
import numpy as np
from scipy import stats

params = json.load(sys.stdin)
targeted_csv = params["targeted_csv"]
epi_csv = params.get("epi_csv")
analyte = params["analyte"]
subgroup = params.get("subgroup")
creatinine_adjust = params.get("creatinine_adjust", False)

def safe_float(x):
    """Convert to float, replacing NaN/Inf with None for JSON."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 6)

try:
    targeted = pd.read_csv(targeted_csv)
    targeted.columns = targeted.columns.str.lower()

    # Filter to analyte
    chem = targeted[targeted["analyte_code"].str.lower() == analyte.lower()].copy()
    if len(chem) == 0:
        print(json.dumps({"error": f"Analyte '{analyte}' not found."}))
        sys.exit(1)

    chem["concentration"] = pd.to_numeric(chem["concentration"], errors="coerce")

    # LOD handling: impute <LOD as LOD/2
    pct_below_lod = None
    lod_method = None
    if "comment_code" in chem.columns and "lod" in chem.columns:
        below_lod = chem["comment_code"].isin([37, 199])
        pct_below_lod = round(below_lod.sum() / len(chem) * 100, 2) if len(chem) > 0 else None
        if pct_below_lod is not None and pct_below_lod <= 25:
            lod_vals = pd.to_numeric(chem["lod"], errors="coerce")
            lod_val = lod_vals[lod_vals > 0].median()
            if pd.notna(lod_val) and lod_val > 0:
                chem.loc[below_lod, "concentration"] = lod_val / 2
                lod_method = "LOD/2 imputation"

    # Creatinine adjustment
    if creatinine_adjust:
        pid_col = next((c for c in ["pid", "child_pid", "subject_id"] if c in chem.columns), None)
        if pid_col is None:
            pid_col = next((c for c in chem.columns if "pid" in c.lower()), "pid")
        cre_dat = targeted[targeted["analyte_code"].str.lower() == "cre"].copy()
        if len(cre_dat) > 0:
            cre_pid = next((c for c in cre_dat.columns if "pid" in c.lower()), pid_col)
            cre_dat["_pid_join"] = cre_dat[cre_pid].astype(str).str.lower()
            chem["_pid_join"] = chem[pid_col].astype(str).str.lower()
            cre_dat["cre_conc"] = pd.to_numeric(cre_dat["concentration"], errors="coerce")
            chem = chem.merge(cre_dat[["_pid_join", "cre_conc"]], on="_pid_join", how="left")
            valid = chem["cre_conc"].notna() & (chem["cre_conc"] > 0)
            chem = chem[valid].copy()
            chem["concentration"] = chem["concentration"] / chem["cre_conc"] * 100

    # Subgroup filter via epi data
    if subgroup and epi_csv:
        epi = pd.read_csv(epi_csv)
        epi.columns = epi.columns.str.lower()
        pid_col_t = next((c for c in chem.columns if "pid" in c.lower()), "pid")
        pid_col_e = next((c for c in epi.columns if "pid" in c.lower()), "pid")
        chem["_pid_j"] = chem[pid_col_t].astype(str).str.lower()
        epi["_pid_j"] = epi[pid_col_e].astype(str).str.lower()
        merged = chem.merge(epi, on="_pid_j", how="inner", suffixes=("", "_epi"))
        merged = merged.query(subgroup)
        chem = merged

    vals = chem["concentration"].dropna()
    if len(vals) == 0:
        print(json.dumps({"error": "No valid concentration values after filtering."}))
        sys.exit(1)

    n = len(vals)
    mean_val = vals.mean()
    sd_val = vals.std()
    median_val = vals.median()

    # Geometric mean (only for positive values)
    pos_vals = vals[vals > 0]
    gmean = float(np.exp(np.mean(np.log(pos_vals)))) if len(pos_vals) > 0 else None

    # CI via t-test
    ci = stats.t.interval(0.95, df=n - 1, loc=mean_val, scale=stats.sem(vals)) if n > 1 else (None, None)

    # Percentiles
    pctiles = np.percentile(vals, [5, 25, 50, 75, 95])

    # Units
    units = chem["units"].dropna().unique()
    units_val = str(units[0]) if len(units) > 0 else None

    result = {
        "analyte": analyte,
        "n": int(n),
        "mean": safe_float(mean_val),
        "sd": safe_float(sd_val),
        "median": safe_float(median_val),
        "geometric_mean": safe_float(gmean),
        "ci_lower": safe_float(ci[0]),
        "ci_upper": safe_float(ci[1]),
        "percentiles": {
            "p5": safe_float(pctiles[0]),
            "p25": safe_float(pctiles[1]),
            "p50": safe_float(pctiles[2]),
            "p75": safe_float(pctiles[3]),
            "p95": safe_float(pctiles[4]),
        },
        "units": units_val,
        "creatinine_adjusted": creatinine_adjust,
        "pct_below_lod": safe_float(pct_below_lod),
        "lod_method": lod_method,
    }
    print(json.dumps(result))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
