/** HH:MM:SS -> seconds */
export function timeToSeconds(t: string): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec((t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

/**
 * Temporal IoU for one phase:
 * IoU = |A ∩ B| / |A ∪ B|
 * where A = [aiStart, aiEnd], B = [trueStart, trueEnd]
 */
export function temporalIoU(
  aiStart: string,
  aiEnd: string,
  trueStart: string,
  trueEnd: string,
): number | null {
  const a0 = timeToSeconds(aiStart);
  const a1 = timeToSeconds(aiEnd);
  const b0 = timeToSeconds(trueStart);
  const b1 = timeToSeconds(trueEnd);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return null;
  if (a1 <= a0 || b1 <= b0) return 0;

  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const union = a1 - a0 + (b1 - b0) - inter;
  if (union <= 0) return 0;
  return inter / union;
}

export type Level2TemporalMetrics = {
  perPhaseIoU: (number | null)[];
  meanTemporalIoU: number | null;
  /** mAP averaged over IoU thresholds 0.50:0.05:0.95 */
  mapAtIoU: number | null;
  thresholds: number[];
  precisionAtThreshold: (number | null)[];
};

/**
 * mAP@IoU (1:1 matched phases):
 * For each thr in {0.5, 0.55, ..., 0.95}:
 *   P(thr) = (# phases with IoU >= thr) / N
 * mAP@IoU = mean_thr P(thr)
 */
export function computeLevel2TemporalMetrics(
  phases: Array<{
    aiStartTime: string;
    aiEndTime: string;
    trueStartTime: string;
    trueEndTime: string;
  }>,
): Level2TemporalMetrics {
  const thresholds: number[] = [];
  for (let t = 50; t <= 95; t += 5) thresholds.push(t / 100);

  const perPhaseIoU = phases.map((p) =>
    temporalIoU(p.aiStartTime, p.aiEndTime, p.trueStartTime, p.trueEndTime),
  );

  const valid = perPhaseIoU.filter((x): x is number => x != null);
  const meanTemporalIoU =
    valid.length === 0 ? null : valid.reduce((a, b) => a + b, 0) / valid.length;

  const n = perPhaseIoU.length;
  const precisionAtThreshold =
    n === 0
      ? thresholds.map(() => null)
      : thresholds.map((thr) => {
          const tp = perPhaseIoU.filter((iou) => iou != null && iou >= thr).length;
          return tp / n;
        });

  const precValid = precisionAtThreshold.filter((x): x is number => x != null);
  const mapAtIoU =
    precValid.length === 0
      ? null
      : precValid.reduce((a, b) => a + b, 0) / precValid.length;

  return {
    perPhaseIoU,
    meanTemporalIoU,
    mapAtIoU,
    thresholds,
    precisionAtThreshold,
  };
}

export function formatIoU(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(3);
}

export type Level2ContentMetrics = {
  total: number;
  contentCorrectCount: number;
  contentHallucinationCount: number;
  contentMisrecognitionCount: number;
  contentAccuracy: number | null;
  contentHallucinationRate: number | null;
  contentMisrecognitionRate: number | null;
};

/**
 * Content metrics over 1:1 phases:
 * accuracy = #contentCorrect / N
 * hallucination_rate = #hallucination_absent / N
 * misrecognition_rate = #misrecognition_present / N
 */
export function computeLevel2ContentMetrics(
  phases: Array<{
    contentCorrect?: string | boolean | null;
    phaseErrorType?: string | null;
  }>,
): Level2ContentMetrics {
  const total = phases.length;
  let contentCorrectCount = 0;
  let contentHallucinationCount = 0;
  let contentMisrecognitionCount = 0;

  for (const p of phases) {
    const ok = p.contentCorrect === true || p.contentCorrect === "correct";
    if (ok) {
      contentCorrectCount += 1;
      continue;
    }
    const err = String(p.phaseErrorType ?? "");
    if (
      err === "hallucination_absent" ||
      err === "seg_correct_hallucination_absent" ||
      err === "seg_incorrect_hallucination_absent"
    ) {
      contentHallucinationCount += 1;
    } else if (
      err === "misrecognition_present" ||
      err === "seg_correct_misrecognition_present" ||
      err === "seg_incorrect_misrecognition_present"
    ) {
      contentMisrecognitionCount += 1;
    }
  }

  return {
    total,
    contentCorrectCount,
    contentHallucinationCount,
    contentMisrecognitionCount,
    contentAccuracy: total > 0 ? contentCorrectCount / total : null,
    contentHallucinationRate: total > 0 ? contentHallucinationCount / total : null,
    contentMisrecognitionRate:
      total > 0 ? contentMisrecognitionCount / total : null,
  };
}
