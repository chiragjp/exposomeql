#!/usr/bin/env python3
"""Cumulative exposure score across multiple analytes in an HHEAR cohort."""

import sys, json, math
import pandas as pd
import numpy as np
from scipy import stats as sp_stats

params = json.load(sys.stdin)
targeted_csv = params["targeted_csv"]
epi_csv = params.get("epi_csv")
analytes = params.get("analytes")
creatinine_adjust = params.get("creatinine_adjust", False)
method = params.get("method", "percentile_rank")

def safe_float(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 6)

try:
    targeted = pd.read_csv(targeted_csv)
    targeted.columns = targeted.columns.str.lower()
    targeted["concentration"] = pd.to_numeric(targeted["concentration"], errors="coerce")

    pid_col = next((c for c in targeted.columns if "pid" in c.lower()), "pid")

    # Auto-detect analytes if not specified
    if not analytes:
        analytes = [a for a in targeted["analyte_code"].unique()
                    if a.upper() not in ("CRE", "SG", "CREATININE")]

    # LOD imputation helper
    def impute_lod(df):
        if "comment_code" in df.columns and "lod" in df.columns:
            below = df["comment_code"].isin([37, 199])
            pct = below.sum() / len(df) * 100 if len(df) > 0 else 100
            if pct <= 25:
                lod_vals = pd.to_numeric(df["lod"], errors="coerce")
                lod_val = lod_vals[lod_vals > 0].median()
                if pd.notna(lod_val) and lod_val > 0:
                    df.loc[below, "concentration"] = lod_val / 2
            elif pct > 25:
                return None  # Skip this analyte
        return df

    # Creatinine data
    cre_data = None
    if creatinine_adjust:
        cre_df = targeted[targeted["analyte_code"].str.lower() == "cre"].copy()
        if len(cre_df) > 0:
            cre_df["_pj"] = cre_df[pid_col].astype(str).str.lower()
            cre_df["cre_conc"] = pd.to_numeric(cre_df["concentration"], errors="coerce")
            cre_data = cre_df[["_pj", "cre_conc"]].dropna()

    # Compute per-analyte scores
    score_frames = []
    per_analyte_stats = []

    for analyte in analytes:
        chem = targeted[targeted["analyte_code"].str.lower() == analyte.lower()].copy()
        if len(chem) < 10:
            continue

        chem = impute_lod(chem)
        if chem is None:
            continue

        if creatinine_adjust and cre_data is not None:
            chem["_pj"] = chem[pid_col].astype(str).str.lower()
            chem = chem.merge(cre_data, on="_pj", how="left")
            valid = chem["cre_conc"].notna() & (chem["cre_conc"] > 0)
            chem = chem[valid].copy()
            chem["concentration"] = chem["concentration"] / chem["cre_conc"] * 100

        # One value per participant: repeat samples (visits, matrices) are
        # averaged, otherwise the merge across analytes multiplies rows.
        chem["_pid"] = chem[pid_col].astype(str).str.lower()
        vals = chem.dropna(subset=["concentration"]).groupby("_pid")["concentration"].mean()
        if len(vals) < 10:
            continue

        if method == "z_score":
            scores = (vals - vals.mean()) / vals.std()
        else:
            scores = vals.rank(pct=True)

        score_df = pd.DataFrame({
            "pid": vals.index.values,
            f"score_{analyte}": scores.values,
        })

        score_frames.append(score_df)
        per_analyte_stats.append({
            "analyte": analyte,
            "n": int(len(vals)),
            "mean_conc": safe_float(vals.mean()),
            "sd_conc": safe_float(vals.std()),
            "mean_score": safe_float(scores.mean()),
        })

    if not score_frames:
        print(json.dumps({"error": "No analytes with sufficient data."}))
        sys.exit(1)

    # Merge all scores by PID
    merged = score_frames[0]
    for sf in score_frames[1:]:
        merged = merged.merge(sf, on="pid", how="inner")

    score_cols = [c for c in merged.columns if c.startswith("score_")]
    merged["cumulative_score"] = merged[score_cols].mean(axis=1)

    cs = merged["cumulative_score"]

    # Score distribution by decile. Aggregates only: HHEAR data are under a
    # data-use agreement, so participant IDs never leave this script.
    deciles = {f"p{q}": safe_float(cs.quantile(q / 100)) for q in range(10, 100, 10)}
    n_tail = max(1, int(round(len(cs) * 0.1)))
    tails = {
        "top_decile_mean": safe_float(cs.nlargest(n_tail).mean()),
        "bottom_decile_mean": safe_float(cs.nsmallest(n_tail).mean()),
        "n_per_decile": n_tail,
    }

    # Age/sex correlation if epi data available
    age_corr = None
    sex_diff = None
    if epi_csv:
        epi = pd.read_csv(epi_csv)
        epi.columns = epi.columns.str.lower()
        epi_pid = next((c for c in epi.columns if "pid" in c.lower()), "pid")
        epi["_pj"] = epi[epi_pid].astype(str).str.lower()
        merged_epi = merged.merge(epi, left_on="pid", right_on="_pj", how="inner")

        # Age correlation
        age_col = next((c for c in ["age", "age_years", "age_val"] if c in merged_epi.columns), None)
        if age_col:
            age_vals = pd.to_numeric(merged_epi[age_col], errors="coerce")
            valid = age_vals.notna() & merged_epi["cumulative_score"].notna()
            if valid.sum() > 10:
                r, p = sp_stats.pearsonr(age_vals[valid], merged_epi.loc[valid, "cumulative_score"])
                age_corr = {"r": safe_float(r), "p_value": safe_float(p), "n": int(valid.sum())}

        # Sex difference
        sex_col = next((c for c in ["sex", "gender"] if c in merged_epi.columns), None)
        if sex_col and merged_epi[sex_col].nunique() == 2:
            groups = merged_epi[sex_col].unique()
            g1 = merged_epi[merged_epi[sex_col] == groups[0]]["cumulative_score"]
            g2 = merged_epi[merged_epi[sex_col] == groups[1]]["cumulative_score"]
            if len(g1) > 5 and len(g2) > 5:
                t, p = sp_stats.ttest_ind(g1, g2)
                sex_diff = {
                    "groups": [str(g) for g in groups],
                    "mean_by_group": [safe_float(g1.mean()), safe_float(g2.mean())],
                    "t_statistic": safe_float(t),
                    "p_value": safe_float(p),
                }

    result = {
        "n_participants": int(len(merged)),
        "n_chemicals_included": len(score_cols),
        "chemicals_included": [s.replace("score_", "") for s in score_cols],
        "score_method": method,
        "creatinine_adjusted": creatinine_adjust,
        "cumulative_score_stats": {
            "mean": safe_float(cs.mean()),
            "sd": safe_float(cs.std()),
            "median": safe_float(cs.median()),
            "min": safe_float(cs.min()),
            "max": safe_float(cs.max()),
            "p25": safe_float(cs.quantile(0.25)),
            "p75": safe_float(cs.quantile(0.75)),
        },
        "per_analyte_stats": per_analyte_stats,
        "score_deciles": deciles,
        "score_tails": tails,
        "age_correlation": age_corr,
        "sex_difference": sex_diff,
    }
    print(json.dumps(result))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
