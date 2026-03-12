/**
 * CTD chemical map: maps our NHANES/HHEAR chemicals to CTD MeSH IDs.
 * CTD uses MeSH substance IDs as primary identifiers.
 *
 * These MeSH IDs were resolved from the CTD_chemicals.tsv vocabulary file
 * by matching on CAS Registry Numbers from comptox-chemicals.ts.
 *
 * Usage: import { CTD_MESH_IDS, CTD_CAS_TO_MESH } from "./ctd-chemical-map.js";
 */

export interface CTDChemicalEntry {
  /** Chemical name (matching our comptox-chemicals naming) */
  chemical_name: string;
  /** HHEAR analyte code */
  hhear_code: string;
  /** CAS Registry Number */
  cas_number: string;
  /** CTD MeSH Substance ID (e.g., "D007854" for Lead) */
  mesh_id: string;
  /** CTD chemical name (may differ from ours) */
  ctd_name: string;
}

/**
 * Mapping of our 54 NHANES/HHEAR chemicals to CTD MeSH IDs.
 * Not all chemicals have CTD entries; metabolites and some specialty
 * analytes (e.g., creatinine) are excluded or mapped to parent compounds.
 *
 * MeSH IDs sourced from: https://ctdbase.org/reports/CTD_chemicals.tsv.gz
 */
export const CTD_CHEMICAL_MAP: CTDChemicalEntry[] = [
  // -- Metals --
  { chemical_name: "Lead", hhear_code: "Pb", cas_number: "7439-92-1", mesh_id: "D007854", ctd_name: "Lead" },
  { chemical_name: "Cadmium", hhear_code: "Cd", cas_number: "7440-43-9", mesh_id: "D002104", ctd_name: "Cadmium" },
  { chemical_name: "Mercury (total)", hhear_code: "Hg", cas_number: "7439-97-6", mesh_id: "D008628", ctd_name: "Mercury" },
  { chemical_name: "Manganese", hhear_code: "Mn", cas_number: "7439-96-5", mesh_id: "D008345", ctd_name: "Manganese" },
  { chemical_name: "Selenium", hhear_code: "Se", cas_number: "7782-49-2", mesh_id: "D012643", ctd_name: "Selenium" },
  { chemical_name: "Arsenic (total)", hhear_code: "As", cas_number: "7440-38-2", mesh_id: "D001151", ctd_name: "Arsenic" },
  { chemical_name: "Antimony", hhear_code: "Sb", cas_number: "7440-36-0", mesh_id: "D000965", ctd_name: "Antimony" },
  { chemical_name: "Barium", hhear_code: "Ba", cas_number: "7440-39-3", mesh_id: "D001464", ctd_name: "Barium" },
  { chemical_name: "Cobalt", hhear_code: "Co", cas_number: "7440-48-4", mesh_id: "D003035", ctd_name: "Cobalt" },
  { chemical_name: "Cesium", hhear_code: "Cs", cas_number: "7440-46-2", mesh_id: "D002588", ctd_name: "Cesium" },
  { chemical_name: "Molybdenum", hhear_code: "Mo", cas_number: "7439-98-7", mesh_id: "D008982", ctd_name: "Molybdenum" },
  { chemical_name: "Thallium", hhear_code: "Tl", cas_number: "7440-28-0", mesh_id: "D013793", ctd_name: "Thallium" },
  { chemical_name: "Tin", hhear_code: "Sn", cas_number: "7440-31-5", mesh_id: "D014001", ctd_name: "Tin" },
  { chemical_name: "Tungsten", hhear_code: "W", cas_number: "7440-33-7", mesh_id: "D014414", ctd_name: "Tungsten" },
  { chemical_name: "Uranium", hhear_code: "U", cas_number: "7440-61-1", mesh_id: "D014501", ctd_name: "Uranium" },

  // -- Phenols --
  { chemical_name: "Bisphenol A", hhear_code: "BPA", cas_number: "80-05-7", mesh_id: "C006780", ctd_name: "bisphenol A" },
  { chemical_name: "Bisphenol S", hhear_code: "BPS", cas_number: "80-09-1", mesh_id: "C543008", ctd_name: "4,4'-sulfonyldiphenol" },
  { chemical_name: "Bisphenol F", hhear_code: "BPF", cas_number: "620-92-8", mesh_id: "C543007", ctd_name: "4,4'-methylenediphenol" },
  { chemical_name: "Triclosan", hhear_code: "TCS", cas_number: "3380-34-5", mesh_id: "D014260", ctd_name: "Triclosan" },
  { chemical_name: "Benzophenone-3 (Oxybenzone)", hhear_code: "BP3", cas_number: "131-57-7", mesh_id: "C005290", ctd_name: "oxybenzone" },
  { chemical_name: "2,4-Dichlorophenol", hhear_code: "24DCP", cas_number: "120-83-2", mesh_id: "C007321", ctd_name: "2,4-dichlorophenol" },

  // -- Parabens --
  { chemical_name: "Methyl paraben", hhear_code: "MeP", cas_number: "99-76-3", mesh_id: "D019946", ctd_name: "Methylparaben" },
  { chemical_name: "Ethyl paraben", hhear_code: "EtP", cas_number: "120-47-8", mesh_id: "C005069", ctd_name: "ethylparaben" },
  { chemical_name: "Propyl paraben", hhear_code: "PrP", cas_number: "94-13-3", mesh_id: "D011427", ctd_name: "Propylparaben" },
  { chemical_name: "Butyl paraben", hhear_code: "BuP", cas_number: "94-26-8", mesh_id: "C038180", ctd_name: "butylparaben" },

  // -- Phthalate metabolites (mapped to parent compounds where available) --
  { chemical_name: "Mono(2-ethylhexyl) phthalate", hhear_code: "MEHP", cas_number: "4376-20-9", mesh_id: "C016599", ctd_name: "mono(2-ethylhexyl)phthalate" },
  { chemical_name: "Monoethyl phthalate", hhear_code: "MEP", cas_number: "2306-33-4", mesh_id: "C028577", ctd_name: "monoethylhexyl phthalate" },
  { chemical_name: "Mono-n-butyl phthalate", hhear_code: "MnBP", cas_number: "131-70-4", mesh_id: "C032279", ctd_name: "monobutyl phthalate" },

  // -- PFAS --
  { chemical_name: "Perfluorooctanoic acid", hhear_code: "PFOA", cas_number: "335-67-1", mesh_id: "C023036", ctd_name: "perfluorooctanoic acid" },
  { chemical_name: "Perfluorooctane sulfonic acid", hhear_code: "PFOS", cas_number: "1763-23-1", mesh_id: "C076994", ctd_name: "perfluorooctane sulfonic acid" },
  { chemical_name: "Perfluorononanoic acid", hhear_code: "PFNA", cas_number: "375-95-1", mesh_id: "C471071", ctd_name: "perfluorononanoic acid" },
  { chemical_name: "Perfluorodecanoic acid", hhear_code: "PFDA", cas_number: "335-76-2", mesh_id: "C101203", ctd_name: "perfluorodecanoic acid" },
  { chemical_name: "Perfluorohexane sulfonic acid", hhear_code: "PFHxS", cas_number: "355-46-4", mesh_id: "C471072", ctd_name: "perfluorohexanesulfonic acid" },

  // -- PAH metabolites --
  { chemical_name: "1-Hydroxypyrene", hhear_code: "1OHPYR", cas_number: "5315-79-7", mesh_id: "C032368", ctd_name: "1-hydroxypyrene" },
  { chemical_name: "1-Hydroxynaphthalene", hhear_code: "1NAP", cas_number: "90-15-3", mesh_id: "C025747", ctd_name: "1-naphthol" },
  { chemical_name: "2-Hydroxynaphthalene", hhear_code: "2NAP", cas_number: "135-19-3", mesh_id: "C031721", ctd_name: "2-naphthol" },

  // -- Flame retardants --
  { chemical_name: "2,2',4,4'-Tetrabromodiphenyl ether (BDE-47)", hhear_code: "BDE47", cas_number: "5436-43-1", mesh_id: "C511295", ctd_name: "4,4'-dibromodiphenyl ether" },

  // -- Smoking biomarkers --
  { chemical_name: "Cotinine", hhear_code: "COT", cas_number: "486-56-6", mesh_id: "D003367", ctd_name: "Cotinine" },

  // -- OP pesticide metabolites --
  { chemical_name: "Dimethylphosphate", hhear_code: "DMP", cas_number: "813-78-5", mesh_id: "C007547", ctd_name: "dimethyl phosphate" },
  { chemical_name: "Diethylphosphate", hhear_code: "DEP", cas_number: "598-02-7", mesh_id: "C007549", ctd_name: "diethyl phosphate" },
  { chemical_name: "Dimethylthiophosphate", hhear_code: "DMTP", cas_number: "756-80-9", mesh_id: "C023025", ctd_name: "dimethylthiophosphoric acid" },
  { chemical_name: "Diethylthiophosphate", hhear_code: "DETP", cas_number: "2465-65-8", mesh_id: "C009603", ctd_name: "diethylthiophosphoric acid" },
  { chemical_name: "Dimethylarsinic acid", hhear_code: "DMA", cas_number: "75-60-5", mesh_id: "C006046", ctd_name: "cacodylic acid" },
];

/** Set of all MeSH IDs for quick lookup / filtering */
export const CTD_MESH_IDS: Set<string> = new Set(
  CTD_CHEMICAL_MAP.map((c) => c.mesh_id)
);

/** CAS -> MeSH lookup */
export const CTD_CAS_TO_MESH: Map<string, string> = new Map(
  CTD_CHEMICAL_MAP.map((c) => [c.cas_number, c.mesh_id])
);

/** MeSH -> chemical entry lookup */
export const CTD_MESH_TO_ENTRY: Map<string, CTDChemicalEntry> = new Map(
  CTD_CHEMICAL_MAP.map((c) => [c.mesh_id, c])
);
