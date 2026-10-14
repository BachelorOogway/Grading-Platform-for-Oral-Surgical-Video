/**
 * Level 5 operative-report rubric (VLM alignment).
 * Six weighted dimensions (max 100) plus a critical auto-fail that zeros the report.
 */

export type Level5ErrorDef = {
  key: string;
  label: string;
};

export type Level5DimensionDef = {
  key: string;
  label: string;
  criteria: string[];
  maxWeight: number;
  errors: Level5ErrorDef[];
};

export const LEVEL5_DIMENSIONS: Level5DimensionDef[] = [
  {
    key: "visualFeatures",
    label: "Visual Features & Anatomical Recognition",
    maxWeight: 20,
    criteria: [
      "Hallucination Detection: Written structures or pathological states must realistically exist in the video.",
      "Visual Alignment: Accurately identifies spatial orientation, morphology, and anatomical relationships without misrecognition.",
    ],
    errors: [
      { key: "visualHallucination", label: "Visual Hallucination" },
      { key: "orientationError", label: "Orientation Error" },
    ],
  },
  {
    key: "coreActionsTemporal",
    label: "Core Actions & Temporal Flow Alignment",
    maxWeight: 20,
    criteria: [
      "Temporal Correctness: The sequence of surgical steps in the text must perfectly align with the video timeline.",
      "Core Action Capture: Accurately identifies primary surgical manipulations without omission or illogical temporal skips.",
    ],
    errors: [
      { key: "sequenceInversion", label: "Sequence Inversion" },
      { key: "coreStepOmission", label: "Core Step Omission" },
    ],
  },
  {
    key: "surgicalIntent",
    label: "Surgical Intent & Dynamic Deduction",
    maxWeight: 15,
    criteria: [
      "Clinical Reasoning: Evaluates if the VLM infers the 'why' behind action shifts or exploratory movements seen in the video, rather than just mechanically listing raw tool-tissue interactions.",
    ],
    errors: [
      { key: "lackOfCausalInference", label: "Lack of Causal Inference" },
      { key: "mechanicalReplayOnly", label: "Mechanical Replay Only" },
    ],
  },
  {
    key: "anomalousEvents",
    label: "Anomalous Events & Rare State Capture",
    maxWeight: 20,
    criteria: [
      "Sensitivity to Variations: VLM must detect unexpected events (e.g., bleeding, anatomical anomalies, or difficulty) and completely log the subsequent troubleshooting loop to closure.",
    ],
    errors: [
      { key: "rareEventOmission", label: "Rare Event Omission" },
      { key: "unresolvedLogicLoop", label: "Unresolved Logic Loop" },
    ],
  },
  {
    key: "quantitativeItems",
    label: "Quantitative Items & Counting Closure",
    maxWeight: 10,
    criteria: [
      "Counting Accuracy: Absolute numbers of specimen resections, implants, or specialized instruments used in the video must match the text exactly.",
      "Data Consistency: No internal textual contradictions.",
    ],
    errors: [
      { key: "countingQuantityError", label: "Counting/Quantity Error" },
      { key: "internalInconsistency", label: "Internal Inconsistency" },
    ],
  },
  {
    key: "narrativeStructure",
    label: "Narrative Structure & Medical Registers",
    maxWeight: 15,
    criteria: [
      "Structural Standardization: Compliance with structured clinical templates (e.g., structured subheadings) over plain essay outputs.",
      "Terminology Precision: Standard medical nomenclature instead of literal translations or colloquial phrasing.",
    ],
    errors: [
      { key: "structuralDisarray", label: "Structural Disarray" },
      { key: "nonStandardRegister", label: "Non-Standard Register" },
    ],
  },
];

export const LEVEL5_DIMENSION_KEYS = LEVEL5_DIMENSIONS.map((d) => d.key);

export const LEVEL5_MAX_TOTAL = LEVEL5_DIMENSIONS.reduce(
  (sum, d) => sum + d.maxWeight,
  0,
);

export const LEVEL5_AUTO_FAIL_CRITERIA =
  "Any critical directional error (e.g., reversing left/right lateralities, severe absolute hallucinations completely divorced from the video, or omission of major patient safety complications) will result in an immediate score of 0 for the entire report.";

export function level5LabelForKey(key: string): string {
  return LEVEL5_DIMENSIONS.find((d) => d.key === key)?.label ?? key;
}

/** Drop the expert-evaluation stub that follows the AI report. */
export function cleanLevel5Report(raw: string): string {
  return (raw ?? "").split(/\[Human\s+Expert\s+Evaluation/i)[0].trim();
}

export function parseLevel5Score(raw: unknown, maxWeight: number): number | null {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > maxWeight) return null;
  return n;
}

export function isAutoFailYes(raw: unknown): boolean {
  return raw === true || raw === "yes" || raw === "Yes";
}

type DimStored = {
  key?: unknown;
  score?: unknown;
  errors?: unknown;
  remarks?: unknown;
};

function dimsFromGrading(grading: unknown): DimStored[] {
  const l5 = (grading as { level5?: { dimensions?: unknown } } | null)?.level5;
  const dims = l5?.dimensions;
  if (Array.isArray(dims)) return dims as DimStored[];
  if (dims && typeof dims === "object") {
    return Object.entries(dims as Record<string, DimStored>).map(([key, d]) => ({
      key,
      score: d?.score,
      errors: d?.errors,
      remarks: d?.remarks,
    }));
  }
  return [];
}

function errorsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter(Boolean).sort();
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v === true || v === "yes" || v === "Yes")
      .map(([k]) => k)
      .sort();
  }
  return [];
}

export type Level5ScoreSummary = {
  reportScore: number;
  maxTotal: number;
  autoFail: boolean;
  dimensionSum: number;
  byKey: Record<
    string,
    { score: number | null; maxWeight: number; errors: string[]; remarks: string }
  >;
  labeledCount: number;
};

/** Final report score: 0 if auto-fail, else sum of dimension scores (0–100). */
export function level5ScoreFromGrading(grading: unknown): Level5ScoreSummary {
  const l5 = (grading as { level5?: Record<string, unknown> } | null)?.level5 ?? {};
  const autoFail = isAutoFailYes(l5.autoFail);
  const stored = new Map<string, DimStored>();
  for (const d of dimsFromGrading(grading)) {
    if (d?.key) stored.set(String(d.key), d);
  }

  const byKey: Level5ScoreSummary["byKey"] = {};
  let dimensionSum = 0;
  let labeledCount = 0;
  for (const def of LEVEL5_DIMENSIONS) {
    const row = stored.get(def.key);
    const score = parseLevel5Score(row?.score, def.maxWeight);
    const errList = errorsOf(row?.errors);
    const remarks = String(row?.remarks ?? "").trim();
    byKey[def.key] = {
      score,
      maxWeight: def.maxWeight,
      errors: errList,
      remarks,
    };
    if (score != null) {
      labeledCount += 1;
      dimensionSum += score;
    }
  }

  return {
    reportScore: autoFail ? 0 : dimensionSum,
    maxTotal: LEVEL5_MAX_TOTAL,
    autoFail,
    dimensionSum,
    byKey,
    labeledCount,
  };
}

/** Sample standard deviation; null when fewer than 2 values. */
export function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type Level5VideoScoreStats = {
  videoOutputId: string;
  expertCount: number;
  scores: number[];
  mean: number | null;
  sd: number | null;
};

export type Level5GlobalMetrics = {
  formCount: number;
  /** Forms with a usable report score (all dimensions scored, or auto-fail set) */
  labeledFormCount: number;
  overallMean: number | null;
  overallSd: number | null;
  videoCount: number;
  perVideo: Level5VideoScoreStats[];
};

/**
 * Per-video mean/SD of Level 5 report scores, plus overall mean/SD
 * across every expert form that has a complete Level 5 score.
 */
export function computeLevel5GlobalMetrics(
  rows: Array<{ videoOutputId?: string; gradingData: unknown }>,
): Level5GlobalMetrics {
  const byVideo = new Map<string, number[]>();
  const allScores: number[] = [];

  for (const r of rows) {
    const summary = level5ScoreFromGrading(r.gradingData);
    // Require every dimension scored (or auto-fail with all dims filled).
    if (summary.labeledCount < LEVEL5_DIMENSIONS.length) continue;
    const score = summary.reportScore;
    allScores.push(score);
    const vid = r.videoOutputId?.trim();
    if (!vid) continue;
    const list = byVideo.get(vid) ?? [];
    list.push(score);
    byVideo.set(vid, list);
  }

  const perVideo: Level5VideoScoreStats[] = [...byVideo.entries()]
    .map(([videoOutputId, scores]) => ({
      videoOutputId,
      expertCount: scores.length,
      scores,
      mean: meanOf(scores),
      sd: sampleStdDev(scores),
    }))
    .sort((a, b) =>
      a.videoOutputId.localeCompare(b.videoOutputId, undefined, {
        numeric: true,
      }),
    );

  return {
    formCount: rows.length,
    labeledFormCount: allScores.length,
    overallMean: meanOf(allScores),
    overallSd: sampleStdDev(allScores),
    videoCount: perVideo.length,
    perVideo,
  };
}
