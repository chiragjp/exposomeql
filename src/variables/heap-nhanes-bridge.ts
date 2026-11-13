/**
 * Hand-curated bridge between HEAP (UK Biobank) exposures and NHANES EP-WAS exposure variables.
 *
 * HEAP exposures are UK Biobank touchscreen/derived fields (IDs like
 * `pack_years_of_smoking_f20161_0_0`); NHANES EP-WAS exposures are lab, dietary-recall and
 * questionnaire variables. No pair measures the same thing the same way, so each entry records
 * how close the match is:
 *   biomarker — NHANES has an objective biomarker of the HEAP self-reported behaviour
 *   analog    — both are self-report/recall measures of the same behaviour, different instruments
 *   proxy     — related construct only (e.g. supplement use vs total nutrient intake)
 *
 * Used by the `heap_nhanes_bridge` tool. NHANES variables listed here were checked against
 * `pe_stats.adjusted_meta_uwls` (model 6); the tool re-checks at query time.
 */

export type BridgeMatch = "biomarker" | "analog" | "proxy";

export interface HeapNhanesBridgeEntry {
  /** Short concept key, also matched against the user's query */
  concept: string;
  /** Extra search words for the concept */
  keywords: string[];
  /** Matches HEAP exposure IDs (case-insensitive) */
  heap: RegExp;
  /** NHANES EP-WAS exposure variables (evarname) */
  nhanes: string[];
  match: BridgeMatch;
  /** What differs between the two measures; shown to the caller */
  note: string;
}

export const HEAP_NHANES_BRIDGE: HeapNhanesBridgeEntry[] = [
  {
    concept: "active smoking",
    keywords: ["smoking", "smoke", "tobacco", "cigarette", "cotinine", "nicotine"],
    heap: /^(smoking_status_f20116|current_tobacco_smoking_f1239|pack_years_of_smoking_f20161|ever_smoked_f20160|past_tobacco_smoking_f1249)/i,
    nhanes: ["LBXCOT", "URXCOTT", "URXHCTT", "SMQ720"],
    match: "biomarker",
    note: "HEAP: self-reported status / pack-years (HEAP has separate terms for Current, Previous, Never; Never and 'No' terms run opposite to cotinine). NHANES: serum/urine cotinine and cigarettes per day.",
  },
  {
    concept: "secondhand smoke",
    keywords: ["secondhand", "passive smoking", "household smoke", "environmental tobacco smoke", "ETS"],
    heap: /^(exposure_to_tobacco_smoke_(at|outside)_home|smoking_smokers_in_household)/i,
    nhanes: ["LBXCOT"],
    match: "proxy",
    note: "NHANES cotinine reflects active plus passive exposure; EP-WAS estimates are not restricted to non-smokers.",
  },
  {
    concept: "alcohol",
    keywords: ["alcohol", "drinking", "ethanol"],
    heap: /^alcohol_/i,
    nhanes: ["DR1TALCO", "DR2TALCO", "DRXTALCO"],
    match: "analog",
    note: "HEAP: drinker status and intake-frequency categories (UKB field 1558 is coded 1=daily … 6=never, so higher level = less frequent). NHANES: grams of alcohol from 24-hour recall.",
  },
  {
    concept: "coffee and caffeine",
    keywords: ["coffee", "caffeine", "tea"],
    heap: /^(coffee_intake|tea_intake)_/i,
    nhanes: ["DR1TCAFF", "DR2TCAFF", "URXMX7"],
    match: "analog",
    note: "HEAP: cups per day of coffee or tea. NHANES: caffeine (mg) from 24-hour recall and urinary caffeine, which pool all caffeine sources.",
  },
  {
    concept: "oily fish and omega-3",
    keywords: ["fish", "omega-3", "EPA", "DHA", "fish oil"],
    heap: /^(oily_fish_intake|mineral_and_other_dietary_supplements_f6179_0_0\.multi_Fish_oil)/i,
    nhanes: ["DR1TP205", "DR1TP226"],
    match: "proxy",
    note: "HEAP: oily-fish intake frequency and fish-oil supplement use. NHANES: dietary EPA (20:5) and DHA (22:6) from 24-hour recall.",
  },
  {
    concept: "salt",
    keywords: ["salt", "sodium"],
    heap: /^salt_added_to_food/i,
    nhanes: ["DR1TSODI", "DR2TSODI"],
    match: "proxy",
    note: "HEAP: how often salt is added at the table. NHANES: total sodium (mg) from 24-hour recall.",
  },
  {
    concept: "vigorous physical activity",
    keywords: ["vigorous", "exercise", "physical activity", "strenuous", "sport"],
    heap: /^(met_minutes_per_week_for_vigorous_activity|number_of_days_week_of_vigorous_physical_activity|types_of_physical_activity_in_last_4_weeks_f6164_0_0\.multi_Strenuous_sports)/i,
    nhanes: ["PAQ_recreation_vigorous_met", "PAQ_recreation_vigorous_week", "PAQ_work_vigorous_met"],
    match: "analog",
    note: "Both self-reported (UKB IPAQ-derived vs NHANES PAQ); NHANES separates leisure and work activity.",
  },
  {
    concept: "moderate physical activity",
    keywords: ["moderate activity", "exercise", "physical activity"],
    heap: /^(met_minutes_per_week_for_moderate_activity|number_of_days_week_of_moderate_physical_activity|summed_met_minutes_per_week_for_all_activity|summed_days_activity|summed_minutes_activity)/i,
    nhanes: ["PAQ_recreation_moderate_met", "PAQ_recreation_moderate_week", "PAQ_work_moderate_met"],
    match: "analog",
    note: "Both self-reported (UKB IPAQ-derived vs NHANES PAQ); HEAP summed-activity fields also include walking and vigorous activity.",
  },
  {
    concept: "walking",
    keywords: ["walking", "walk"],
    heap: /^(met_minutes_per_week_for_walking|number_of_days_week_walked|duration_of_walks)/i,
    nhanes: ["PAQ_walk_met", "PAQ_walk_days_per_week", "walk_min_per_day"],
    match: "analog",
    note: "Both self-reported walking; NHANES items cover walking or bicycling for transport.",
  },
  {
    concept: "sedentary time",
    keywords: ["sedentary", "television", "TV", "screen time", "sitting", "computer"],
    heap: /^time_spent_(watching_television|using_computer|driving)/i,
    nhanes: ["PAQ_sedentary_activity_min_per_day", "PA_sedentary_activity_min_per_day"],
    match: "analog",
    note: "HEAP: hours per day of TV, computer and driving as separate exposures. NHANES: total sedentary minutes per day.",
  },
  {
    concept: "calcium supplement",
    keywords: ["calcium"],
    heap: /multi_Calcium$/i,
    nhanes: ["DSQTCALC", "DR1TCALC"],
    match: "proxy",
    note: "HEAP: yes/no supplement use. NHANES: supplemental (DSQT) and dietary (DR1T) calcium in mg.",
  },
  {
    concept: "iron supplement",
    keywords: ["iron"],
    heap: /multi_Iron$/i,
    nhanes: ["DSQTIRON", "DR1TIRON"],
    match: "proxy",
    note: "HEAP: yes/no supplement use. NHANES: supplemental and dietary iron in mg.",
  },
  {
    concept: "selenium supplement",
    keywords: ["selenium"],
    heap: /multi_Selenium$/i,
    nhanes: ["LBXBSE", "DSQTSELE", "DR1TSELE"],
    match: "proxy",
    note: "HEAP: yes/no supplement use. NHANES: blood selenium (biomarker of total intake), supplemental and dietary selenium.",
  },
  {
    concept: "zinc supplement",
    keywords: ["zinc"],
    heap: /multi_Zinc$/i,
    nhanes: ["DSQTZINC", "DR1TZINC"],
    match: "proxy",
    note: "HEAP: yes/no supplement use. NHANES: supplemental and dietary zinc in mg.",
  },
  {
    concept: "folic acid supplement",
    keywords: ["folate", "folic acid", "vitamin B9"],
    heap: /multi_Folic_acid/i,
    nhanes: ["DSQTFA", "DR1TFOLA"],
    match: "proxy",
    note: "HEAP: yes/no supplement use. NHANES: supplemental folic acid and total dietary folate.",
  },
  {
    concept: "vitamin B supplement",
    keywords: ["vitamin B", "B12", "B6"],
    heap: /multi_Vitamin_B$/i,
    nhanes: ["LBXB12", "DSQTVB12", "DSQTVB6"],
    match: "proxy",
    note: "HEAP: yes/no use of any B-vitamin supplement. NHANES: serum B12 and supplemental B12/B6.",
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Find bridge entries for a free-text query: a NHANES variable name (exact), a HEAP exposure ID
 * (or fragment of one), or a concept/keyword.
 */
export function findBridgeEntries(query: string): HeapNhanesBridgeEntry[] {
  const raw = query.trim();
  const n = norm(raw);
  if (!n) return [];
  const byVar = HEAP_NHANES_BRIDGE.filter((e) => e.nhanes.some((v) => v.toLowerCase() === raw.toLowerCase()));
  if (byVar.length) return byVar;
  const words = n.split(" ");
  return HEAP_NHANES_BRIDGE.filter((e) => {
    if (e.heap.test(raw) || e.heap.test(raw.replace(/\s+/g, "_"))) return true;
    const hay = [e.concept, ...e.keywords].map(norm);
    // whole-word match in either direction: "smoking" hits "active smoking"; "pack years of smoking" hits "smoking"
    return hay.some((h) => {
      const hw = h.split(" ");
      return hw.every((w) => words.includes(w)) || words.every((w) => hw.includes(w));
    });
  });
}
