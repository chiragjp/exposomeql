/**
 * Determine which survey weight to use for a given variable.
 * Mirrors figure_out_weight() logic from nhanespewas/R/petable.R
 */
export function determineWeight(variableName: string): {
  weight: string;
  rationale: string;
} {
  // Dietary recall variables use dietary weights
  if (
    variableName.startsWith("DRX") ||
    variableName.startsWith("DR1") ||
    variableName.startsWith("DR2")
  ) {
    return {
      weight: "WTDRD1",
      rationale:
        "Dietary recall variable — using dietary day 1 sample weight (WTDRD1)",
    };
  }

  // Fasting subsample variables
  const fastingVars = ["LBXGLU", "LBXIN", "LBXTR", "LBDLDL"];
  if (fastingVars.includes(variableName)) {
    return {
      weight: "WTSAF2YR",
      rationale:
        "Fasting subsample variable — using fasting subsample weight (WTSAF2YR)",
    };
  }

  // Default: MEC examination weight
  return {
    weight: "WTMEC2YR",
    rationale:
      "Using MEC examination 2-year weight (WTMEC2YR) — standard for lab and examination variables",
  };
}
