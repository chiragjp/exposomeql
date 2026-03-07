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
  hematocrit: "LBXHCT",
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

  // Vitamins
  "vitamin D": "LBXVIDMS",
  "vitamin A": "LBXVIA",
  "vitamin E": "LBXVIE",
  folate: "LBXFOLSI",
  "vitamin B12": "LBXB12",
  iron: "LBXIRN",
  ferritin: "LBXFER",
};
