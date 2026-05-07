#!/usr/bin/env python3
"""Find NHANES 'doppelgangers' — participants matching a demographic + exposure profile."""

import sys, json, os, math, sqlite3
import pandas as pd
import numpy as np

params = json.load(sys.stdin)
db_path = os.environ.get("EXPOSOMEQL_DB_PATH", "data/nhanes_031725.sqlite")

age_min = params.get("age_min", 18)
age_max = params.get("age_max", 80)
sex_code = params.get("sex_code")
race_code = params.get("race_code")
exposure_filters = params.get("exposure_filters", [])
match_window = params.get("match_window", 1.0)
phenotypes = params.get("phenotypes", [])

def safe_float(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 6)

try:
    con = sqlite3.connect(db_path)

    # Load demographics from most recent cycle (DEMO_J = 2017-2018)
    demo = pd.read_sql("SELECT SEQN, RIDAGEYR, RIAGENDR, RIDRETH3, BMXBMI, WTMEC2YR, SDMVPSU, SDMVSTRA FROM DEMO_J LEFT JOIN BMX_J USING(SEQN)", con)

    # Filter demographics
    mask = (demo["RIDAGEYR"] >= age_min) & (demo["RIDAGEYR"] <= age_max)
    if sex_code is not None:
        mask &= demo["RIAGENDR"] == sex_code
    if race_code is not None:
        mask &= demo["RIDRETH3"] == race_code

    matched = demo[mask].copy()
    n_demographic = len(matched)

    # Exposure filtering
    for ef in exposure_filters:
        parts = ef.split(":")
        if len(parts) != 2:
            continue
        var_name, target_str = parts[0].strip(), parts[1].strip()
        target_val = float(target_str)

        # Find table containing this variable in cycle J
        tables = pd.read_sql(
            f"SELECT DISTINCT \"Data.File.Name\" FROM variable_names_epcf WHERE \"Variable.Name\" = ? AND \"Data.File.Name\" LIKE '%_J'",
            con, params=(var_name,)
        )
        if len(tables) == 0:
            continue

        tab_name = tables.iloc[0, 0]
        try:
            expo_data = pd.read_sql(f"SELECT SEQN, \"{var_name}\" FROM \"{tab_name}\"", con)
        except Exception:
            continue

        expo_data[var_name] = pd.to_numeric(expo_data[var_name], errors="coerce")
        expo_data = expo_data.dropna(subset=[var_name])

        vals = expo_data[var_name]
        # Log10 transform if all positive (matches EP-WAS convention)
        if (vals > 0).all():
            vals = np.log10(vals)
            target_val = np.log10(target_val) if target_val > 0 else target_val

        mean_val = vals.mean()
        sd_val = vals.std()
        if sd_val > 0:
            z_target = (target_val - mean_val) / sd_val
            expo_data["_z"] = (vals - mean_val) / sd_val
            expo_data = expo_data[abs(expo_data["_z"] - z_target) <= match_window]

        matched = matched[matched["SEQN"].isin(expo_data["SEQN"])]

    n_matched = len(matched)

    # Phenotype distributions
    phenotype_dists = []
    for pheno in phenotypes:
        # Find table
        tables = pd.read_sql(
            f"SELECT DISTINCT \"Data.File.Name\" FROM variable_names_epcf WHERE \"Variable.Name\" = ? AND \"Data.File.Name\" LIKE '%_J'",
            con, params=(pheno,)
        )
        if len(tables) == 0:
            continue

        tab_name = tables.iloc[0, 0]
        try:
            pheno_data = pd.read_sql(f"SELECT SEQN, \"{pheno}\" FROM \"{tab_name}\"", con)
        except Exception:
            continue

        pheno_data[pheno] = pd.to_numeric(pheno_data[pheno], errors="coerce")
        merged = matched.merge(pheno_data, on="SEQN", how="inner")
        vals = merged[pheno].dropna()

        if len(vals) == 0:
            continue

        pctiles = np.percentile(vals, [5, 25, 50, 75, 95])
        phenotype_dists.append({
            "variable": pheno,
            "n": int(len(vals)),
            "mean": safe_float(vals.mean()),
            "sd": safe_float(vals.std()),
            "p5": safe_float(pctiles[0]),
            "p25": safe_float(pctiles[1]),
            "median": safe_float(pctiles[2]),
            "p75": safe_float(pctiles[3]),
            "p95": safe_float(pctiles[4]),
        })

    con.close()

    result = {
        "n_demographic": int(n_demographic),
        "n_matched": int(n_matched),
        "phenotype_distributions": phenotype_dists,
    }
    print(json.dumps(result))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
