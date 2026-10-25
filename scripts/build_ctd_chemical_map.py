#!/usr/bin/env python3
"""
Regenerate src/variables/ctd-chemical-map.ts from the CTD chemical vocabulary.

Every mapping is resolved per NHANES variable from that variable's own NHANES
description, then checked against data/ctd/raw/CTD_chemicals.tsv:
  1. curated override (scripts/ctd_mesh_overrides.py)
  2. exact match of the cleaned description to a CTD name / synonym
  3. CAS number of the previous map entry for that variable
Unresolved exposures are written to data/ctd/exposure_mesh_coverage.tsv.

Inputs : data/ctd/raw/CTD_chemicals.tsv, data/nhanes_031725.sqlite,
         data/pe_summary_stats_01_2025.sqlite, previous ctd-chemical-map.ts (git HEAD)
Usage  : python3 scripts/build_ctd_chemical_map.py [--prev path/to/old-map.ts]
"""
import collections, json, os, re, subprocess, sys
import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from ctd_mesh_overrides import OV, DIET, BLACKLIST  # noqa: E402

MAP_TS = os.path.join(ROOT, "src/variables/ctd-chemical-map.ts")
CTD_TSV = os.path.join(ROOT, "data/ctd/raw/CTD_chemicals.tsv")
COVERAGE = os.path.join(ROOT, "data/ctd/exposure_mesh_coverage.tsv")
DIET_RE = re.compile(r"^(DR1T|DR2T|DRXT|DRDT|DS1T|DS2T|DSQT)([A-Z0-9]+)$")
NON_CHEMICAL = {"physical activity", "allergy", "infection"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


# ── previous map (source of hhear codes, categories, names) ────────────────
def load_prev():
    if "--prev" in sys.argv:
        src = open(sys.argv[sys.argv.index("--prev") + 1]).read()
    else:
        src = subprocess.run(["git", "show", "HEAD:src/variables/ctd-chemical-map.ts"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
    ents = []
    for b in re.findall(r"\{\s*chemical_name:(.*?)\n  \}", src, re.S):
        g = lambda k: (re.search(k + r': "([^"]*)"', b) or [None, None])[1]
        vs = re.findall(r'"([A-Z0-9_]+)"', re.search(r"nhanes_vars: \[(.*?)\]", b, re.S).group(1))
        ents.append(dict(name=re.search(r'"([^"]+)"', b).group(1), mesh=g("mesh_id"), cas=g("cas"),
                         vars=vs, hhear=g("hhear_code"), category=g("category"),
                         subcategory=g("subcategory"), parent=g("parent_compound")))
    return src, ents


# ── CTD vocabulary ─────────────────────────────────────────────────────────
ctd, bycas, byname = {}, collections.defaultdict(list), collections.defaultdict(list)
for line in open(CTD_TSV, encoding="utf-8"):
    if line.startswith("#"):
        continue
    r = line.rstrip("\n").split("\t")
    r += [""] * (13 - len(r))
    i = r[1].replace("MESH:", "")
    ctd[i] = dict(name=r[0], cas=r[2], cid=r[3], dtxsid=r[5], inchikey=r[6])
    for x in r[2].split("|"):
        if x:
            bycas[x].append(i)
    for s in [r[0]] + r[11].split("|") + r[12].split("|"):
        if s and i not in byname[norm(s)]:
            byname[norm(s)].append(i)

con = duckdb.connect()
con.execute("INSTALL sqlite; LOAD sqlite")
con.execute(f"ATTACH '{ROOT}/data/nhanes_031725.sqlite' AS n (TYPE sqlite, READ_ONLY)")
con.execute(f"ATTACH '{ROOT}/data/pe_summary_stats_01_2025.sqlite' AS pe (TYPE sqlite, READ_ONLY)")
desc = dict(con.execute("""SELECT "Variable.Name", string_agg(DISTINCT "Variable.Description", ' || ')
                           FROM n.variable_names_epcf GROUP BY 1""").fetchall())
epwas = con.execute("""
  SELECT a.evarname, max(d.category), max(d.subcategory), string_agg(DISTINCT d."Variable.Description", ' || ')
  FROM (SELECT DISTINCT evarname FROM pe.adjusted_meta_uwls WHERE model_number = 6 AND expo_name = 'expo') a
  LEFT JOIN pe.variable_domain d ON d.varname = a.evarname GROUP BY 1 ORDER BY 1""").fetchall()
domain = {v: (c, s) for v, c, s, _ in epwas}
for v, _, _, d in epwas:
    if d and v not in desc:
        desc[v] = d

STOP = r"\b(blood|serum|urinary|urine|plasma|result|level|lipid ?adj(usted)?|creatinine|total|concentration|concentrt)\b"


def clean(d):
    d = re.sub(r"\((?:[a-zµu]+/[a-z]+|%|ng|pg|ug|mg)[^)]*\)", "", d, flags=re.I)
    d = re.sub(r"\b(ng|pg|ug|mg|umol|nmol|pmol)/\w+\b", "", d, flags=re.I)
    d = re.sub(STOP, "", d, flags=re.I)
    return re.sub(r"\s+", " ", d).strip(" ,-.")


def name_hits(d):
    hits = []
    for part in (d or "").split(" || "):
        cl = clean(part)
        for cand in [cl] + re.findall(r"\(([^)]*)\)", cl) + [re.sub(r"\s*\(.*?\)", "", cl)]:
            for h in byname.get(norm(cand), ()):
                if h not in hits and h not in BLACKLIST:
                    hits.append(h)
    return hits


def nice_name(v):
    parts = [p for p in (desc.get(v) or "").split(" || ") if p and p != v]
    best = min(parts, key=lambda p: (len(re.findall(r"[a-z]", p)) == 0, len(p))) if parts else v
    return clean(best) or v


def consistent(v, name):
    """True if the NHANES description of v names the same analyte as a previous entry name."""
    n = norm(name)
    return any(len(c) > 2 and (c in n or n in c)
               for c in (norm(clean(p)) for p in (desc.get(v) or "").split(" || ")))


# ── resolve the previous map's own identities (CAS first, then name) ───────
prev_src, prev = load_prev()
for e in prev:
    # parenthetical aliases only if long enough not to be an acronym (MCPP -> mCPP collision)
    nm = [e["name"], re.sub(r"\s*\(.*?\)", "", e["name"])] + \
         [a for a in re.findall(r"\((.*?)\)", e["name"]) if len(norm(a)) >= 8]
    cand = []
    if e["cas"]:
        cand += bycas.get(e["cas"], [])
    for x in nm:
        cand += [h for h in byname.get(norm(x), []) if h not in cand]
    e["resolved"] = e["mesh"] if e["mesh"] in cand else (cand[0] if cand else None)
prev_by_var = {v: e for e in prev for v in e["vars"]}

# ── resolve each NHANES variable ───────────────────────────────────────────
universe = [v for v, c, _, _ in epwas if c not in NON_CHEMICAL]
universe += [v for e in prev for v in e["vars"] if v in desc and v not in universe]

resolved, unresolved = {}, {}
for v in universe:
    m = DIET_RE.match(v)
    if v in OV:
        mesh, how = OV[v]
    elif m and m.group(2) in DIET:
        mesh, how = DIET[m.group(2)]
    elif m:
        unresolved[v] = "dietary aggregate (energy/protein/count) - not a CTD chemical"
        continue
    else:
        hits = name_hits(desc.get(v))
        pe = prev_by_var.get(v)
        if hits:
            mesh, how = hits[0], "exact"
        elif pe and pe["resolved"] and pe["cas"] and pe["cas"] in ctd[pe["resolved"]]["cas"].split("|") \
                and norm(clean(desc.get(v, "").split(" || ")[0])) in norm(pe["name"]):
            # e.g. "PCB49" -> previous entry "PCB 49 (...)" whose CAS resolves in CTD
            mesh, how = pe["resolved"], "exact"
        else:
            unresolved[v] = "no CTD record matches NHANES description"
            continue
    assert mesh in ctd, f"{v}: {mesh} not in CTD vocabulary"
    resolved[v] = (mesh, how)

# ── group into analyte entries ─────────────────────────────────────────────
entries, key_of = {}, {}
prev_by_mesh = collections.defaultdict(list)
for e in prev:
    if e["resolved"]:
        prev_by_mesh[e["resolved"]].append(e)

for v, (mesh, how) in resolved.items():
    pe = prev_by_var.get(v)
    if pe and (pe["resolved"] == mesh or (pe["resolved"] is None and consistent(v, pe["name"]))):
        base = pe                       # previous entry, assignment confirmed
    elif how == "exact" and any(consistent(v, e["name"]) for e in prev_by_mesh[mesh]):
        base = next(e for e in prev_by_mesh[mesh] if consistent(v, e["name"]))
    else:
        base = None
    kind = "diet" if DIET_RE.match(v) else domain.get(v, (None,))[0]
    if base is not None:
        key = ("prev", base["name"])
    elif how == "exact":
        key = ("mesh", kind, mesh)
    else:
        key = ("analyte", kind, mesh, norm(nice_name(v)))
    if key not in entries:
        c, s = domain.get(v, (None, None))
        if c is None and v.startswith("LBXV"):
            c, s = "VOC", None
        if DIET_RE.match(v):
            c, s = "nutrient", "supplement" if v.startswith("DS") else "dietary intake"
        elif c == "nutrients":
            c, s = "nutrient", "biomarker"
        entries[key] = dict(
            chemical_name=base["name"] if base else (ctd[mesh]["name"] if how == "exact" else nice_name(v)),
            mesh_id=mesh, mesh_match=how, nhanes_vars=[],
            hhear_code=base["hhear"] if base else None,
            category=(base["category"] if base else c) or "other",
            subcategory=base["subcategory"] if base else s,
            parent_compound=(base["parent"] if base else None) or (ctd[mesh]["name"] if how == "parent" else None),
        )
    ent = entries[key]
    if how != "exact":
        ent["mesh_match"] = how
    ent["nhanes_vars"].append(v)

# HHEAR-only chemicals from the previous map whose vars were invalid
covered = {e["chemical_name"] for e in entries.values()}
for e in prev:
    if e["hhear"] and e["name"] not in covered and e["resolved"]:
        same = [x for x in entries.values() if x["mesh_id"] == e["resolved"] and not x.get("hhear_code")]
        if same:
            same[0]["hhear_code"] = e["hhear"]
        elif not any(x.get("hhear_code") == e["hhear"] for x in entries.values()):
            entries[("prev", e["name"])] = dict(
                chemical_name=e["name"], mesh_id=e["resolved"], mesh_match="exact", nhanes_vars=[],
                hhear_code=e["hhear"], category=e["category"] or "other",
                subcategory=e["subcategory"], parent_compound=e["parent"])

# ── emit TypeScript ────────────────────────────────────────────────────────
def ts(s):
    return json.dumps(s, ensure_ascii=False)


out = [
    "/**",
    " * CTD (Comparative Toxicogenomics Database) chemical identity mapping for ExposomeQL.",
    " * Maps NHANES chemical variables and HHEAR analyte codes to CTD MeSH identifiers.",
    " *",
    " * GENERATED by scripts/build_ctd_chemical_map.py — do not edit by hand.",
    " * Every mesh_id is validated against data/ctd/raw/CTD_chemicals.tsv and every",
    " * nhanes_var was assigned from its own NHANES variable description.",
    " * Curated decisions live in scripts/ctd_mesh_overrides.py.",
    " */",
    "",
    "export interface CTDChemicalMapping {",
    "  chemical_name: string;",
    "  cas?: string;",
    "  /** CTD / MeSH chemical ID (e.g., \"D007854\" for Lead) */",
    "  mesh_id: string;",
    "  /** CTD preferred name for mesh_id */",
    "  ctd_name: string;",
    "  /** exact: CTD record is the analyte; parent: mapped to parent compound/isomer; class: MeSH group term */",
    "  mesh_match: \"exact\" | \"parent\" | \"class\";",
    "  dtxsid?: string;",
    "  pubchem_cid?: string;",
    "  inchikey?: string;",
    "  nhanes_vars: string[];",
    "  hhear_code?: string;",
    "  category: string;",
    "  subcategory?: string;",
    "  parent_compound?: string;",
    "}",
    "",
    "export const CTD_CHEMICAL_MAP: CTDChemicalMapping[] = [",
]
by_cat = collections.defaultdict(list)
for ent in entries.values():
    by_cat[ent["category"]].append(ent)
for cat in sorted(by_cat, key=str.lower):
    out.append(f"  // ── {cat} ──")
    for ent in sorted(by_cat[cat], key=lambda e: e["chemical_name"].lower()):
        c = ctd[ent["mesh_id"]]
        out.append("  {")
        out.append(f"    chemical_name: {ts(ent['chemical_name'])},")
        cas = c["cas"].split("|")[0] if ent["mesh_match"] == "exact" else ""
        if cas:
            out.append(f"    cas: {ts(cas)},")
        out.append(f"    mesh_id: {ts(ent['mesh_id'])},")
        out.append(f"    ctd_name: {ts(c['name'])},")
        out.append(f"    mesh_match: {ts(ent['mesh_match'])},")
        if ent["mesh_match"] == "exact":
            for k, f in (("dtxsid", "dtxsid"), ("pubchem_cid", "cid"), ("inchikey", "inchikey")):
                if c[f]:
                    out.append(f"    {k}: {ts(c[f].split('|')[0].removeprefix('CID:'))},")
        out.append(f"    nhanes_vars: {ts(sorted(ent['nhanes_vars']))},")
        for k in ("hhear_code", "category", "subcategory", "parent_compound"):
            if ent.get(k):
                out.append(f"    {k}: {ts(ent[k])},")
        out.append("  },")
out.append("];")
out.append("")
tail = prev_src[prev_src.index("// ════════════════════════════════════════════════════════════════════\n// LOOKUP INDEXES"):]
open(MAP_TS, "w").write("\n".join(out) + "\n" + tail)

# ── coverage report ────────────────────────────────────────────────────────
var_entry = {v: e for e in entries.values() for v in e["nhanes_vars"]}
with open(COVERAGE, "w") as f:
    f.write("evarname\tdomain\tsubdomain\tdescription\tmesh_id\tctd_name\tmesh_match\tnote\n")
    for v, c, s, d in epwas:
        d = (d or "").split(" || ")[0]
        if v in var_entry:
            e = var_entry[v]
            f.write(f"{v}\t{c}\t{s}\t{d}\t{e['mesh_id']}\t{ctd[e['mesh_id']]['name']}\t{resolved[v][1]}\t\n")
        else:
            note = unresolved.get(v, "non-chemical exposure (not in CTD scope)")
            f.write(f"{v}\t{c}\t{s}\t{d}\t\t\tunmapped\t{note}\n")

cnt = collections.Counter(resolved[v][1] for v, *_ in epwas if v in resolved)
print(f"entries: {len(entries)}  vars mapped: {len(var_entry)}")
print(f"EP-WAS exposures: {len(epwas)}  mapped: {sum(cnt.values())} {dict(cnt)}")
print(f"unresolved chemical vars: {[v for v in unresolved if not DIET_RE.match(v)]}")
