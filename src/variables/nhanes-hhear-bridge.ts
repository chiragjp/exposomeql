/**
 * NHANES ↔ HHEAR variable bridge: maps HHEAR analyte codes to NHANES variable codes.
 * Includes matrix type (blood/urine/serum), units, and notes on comparability.
 */

export interface BridgeEntry {
  /** HHEAR analyte code (e.g., "Pb") */
  hhear_code: string;
  /** Full chemical name */
  chemical_name: string;
  /** NHANES variable code(s) for the same or comparable analyte */
  nhanes_codes: NhanesMapping[];
}

export interface NhanesMapping {
  /** NHANES variable code (e.g., "LBXBPB") */
  code: string;
  /** Description */
  description: string;
  /** Sample matrix: blood, urine, serum, plasma */
  matrix: string;
  /** Typical units in NHANES */
  units: string;
  /** NHANES cycles where this variable is available */
  cycles?: string;
  /** Notes on comparability */
  note?: string;
}

export const NHANES_HHEAR_BRIDGE: BridgeEntry[] = [
  // ── Trace Elements ──
  {
    hhear_code: "Pb",
    chemical_name: "Lead",
    nhanes_codes: [
      { code: "LBXBPB", description: "Blood lead", matrix: "blood", units: "µg/dL", cycles: "A-J" },
      { code: "URXUPB", description: "Urinary lead", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Cd",
    chemical_name: "Cadmium",
    nhanes_codes: [
      { code: "LBXBCD", description: "Blood cadmium", matrix: "blood", units: "µg/L", cycles: "A-J" },
      { code: "URXUCD", description: "Urinary cadmium", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Hg",
    chemical_name: "Mercury",
    nhanes_codes: [
      { code: "LBXTHG", description: "Blood total mercury", matrix: "blood", units: "µg/L", cycles: "A-J" },
      { code: "LBXIHG", description: "Blood inorganic mercury", matrix: "blood", units: "µg/L", cycles: "C-J" },
      { code: "URXUHG", description: "Urinary mercury", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "As",
    chemical_name: "Arsenic (total)",
    nhanes_codes: [
      { code: "URXUAS", description: "Urinary total arsenic", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "iAs",
    chemical_name: "Inorganic Arsenic",
    nhanes_codes: [
      { code: "URXUAS3", description: "Urinary arsenous acid", matrix: "urine", units: "µg/L", cycles: "A-J" },
      { code: "URXUAS5", description: "Urinary arsenic acid", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "DMA",
    chemical_name: "Dimethylarsinic acid",
    nhanes_codes: [
      { code: "URXUDMA", description: "Urinary dimethylarsinic acid", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Mn",
    chemical_name: "Manganese",
    nhanes_codes: [
      { code: "LBXBMN", description: "Blood manganese", matrix: "blood", units: "µg/L", cycles: "E-J" },
    ],
  },
  {
    hhear_code: "Se",
    chemical_name: "Selenium",
    nhanes_codes: [
      { code: "LBXBSE", description: "Blood selenium", matrix: "blood", units: "µg/L", cycles: "E-J" },
    ],
  },
  {
    hhear_code: "Ba",
    chemical_name: "Barium",
    nhanes_codes: [
      { code: "URXUBA", description: "Urinary barium", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Co",
    chemical_name: "Cobalt",
    nhanes_codes: [
      { code: "URXUCO", description: "Urinary cobalt", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Cs",
    chemical_name: "Cesium",
    nhanes_codes: [
      { code: "URXUCS", description: "Urinary cesium", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Mo",
    chemical_name: "Molybdenum",
    nhanes_codes: [
      { code: "URXUMO", description: "Urinary molybdenum", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Sb",
    chemical_name: "Antimony",
    nhanes_codes: [
      { code: "URXUSB", description: "Urinary antimony", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Tl",
    chemical_name: "Thallium",
    nhanes_codes: [
      { code: "URXUTL", description: "Urinary thallium", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "W",
    chemical_name: "Tungsten",
    nhanes_codes: [
      { code: "URXUTW", description: "Urinary tungsten", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "U",
    chemical_name: "Uranium",
    nhanes_codes: [
      { code: "URXUUR", description: "Urinary uranium", matrix: "urine", units: "µg/L", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "Sn",
    chemical_name: "Tin",
    nhanes_codes: [
      { code: "URXUSN", description: "Urinary tin", matrix: "urine", units: "µg/L", cycles: "H-J", note: "Available from 2013-2014 onward" },
    ],
  },

  // ── Phenols ──
  {
    hhear_code: "BPA",
    chemical_name: "Bisphenol A",
    nhanes_codes: [
      { code: "URXBPH", description: "Urinary bisphenol A", matrix: "urine", units: "ng/mL", cycles: "C-I", note: "Discontinued after 2015-2016" },
    ],
  },
  {
    hhear_code: "BPF",
    chemical_name: "Bisphenol F",
    nhanes_codes: [
      { code: "URXBPF", description: "Urinary bisphenol F", matrix: "urine", units: "ng/mL", cycles: "H-I" },
    ],
  },
  {
    hhear_code: "BPS",
    chemical_name: "Bisphenol S",
    nhanes_codes: [
      { code: "URXBPS", description: "Urinary bisphenol S", matrix: "urine", units: "ng/mL", cycles: "H-I" },
    ],
  },
  {
    hhear_code: "TCS",
    chemical_name: "Triclosan",
    nhanes_codes: [
      { code: "URXTRS", description: "Urinary triclosan", matrix: "urine", units: "ng/mL", cycles: "C-I" },
    ],
  },
  {
    hhear_code: "BP3",
    chemical_name: "Benzophenone-3 (Oxybenzone)",
    nhanes_codes: [
      { code: "URXBP3", description: "Urinary benzophenone-3", matrix: "urine", units: "ng/mL", cycles: "C-I" },
    ],
  },
  {
    hhear_code: "DCP24",
    chemical_name: "2,4-Dichlorophenol",
    nhanes_codes: [
      { code: "URXDCB", description: "Urinary 2,4-dichlorophenol", matrix: "urine", units: "ng/mL", cycles: "C-I" },
    ],
  },
  {
    hhear_code: "DCP25",
    chemical_name: "2,5-Dichlorophenol",
    nhanes_codes: [
      { code: "URX14D", description: "Urinary 2,5-dichlorophenol", matrix: "urine", units: "ng/mL", cycles: "C-I" },
    ],
  },

  // ── Parabens ──
  {
    hhear_code: "BUPB",
    chemical_name: "Butyl paraben",
    nhanes_codes: [
      { code: "URXBUP", description: "Urinary butyl paraben", matrix: "urine", units: "ng/mL", cycles: "E-I" },
    ],
  },
  {
    hhear_code: "ETPB",
    chemical_name: "Ethyl paraben",
    nhanes_codes: [
      { code: "URXEPB", description: "Urinary ethyl paraben", matrix: "urine", units: "ng/mL", cycles: "E-I" },
    ],
  },
  {
    hhear_code: "MEPB",
    chemical_name: "Methyl paraben",
    nhanes_codes: [
      { code: "URXMPB", description: "Urinary methyl paraben", matrix: "urine", units: "ng/mL", cycles: "E-I" },
    ],
  },
  {
    hhear_code: "PRPB",
    chemical_name: "Propyl paraben",
    nhanes_codes: [
      { code: "URXPPB", description: "Urinary propyl paraben", matrix: "urine", units: "ng/mL", cycles: "E-I" },
    ],
  },

  // ── Phthalates ──
  {
    hhear_code: "MEHP",
    chemical_name: "Mono-ethylhexyl phthalate",
    nhanes_codes: [
      { code: "URXMHP", description: "Urinary MEHP", matrix: "urine", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "MEHHP",
    chemical_name: "Mono(2-ethyl-5-hydroxyhexyl) phthalate",
    nhanes_codes: [
      { code: "URXMHH", description: "Urinary MEHHP", matrix: "urine", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "MECPP",
    chemical_name: "Mono(2-ethyl-5-carboxypentyl) phthalate",
    nhanes_codes: [
      { code: "URXMCP", description: "Urinary MECPP", matrix: "urine", units: "ng/mL", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "MEOHP",
    chemical_name: "Mono(2-ethyl-5-oxohexyl) phthalate",
    nhanes_codes: [
      { code: "URXMOH", description: "Urinary MEOHP", matrix: "urine", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "MBZP",
    chemical_name: "Mono-benzyl phthalate",
    nhanes_codes: [
      { code: "URXMBP", description: "Urinary MBzP", matrix: "urine", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "MEP",
    chemical_name: "Monoethyl phthalate",
    nhanes_codes: [
      { code: "URXMEP", description: "Urinary MEP", matrix: "urine", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "MIBP",
    chemical_name: "Mono-isobutyl phthalate",
    nhanes_codes: [
      { code: "URXMIB", description: "Urinary MiBP", matrix: "urine", units: "ng/mL", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "MNBP",
    chemical_name: "Mono-n-butyl phthalate",
    nhanes_codes: [
      { code: "URXMNB", description: "Urinary MnBP", matrix: "urine", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "MCPP",
    chemical_name: "Mono(3-carboxypropyl) phthalate",
    nhanes_codes: [
      { code: "URXMC1", description: "Urinary MCPP", matrix: "urine", units: "ng/mL", cycles: "C-J" },
    ],
  },

  // ── PFAS ──
  {
    hhear_code: "PFOA",
    chemical_name: "Perfluorooctanoic acid",
    nhanes_codes: [
      { code: "LBXPFOA", description: "Serum PFOA", matrix: "serum", units: "ng/mL", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "PFOS",
    chemical_name: "Perfluorooctane sulfonic acid",
    nhanes_codes: [
      { code: "LBXPFOS", description: "Serum PFOS", matrix: "serum", units: "ng/mL", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "PFNA",
    chemical_name: "Perfluorononanoic acid",
    nhanes_codes: [
      { code: "LBXPFNA", description: "Serum PFNA", matrix: "serum", units: "ng/mL", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "PFHXS",
    chemical_name: "Perfluorohexane sulfonic acid",
    nhanes_codes: [
      { code: "LBXPFHS", description: "Serum PFHxS", matrix: "serum", units: "ng/mL", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "PFDA",
    chemical_name: "Perfluorodecanoic acid",
    nhanes_codes: [
      { code: "LBXPFDE", description: "Serum PFDA", matrix: "serum", units: "ng/mL", cycles: "C-J" },
    ],
  },

  // ── PAH ──
  {
    hhear_code: "PYR1",
    chemical_name: "1-Hydroxypyrene",
    nhanes_codes: [
      { code: "URXP01", description: "Urinary 1-hydroxypyrene", matrix: "urine", units: "ng/L", cycles: "C-J" },
    ],
  },
  {
    hhear_code: "NAP1",
    chemical_name: "1-Hydroxynaphthalene",
    nhanes_codes: [
      { code: "URXP01", description: "Urinary 1-hydroxynaphthalene", matrix: "urine", units: "ng/L", cycles: "C-J", note: "Check NHANES variable naming for specific PAH metabolites" },
    ],
  },
  {
    hhear_code: "NAP2",
    chemical_name: "2-Hydroxynaphthalene",
    nhanes_codes: [
      { code: "URXP02", description: "Urinary 2-hydroxynaphthalene", matrix: "urine", units: "ng/L", cycles: "C-J" },
    ],
  },

  // ── Flame Retardants ──
  {
    hhear_code: "BDE47",
    chemical_name: "2,2',4,4'-Tetrabromodiphenyl ether",
    nhanes_codes: [
      { code: "LBXBR2", description: "Serum BDE-47", matrix: "serum", units: "ng/g lipid", cycles: "C-J" },
    ],
  },

  // ── Smoking ──
  {
    hhear_code: "COTT",
    chemical_name: "Cotinine (total)",
    nhanes_codes: [
      { code: "LBXCOT", description: "Serum cotinine", matrix: "serum", units: "ng/mL", cycles: "A-J" },
    ],
  },
  {
    hhear_code: "NNAL",
    chemical_name: "4-(Methylnitrosamino)-1-(3-pyridyl)-1-butanol",
    nhanes_codes: [
      { code: "URXNNAL", description: "Urinary NNAL", matrix: "urine", units: "pg/mL", cycles: "E-J" },
    ],
  },

  // ── Pesticides ──
  {
    hhear_code: "DEP",
    chemical_name: "Diethylphosphate",
    nhanes_codes: [
      { code: "URXDEP", description: "Urinary DEP", matrix: "urine", units: "µg/L", cycles: "A-I" },
    ],
  },
  {
    hhear_code: "DETP",
    chemical_name: "Diethylthiophosphate",
    nhanes_codes: [
      { code: "URXDET", description: "Urinary DETP", matrix: "urine", units: "µg/L", cycles: "A-I" },
    ],
  },
  {
    hhear_code: "DMP",
    chemical_name: "Dimethylphosphate",
    nhanes_codes: [
      { code: "URXDMP", description: "Urinary DMP", matrix: "urine", units: "µg/L", cycles: "A-I" },
    ],
  },
  {
    hhear_code: "DMTP",
    chemical_name: "Dimethylthiophosphate",
    nhanes_codes: [
      { code: "URXDMT", description: "Urinary DMTP", matrix: "urine", units: "µg/L", cycles: "A-I" },
    ],
  },

  // ── Dilution ──
  {
    hhear_code: "CRE",
    chemical_name: "Creatinine",
    nhanes_codes: [
      { code: "URXUCR", description: "Urinary creatinine", matrix: "urine", units: "mg/dL", cycles: "A-J" },
    ],
  },
];

/** Build a quick lookup map from HHEAR code to bridge entry */
export const BRIDGE_BY_HHEAR: Map<string, BridgeEntry> = new Map(
  NHANES_HHEAR_BRIDGE.map((e) => [e.hhear_code, e])
);

/** Build a reverse lookup: NHANES code → HHEAR code(s) */
export const BRIDGE_BY_NHANES: Map<string, BridgeEntry[]> = (() => {
  const map = new Map<string, BridgeEntry[]>();
  for (const entry of NHANES_HHEAR_BRIDGE) {
    for (const nm of entry.nhanes_codes) {
      if (!map.has(nm.code)) map.set(nm.code, []);
      map.get(nm.code)!.push(entry);
    }
  }
  return map;
})();
