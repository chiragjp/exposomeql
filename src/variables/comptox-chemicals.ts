/**
 * CompTox chemical identity and toxicological profiles for NHANES/HHEAR chemicals.
 * Data sourced from EPA CompTox Chemicals Dashboard (https://comptox.epa.gov/dashboard/).
 * Covers all ~70 chemicals in the NHANES↔HHEAR bridge.
 */

export interface BiomarkerThreshold {
  /** Biological matrix: "blood", "urine", "serum" */
  matrix: string;
  /** NHANES variable code for this measurement */
  nhanes_variable: string;
  /** Measurement units matching NHANES data (e.g., "µg/dL") */
  units: string;
  /** Numeric threshold value */
  reference_value: number;
  /** Authoritative source (e.g., "CDC Blood Lead Reference Value (2021)") */
  reference_source: string;
  /** Severity level: "concern", "action", or "clinical" */
  level: string;
  /** Human-readable description of what this threshold means */
  description: string;
  /** Target population (e.g., "children <6"). Undefined = general population. */
  population?: string;
}

export interface ToxCastOverlap {
  /** Whether this chemical is in the ToxCast/Tox21 screening library */
  in_toxcast: boolean;
  /** Quality of ToxCast data for this chemical */
  data_quality: "excellent" | "good" | "moderate" | "poor" | "indirect" | "not_applicable" | "unknown";
  /** Key active assay endpoints or pathway targets identified */
  key_endpoints?: string[];
  /** Brief explanation of ToxCast status */
  summary: string;
}

export interface ChemicalProfile {
  /** HHEAR analyte code (e.g., "Pb") */
  hhear_code: string;
  /** Full chemical name */
  chemical_name: string;
  /** CAS Registry Number */
  cas_number: string;
  /** EPA DSSTox Substance Identifier */
  dtxsid: string;
  /** Molecular formula */
  molecular_formula?: string;
  /** Chemical category/class */
  category: string;
  /** Toxicity classification */
  toxicity_class?: string;
  /** Key regulatory notes */
  regulatory_notes?: string;
  /** Primary exposure routes */
  exposure_routes?: string[];
  /** Target organs/systems */
  target_organs?: string[];
  /** Biological half-life */
  half_life?: string;
  /** Structured biomarker reference thresholds from authoritative sources */
  biomarker_thresholds?: BiomarkerThreshold[];
  /** EPA ToxCast/Tox21 high-throughput screening overlap status */
  toxcast?: ToxCastOverlap;
}

export const COMPTOX_CHEMICALS: ChemicalProfile[] = [
  // ── Trace Elements / Metals ──
  {
    hhear_code: "Pb",
    chemical_name: "Lead",
    cas_number: "7439-92-1",
    dtxsid: "DTXSID3021573",
    molecular_formula: "Pb",
    category: "Metal",
    toxicity_class: "IARC Group 2B probable carcinogen",
    regulatory_notes: "CDC reference value 3.5 µg/dL (children). No safe blood level established. EPA MCL 15 µg/L (action level).",
    exposure_routes: ["ingestion", "inhalation", "dermal"],
    target_organs: ["nervous system", "kidney", "blood", "bone", "reproductive system"],
    half_life: "~30 days (blood), 10-30 years (bone)",
    biomarker_thresholds: [
      { matrix: "blood", nhanes_variable: "LBXBPB", units: "µg/dL", reference_value: 3.5, reference_source: "CDC Blood Lead Reference Value (2021)", level: "concern", description: "97.5th percentile of US children ages 1-5", population: "children <6" },
      { matrix: "blood", nhanes_variable: "LBXBPB", units: "µg/dL", reference_value: 5, reference_source: "CDC/NIOSH Adult Blood Lead Reference Value", level: "action", description: "CDC reference value for adults; NIOSH medical monitoring threshold", population: "adults" },
      { matrix: "blood", nhanes_variable: "LBXBPB", units: "µg/dL", reference_value: 10, reference_source: "WHO Clinical Action Level", level: "clinical", description: "WHO clinical intervention threshold for children" },
    ],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Present in ToxCast library but metals cause non-specific, promiscuous activity across HTS assays; mechanistic interpretation unreliable" },
  },
  {
    hhear_code: "Cd",
    chemical_name: "Cadmium",
    cas_number: "7440-43-9",
    dtxsid: "DTXSID7020195",
    molecular_formula: "Cd",
    category: "Metal",
    toxicity_class: "IARC Group 1 carcinogen (lung)",
    regulatory_notes: "OSHA PEL 5 µg/m³. EPA MCL 5 µg/L. ATSDR MRL 0.1 µg/kg/day (oral, chronic).",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["kidney", "lung", "bone", "liver"],
    half_life: "10-30 years (kidney cortex), ~75 days (blood)",
    biomarker_thresholds: [
      { matrix: "blood", nhanes_variable: "LBXBCD", units: "µg/L", reference_value: 1.0, reference_source: "German HBM-I (2011)", level: "concern", description: "HBM-I: no adverse health effects expected below this level" },
      { matrix: "blood", nhanes_variable: "LBXBCD", units: "µg/L", reference_value: 4.0, reference_source: "German HBM-II (2011)", level: "action", description: "HBM-II: increased risk of adverse health effects above this level" },
      { matrix: "urine", nhanes_variable: "URXUCD", units: "µg/L", reference_value: 0.8, reference_source: "German HBM-I (2011)", level: "concern", description: "HBM-I for urinary cadmium; no adverse effects expected below" },
    ],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Present in ToxCast but non-specific metal interference limits interpretability of HTS results" },
  },
  {
    hhear_code: "Hg",
    chemical_name: "Mercury (total)",
    cas_number: "7439-97-6",
    dtxsid: "DTXSID3024173",
    molecular_formula: "Hg",
    category: "Metal",
    toxicity_class: "IARC Group 3 (elemental/inorganic); methylmercury is IARC Group 2B",
    regulatory_notes: "EPA RfD 0.1 µg/kg/day (methylmercury). FDA action level 1 ppm in fish.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["nervous system", "kidney", "immune system"],
    half_life: "~70 days (methylmercury in blood)",
    biomarker_thresholds: [
      { matrix: "blood", nhanes_variable: "LBXTHG", units: "µg/L", reference_value: 2.0, reference_source: "German HBM-I (1999)", level: "concern", description: "HBM-I for total mercury in blood; no adverse effects expected below" },
      { matrix: "blood", nhanes_variable: "LBXTHG", units: "µg/L", reference_value: 5.0, reference_source: "German HBM-II (1999)", level: "action", description: "HBM-II: increased risk of adverse health effects above this level" },
      { matrix: "urine", nhanes_variable: "URXUHG", units: "µg/L", reference_value: 1.0, reference_source: "German HBM-I (1999)", level: "concern", description: "HBM-I for urinary mercury (inorganic)" },
      { matrix: "urine", nhanes_variable: "URXUHG", units: "µg/L", reference_value: 5.0, reference_source: "German HBM-II (1999)", level: "action", description: "HBM-II for urinary mercury (inorganic)" },
    ],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Present in ToxCast but non-specific cytotoxicity from metals confounds mechanistic interpretation" },
  },
  {
    hhear_code: "As",
    chemical_name: "Arsenic (total)",
    cas_number: "7440-38-2",
    dtxsid: "DTXSID4023886",
    molecular_formula: "As",
    category: "Metalloid",
    toxicity_class: "IARC Group 1 carcinogen (lung, skin, bladder)",
    regulatory_notes: "EPA MCL 10 µg/L. WHO guideline 10 µg/L drinking water.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["skin", "lung", "bladder", "liver", "cardiovascular system"],
    half_life: "~4 days (inorganic arsenic)",
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Present in ToxCast but inorganic metal species show non-specific assay activity" },
  },
  {
    hhear_code: "iAs",
    chemical_name: "Inorganic Arsenic",
    cas_number: "7440-38-2",
    dtxsid: "DTXSID4023886",
    molecular_formula: "As",
    category: "Metalloid",
    toxicity_class: "IARC Group 1 carcinogen",
    regulatory_notes: "Sum of arsenous acid (As III) and arsenic acid (As V). Biomarker of non-dietary inorganic arsenic exposure.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["skin", "lung", "bladder", "liver"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Inorganic arsenic species show non-specific activity in HTS assays" },
  },
  {
    hhear_code: "DMA",
    chemical_name: "Dimethylarsinic acid",
    cas_number: "75-60-5",
    dtxsid: "DTXSID2020509",
    molecular_formula: "C2H7AsO2",
    category: "Organoarsenic",
    toxicity_class: "IARC Group 2B possible carcinogen",
    regulatory_notes: "Major urinary metabolite of inorganic arsenic. Used as biomarker of arsenic metabolism.",
    exposure_routes: ["ingestion"],
    target_organs: ["bladder", "kidney"],
    toxcast: { in_toxcast: false, data_quality: "unknown", summary: "Organoarsenic metabolite; uncertain whether tested in ToxCast" },
  },
  {
    hhear_code: "Mn",
    chemical_name: "Manganese",
    cas_number: "7439-96-5",
    dtxsid: "DTXSID2024169",
    molecular_formula: "Mn",
    category: "Metal",
    toxicity_class: "Essential trace element; neurotoxic at high levels",
    regulatory_notes: "EPA MCL 0.05 mg/L (secondary). OSHA PEL 5 mg/m³ (ceiling). EPA RfD 0.14 mg/kg/day.",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["nervous system", "respiratory system"],
    half_life: "~40 days (blood)",
    biomarker_thresholds: [
      { matrix: "blood", nhanes_variable: "LBXBMN", units: "µg/L", reference_value: 15, reference_source: "Literature review (Zheng et al., 2011)", level: "concern", description: "Blood manganese level associated with neurobehavioral effects in occupational studies" },
    ],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Present in ToxCast but metal interference limits mechanistic interpretation" },
  },
  {
    hhear_code: "Se",
    chemical_name: "Selenium",
    cas_number: "7782-49-2",
    dtxsid: "DTXSID1024299",
    molecular_formula: "Se",
    category: "Metalloid",
    toxicity_class: "Essential trace element; toxic at high doses",
    regulatory_notes: "EPA MCL 50 µg/L. RDA 55 µg/day (adults). UL 400 µg/day.",
    exposure_routes: ["ingestion"],
    target_organs: ["liver", "hair", "nails", "skin"],
    half_life: "~100 days (whole body)",
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Essential trace element; non-specific metal activity in HTS assays" },
  },
  {
    hhear_code: "Ba",
    chemical_name: "Barium",
    cas_number: "7440-39-3",
    dtxsid: "DTXSID5023870",
    molecular_formula: "Ba",
    category: "Metal",
    regulatory_notes: "EPA MCL 2 mg/L.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["cardiovascular system", "kidney", "gastrointestinal tract"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },
  {
    hhear_code: "Co",
    chemical_name: "Cobalt",
    cas_number: "7440-48-4",
    dtxsid: "DTXSID2024063",
    molecular_formula: "Co",
    category: "Metal",
    toxicity_class: "IARC Group 2B possible carcinogen (cobalt compounds)",
    regulatory_notes: "OSHA PEL 0.1 mg/m³.",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["heart", "lung", "thyroid"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },
  {
    hhear_code: "Cs",
    chemical_name: "Cesium",
    cas_number: "7440-46-2",
    dtxsid: "DTXSID1024061",
    molecular_formula: "Cs",
    category: "Metal",
    regulatory_notes: "No EPA MCL. Urinary cesium used as biomarker of dietary exposure.",
    exposure_routes: ["ingestion"],
    target_organs: ["kidney"],
    half_life: "~70 days",
    toxcast: { in_toxcast: false, data_quality: "unknown", summary: "Not confirmed in ToxCast screening library" },
  },
  {
    hhear_code: "Mo",
    chemical_name: "Molybdenum",
    cas_number: "7439-98-7",
    dtxsid: "DTXSID6024195",
    molecular_formula: "Mo",
    category: "Metal",
    regulatory_notes: "Essential trace element. RDA 45 µg/day. UL 2 mg/day. EPA lifetime HA 40 µg/L.",
    exposure_routes: ["ingestion"],
    target_organs: ["liver", "kidney"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },
  {
    hhear_code: "Sb",
    chemical_name: "Antimony",
    cas_number: "7440-36-0",
    dtxsid: "DTXSID1023868",
    molecular_formula: "Sb",
    category: "Metalloid",
    toxicity_class: "IARC Group 2B possible carcinogen (antimony trioxide)",
    regulatory_notes: "EPA MCL 6 µg/L.",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["heart", "lung", "liver"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },
  {
    hhear_code: "Tl",
    chemical_name: "Thallium",
    cas_number: "7440-28-0",
    dtxsid: "DTXSID5024339",
    molecular_formula: "Tl",
    category: "Metal",
    regulatory_notes: "EPA MCL 2 µg/L. Highly toxic.",
    exposure_routes: ["ingestion", "inhalation", "dermal"],
    target_organs: ["nervous system", "cardiovascular system", "kidney", "gastrointestinal tract"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },
  {
    hhear_code: "W",
    chemical_name: "Tungsten",
    cas_number: "7440-33-7",
    dtxsid: "DTXSID5024362",
    molecular_formula: "W",
    category: "Metal",
    regulatory_notes: "No EPA MCL. Emerging contaminant of concern.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["respiratory system"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },
  {
    hhear_code: "U",
    chemical_name: "Uranium",
    cas_number: "7440-61-1",
    dtxsid: "DTXSID1024367",
    molecular_formula: "U",
    category: "Metal",
    toxicity_class: "IARC Group 1 (as depleted uranium internalized)",
    regulatory_notes: "EPA MCL 30 µg/L. WHO guideline 30 µg/L.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["kidney", "bone"],
    half_life: "~15 days (blood), years (bone)",
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Radioactive metal with non-specific HTS activity" },
  },
  {
    hhear_code: "Sn",
    chemical_name: "Tin",
    cas_number: "7440-31-5",
    dtxsid: "DTXSID4024345",
    molecular_formula: "Sn",
    category: "Metal",
    regulatory_notes: "No EPA MCL for inorganic tin. WHO PTWI 14 mg/kg/week (inorganic).",
    exposure_routes: ["ingestion"],
    target_organs: ["gastrointestinal tract"],
    toxcast: { in_toxcast: true, data_quality: "poor", summary: "Metal with non-specific HTS activity" },
  },

  // ── Phenols / BPA ──
  {
    hhear_code: "BPA",
    chemical_name: "Bisphenol A",
    cas_number: "80-05-7",
    dtxsid: "DTXSID7020182",
    molecular_formula: "C15H16O2",
    category: "Phenol",
    toxicity_class: "Endocrine disruptor. IARC not classified.",
    regulatory_notes: "FDA banned from baby bottles/sippy cups (2012). EFSA TDI 0.2 ng/kg/day (2023 reassessment). EPA reference dose under review.",
    exposure_routes: ["ingestion", "dermal"],
    target_organs: ["endocrine system", "reproductive system", "nervous system", "metabolic system"],
    half_life: "~6 hours",
    biomarker_thresholds: [
      { matrix: "urine", nhanes_variable: "URXBPH", units: "µg/L", reference_value: 100, reference_source: "German HBM-I (2012)", level: "concern", description: "HBM-I for urinary BPA; no adverse effects expected below", population: "children" },
      { matrix: "urine", nhanes_variable: "URXBPH", units: "µg/L", reference_value: 200, reference_source: "German HBM-I (2012)", level: "concern", description: "HBM-I for urinary BPA in adults", population: "adults" },
    ],
    toxcast: { in_toxcast: true, data_quality: "excellent", key_endpoints: ["estrogen receptor agonist", "androgen receptor antagonist", "aromatase", "thyroid peroxidase"], summary: "One of the most extensively tested ToxCast chemicals; reference compound for endocrine disruption screening across hundreds of assays" },
  },
  {
    hhear_code: "BPF",
    chemical_name: "Bisphenol F",
    cas_number: "620-92-8",
    dtxsid: "DTXSID2022442",
    molecular_formula: "C13H12O2",
    category: "Phenol",
    toxicity_class: "Endocrine disruptor (estrogenic activity similar to BPA)",
    regulatory_notes: "BPA substitute. No specific regulatory limits. Emerging contaminant.",
    exposure_routes: ["ingestion", "dermal"],
    target_organs: ["endocrine system", "reproductive system"],
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor agonist", "androgen receptor"], summary: "Tested as BPA alternative; shows estrogenic activity in ToxCast assays" },
  },
  {
    hhear_code: "BPS",
    chemical_name: "Bisphenol S",
    cas_number: "80-09-1",
    dtxsid: "DTXSID5020153",
    molecular_formula: "C12H10O4S",
    category: "Phenol",
    toxicity_class: "Endocrine disruptor (estrogenic activity)",
    regulatory_notes: "BPA substitute. No specific regulatory limits. Emerging contaminant.",
    exposure_routes: ["ingestion", "dermal"],
    target_organs: ["endocrine system", "reproductive system"],
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor agonist"], summary: "Tested as BPA alternative; estrogenic activity detected in ToxCast" },
  },
  {
    hhear_code: "TCS",
    chemical_name: "Triclosan",
    cas_number: "3380-34-5",
    dtxsid: "DTXSID4021404",
    molecular_formula: "C12H7Cl3O2",
    category: "Antimicrobial agent",
    toxicity_class: "Endocrine disruptor",
    regulatory_notes: "FDA banned from consumer antiseptic washes (2016). Still used in toothpaste (Colgate Total).",
    exposure_routes: ["dermal", "ingestion"],
    target_organs: ["endocrine system", "liver", "immune system"],
    half_life: "~21 hours",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["thyroid peroxidase inhibition", "estrogen receptor", "androgen receptor"], summary: "Well-characterized in ToxCast; identified as TPO inhibitor affecting thyroid hormone synthesis" },
  },
  {
    hhear_code: "BP3",
    chemical_name: "Benzophenone-3 (Oxybenzone)",
    cas_number: "131-57-7",
    dtxsid: "DTXSID3022405",
    molecular_formula: "C14H12O3",
    category: "UV filter",
    toxicity_class: "Endocrine disruptor (estrogenic, anti-androgenic)",
    regulatory_notes: "Banned in Hawaii and Palau sunscreens (coral reef protection). FDA GRASE evaluation pending.",
    exposure_routes: ["dermal", "ingestion"],
    target_organs: ["endocrine system", "skin"],
    half_life: "~3 hours (dermal absorption)",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor", "androgen receptor antagonist"], summary: "Tested as UV filter/consumer product chemical; endocrine activity detected" },
  },
  {
    hhear_code: "DCP24",
    chemical_name: "2,4-Dichlorophenol",
    cas_number: "120-83-2",
    dtxsid: "DTXSID9020450",
    molecular_formula: "C6H4Cl2O",
    category: "Chlorophenol",
    toxicity_class: "IARC Group 2B possible carcinogen (chlorophenol group)",
    regulatory_notes: "EPA MCL 0.03 mg/L (as total chlorophenols). Metabolite of 2,4-D herbicide.",
    exposure_routes: ["ingestion", "dermal", "inhalation"],
    target_organs: ["liver", "kidney"],
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["cytotoxicity", "oxidative stress"], summary: "Pesticide degradation product tested in ToxCast" },
  },
  {
    hhear_code: "DCP25",
    chemical_name: "2,5-Dichlorophenol",
    cas_number: "583-78-8",
    dtxsid: "DTXSID4020453",
    molecular_formula: "C6H4Cl2O",
    category: "Chlorophenol",
    regulatory_notes: "Metabolite of 1,4-dichlorobenzene (moth repellent/deodorizer).",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["liver", "kidney"],
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["cytotoxicity"], summary: "Chlorophenol tested in ToxCast screening" },
  },

  // ── Parabens ──
  {
    hhear_code: "BUPB",
    chemical_name: "Butyl paraben",
    cas_number: "94-26-8",
    dtxsid: "DTXSID6022445",
    molecular_formula: "C11H14O3",
    category: "Paraben (preservative)",
    toxicity_class: "Endocrine disruptor (weak estrogenic activity)",
    regulatory_notes: "EU restricted in cosmetics to 0.14% (as butyl/propyl paraben). Banned in Denmark for children < 3.",
    exposure_routes: ["dermal", "ingestion"],
    target_organs: ["endocrine system", "reproductive system"],
    half_life: "~3 hours",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor agonist", "androgen receptor antagonist"], summary: "Tested in ToxCast; estrogenic and anti-androgenic activity detected" },
  },
  {
    hhear_code: "ETPB",
    chemical_name: "Ethyl paraben",
    cas_number: "120-47-8",
    dtxsid: "DTXSID5020583",
    molecular_formula: "C9H10O3",
    category: "Paraben (preservative)",
    toxicity_class: "Endocrine disruptor (weak estrogenic activity)",
    regulatory_notes: "EU permitted in cosmetics up to 0.4%. GRAS for food use (FDA).",
    exposure_routes: ["dermal", "ingestion"],
    target_organs: ["endocrine system"],
    half_life: "~4 hours",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor agonist"], summary: "Tested in ToxCast; weak estrogenic activity" },
  },
  {
    hhear_code: "MEPB",
    chemical_name: "Methyl paraben",
    cas_number: "99-76-3",
    dtxsid: "DTXSID2020825",
    molecular_formula: "C8H8O3",
    category: "Paraben (preservative)",
    toxicity_class: "Endocrine disruptor (very weak estrogenic activity)",
    regulatory_notes: "Most commonly used paraben. EU limit 0.4% in cosmetics. GRAS for food (FDA).",
    exposure_routes: ["dermal", "ingestion"],
    target_organs: ["endocrine system"],
    half_life: "~4 hours",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor agonist"], summary: "Tested in ToxCast; weak estrogenic activity" },
  },
  {
    hhear_code: "PRPB",
    chemical_name: "Propyl paraben",
    cas_number: "94-13-3",
    dtxsid: "DTXSID5021200",
    molecular_formula: "C10H12O3",
    category: "Paraben (preservative)",
    toxicity_class: "Endocrine disruptor (weak estrogenic activity)",
    regulatory_notes: "EU restricted in cosmetics to 0.14%. Banned in Denmark for children < 3.",
    exposure_routes: ["dermal", "ingestion"],
    target_organs: ["endocrine system", "reproductive system"],
    half_life: "~3 hours",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["estrogen receptor agonist", "androgen receptor antagonist"], summary: "Tested in ToxCast; estrogenic and anti-androgenic activity" },
  },

  // ── Phthalates ──
  {
    hhear_code: "MEHP",
    chemical_name: "Mono(2-ethylhexyl) phthalate",
    cas_number: "4376-20-9",
    dtxsid: "DTXSID1020862",
    molecular_formula: "C16H22O4",
    category: "Phthalate metabolite",
    toxicity_class: "Endocrine disruptor (anti-androgenic). Parent DEHP is IARC Group 2B.",
    regulatory_notes: "Primary urinary metabolite of DEHP (di(2-ethylhexyl) phthalate). CPSIA banned DEHP > 0.1% in children's toys.",
    exposure_routes: ["ingestion", "inhalation", "dermal"],
    target_organs: ["reproductive system", "liver", "endocrine system"],
    half_life: "~5 hours",
    toxcast: { in_toxcast: true, data_quality: "moderate", key_endpoints: ["PPAR-gamma activation", "androgen receptor"], summary: "Tested as toxicologically active phthalate metabolite; PPAR activation detected" },
  },
  {
    hhear_code: "MEHHP",
    chemical_name: "Mono(2-ethyl-5-hydroxyhexyl) phthalate",
    cas_number: "40321-99-1",
    dtxsid: "DTXSID8047523",
    molecular_formula: "C16H22O5",
    category: "Phthalate metabolite",
    toxicity_class: "Oxidative metabolite of DEHP. Biomarker preferred over MEHP.",
    regulatory_notes: "Secondary metabolite of DEHP. More reliable biomarker due to less exogenous contamination.",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system", "liver"],
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Hydroxylated DEHP metabolite; parent compound DEHP tested in ToxCast" },
  },
  {
    hhear_code: "MECPP",
    chemical_name: "Mono(2-ethyl-5-carboxypentyl) phthalate",
    cas_number: "40809-41-4",
    dtxsid: "DTXSID0047521",
    molecular_formula: "C16H20O6",
    category: "Phthalate metabolite",
    toxicity_class: "Oxidative metabolite of DEHP. Most abundant urinary DEHP metabolite.",
    regulatory_notes: "Most abundant and longest-lived urinary metabolite of DEHP.",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system", "liver"],
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Carboxylated DEHP metabolite; parent compound DEHP tested in ToxCast" },
  },
  {
    hhear_code: "MEOHP",
    chemical_name: "Mono(2-ethyl-5-oxohexyl) phthalate",
    cas_number: "40321-98-0",
    dtxsid: "DTXSID1047524",
    molecular_formula: "C16H20O5",
    category: "Phthalate metabolite",
    toxicity_class: "Oxidative metabolite of DEHP.",
    regulatory_notes: "Secondary metabolite of DEHP.",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system", "liver"],
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Oxidative DEHP metabolite; parent compound DEHP tested in ToxCast" },
  },
  {
    hhear_code: "MBZP",
    chemical_name: "Mono-benzyl phthalate",
    cas_number: "2528-16-7",
    dtxsid: "DTXSID0047497",
    molecular_formula: "C15H14O4",
    category: "Phthalate metabolite",
    toxicity_class: "Metabolite of BzBP. Anti-androgenic.",
    regulatory_notes: "Metabolite of butylbenzyl phthalate (BzBP). CPSIA banned BzBP > 0.1% in children's toys.",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system"],
    toxcast: { in_toxcast: true, data_quality: "moderate", key_endpoints: ["androgen receptor antagonist"], summary: "Mono-benzyl phthalate tested in ToxCast; anti-androgenic activity" },
  },
  {
    hhear_code: "MEP",
    chemical_name: "Monoethyl phthalate",
    cas_number: "2306-33-4",
    dtxsid: "DTXSID1047525",
    molecular_formula: "C10H12O4",
    category: "Phthalate metabolite",
    toxicity_class: "Metabolite of DEP (diethyl phthalate). Low anti-androgenic potency.",
    regulatory_notes: "Metabolite of DEP, found in personal care products and fragrances.",
    exposure_routes: ["dermal", "inhalation", "ingestion"],
    target_organs: ["endocrine system"],
    half_life: "~5 hours",
    toxcast: { in_toxcast: true, data_quality: "moderate", summary: "Monoethyl phthalate tested in ToxCast" },
  },
  {
    hhear_code: "MIBP",
    chemical_name: "Mono-isobutyl phthalate",
    cas_number: "30833-53-5",
    dtxsid: "DTXSID8047519",
    molecular_formula: "C12H14O4",
    category: "Phthalate metabolite",
    toxicity_class: "Anti-androgenic. Metabolite of DiBP.",
    regulatory_notes: "Metabolite of di-isobutyl phthalate (DiBP). EU restricted DiBP in toys.",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system"],
    toxcast: { in_toxcast: true, data_quality: "moderate", summary: "Mono-isobutyl phthalate tested in ToxCast" },
  },
  {
    hhear_code: "MNBP",
    chemical_name: "Mono-n-butyl phthalate",
    cas_number: "131-70-4",
    dtxsid: "DTXSID1020108",
    molecular_formula: "C12H14O4",
    category: "Phthalate metabolite",
    toxicity_class: "Anti-androgenic. Metabolite of DBP.",
    regulatory_notes: "Metabolite of di-n-butyl phthalate (DBP). CPSIA banned DBP > 0.1% in children's toys.",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system"],
    toxcast: { in_toxcast: true, data_quality: "moderate", key_endpoints: ["PPAR-gamma", "androgen receptor antagonist"], summary: "Confirmed in ToxCast Phase I as tested phthalate metabolite" },
  },
  {
    hhear_code: "MCPP",
    chemical_name: "Mono(3-carboxypropyl) phthalate",
    cas_number: "66851-46-5",
    dtxsid: "DTXSID5047503",
    molecular_formula: "C12H12O6",
    category: "Phthalate metabolite",
    regulatory_notes: "Non-specific metabolite of several high-MW phthalates (DBP, DOP).",
    exposure_routes: ["ingestion"],
    target_organs: ["reproductive system"],
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Phthalate metabolite; parent compound tested in ToxCast" },
  },

  // ── PFAS ──
  {
    hhear_code: "PFOA",
    chemical_name: "Perfluorooctanoic acid",
    cas_number: "335-67-1",
    dtxsid: "DTXSID8031865",
    molecular_formula: "C8HF15O2",
    category: "PFAS",
    toxicity_class: "IARC Group 2B possible carcinogen. Immune suppression.",
    regulatory_notes: "EPA MCL 4 ng/L (2024 final rule). PFOA stewardship program phased out US production by 2015. Stockholm Convention listed (2019).",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["liver", "immune system", "thyroid", "kidney"],
    half_life: "~3.5 years",
    biomarker_thresholds: [
      { matrix: "serum", nhanes_variable: "LBXPFOA", units: "ng/mL", reference_value: 2, reference_source: "German HBM-I (2020)", level: "concern", description: "HBM-I: no adverse health effects expected below this serum level" },
      { matrix: "serum", nhanes_variable: "LBXPFOA", units: "ng/mL", reference_value: 10, reference_source: "German HBM-II (2020)", level: "action", description: "HBM-II: increased risk of adverse effects above this level" },
      { matrix: "serum", nhanes_variable: "LBXPFOA", units: "ng/mL", reference_value: 5, reference_source: "German HBM-II (2020)", level: "action", description: "HBM-II for women of childbearing age", population: "women of childbearing age" },
    ],
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["PPAR-alpha activation", "liver toxicity pathways", "mitochondrial function"], summary: "Tested in ToxCast Phase I; PPAR-alpha activation and hepatic endpoints active" },
  },
  {
    hhear_code: "PFOS",
    chemical_name: "Perfluorooctane sulfonic acid",
    cas_number: "1763-23-1",
    dtxsid: "DTXSID3031864",
    molecular_formula: "C8HF17O3S",
    category: "PFAS",
    toxicity_class: "IARC Group 2B possible carcinogen. Immune suppression.",
    regulatory_notes: "EPA MCL 4 ng/L (2024 final rule). Stockholm Convention listed (2009). Phased out by 3M in 2002.",
    exposure_routes: ["ingestion", "inhalation"],
    target_organs: ["liver", "immune system", "thyroid", "reproductive system"],
    half_life: "~5.4 years",
    biomarker_thresholds: [
      { matrix: "serum", nhanes_variable: "LBXPFOS", units: "ng/mL", reference_value: 5, reference_source: "German HBM-I (2020)", level: "concern", description: "HBM-I: no adverse health effects expected below this serum level" },
      { matrix: "serum", nhanes_variable: "LBXPFOS", units: "ng/mL", reference_value: 20, reference_source: "German HBM-II (2020)", level: "action", description: "HBM-II: increased risk of adverse effects above this level" },
      { matrix: "serum", nhanes_variable: "LBXPFOS", units: "ng/mL", reference_value: 10, reference_source: "German HBM-II (2020)", level: "action", description: "HBM-II for women of childbearing age", population: "women of childbearing age" },
    ],
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["PPAR-alpha activation", "mitochondrial membrane potential", "liver toxicity"], summary: "Tested in ToxCast Phase I; PPAR activation and mitochondrial effects" },
  },
  {
    hhear_code: "PFNA",
    chemical_name: "Perfluorononanoic acid",
    cas_number: "375-95-1",
    dtxsid: "DTXSID8037708",
    molecular_formula: "C9HF17O2",
    category: "PFAS",
    toxicity_class: "Suspected endocrine disruptor and immunotoxicant",
    regulatory_notes: "EPA hazard index PFAS rule (2024). State-level MCLs (e.g., NJ 13 ng/L).",
    exposure_routes: ["ingestion"],
    target_organs: ["liver", "immune system", "thyroid"],
    half_life: "~2.5 years",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["PPAR-alpha activation"], summary: "Long-chain PFAS tested in ToxCast PFAS expansion set" },
  },
  {
    hhear_code: "PFHXS",
    chemical_name: "Perfluorohexane sulfonic acid",
    cas_number: "355-46-4",
    dtxsid: "DTXSID7040150",
    molecular_formula: "C6HF13O3S",
    category: "PFAS",
    toxicity_class: "Suspected immunotoxicant",
    regulatory_notes: "EPA hazard index PFAS rule (2024). Stockholm Convention listed (2022).",
    exposure_routes: ["ingestion"],
    target_organs: ["liver", "immune system", "thyroid"],
    half_life: "~8.5 years",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["PPAR-alpha activation"], summary: "Tested in ToxCast PFAS screening; ~430 PFAS in current library" },
  },
  {
    hhear_code: "PFDA",
    chemical_name: "Perfluorodecanoic acid",
    cas_number: "335-76-2",
    dtxsid: "DTXSID1037303",
    molecular_formula: "C10HF19O2",
    category: "PFAS",
    toxicity_class: "Suspected immunotoxicant and hepatotoxicant",
    regulatory_notes: "EPA hazard index PFAS rule (2024).",
    exposure_routes: ["ingestion"],
    target_organs: ["liver", "immune system"],
    half_life: "~4-7 years",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["PPAR-alpha activation"], summary: "Long-chain PFAS tested in ToxCast" },
  },

  // ── PAH metabolites ──
  {
    hhear_code: "PYR1",
    chemical_name: "1-Hydroxypyrene",
    cas_number: "5315-79-7",
    dtxsid: "DTXSID1060030",
    molecular_formula: "C16H10O",
    category: "PAH metabolite",
    toxicity_class: "Biomarker of total PAH exposure (parent pyrene is IARC Group 3)",
    regulatory_notes: "Most widely used biomarker of total PAH exposure. Not carcinogenic itself.",
    exposure_routes: ["inhalation", "ingestion", "dermal"],
    target_organs: ["lung", "skin"],
    half_life: "~18 hours",
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "PAH metabolite; parent compound pyrene likely tested in ToxCast" },
  },
  {
    hhear_code: "NAP1",
    chemical_name: "1-Hydroxynaphthalene",
    cas_number: "90-15-3",
    dtxsid: "DTXSID6021800",
    molecular_formula: "C10H8O",
    category: "PAH metabolite",
    toxicity_class: "Metabolite of naphthalene (IARC Group 2B)",
    regulatory_notes: "Biomarker of naphthalene exposure. Sources: mothballs, tobacco smoke, vehicle exhaust.",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["respiratory system", "eye (cataracts)"],
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "PAH metabolite; parent compound naphthalene tested in ToxCast" },
  },
  {
    hhear_code: "NAP2",
    chemical_name: "2-Hydroxynaphthalene",
    cas_number: "135-19-3",
    dtxsid: "DTXSID3021803",
    molecular_formula: "C10H8O",
    category: "PAH metabolite",
    toxicity_class: "Metabolite of naphthalene (IARC Group 2B)",
    regulatory_notes: "Major urinary metabolite of naphthalene. Elevated in smokers.",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["respiratory system"],
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "PAH metabolite; parent compound naphthalene tested in ToxCast" },
  },

  // ── Flame Retardants ──
  {
    hhear_code: "BDE47",
    chemical_name: "2,2',4,4'-Tetrabromodiphenyl ether (BDE-47)",
    cas_number: "5436-43-1",
    dtxsid: "DTXSID2021735",
    molecular_formula: "C12H6Br4O",
    category: "Polybrominated diphenyl ether (PBDE)",
    toxicity_class: "Endocrine disruptor (thyroid). Neurodevelopmental toxicant.",
    regulatory_notes: "PentaBDE commercial mixture voluntarily phased out (2004). Stockholm Convention listed. Still detected in house dust and food.",
    exposure_routes: ["ingestion", "inhalation", "dermal"],
    target_organs: ["thyroid", "nervous system", "liver", "reproductive system"],
    half_life: "~2-4 years (serum)",
    toxcast: { in_toxcast: true, data_quality: "good", key_endpoints: ["thyroid receptor", "estrogen receptor", "PPAR-gamma"], summary: "PBDE flame retardant tested in ToxCast; thyroid and endocrine activity" },
  },

  // ── Smoking Biomarkers ──
  {
    hhear_code: "COTT",
    chemical_name: "Cotinine",
    cas_number: "486-56-6",
    dtxsid: "DTXSID6023068",
    molecular_formula: "C10H12N2O",
    category: "Nicotine metabolite",
    toxicity_class: "Biomarker of tobacco/nicotine exposure (active + passive)",
    regulatory_notes: "Serum cotinine > 10 ng/mL indicates active smoking. > 0.05 ng/mL indicates secondhand smoke exposure.",
    exposure_routes: ["inhalation", "ingestion"],
    target_organs: ["cardiovascular system", "respiratory system"],
    half_life: "~16-20 hours",
    biomarker_thresholds: [
      { matrix: "serum", nhanes_variable: "LBXCOT", units: "ng/mL", reference_value: 0.05, reference_source: "Benowitz et al. (2009)", level: "concern", description: "Serum cotinine threshold indicating secondhand smoke exposure" },
      { matrix: "serum", nhanes_variable: "LBXCOT", units: "ng/mL", reference_value: 10, reference_source: "SRNT/CDC consensus (Benowitz et al., 2009)", level: "action", description: "Serum cotinine threshold distinguishing active smokers from non-smokers" },
    ],
    toxcast: { in_toxcast: false, data_quality: "not_applicable", summary: "Endogenous nicotine metabolite; not a primary environmental chemical for HTS screening" },
  },
  {
    hhear_code: "NNAL",
    chemical_name: "4-(Methylnitrosamino)-1-(3-pyridyl)-1-butanol",
    cas_number: "76014-81-8",
    dtxsid: "DTXSID5047315",
    molecular_formula: "C10H15N3O2",
    category: "Tobacco-specific nitrosamine metabolite",
    toxicity_class: "Metabolite of NNK (IARC Group 1 carcinogen). Biomarker of tobacco-specific carcinogen exposure.",
    regulatory_notes: "Urinary NNAL is the gold-standard biomarker for tobacco-specific carcinogen exposure. No safe level.",
    exposure_routes: ["inhalation"],
    target_organs: ["lung", "pancreas"],
    half_life: "~40-45 days",
    toxcast: { in_toxcast: false, data_quality: "not_applicable", summary: "Tobacco-specific nitrosamine metabolite; not a primary target for ToxCast HTS" },
  },

  // ── Organophosphate Pesticide Metabolites ──
  {
    hhear_code: "DEP",
    chemical_name: "Diethylphosphate",
    cas_number: "598-02-7",
    dtxsid: "DTXSID0020462",
    molecular_formula: "C4H11O4P",
    category: "Organophosphate pesticide metabolite",
    toxicity_class: "Non-specific metabolite of diethyl-OP pesticides (chlorpyrifos, diazinon)",
    regulatory_notes: "Biomarker of recent OP pesticide exposure. Sources: diet, residential use.",
    exposure_routes: ["ingestion", "dermal", "inhalation"],
    target_organs: ["nervous system"],
    half_life: "~6-24 hours",
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Non-specific organophosphate metabolite; parent pesticides (e.g., chlorpyrifos, diazinon) extensively tested in ToxCast" },
  },
  {
    hhear_code: "DETP",
    chemical_name: "Diethylthiophosphate",
    cas_number: "2465-65-8",
    dtxsid: "DTXSID7024925",
    molecular_formula: "C4H11O3PS",
    category: "Organophosphate pesticide metabolite",
    toxicity_class: "Non-specific metabolite of diethylthio-OP pesticides",
    regulatory_notes: "Biomarker of recent OP pesticide exposure.",
    exposure_routes: ["ingestion", "dermal"],
    target_organs: ["nervous system"],
    half_life: "~6-24 hours",
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Non-specific organophosphate metabolite; parent pesticides tested in ToxCast" },
  },
  {
    hhear_code: "DMP",
    chemical_name: "Dimethylphosphate",
    cas_number: "813-78-5",
    dtxsid: "DTXSID6024915",
    molecular_formula: "C2H7O4P",
    category: "Organophosphate pesticide metabolite",
    toxicity_class: "Non-specific metabolite of dimethyl-OP pesticides (malathion)",
    regulatory_notes: "Biomarker of recent OP pesticide exposure.",
    exposure_routes: ["ingestion", "dermal", "inhalation"],
    target_organs: ["nervous system"],
    half_life: "~6-24 hours",
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Non-specific organophosphate metabolite; parent pesticides tested in ToxCast" },
  },
  {
    hhear_code: "DMTP",
    chemical_name: "Dimethylthiophosphate",
    cas_number: "756-80-9",
    dtxsid: "DTXSID6024916",
    molecular_formula: "C2H7O3PS",
    category: "Organophosphate pesticide metabolite",
    toxicity_class: "Non-specific metabolite of dimethylthio-OP pesticides",
    regulatory_notes: "Biomarker of recent OP pesticide exposure.",
    exposure_routes: ["ingestion", "dermal"],
    target_organs: ["nervous system"],
    half_life: "~6-24 hours",
    toxcast: { in_toxcast: false, data_quality: "indirect", summary: "Non-specific organophosphate metabolite; parent pesticides tested in ToxCast" },
  },

  // ── Dilution marker ──
  {
    hhear_code: "CRE",
    chemical_name: "Creatinine",
    cas_number: "60-27-5",
    dtxsid: "DTXSID4020347",
    molecular_formula: "C4H7N3O",
    category: "Endogenous metabolite",
    regulatory_notes: "Used for urinary dilution adjustment. Normal: 20-300 mg/dL. Samples < 30 mg/dL or > 300 mg/dL may be unreliable.",
    exposure_routes: ["endogenous"],
    target_organs: ["kidney"],
    toxcast: { in_toxcast: false, data_quality: "not_applicable", summary: "Endogenous biomarker of kidney function; not an environmental chemical" },
  },
];

// ── Lookup indexes ──

/** Lookup by HHEAR code (case-insensitive) */
export const COMPTOX_BY_HHEAR: Map<string, ChemicalProfile> = new Map(
  COMPTOX_CHEMICALS.map((c) => [c.hhear_code.toLowerCase(), c])
);

/** Lookup by CAS number */
export const COMPTOX_BY_CAS: Map<string, ChemicalProfile> = new Map(
  COMPTOX_CHEMICALS.map((c) => [c.cas_number, c])
);

/** Lookup by DTXSID */
export const COMPTOX_BY_DTXSID: Map<string, ChemicalProfile> = new Map(
  COMPTOX_CHEMICALS.map((c) => [c.dtxsid, c])
);

/** Lookup by chemical name (lowercase) */
export const COMPTOX_BY_NAME: Map<string, ChemicalProfile> = new Map(
  COMPTOX_CHEMICALS.map((c) => [c.chemical_name.toLowerCase(), c])
);

/** Lookup biomarker thresholds by NHANES variable code */
export const THRESHOLDS_BY_NHANES_VAR: Map<string, BiomarkerThreshold[]> = (() => {
  const map = new Map<string, BiomarkerThreshold[]>();
  for (const chem of COMPTOX_CHEMICALS) {
    for (const t of chem.biomarker_thresholds ?? []) {
      const existing = map.get(t.nhanes_variable) ?? [];
      existing.push(t);
      map.set(t.nhanes_variable, existing);
    }
  }
  return map;
})();

/**
 * Resolve a chemical by any identifier: HHEAR code, CAS number, DTXSID, NHANES code, or name.
 * Returns the ChemicalProfile or undefined.
 */
export function resolveChemical(identifier: string): ChemicalProfile | undefined {
  const id = identifier.trim();
  const idLower = id.toLowerCase();

  // Try HHEAR code (case-insensitive)
  const byHhear = COMPTOX_BY_HHEAR.get(idLower);
  if (byHhear) return byHhear;

  // Try CAS number
  const byCas = COMPTOX_BY_CAS.get(id);
  if (byCas) return byCas;

  // Try DTXSID
  const byDtx = COMPTOX_BY_DTXSID.get(id);
  if (byDtx) return byDtx;

  // Try exact name match
  const byName = COMPTOX_BY_NAME.get(idLower);
  if (byName) return byName;

  // Try partial name match
  const byPartial = COMPTOX_CHEMICALS.find(
    (c) =>
      c.chemical_name.toLowerCase().includes(idLower) ||
      idLower.includes(c.chemical_name.toLowerCase())
  );
  if (byPartial) return byPartial;

  // Try NHANES code → HHEAR code via bridge (import avoided; check by known NHANES prefixes)
  // Not importing bridge to avoid circular dependency; caller can cross-reference
  return undefined;
}
