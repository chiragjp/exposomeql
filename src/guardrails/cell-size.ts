const NCHS_MIN_CELL_SIZE = 30;

export function checkCellSize(nUnweighted: number): boolean {
  return nUnweighted >= NCHS_MIN_CELL_SIZE;
}

export function formatCellSizeWarning(nUnweighted: number): string | null {
  if (nUnweighted < NCHS_MIN_CELL_SIZE) {
    return `WARNING: Unweighted sample size (N=${nUnweighted}) is below the NCHS minimum of ${NCHS_MIN_CELL_SIZE}. Estimate may be unreliable.`;
  }
  return null;
}
