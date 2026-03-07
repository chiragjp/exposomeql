const LOD_HIGH_CENSORING_THRESHOLD = 40; // percent

/**
 * Derive the NHANES comment code column name from a lab variable.
 * Pattern: LBXBPB → LBDBPBLC, URXBPH → URDBPHLC
 * The comment code column indicates whether a value is below LOD.
 */
export function deriveCommentColumn(variableName: string): string | null {
  // Lab blood variables: LBX → LBD + core + LC
  if (variableName.startsWith("LBX")) {
    const core = variableName.slice(3);
    return `LBD${core}LC`;
  }
  // Urinary variables: URX → URD + core + LC
  if (variableName.startsWith("URX")) {
    const core = variableName.slice(3);
    return `URD${core}LC`;
  }
  return null;
}

/** Check if a variable is a lab biomarker (LBX* or URX*) */
export function isLabBiomarker(variableName: string): boolean {
  return variableName.startsWith("LBX") || variableName.startsWith("URX");
}

export function checkLOD(pctBelowLod: number): {
  highCensoring: boolean;
  warning: string | null;
} {
  if (pctBelowLod > LOD_HIGH_CENSORING_THRESHOLD) {
    return {
      highCensoring: true,
      warning: `WARNING: ${pctBelowLod.toFixed(1)}% of values are below the limit of detection. Mean estimates may be unreliable. Consider using nhanes.prevalence with a threshold instead.`,
    };
  }
  return { highCensoring: false, warning: null };
}

export function formatLODWarning(pctBelowLod: number): string | null {
  const result = checkLOD(pctBelowLod);
  return result.warning;
}
