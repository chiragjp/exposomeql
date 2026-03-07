/**
 * Adjust survey weights when pooling multiple NHANES cycles.
 * Per NCHS guidelines, when combining C cycles of 2-year data,
 * divide each 2-year weight by C.
 *
 * Series A+B (1999-2002) have dedicated 4-year weights (WTMEC4YR).
 */
export function adjustCycleWeights(
  cycles: string[],
  weightColumn: string
): { adjustedWeightExpr: string; rationale: string } {
  if (cycles.length <= 1) {
    return {
      adjustedWeightExpr: weightColumn,
      rationale: "Single cycle — no weight adjustment needed",
    };
  }

  // Check for A+B (1999-2002) which have 4-year weights
  const hasA = cycles.includes("A");
  const hasB = cycles.includes("B");
  if (hasA && hasB && cycles.length === 2) {
    const fourYearWeight = weightColumn.replace("2YR", "4YR");
    return {
      adjustedWeightExpr: fourYearWeight,
      rationale: `Series A+B — using 4-year weight (${fourYearWeight})`,
    };
  }

  const nCycles = cycles.length;
  return {
    adjustedWeightExpr: `${weightColumn} / ${nCycles}`,
    rationale: `Pooling ${nCycles} cycles — dividing 2-year weights by ${nCycles} per NCHS guidelines`,
  };
}
