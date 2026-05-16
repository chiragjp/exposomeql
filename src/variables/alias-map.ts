/**
 * Common natural language aliases for NHANES variable codes.
 * Maps user-friendly terms to canonical NHANES variable names.
 * When a value is an array, the term is ambiguous and requires clarification.
 */
export const ALIAS_MAP: Record<string, string | string[]> = {
  // Metals
  lead: "LBXBPB",
  "blood lead": "LBXBPB",
  cadmium: "LBXBCD",
  "blood cadmium": "LBXBCD",
  mercury: ["LBXTHG", "LBXIHG", "URXUHG"],
  "total mercury": "LBXTHG",
  "blood mercury": "LBXTHG",
  "inorganic mercury": "LBXIHG",
  "urinary mercury": "URXUHG",
  arsenic: "URXUAS",
  manganese: "LBXBMN",
  selenium: "LBXBSE",

  // Organic chemicals
  BPA: "URXBPH",
  bisphenol: "URXBPH",
  "bisphenol A": "URXBPH",
  cotinine: "LBXCOT",
  PFOS: "LBXPFOS",
  PFOA: "LBXPFOA",
  PFAS: ["LBXPFOS", "LBXPFOA", "LBXPFHS", "LBXPFNA"],
  perchlorate: "URXUP8",

  // Clinical biomarkers
  A1C: "LBXGH",
  HbA1c: "LBXGH",
  "hemoglobin A1c": "LBXGH",
  glycohemoglobin: "LBXGH",
  CRP: "LBXCRP",
  "C-reactive protein": "LBXCRP",
  creatinine: ["LBXSCR", "URXUCR"],
  "serum creatinine": "LBXSCR",
  "urinary creatinine": "URXUCR",
  glucose: "LBXGLU",
  "fasting glucose": "LBXGLU",
  cholesterol: "LBXTC",
  "total cholesterol": "LBXTC",
  HDL: "LBDHDD",
  LDL: "LBDLDL",
  triglycerides: "LBXTR",
  insulin: "LBXIN",

  // Anthropometric
  BMI: "BMXBMI",
  "body mass index": "BMXBMI",
  height: "BMXHT",
  weight: "BMXWT",
  "waist circumference": "BMXWAIST",

  // Blood pressure
  "systolic blood pressure": "BPXSY1",
  "diastolic blood pressure": "BPXDI1",
  "blood pressure": ["BPXSY1", "BPXDI1"],

  // Blood counts
  hemoglobin: "LBXHGB",
  // CAUTION: LBXHCT is ambiguous in NHANES — it maps to BOTH Hematocrit (%)
  // in the CBC tables (1999-2020) AND Hydroxycotinine (ng/mL) in the COT tables
  // (2013-2018). The variable code was reused for a completely different analyte.
  // When the user says "hematocrit", they mean the CBC version. For hydroxycotinine,
  // use LBXHCTR or direct them to the COT table.
  hematocrit: "LBXHCT",
  hydroxycotinine: "LBXHCT", // NOTE: same code collision — COT table only (2013+)
  "white blood cells": "LBXWBCSI",
  WBC: "LBXWBCSI",
  "red blood cells": "LBXRBCSI",
  RBC: "LBXRBCSI",
  RDW: "LBXRDW",

  // Demographics
  age: "RIDAGEYR",
  sex: "RIAGENDR",
  gender: "RIAGENDR",
  income: "INDFMPIR",
  "poverty ratio": "INDFMPIR",
  education: "DMDEDUC2",
  race: "RIDRETH3",
  ethnicity: "RIDRETH3",
  "race/ethnicity": "RIDRETH3",

  // Kidney
  eGFR: "LBXSCR", // derived from creatinine
  "kidney function": "LBXSCR",
  albumin: "URXUMA",
  "urinary albumin": "URXUMA",
  ACR: ["URXUMA", "URXUCR"], // albumin-to-creatinine ratio

  // Vitamins & micronutrients
  "vitamin D": "LBXVIDMS",
  "25-OH vitamin D": "LBXVIDMS",
  "25-hydroxyvitamin D": "LBXVIDMS",
  "vitamin A": "LBXVIA",
  retinol: "LBXVIA",
  "vitamin E": "LBXVIE",
  "alpha-tocopherol": "LBXVIE",
  "alpha tocopherol": "LBXVIE",
  "a-tocopherol": "LBXVIE",
  "gamma-tocopherol": "LBXGTC",
  "gamma tocopherol": "LBXGTC",
  "g-tocopherol": "LBXGTC",
  "beta-carotene": "LBXBEC",
  "beta carotene": "LBXBEC",
  "b-carotene": "LBXBEC",
  "trans-beta-carotene": "LBXBEC",
  "alpha-carotene": "LBXALC",
  "alpha carotene": "LBXALC",
  "a-carotene": "LBXALC",
  "beta-cryptoxanthin": "LBXCRY",
  lycopene: "LBXLYC",
  lutein: "LBXLUZ",
  "lutein/zeaxanthin": "LBXLUZ",
  folate: "LBXFOLSI",
  "serum folate": "LBXFOLSI",
  "RBC folate": "LBXRBFSI",
  "vitamin B12": "LBXB12",
  "vitamin C": "LBXVIC",
  iron: "LBXIRN",
  "serum iron": "LBXIRN",
  ferritin: "LBXFER",
  transferrin: "LBXTFR",
  "uric acid": "LBXSUA",
  "serum uric acid": "LBXSUA",
  "HOMA-IR": "HOMA_IR",
  "homa-ir": "HOMA_IR",
  "homa ir": "HOMA_IR",
  "insulin resistance": "HOMA_IR",
  "HOMA": "HOMA_IR",

  // Thyroid
  TSH: "LBXTSH",
  "thyroid stimulating hormone": "LBXTSH",
  T4: "LBXT4",
  "thyroxine": "LBXT4",
  "free T4": "LBXT4F",
  T3: "LBXT3",
  "triiodothyronine": "LBXT3",

  // Liver
  ALT: "LBXSATSI",
  AST: "LBXSASSI",
  GGT: "LBXSGTSI",
  "alkaline phosphatase": "LBXSAPSI",
  ALP: "LBXSAPSI",
  bilirubin: "LBXSTB",
  "total bilirubin": "LBXSTB",
  "serum albumin": "LBXSAL",
};
