/**
 * HHEAR analyte code aliases: maps natural language names to analyte codes.
 * Based on Supplemental Table 2 from Lloyd, Tierney, Isaac et al.
 * and HHEAR README PDF analyte tables.
 *
 * When a value is an array, the term is ambiguous and requires clarification.
 */
export const HHEAR_ALIAS_MAP: Record<string, string | string[]> = {
  // ── Trace Elements ──
  lead: "Pb",
  "blood lead": "Pb",
  "urinary lead": "Pb",
  cadmium: "Cd",
  mercury: "Hg",
  arsenic: ["As", "iAs"],
  "inorganic arsenic": "iAs",
  "total arsenic": "As",
  arsenobetaine: "AsB",
  arsenocholine: "AsC",
  "dimethylarsinic acid": "DMA",
  DMA: "DMA",
  MMA: "MMA",
  manganese: "Mn",
  selenium: "Se",
  barium: "Ba",
  beryllium: "Be",
  cobalt: "Co",
  chromium: "Cr",
  cesium: "Cs",
  copper: "Cu",
  magnesium: "Mg",
  molybdenum: "Mo",
  tin: "Sn",
  antimony: "Sb",
  thallium: "Tl",
  uranium: "U",
  tungsten: "W",
  zinc: "Zn",
  aluminum: "Al",
  platinum: "Pt",
  iron: "Fe",

  // ── Phenols ──
  "bisphenol a": "BPA",
  "bisphenol f": "BPF",
  "bisphenol s": "BPS",
  bisphenol: ["BPA", "BPF", "BPS"],
  "benzophenone-3": "BP3",
  "benzophenone-1": "BP1",
  benzophenone: ["BP1", "BP3"],
  triclosan: "TCS",
  triclocarban: "TCC",
  "2,4-dichlorophenol": "DCP24",
  "2,5-dichlorophenol": "DCP25",
  dichlorophenol: ["DCP24", "DCP25"],

  // ── Parabens ──
  "butyl paraben": "BUPB",
  "ethyl paraben": "ETPB",
  "methyl paraben": "MEPB",
  "propyl paraben": "PRPB",
  paraben: ["BUPB", "ETPB", "MEPB", "PRPB"],
  parabens: ["BUPB", "ETPB", "MEPB", "PRPB"],

  // ── Phthalates ──
  "mono-ethylhexyl phthalate": "MEHP",
  MEHP: "MEHP",
  "mono(2-ethyl-5-hydroxyhexyl) phthalate": "MEHHP",
  MEHHP: "MEHHP",
  "mono(2-ethyl-5-carboxypentyl) phthalate": "MECPP",
  MECPP: "MECPP",
  "mono(2-ethyl-5-oxohexyl) phthalate": "MEOHP",
  MEOHP: "MEOHP",
  "mono-benzyl phthalate": "MBZP",
  MBZP: "MBZP",
  "monoethyl phthalate": "MEP",
  MEP: "MEP",
  "mono-isobutyl phthalate": "MIBP",
  MIBP: "MIBP",
  "mono-n-butyl phthalate": "MNBP",
  MNBP: "MNBP",
  "mono(3-carboxypropyl) phthalate": "MCPP",
  MCPP: "MCPP",
  phthalate: ["MEHP", "MEHHP", "MECPP", "MBZP", "MEP", "MIBP"],
  phthalates: ["MEHP", "MEHHP", "MECPP", "MBZP", "MEP", "MIBP"],

  // ── PFAS ──
  PFOA: "PFOA",
  "perfluorooctanoic acid": "PFOA",
  PFOS: "PFOS",
  "perfluorooctane sulfonic acid": "PFOS",
  PFNA: "PFNA",
  "perfluorononanoic acid": "PFNA",
  PFHXS: "PFHXS",
  "perfluorohexane sulfonic acid": "PFHXS",
  PFDA: "PFDA",
  "perfluorodecanoic acid": "PFDA",
  PFBS: "PFBS",
  PFBA: "PFBA",
  PFAS: ["PFOA", "PFOS", "PFNA", "PFHXS"],
  "perfluoroalkyl": ["PFOA", "PFOS", "PFNA", "PFHXS"],
  PFOSA: "PFOSA",
  PFUNDA: "PFUN",

  // ── PAH ──
  "1-hydroxynaphthalene": "NAP1",
  "2-hydroxynaphthalene": "NAP2",
  naphthalene: ["NAP1", "NAP2"],
  "1-hydroxypyrene": "PYR1",
  pyrene: "PYR1",
  fluorene: "FLUO",
  phenanthrene: "PHEN",
  PAH: ["NAP1", "NAP2", "PYR1", "FLUO", "PHEN"],

  // ── Flame Retardants (BDE/PBB) ──
  "BDE-47": "BDE47",
  "BDE-99": "BDE99",
  "BDE-100": "BDE100",
  "BDE-153": "BDE153",
  PBDE: ["BDE47", "BDE99", "BDE100", "BDE153"],
  "flame retardant": ["BDE47", "BDE99", "BDE100", "BDE153", "BDCPP"],

  // ── Smoking ──
  cotinine: "COTT",
  "total cotinine": "COTT",
  NNAL: "NNAL",
  nicotine: "COTT",
  smoking: ["COTT", "NNAL"],
  tobacco: ["COTT", "NNAL"],

  // ── Pesticides ──
  BDCPP: "BDCPP",
  "bis(1,3-dichloro-2-propyl) phosphate": "BDCPP",
  "organophosphate": ["DEP", "DETP", "DMP", "DMTP"],
  "dialkyl phosphate": ["DEP", "DETP", "DMP", "DMTP", "DEDP", "DMDP"],
  DAP: ["DEP", "DETP", "DMP", "DMTP"],
  glyphosate: "GPS",
  atrazine: "ATRAZ",
  imidacloprid: "IMPY",

  // ── Stress / Inflammation ──
  cortisol: "CORTL",
  cortisone: "CORTE",
  "C-reactive protein": "CRP",
  CRP: "CRP",
  interleukin: ["IL1B", "IL6", "IL10"],

  // ── Dilution markers ──
  creatinine: "CRE",
  "specific gravity": "SG",

  // ── Lipids ──
  cholesterol: "CHOL",
  triglycerides: "TG",
};

/**
 * Full chemical names for HHEAR analyte codes.
 * Used for display enrichment.
 */
export const HHEAR_ANALYTE_NAMES: Record<string, string> = {
  // Trace Elements
  Pb: "Lead",
  Cd: "Cadmium",
  Hg: "Mercury",
  As: "Arsenic (total)",
  iAs: "Inorganic Arsenic",
  AsB: "Arsenobetaine",
  AsC: "Arsenocholine",
  DMA: "Dimethylarsinic acid",
  MMA: "Monomethylarsonic acid",
  Mn: "Manganese",
  Se: "Selenium",
  Ba: "Barium",
  Be: "Beryllium",
  Co: "Cobalt",
  Cr: "Chromium",
  Cs: "Cesium",
  Cu: "Copper",
  Mg: "Magnesium",
  Mo: "Molybdenum",
  Sn: "Tin",
  Sb: "Antimony",
  Tl: "Thallium",
  U: "Uranium",
  W: "Tungsten",
  Zn: "Zinc",
  Al: "Aluminum",
  V: "Vanadium",
  Pt: "Platinum",
  Fe: "Iron",
  Ni: "Nickel",

  // Phenols
  BPA: "Bisphenol A",
  BPF: "Bisphenol F",
  BPS: "Bisphenol S",
  BPAF: "Bisphenol AF",
  BPAP: "Bisphenol AP",
  BPB: "Bisphenol B",
  BP1: "Benzophenone-1",
  BP2: "Benzophenone-2",
  BP3: "Benzophenone-3 (Oxybenzone)",
  BP8: "Benzophenone-8",
  TCS: "Triclosan",
  TCC: "Triclocarban",
  DCP24: "2,4-Dichlorophenol",
  DCP25: "2,5-Dichlorophenol",

  // Parabens
  BUPB: "Butyl paraben",
  ETPB: "Ethyl paraben",
  MEPB: "Methyl paraben",
  PRPB: "Propyl paraben",

  // Phthalates
  MEHP: "Mono-ethylhexyl phthalate",
  MEHHP: "Mono(2-ethyl-5-hydroxyhexyl) phthalate",
  MEHHTP: "Mono(2-ethyl-5-hydroxyhexyl) terephthalate",
  MECPP: "Mono(2-ethyl-5-carboxypentyl) phthalate",
  MECPTP: "Mono(2-ethyl-5-carboxypentyl) terephthalate",
  MEOHP: "Mono(2-ethyl-5-oxohexyl) phthalate",
  MBZP: "Mono-benzyl phthalate",
  MEP: "Monoethyl phthalate",
  MIBP: "Mono-isobutyl phthalate",
  MNBP: "Mono-n-butyl phthalate",
  MCPP: "Mono(3-carboxypropyl) phthalate",
  MCOP: "Mono-carboxyoctyl phthalate",
  MCOCH: "Mono-carboxyoctyl cyclohexane",
  MCINP: "Mono-carboxy-isononyl phthalate",
  MCIOP: "Mono-carboxy-isooctyl phthalate",
  MCMH: "Mono-cyclohexyl-methyl-hexyl phthalate",
  MEHH: "Mono-ethyl-hydroxyhexyl phthalate",
  MEOH: "Mono-ethyl-oxohexyl phthalate",

  // PFAS
  PFOA: "Perfluorooctanoic acid",
  PFOS: "Perfluorooctane sulfonic acid",
  PFNA: "Perfluorononanoic acid",
  PFHXS: "Perfluorohexane sulfonic acid",
  PFDA: "Perfluorodecanoic acid",
  PFBS: "Perfluorobutane sulfonic acid",
  PFBA: "Perfluorobutanoic acid",
  PFHXA: "Perfluorohexanoic acid",
  PFHPA: "Perfluoroheptanoic acid",
  PFHPS: "Perfluoroheptane sulfonic acid",
  PFHP: "Perfluoroheptanoic acid",
  PFHX: "Perfluorohexanoic acid",
  PFOSA: "Perfluorooctane sulfonamide",
  PFPEA: "Perfluoropentanoic acid",
  PFUN: "Perfluoroundecanoic acid",
  PFHp: "Perfluoroheptanoic acid",
  NETFOSAA: "N-ethyl perfluorooctane sulfonamido acetic acid",
  NMFOSAA: "N-methyl perfluorooctane sulfonamido acetic acid",
  ETFOSA: "N-ethyl perfluorooctane sulfonamide",

  // PAH
  NAP1: "1-Hydroxynaphthalene",
  NAP2: "2-Hydroxynaphthalene",
  PYR1: "1-Hydroxypyrene",
  FLUO: "Fluorene",
  PHEN: "Phenanthrene",
  ACE: "Acenaphthene",
  ACEN: "Acenaphthylene",
  ACENY: "Acenaphthylene",
  ANTH: "Anthracene",
  BAP: "Benzo[a]pyrene",
  BBF: "Benzo[b]fluoranthene",
  BENZAANTH: "Benz[a]anthracene",

  // Flame Retardants
  BDE47: "2,2',4,4'-Tetrabromodiphenyl ether",
  BDE99: "2,2',4,4',5-Pentabromodiphenyl ether",
  BDE100: "2,2',4,4',6-Pentabromodiphenyl ether",
  BDE153: "2,2',4,4',5,5'-Hexabromodiphenyl ether",
  BDE154: "2,2',4,4',5,6'-Hexabromodiphenyl ether",
  BDE183: "2,2',3,4,4',5',6-Heptabromodiphenyl ether",
  BDE28: "2,4,4'-Tribromodiphenyl ether",
  BDE85: "2,2',3,4,4'-Pentabromodiphenyl ether",
  BDCPP: "Bis(1,3-dichloro-2-propyl) phosphate",
  PBB1: "Polybrominated biphenyl",
  BHCH: "Beta-hexachlorocyclohexane",
  HCB: "Hexachlorobenzene",

  // Smoking
  COTT: "Cotinine (total)",
  COT: "Cotinine",
  HCOTT: "Hydroxycotinine",
  NNAL: "4-(Methylnitrosamino)-1-(3-pyridyl)-1-butanol",

  // Pesticides
  ATRAZ: "Atrazine",
  AZOXY: "Azoxystrobin",
  GPS: "Glyphosate",
  IMPY: "Imidacloprid",
  ETU: "Ethylene thiourea",
  PTU: "Propylene thiourea",
  AMPA: "Aminomethylphosphonic acid",
  D24: "2,4-D",
  FPBA: "3-Fluoro-3-phenylbenzoic acid",
  DEDP: "Diethyldithiophosphate",
  DEP: "Diethylphosphate",
  DETP: "Diethylthiophosphate",
  DMDP: "Dimethyldithiophosphate",
  DMP: "Dimethylphosphate",
  DMTP: "Dimethylthiophosphate",

  // Stress & Inflammation
  CORTL: "Cortisol",
  CORTE: "Cortisone",
  CRP: "C-reactive protein",
  IL1B: "Interleukin-1β",
  IL6: "Interleukin-6",
  IL10: "Interleukin-10",

  // Oxidative Stress
  OS8O: "8-oxo-deoxyguanosine",
  OSMD: "Malondialdehyde",
  F2A8IP: "8-iso-Prostaglandin F2α",
  F2A12I: "8,12-iso-Isoprostane F2α-VI",
  F2A23D: "2,3-dinor-8-iso-Prostaglandin F2α",
  F2AVI: "Isoprostane F2α-VI",

  // VOCs
  HMPMA: "N-Acetyl-S-(3-hydroxypropyl)-L-cysteine",
  CYMA: "N-Acetyl-S-(2-cyanoethyl)-L-cysteine",
  CINA6: "trans,trans-Muconic acid",

  // Dilution
  CRE: "Creatinine",
  SG: "Specific gravity",

  // Lipids
  CHOL: "Cholesterol",
  TG: "Triglycerides",

  // Immune
  FLT3L: "FMS-like tyrosine kinase 3 ligand",
  GMCSF: "Granulocyte-macrophage colony-stimulating factor",
  HAPTOGLOBIN: "Haptoglobin",
};
