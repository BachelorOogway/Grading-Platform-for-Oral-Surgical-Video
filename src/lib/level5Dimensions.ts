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
    label: "Visual Features & Anatomical Reality",
    maxWeight: 20,
    criteria: [
      "Hallucination Detection: Every anatomical structure and pathology described must truly exist within the video context.",
      "Visual Grounding: Accurately maps positions, orientations, and structural relationships without cross-modal spatial mismatch.",
    ],
    errors: [
      { key: "visualHallucination", label: "Visual Hallucination" },
      { key: "spatialMismatch", label: "Spatial Mismatch" },
    ],
  },
  {
    key: "coreActionsTemporal",
    label: "Core Actions & Temporal Flow Alignment",
    maxWeight: 20,
    criteria: [
      "Timeline Adherence: Chronological order of events in the text must perfectly align with the video sequence.",
      "Phase Capture: Reliably identifies transitions and milestones, ensuring no key segments are skipped or skipped backward.",
    ],
    errors: [
      { key: "temporalInversion", label: "Temporal Inversion" },
      { key: "coreStepOmission", label: "Core Step Omission" },
    ],
  },
  {
    key: "tacticalIntent",
    label: "Tactical Intent & Dynamic Decision Logic",
    maxWeight: 15,
    criteria: [
      "Action-to-Intent Derivation: Captures clinical reasoning rather than just replaying pixel changes (e.g., explaining why a route was switched).",
      "Adaptive Contextualization: Tracks shifts in operative pathways based on real-time findings.",
    ],
    errors: [
      { key: "missingCausalLogic", label: "Missing Causal Logic" },
      { key: "mechanicalReplay", label: "Mechanical Replay" },
    ],
  },
  {
    key: "anomalousEvents",
    label: "Anomalous Events & Exceptional Handling",
    maxWeight: 20,
    criteria: [
      "Event Sensitivity: Recognizes unexpected or sparse occurrences (e.g., sudden bleeding, tissue resistance, structural difficulties).",
      "Closure Resolution: Tracks the event until a stable clinical resolution is verified visually.",
    ],
    errors: [
      { key: "anomalousEventOmission", label: "Anomalous Event Omission" },
      { key: "unresolvedLogicLoop", label: "Unresolved Logic Loop" },
    ],
  },
  {
    key: "ergonomicsInstrument",
    label: "Ergonomics & Instrument Interaction",
    maxWeight: 10,
    criteria: [
      "Instrument Identification: Accurately specifies the classes or types of tools/devices introduced into the surgical field.",
      "Tool-Tissue Mapping: Correctly describes the interaction dynamics between active instruments and anatomical target surfaces.",
    ],
    errors: [
      { key: "instrumentRecognitionError", label: "Instrument Recognition Error" },
      { key: "misalignedToolInteraction", label: "Misaligned Tool Interaction" },
    ],
  },
  {
    key: "textualRegister",
    label: "Textual Register & Medical Nomenclature",
    maxWeight: 15,
    criteria: [
      "Professional Taxonomy: Deploys proper clinical and surgical terminology without colloquially translated artifacts.",
      "Structural Consistency: Conforms to expected technical report prose formats rather than standard conversational prose.",
    ],
    errors: [
      { key: "nonStandardNomenclature", label: "Non-Standard Nomenclature" },
      { key: "unstructuredProse", label: "Unstructured Prose" },
    ],
  },
];

export const LEVEL5_DIMENSION_KEYS = LEVEL5_DIMENSIONS.map((d) => d.key);

export const LEVEL5_MAX_TOTAL = LEVEL5_DIMENSIONS.reduce(
  (sum, d) => sum + d.maxWeight,
  0,
);

export const LEVEL5_AUTO_FAIL_CRITERIA =
  "If the generated report exhibits catastrophic directional hallucinations (e.g., wrong quadrant, inverted anatomical sides, or completely fabricated surgical arches) or completely overlooks a critical patient safety incident shown in the video, the total evaluation score collapses immediately to 0.";

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
