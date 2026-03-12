#!/bin/bash
# ===========================================================================
# CTD (Comparative Toxicogenomics Database) ETL — shell/DuckDB CLI version
#
# Downloads CTD batch files, filters to NHANES/HHEAR chemicals by MeSH ID,
# and converts to Parquet using the DuckDB CLI.
#
# Prerequisites:
#   - curl
#   - gunzip
#   - duckdb CLI (https://duckdb.org/docs/installation/)
#
# Usage:
#   bash scripts/ctd-etl.sh
#   bash scripts/ctd-etl.sh --skip-download
# ===========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CTD_BASE_URL="https://ctdbase.org/reports"
DATA_DIR="$PROJECT_ROOT/data/ctd"
RAW_DIR="$DATA_DIR/raw"
FILTERED_DIR="$DATA_DIR/filtered"
PARQUET_DIR="$DATA_DIR/parquet"
DUCKDB_PATH="$PARQUET_DIR/ctd.duckdb"

SKIP_DOWNLOAD="${1:-}"

# ---------------------------------------------------------------------------
# MeSH IDs for our NHANES/HHEAR chemicals (from ctd-chemical-map.ts)
# ---------------------------------------------------------------------------

MESH_IDS=(
  # ── Metals & Trace Elements (25 unique MeSH IDs) ──
  "D007854"   # Lead
  "D002104"   # Cadmium
  "D008628"   # Mercury
  "C025954"   # Ethylmercury
  "D008767"   # Methylmercury
  "D003035"   # Cobalt
  "D002857"   # Chromium
  "D001151"   # Arsenic (total)
  "C006632"   # Arsenous acid / Arsenobetaine / DMA / MMA / TMAO
  "C009005"   # Arsenic acid
  "C006627"   # Arsenocholine
  "D001464"   # Barium
  "D001608"   # Beryllium
  "D002563"   # Cesium
  "D008345"   # Manganese
  "D008982"   # Molybdenum
  "D009532"   # Nickel
  "D010984"   # Platinum
  "D000965"   # Antimony
  "D012643"   # Selenium
  "D014001"   # Tin
  "D013324"   # Strontium
  "D013793"   # Thallium
  "D014414"   # Tungsten
  "D014501"   # Uranium

  # ── PFAS (9 unique MeSH IDs) ──
  "C076994"   # PFOS / PFOSA / MePFOSAA / EtPFOSAA
  "C023036"   # PFOA
  "C471071"   # PFHxS
  "C471072"   # PFNA
  "C524041"   # PFDA
  "C558160"   # PFUnDA
  "C558161"   # PFDoDA
  "C543160"   # PFBS
  "C524040"   # PFHpA

  # ── Phthalates (6 unique MeSH IDs) ──
  "C016599"   # MEP / MEHP / MnOP
  "C032279"   # MBP (mono-n-butyl phthalate)
  "C028577"   # MBzP / MiBP
  "D004051"   # MEHHP / MEOHP / MECPP / MCPP / MEHT / MEHHTP / MECPTP
  "C539018"   # MCnP / MCOP / MiNP / MHiNP / MOiNP
  "D010795"   # MCHP (monocyclohexyl phthalate)

  # ── Phenols (8 unique MeSH IDs) ──
  "C006780"   # Bisphenol A
  "C543008"   # Bisphenol F / Bisphenol S
  "C010927"   # Triclosan
  "C019250"   # Benzophenone-3 (Oxybenzone)
  "C005153"   # 4-tert-Octylphenol
  "C012117"   # 2,5-Dichlorophenol
  "C007677"   # 2,4-Dichlorophenol
  "C004705"   # Triclocarban

  # ── Parabens (4 unique MeSH IDs) ──
  "D010791"   # Methyl paraben
  "C013635"   # Ethyl paraben
  "C010928"   # Propyl paraben
  "C038180"   # Butyl paraben

  # ── PCBs (1 unique MeSH ID — all congeners share it) ──
  "D011078"   # Polychlorinated biphenyls (PCB 28–209)

  # ── Dioxins (2 unique MeSH IDs) ──
  "D013749"   # 2,3,7,8-TCDD
  "D011084"   # HpCDD / OCDD / HxCDD / PnCDD (polychlorinated dioxins)

  # ── Furans (1 unique MeSH ID) ──
  "D000072338" # Polychlorinated dibenzofurans (TCDF–OCDF)

  # ── Organochlorine Pesticides (12 unique MeSH IDs) ──
  "D003634"   # p,p'-DDT
  "D003633"   # p,p'-DDE
  "C028872"   # o,p'-DDT
  "D004028"   # Dieldrin
  "D000459"   # Aldrin
  "D004726"   # Endrin
  "D006582"   # Hexachlorobenzene
  "C023888"   # beta-Hexachlorocyclohexane
  "D001556"   # gamma-Hexachlorocyclohexane (Lindane)
  "C020744"   # Heptachlor epoxide
  "D008798"   # Mirex
  "C014024"   # Oxychlordane / trans-Nonachlor

  # ── Brominated Flame Retardants (3 unique MeSH IDs) ──
  "D011075"   # PBB 153
  "D055964"   # PBDEs (BDE-17 through BDE-209)
  "C006264"   # Tetrabromobisphenol A (TBBPA)

  # ── OP Flame Retardants (1 unique MeSH ID) ──
  "C548789"   # BDCPP / BCEP / BCPP

  # ── PAH Metabolites (6 unique MeSH IDs) ──
  "D009281"   # 1-Naphthol / 2-Naphthol (naphthalene)
  "D005449"   # Hydroxyfluorenes (fluorene)
  "D010616"   # Hydroxyphenanthrenes / phenanthrenedione (phenanthrene)
  "C010537"   # 3-Hydroxyfluoranthene
  "D011722"   # 1-Hydroxypyrene / pyrethroid metabolites (shared)

  # ── Smoking Biomarkers (7 unique MeSH IDs) ──
  "D003367"   # Cotinine
  "C116453"   # Hydroxycotinine / trans-3'-hydroxycotinine
  "C076523"   # NNAL / NNAL-Gluc
  "D009538"   # Nicotine / Nicotine-N-oxide / Nornicotine / Nicotine equivalent
  "D015984"   # N'-Nitrosonornicotine (NNN)
  "C009034"   # Anabasine
  "C014027"   # Anatabine

  # ── VOCs — BTEX & Aromatics (7 unique MeSH IDs) ──
  "D001554"   # Benzene / tert-/sec-/n-Butylbenzene / benzene metabolites
  "D014050"   # Toluene / toluene metabolites
  "C004912"   # Ethylbenzene / Chlorobenzene
  "D014992"   # o-Xylene / m-p-Xylene / xylene metabolites
  "D020058"   # Styrene / styrene metabolites
  "C027068"   # Isopropylbenzene / n-Propylbenzene
  "C010197"   # 1,2,4-Trimethylbenzene / 1,3,5-Trimethylbenzene

  # ── VOCs — Trihalomethanes (3 unique MeSH IDs) ──
  "D002725"   # Chloroform
  "C004637"   # Bromodichloromethane
  "C004639"   # Dibromochloromethane

  # ── VOCs — Chlorinated Solvents & Aromatics (12 unique MeSH IDs) ──
  "D002251"   # Carbon tetrachloride
  "D014241"   # Trichloroethene
  "D013750"   # Tetrachloroethene (Perchloroethylene)
  "D008752"   # Methylene chloride
  "C024565"   # 1,1-Dichloroethane
  "D004987"   # 1,2-Dichloroethane
  "C014592"   # 1,1,1-Trichloroethane / 1,1,2-Trichloroethane / 1,2,4-Trichlorobenzene
  "C005963"   # 1,1,2,2-Tetrachloroethane
  "C022183"   # 1,1-Dichloroethene
  "C023733"   # cis-/trans-1,2-Dichloroethene
  "C004901"   # 1,2-Dichlorobenzene / 1,3-Dichlorobenzene
  "C015667"   # 1,4-Dichlorobenzene

  # ── VOCs — Other Solvents & Chemicals (14 unique MeSH IDs) ──
  "D006591"   # Hexachloroethane
  "C043243"   # MTBE / ETBE / TAME
  "C024665"   # Bromoform / Dibromomethane / Bromochloromethane
  "C025223"   # 1,4-Dioxane
  "D005663"   # Furan
  "C003192"   # Nitrobenzene
  "C005252"   # 2-Butanone (MEK)
  "D000096"   # Acetone
  "D002246"   # Carbon disulfide / TTCA metabolite
  "C017262"   # 2-Hexanone
  "D014752"   # Vinyl chloride / vinyl chloride metabolite
  "C002490"   # 1,2-Dibromo-3-chloropropane
  "C012989"   # 1,2-/1,3-/2,2-Dichloropropane
  "C042650"   # cis-/trans-1,3-Dichloropropene

  # ── VOCs — Miscellaneous (5 unique MeSH IDs) ──
  "C050363"   # 1,2,3-Trichloropropane
  "C007210"   # 4-Isopropyltoluene (p-Cymene)
  "D019871"   # Diethyl ether
  "C018674"   # Tetrahydrofuran
  "D000181"   # Acrylonitrile / acrylonitrile metabolites

  # ── VOC Urinary Metabolites (9 unique MeSH IDs) ──
  "D000171"   # Acrolein metabolites (HPMA / CEMA)
  "D020106"   # Acrylamide / acrylamide metabolite (AAMA)
  "C029304"   # Glycidamide (GAMA)
  "D002070"   # 1,3-Butadiene metabolites (DHBMA / MHBMA)
  "C017471"   # Crotonaldehyde metabolite (HPMMA)
  "D005027"   # Ethylene oxide / HEMA
  "D011024"   # Propylene oxide metabolite (2HPMA)
  "C019102"   # 1-Bromopropane metabolite (BPMA)
  "D008762"   # Methyl bromide metabolite

  # ── VOC — Other Metabolites (2 unique MeSH IDs) ──
  "C026205"   # N,N-Dimethylformamide metabolite (AMCC)
  "D001280"   # Atrazine / atrazine mercapturate

  # ── Priority Pesticides (14 unique MeSH IDs) ──
  "D015084"   # 2,4-Dichlorophenoxyacetic acid (2,4-D)
  "D015085"   # 2,4,5-Trichlorophenoxyacetic acid (2,4,5-T)
  "D010416"   # Pentachlorophenol
  "D004390"   # Chlorpyrifos metabolite (TCP)
  "D010278"   # para-Nitrophenol (parathion metabolite)
  "C031080"   # Acetochlor mercapturate
  "C025958"   # Metolachlor mercapturate
  "D000382"   # Alachlor mercapturate
  "D003976"   # Diazinon metabolite (IMPY)
  "D008294"   # Malathion metabolite (MDA)
  "C010974"   # Glyphosate / AMPA
  "C029002"   # Glufosinate
  "C016109"   # 2,4,5-Trichlorophenol
  "C005146"   # ortho-Phenylphenol

  # ── Dialkyl Phosphates (2 unique MeSH IDs) ──
  "C025058"   # Dimethylphosphate (DMP)
  "D010575"   # DEP / DMTP / DETP / DMDTP / DEDTP / DBuP / DPhP / ip-PPP

  # ── Inorganic — Thyroid Disruptors (3 unique MeSH IDs) ──
  "D010545"   # Perchlorate
  "D009566"   # Nitrate
  "D013861"   # Thiocyanate

  # ── Industrial Chemicals (3 unique MeSH IDs) ──
  "D005557"   # Formaldehyde
  "C015357"   # 2,4-Toluene diamine (TDA)
  "C002180"   # 4,4'-Methylenedianiline (MDA)

  # ── Isocyanate Metabolites (1 unique MeSH ID) ──
  "D006586"   # 1,6-Hexamethylene diamine (HDA)

  # ── Insect Repellent (1 unique MeSH ID) ──
  "D003671"   # DEET

  # ── Aromatic Amines (6 unique MeSH IDs) ──
  "D015074"   # 4-Aminobiphenyl
  "C013036"   # o-Toluidine
  "C049584"   # PhIP (2-Amino-1-methyl-6-phenylimidazo[4,5-b]pyridine)
  "C001797"   # 1-Aminonaphthalene
  "C001798"   # 2-Aminonaphthalene
  "C001265"   # o-Anisidine

  # ── Nutrient (1 unique MeSH ID) ──
  "D007455"   # Iodine

  # ── Phytoestrogens (6 unique MeSH IDs) ──
  "D019833"   # Genistein
  "D060754"   # Daidzein
  "C004742"   # Equol
  "C032517"   # O-Desmethylangolensin
  "C006717"   # Enterodiol
  "C009945"   # Enterolactone
)

CTD_FILES=(
  "CTD_chem_gene_ixns.tsv.gz"
  "CTD_chemicals_diseases.tsv.gz"
  "CTD_chem_pathways_enriched.tsv.gz"
  "CTD_chem_go_enriched.tsv.gz"
  "CTD_chemicals.tsv.gz"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { echo "[ctd-etl] $*" >&2; }

# Build a grep pattern for all MeSH IDs (matches MESH:D007854 etc.)
build_mesh_pattern() {
  local pattern=""
  for id in "${MESH_IDS[@]}"; do
    if [ -z "$pattern" ]; then
      pattern="MESH:${id}"
    else
      pattern="${pattern}|MESH:${id}"
    fi
  done
  echo "$pattern"
}

# Filter a TSV: keep header + rows where column $2 matches a MeSH ID
filter_tsv() {
  local input="$1"
  local output="$2"
  local pattern
  pattern="$(build_mesh_pattern)"

  log "Filtering $(basename "$input")..."

  # Extract the last comment line as header, then grep data lines
  {
    # Get the last line starting with '#' (the header)
    grep '^#' "$input" | tail -1 | sed 's/^# *//'
    # Get data lines matching our MeSH IDs
    grep -v '^#' "$input" | grep -E "$pattern" || true
  } > "$output"

  local count
  count=$(wc -l < "$output")
  count=$((count - 1))  # subtract header
  log "  -> $count matching rows"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

log "=== CTD ETL for ExposomeQL (shell version) ==="
log "Chemicals: ${#MESH_IDS[@]} MeSH IDs"

mkdir -p "$RAW_DIR" "$FILTERED_DIR" "$PARQUET_DIR"

# Step 1: Download and decompress
if [ "$SKIP_DOWNLOAD" != "--skip-download" ]; then
  log ""
  log "--- Step 1: Download CTD batch files ---"
  for f in "${CTD_FILES[@]}"; do
    gz_path="$RAW_DIR/$f"
    tsv_path="$RAW_DIR/${f%.gz}"

    if [ -f "$gz_path" ]; then
      log "Exists: $f"
    else
      log "Downloading $f..."
      curl -L --progress-bar -o "$gz_path" "$CTD_BASE_URL/$f"
    fi

    if [ -f "$tsv_path" ]; then
      log "Decompressed exists: ${f%.gz}"
    else
      log "Decompressing $f..."
      gunzip -k "$gz_path"
    fi
  done
else
  log ""
  log "--- Step 1: SKIPPED (--skip-download) ---"
fi

# Step 2: Filter to our chemicals
log ""
log "--- Step 2: Filter to NHANES/HHEAR chemicals ---"

for f in "${CTD_FILES[@]}"; do
  tsv_name="${f%.gz}"
  input="$RAW_DIR/$tsv_name"
  output="$FILTERED_DIR/$tsv_name"

  # Skip vocab file
  if [ "$tsv_name" = "CTD_chemicals.tsv" ]; then
    log "Skipping vocabulary file: $tsv_name"
    continue
  fi

  if [ ! -f "$input" ]; then
    log "WARNING: missing $tsv_name"
    continue
  fi

  filter_tsv "$input" "$output"
done

# Step 3: Load into DuckDB and create Parquet
log ""
log "--- Step 3: Create DuckDB tables and Parquet files ---"

# Check for duckdb CLI
if ! command -v duckdb &>/dev/null; then
  log "ERROR: duckdb CLI not found. Install from https://duckdb.org/docs/installation/"
  exit 1
fi

# Remove old database
rm -f "$DUCKDB_PATH"

duckdb "$DUCKDB_PATH" <<SQL

-- Chemical-gene interactions
CREATE TABLE ctd_chem_gene AS
SELECT
  replace("ChemicalID", 'MESH:', '') AS mesh_id,
  "ChemicalName" AS chemical_name,
  "CasRN" AS cas,
  "GeneSymbol" AS gene_symbol,
  TRY_CAST("GeneID" AS INTEGER) AS gene_id,
  "Organism" AS organism,
  TRY_CAST("OrganismID" AS INTEGER) AS organism_id,
  "Interaction" AS interaction,
  "InteractionActions" AS interaction_actions,
  "PubMedIDs" AS pubmed_ids
FROM read_csv('${FILTERED_DIR}/CTD_chem_gene_ixns.tsv',
  delim='\t', header=true, quote='', all_varchar=true,
  ignore_errors=true
);

COPY ctd_chem_gene TO '${PARQUET_DIR}/ctd_chem_gene.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
SELECT 'ctd_chem_gene: ' || count(*)::VARCHAR || ' rows' FROM ctd_chem_gene;

-- Chemical-disease associations
CREATE TABLE ctd_chem_disease AS
SELECT
  replace("ChemicalID", 'MESH:', '') AS mesh_id,
  "ChemicalName" AS chemical_name,
  "CasRN" AS cas,
  "DiseaseName" AS disease_name,
  "DiseaseID" AS disease_id,
  "DirectEvidence" AS direct_evidence,
  "InferenceGeneSymbol" AS inference_gene_symbol,
  TRY_CAST("InferenceScore" AS DOUBLE) AS inference_score,
  "OmimIDs" AS omim_ids,
  "PubMedIDs" AS pubmed_ids
FROM read_csv('${FILTERED_DIR}/CTD_chemicals_diseases.tsv',
  delim='\t', header=true, quote='', all_varchar=true,
  ignore_errors=true
);

COPY ctd_chem_disease TO '${PARQUET_DIR}/ctd_chem_disease.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
SELECT 'ctd_chem_disease: ' || count(*)::VARCHAR || ' rows' FROM ctd_chem_disease;

-- Chemical-pathway enrichment
CREATE TABLE ctd_chem_pathway AS
SELECT
  replace("ChemicalID", 'MESH:', '') AS mesh_id,
  "ChemicalName" AS chemical_name,
  "CasRN" AS cas,
  "PathwayName" AS pathway_name,
  "PathwayID" AS pathway_id,
  TRY_CAST("PValue" AS DOUBLE) AS p_value,
  TRY_CAST("CorrectedPValue" AS DOUBLE) AS corrected_p_value,
  CAST(NULL AS VARCHAR) AS target_genes,
  TRY_CAST("TargetMatchQty" AS INTEGER) AS gene_count,
  TRY_CAST("BackgroundTotalQty" AS INTEGER) AS total_genes
FROM read_csv('${FILTERED_DIR}/CTD_chem_pathways_enriched.tsv',
  delim='\t', header=true, quote='', all_varchar=true,
  ignore_errors=true
);

COPY ctd_chem_pathway TO '${PARQUET_DIR}/ctd_chem_pathway.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
SELECT 'ctd_chem_pathway: ' || count(*)::VARCHAR || ' rows' FROM ctd_chem_pathway;

-- Chemical-GO enrichment
CREATE TABLE ctd_chem_go AS
SELECT
  replace("ChemicalID", 'MESH:', '') AS mesh_id,
  "ChemicalName" AS chemical_name,
  "CasRN" AS cas,
  "GOTermName" AS go_name,
  "GOTermID" AS go_id,
  "Ontology" AS ontology,
  TRY_CAST("PValue" AS DOUBLE) AS p_value,
  TRY_CAST("CorrectedPValue" AS DOUBLE) AS corrected_p_value,
  CAST(NULL AS VARCHAR) AS target_genes,
  TRY_CAST("TargetMatchQty" AS INTEGER) AS gene_count,
  TRY_CAST("BackgroundTotalQty" AS INTEGER) AS total_genes
FROM read_csv('${FILTERED_DIR}/CTD_chem_go_enriched.tsv',
  delim='\t', header=true, quote='', all_varchar=true,
  ignore_errors=true
);

COPY ctd_chem_go TO '${PARQUET_DIR}/ctd_chem_go.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
SELECT 'ctd_chem_go: ' || count(*)::VARCHAR || ' rows' FROM ctd_chem_go;

-- Summary
SELECT '--- Chemical coverage ---';
SELECT DISTINCT mesh_id, chemical_name FROM ctd_chem_gene ORDER BY chemical_name;

SQL

log ""
log "--- Output ---"
log "Parquet files: $PARQUET_DIR/"
ls -lh "$PARQUET_DIR"/*.parquet 2>/dev/null || log "  (no parquet files)"
log "DuckDB: $DUCKDB_PATH"

log ""
log "Done."
