import { parseJsonSafe } from "./json";

export type YesNo = "yes" | "no";

export type Level3FormSignals = {
  /** Expert ground truth: surgery completed? */
  expertCompleted: YesNo | null;
  /** AI prediction: surgery completed? */
  aiCompleted: YesNo | null;
  nextActionAccurate: boolean | null;
  nomenclatureStandardized: boolean | null;
  safetyCheckPass: boolean | null;
};

export type Level3GlobalMetrics = {
  formCount: number;
  /** Forms where both AI and expert completion labels are known */
  exitEligibleCount: number;
  /** Expert=No forms (next-action / nomenclature / safety denominators) */
  incompleteExpertCount: number;

  exitTruePositive: number;
  exitFalsePositive: number;
  exitFalseNegative: number;
  exitTrueNegative: number;

  /** TP / (TP + FP); null if AI never predicted completed */
  exitPrecision: number | null;
  /** TP / (TP + FN); null if expert never marked completed */
  exitRecall: number | null;
  /** Correct next action among Expert=No forms */
  globalPrecision: number | null;
  /** Standardized nomenclature among Expert=No forms */
  nomenclatureAccuracy: number | null;
  /** Safety Fail among Expert=No forms */
  safetyFailRate: number | null;
  /** (AI=Yes ∧ Expert=No) / all forms */
  falseExitRate: number | null;
};

function parseYesNo(raw: unknown): YesNo | null {
  if (raw === true || raw === "yes" || raw === "Yes" || raw === "YES") return "yes";
  if (raw === false || raw === "no" || raw === "No" || raw === "NO") return "no";
  if (typeof raw === "string") {
    const t = raw.trim().toLowerCase();
    if (t === "yes" || t.startsWith("yes")) return "yes";
    if (t === "no" || t.startsWith("no")) return "no";
  }
  return null;
}

function parseBoolCorrect(raw: unknown): boolean | null {
  if (raw === true || raw === "correct" || raw === "Correct") return true;
  if (raw === false || raw === "incorrect" || raw === "Incorrect") return false;
  return null;
}

function parseSafetyPass(raw: unknown): boolean | null {
  if (raw === true || raw === "pass" || raw === "Pass") return true;
  if (raw === false || raw === "fail" || raw === "Fail") return false;
  return null;
}

/** Extract AI completion label from AiOutput.parsedData JSON string/object. */
export function aiCompletedFromParsedData(parsedData: unknown): YesNo | null {
  const parsed =
    typeof parsedData === "string"
      ? parseJsonSafe<Record<string, unknown>>(parsedData, {})
      : parsedData && typeof parsedData === "object"
        ? (parsedData as Record<string, unknown>)
        : {};
  const l3 = (parsed.level3 ?? {}) as Record<string, unknown>;
  return parseYesNo(l3.surgeryCompleted);
}

/** Extract Level 3 expert judgements from saved gradingData. */
export function level3SignalsFromGradingData(
  gradingData: unknown,
  aiCompleted: YesNo | null,
): Level3FormSignals {
  const gd =
    typeof gradingData === "string"
      ? parseJsonSafe<Record<string, unknown>>(gradingData, {})
      : gradingData && typeof gradingData === "object"
        ? (gradingData as Record<string, unknown>)
        : {};
  const l3 = (gd.level3 ?? {}) as Record<string, unknown>;

  return {
    expertCompleted: parseYesNo(l3.surgeryCompleted),
    aiCompleted,
    nextActionAccurate: parseBoolCorrect(l3.nextActionAccurate),
    nomenclatureStandardized: parseBoolCorrect(l3.nomenclatureStandardized),
    safetyCheckPass: parseSafetyPass(l3.safetyCheckPass),
  };
}

function ratio(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

/**
 * Aggregate Level 3 metrics over all grading forms.
 *
 * Exit Precision = (AI=Yes ∧ Expert=Yes) / (AI=Yes)
 * Exit Recall    = (AI=Yes ∧ Expert=Yes) / (Expert=Yes)
 * Global Precision = (Expert=No ∧ nextAction correct) / (Expert=No)
 * Nomenclature Accuracy = (Expert=No ∧ nomenclature correct) / (Expert=No)
 * Safety Fail Rate = (Expert=No ∧ safety fail) / (Expert=No)
 * False Exit Rate = (AI=Yes ∧ Expert=No) / (all forms)
 */
export function computeLevel3GlobalMetrics(
  forms: Level3FormSignals[],
): Level3GlobalMetrics {
  let exitTruePositive = 0;
  let exitFalsePositive = 0;
  let exitFalseNegative = 0;
  let exitTrueNegative = 0;
  let exitEligibleCount = 0;

  let incompleteExpertCount = 0;
  let nextActionCorrect = 0;
  let nomenclatureCorrect = 0;
  let safetyFail = 0;
  let falseExit = 0;

  for (const f of forms) {
    if (f.aiCompleted != null && f.expertCompleted != null) {
      exitEligibleCount += 1;
      if (f.aiCompleted === "yes" && f.expertCompleted === "yes") {
        exitTruePositive += 1;
      } else if (f.aiCompleted === "yes" && f.expertCompleted === "no") {
        exitFalsePositive += 1;
      } else if (f.aiCompleted === "no" && f.expertCompleted === "yes") {
        exitFalseNegative += 1;
      } else {
        exitTrueNegative += 1;
      }
    }

    if (f.aiCompleted === "yes" && f.expertCompleted === "no") {
      falseExit += 1;
    }

    if (f.expertCompleted === "no") {
      incompleteExpertCount += 1;
      if (f.nextActionAccurate === true) nextActionCorrect += 1;
      if (f.nomenclatureStandardized === true) nomenclatureCorrect += 1;
      if (f.safetyCheckPass === false) safetyFail += 1;
    }
  }

  const aiYes = exitTruePositive + exitFalsePositive;
  const expertYes = exitTruePositive + exitFalseNegative;

  return {
    formCount: forms.length,
    exitEligibleCount,
    incompleteExpertCount,
    exitTruePositive,
    exitFalsePositive,
    exitFalseNegative,
    exitTrueNegative,
    exitPrecision: ratio(exitTruePositive, aiYes),
    exitRecall: ratio(exitTruePositive, expertYes),
    globalPrecision: ratio(nextActionCorrect, incompleteExpertCount),
    nomenclatureAccuracy: ratio(nomenclatureCorrect, incompleteExpertCount),
    safetyFailRate: ratio(safetyFail, incompleteExpertCount),
    falseExitRate: ratio(falseExit, forms.length),
  };
}

export function formatMetricRate(value: number | null, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(digits > 2 ? 2 : digits) + "%";
}
