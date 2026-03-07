/**
 * Multiple testing correction for ExWAS-style analyses.
 */
export interface CorrectedPValues {
  nominal: number;
  bonferroni: number;
  fdr: number;
}

/** Apply Bonferroni correction */
export function bonferroni(pValue: number, nTests: number): number {
  return Math.min(pValue * nTests, 1.0);
}

/** Apply Benjamini-Hochberg FDR correction to a sorted array of p-values */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);

  const adjusted = new Array<number>(n);
  let cumMin = 1.0;

  for (let rank = n; rank >= 1; rank--) {
    const entry = indexed[rank - 1];
    const raw = (entry.p * n) / rank;
    cumMin = Math.min(cumMin, raw);
    adjusted[entry.i] = Math.min(cumMin, 1.0);
  }

  return adjusted;
}

/** Apply both corrections to an array of results */
export function applyMultipleTestingCorrection(
  pValues: number[]
): CorrectedPValues[] {
  const nTests = pValues.length;
  const fdrValues = benjaminiHochberg(pValues);

  return pValues.map((p, i) => ({
    nominal: p,
    bonferroni: bonferroni(p, nTests),
    fdr: fdrValues[i],
  }));
}
