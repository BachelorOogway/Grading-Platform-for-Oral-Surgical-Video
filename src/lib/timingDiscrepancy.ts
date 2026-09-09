import { timeToSeconds } from "@/lib/temporalMetrics";
import { getCategoricalRaw } from "@/lib/categoricalFields";

export const TIMING_DISCREPANCY_THRESHOLD_SEC = 3;

export type TimingDiscrepancy = {
  path: string;
  label: string;
};

function phaseCount(gradings: unknown[]): number {
  let max = 0;
  for (const g of gradings) {
    const phases = (g as any)?.level2?.phases;
    if (Array.isArray(phases)) max = Math.max(max, phases.length);
  }
  return max;
}

function timeAt(grading: unknown, phaseIndex: number, field: "trueStartTime" | "trueEndTime") {
  return getCategoricalRaw(grading, `level2.phases.${phaseIndex}.${field}`);
}

function secondsAt(
  grading: unknown,
  phaseIndex: number,
  field: "trueStartTime" | "trueEndTime",
): number | null {
  const raw = timeAt(grading, phaseIndex, field);
  return typeof raw === "string" ? timeToSeconds(raw) : null;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** Paths whose consensus is judged by a seconds tolerance, not exact equality. */
export function isTimingPath(path: string): boolean {
  return path.endsWith(".trueStartTime") || path.endsWith(".trueEndTime");
}

/** True when every submitted time is within `thresholdSec` of the others. */
export function timesWithinThreshold(
  values: Array<string | null | undefined>,
  thresholdSec = TIMING_DISCREPANCY_THRESHOLD_SEC,
): boolean {
  const secs: number[] = [];
  for (const v of values) {
    const s = typeof v === "string" ? timeToSeconds(v) : null;
    if (s == null) return false;
    secs.push(s);
  }
  if (secs.length === 0) return false;
  return spread(secs) <= thresholdSec;
}

/**
 * A phase is contested when any two graders differ by > thresholdSec on the
 * true start, on the true end, or on the length of the window they marked
 * (00:00-00:03 vs 00:00-00:07 is a 4s window gap).
 */
export function findTimingBoundDiscrepancies(
  gradings: unknown[],
  thresholdSec = TIMING_DISCREPANCY_THRESHOLD_SEC,
): TimingDiscrepancy[] {
  const usable = gradings.filter((g) => g && typeof g === "object");
  if (usable.length < 2) return [];

  const n = phaseCount(usable);
  const out: TimingDiscrepancy[] = [];
  const seen = new Set<string>();

  const add = (phaseIndex: number, field: "trueStartTime" | "trueEndTime", reason: string) => {
    const path = `level2.phases.${phaseIndex}.${field}`;
    if (seen.has(path)) return;
    seen.add(path);
    out.push({
      path,
      label: `L2 Phase ${phaseIndex + 1} ${
        field === "trueStartTime" ? "True Start" : "True End"
      } (${reason})`,
    });
  };

  for (let i = 0; i < n; i++) {
    // Window length: only graders who gave both bounds can be compared.
    const durations: number[] = [];
    for (const g of usable) {
      const start = secondsAt(g, i, "trueStartTime");
      const end = secondsAt(g, i, "trueEndTime");
      if (start != null && end != null) durations.push(end - start);
    }
    const windowGap = durations.length >= 2 && spread(durations) > thresholdSec;

    for (const field of ["trueStartTime", "trueEndTime"] as const) {
      const times: number[] = [];
      for (const g of usable) {
        const sec = secondsAt(g, i, field);
        if (sec != null) times.push(sec);
      }
      const boundGap = times.length >= 2 && spread(times) > thresholdSec;

      if (boundGap) add(i, field, `>${thresholdSec}s apart`);
      else if (windowGap) add(i, field, `window >${thresholdSec}s apart`);
    }
  }

  return out;
}
