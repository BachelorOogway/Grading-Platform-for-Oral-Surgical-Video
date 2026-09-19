import { parseJsonSafe } from "./json";
import { inferAiMissedPhasesCount } from "./aiOutputParser";
import {
  aiCompletedFromParsedData,
  computeLevel3GlobalMetrics,
  level3SignalsFromGradingData,
  type Level3GlobalMetrics,
} from "./level3Metrics";
import {
  computeInterExpertIccMetrics,
  computeLevel4GlobalMetrics,
  level4HallucinationFromGradingData,
  level4ScorePairsFromRow,
  type InterExpertIccMetrics,
  type Level4GlobalMetrics,
} from "./level4Metrics";

export type { Level3GlobalMetrics, Level4GlobalMetrics, InterExpertIccMetrics };
export { formatMetricRate } from "./level3Metrics";
export {
  computeInterExpertIccMetrics,
  iccAbsoluteAgreement,
  fisherZAverage,
} from "./level4Metrics";

export type Level1GlobalMetrics = {
  formCount: number;
  procedureTypeLabeledCount: number;
  procedureTypeCorrectCount: number;
  /** Correct procedure-type judgements / labeled forms */
  procedureTypeAccuracy: number | null;
  spatialPositioningLabeledCount: number;
  spatialPositioningCorrectCount: number;
  /** Correct spatial-positioning judgements / labeled forms */
  spatialPositioningAccuracy: number | null;
};

export type Level2GlobalMetrics = {
  formCount: number;
  /** Forms with both AI and expert missed-phase counts */
  countPairCount: number;
  /** Pearson r between AI and expert missed-phase counts */
  missedPhasesCountCorrelation: number | null;
  /** Expert: missed-phase content Correct / labeled content judgements */
  contentLabeledCount: number;
  contentCorrectCount: number;
  missedPhasesContentAccuracy: number | null;
};

export type GlobalGradingMetrics = {
  formCount: number;
  level1: Level1GlobalMetrics;
  level2: Level2GlobalMetrics;
  level3: Level3GlobalMetrics;
  level4: Level4GlobalMetrics;
  /** Inter-expert ICC on videos with ≥2 expert Level-4 forms */
  interExpert: InterExpertIccMetrics;
};

type Level1FormSignals = {
  procedureTypeCorrect: boolean | null;
  spatialPositioningCorrect: boolean | null;
};

type Level2FormSignals = {
  aiMissedPhasesCount: number | null;
  expertMissedPhasesCount: number | null;
  missedPhasesContentCorrect: boolean | null;
};

function parseBoolCorrect(raw: unknown): boolean | null {
  if (raw === true || raw === "correct" || raw === "Correct") return true;
  if (raw === false || raw === "incorrect" || raw === "Incorrect") return false;
  return null;
}

function parseNonNegInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseGradingObject(gradingData: unknown): Record<string, unknown> {
  if (typeof gradingData === "string") {
    return parseJsonSafe<Record<string, unknown>>(gradingData, {});
  }
  if (gradingData && typeof gradingData === "object") {
    return gradingData as Record<string, unknown>;
  }
  return {};
}

function parseParsedObject(parsedData: unknown): Record<string, unknown> {
  if (typeof parsedData === "string") {
    return parseJsonSafe<Record<string, unknown>>(parsedData, {});
  }
  if (parsedData && typeof parsedData === "object") {
    return parsedData as Record<string, unknown>;
  }
  return {};
}

function ratio(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

/** Pearson product-moment correlation; null if <2 pairs or zero variance. */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const mx = sumX / n;
  const my = sumY / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function level1SignalsFromGradingData(
  gradingData: unknown,
): Level1FormSignals {
  const l1 = (parseGradingObject(gradingData).level1 ?? {}) as Record<
    string,
    unknown
  >;
  return {
    procedureTypeCorrect: parseBoolCorrect(l1.procedureTypeCorrect),
    spatialPositioningCorrect: parseBoolCorrect(l1.spatialPositioningCorrect),
  };
}

export function aiMissedPhasesCountFromParsedData(
  parsedData: unknown,
): number | null {
  const l2 = (parseParsedObject(parsedData).level2 ?? {}) as Record<
    string,
    unknown
  >;
  const stored = parseNonNegInt(l2.aiMissedPhasesCount);
  if (stored != null) return stored;
  const evalText =
    typeof l2.missedStepsEvaluation === "string" ? l2.missedStepsEvaluation : "";
  if (!evalText.trim()) return null;
  return inferAiMissedPhasesCount(evalText, evalText);
}

/**
 * Level 2 missed-phase signals:
 * - AI count from saved grading snapshot or AiOutput.parsedData
 * - Expert count from grading form missedPhasesCount
 * - Content correctness from missedStepsDetectedCorrect
 */
export function level2SignalsFromGradingData(
  gradingData: unknown,
  parsedData?: unknown,
): Level2FormSignals {
  const l2 = (parseGradingObject(gradingData).level2 ?? {}) as Record<
    string,
    unknown
  >;
  const fromGrading = parseNonNegInt(l2.aiMissedPhasesCount);
  const fromParsed = aiMissedPhasesCountFromParsedData(parsedData);

  return {
    aiMissedPhasesCount: fromGrading ?? fromParsed,
    expertMissedPhasesCount: parseNonNegInt(l2.missedPhasesCount),
    missedPhasesContentCorrect: parseBoolCorrect(l2.missedStepsDetectedCorrect),
  };
}

export function computeLevel1GlobalMetrics(
  forms: Level1FormSignals[],
): Level1GlobalMetrics {
  let procedureTypeLabeledCount = 0;
  let procedureTypeCorrectCount = 0;
  let spatialPositioningLabeledCount = 0;
  let spatialPositioningCorrectCount = 0;

  for (const f of forms) {
    if (f.procedureTypeCorrect != null) {
      procedureTypeLabeledCount += 1;
      if (f.procedureTypeCorrect) procedureTypeCorrectCount += 1;
    }
    if (f.spatialPositioningCorrect != null) {
      spatialPositioningLabeledCount += 1;
      if (f.spatialPositioningCorrect) spatialPositioningCorrectCount += 1;
    }
  }

  return {
    formCount: forms.length,
    procedureTypeLabeledCount,
    procedureTypeCorrectCount,
    procedureTypeAccuracy: ratio(
      procedureTypeCorrectCount,
      procedureTypeLabeledCount,
    ),
    spatialPositioningLabeledCount,
    spatialPositioningCorrectCount,
    spatialPositioningAccuracy: ratio(
      spatialPositioningCorrectCount,
      spatialPositioningLabeledCount,
    ),
  };
}

export function computeLevel2GlobalMetrics(
  forms: Level2FormSignals[],
): Level2GlobalMetrics {
  const aiCounts: number[] = [];
  const expertCounts: number[] = [];
  let contentLabeledCount = 0;
  let contentCorrectCount = 0;

  for (const f of forms) {
    if (f.aiMissedPhasesCount != null && f.expertMissedPhasesCount != null) {
      aiCounts.push(f.aiMissedPhasesCount);
      expertCounts.push(f.expertMissedPhasesCount);
    }
    if (f.missedPhasesContentCorrect != null) {
      contentLabeledCount += 1;
      if (f.missedPhasesContentCorrect) contentCorrectCount += 1;
    }
  }

  const countPairCount = aiCounts.length;

  return {
    formCount: forms.length,
    countPairCount,
    missedPhasesCountCorrelation: pearsonCorrelation(aiCounts, expertCounts),
    contentLabeledCount,
    contentCorrectCount,
    missedPhasesContentAccuracy: ratio(contentCorrectCount, contentLabeledCount),
  };
}

export type GradingResultRow = {
  gradingData: unknown;
  parsedData: unknown;
  videoOutputId?: string;
  expertId?: string;
  kind?: string;
};

/** Build all Level 1–4 global metrics from grading rows + AI parsed outputs. */
export function computeGlobalGradingMetrics(
  rows: GradingResultRow[],
): GlobalGradingMetrics {
  const level1Forms = rows.map((r) => level1SignalsFromGradingData(r.gradingData));
  const level2Forms = rows.map((r) =>
    level2SignalsFromGradingData(r.gradingData, r.parsedData),
  );
  const level3Forms = rows.map((r) =>
    level3SignalsFromGradingData(
      r.gradingData,
      aiCompletedFromParsedData(r.parsedData),
    ),
  );
  const level4Pairs = rows.flatMap((r) =>
    level4ScorePairsFromRow(r.gradingData, r.parsedData),
  );
  const formHallucinationRates: number[] = [];
  let hallucinationYesCount = 0;
  let hallucinationTotalCount = 0;
  for (const r of rows) {
    const h = level4HallucinationFromGradingData(r.gradingData);
    if (!h) continue;
    formHallucinationRates.push(h.rate);
    hallucinationYesCount += h.yesCount;
    hallucinationTotalCount += h.totalCount;
  }
  const interExpert = computeInterExpertIccMetrics(
    rows
      .filter((r) => r.videoOutputId && r.expertId)
      .map((r) => ({
        videoOutputId: r.videoOutputId as string,
        expertId: r.expertId as string,
        gradingData: r.gradingData,
      })),
  );

  return {
    formCount: rows.length,
    level1: computeLevel1GlobalMetrics(level1Forms),
    level2: computeLevel2GlobalMetrics(level2Forms),
    level3: computeLevel3GlobalMetrics(level3Forms),
    level4: computeLevel4GlobalMetrics(
      level4Pairs,
      rows.length,
      formHallucinationRates,
      hallucinationYesCount,
      hallucinationTotalCount,
    ),
    interExpert,
  };
}

export function formatMetricNumber(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}
