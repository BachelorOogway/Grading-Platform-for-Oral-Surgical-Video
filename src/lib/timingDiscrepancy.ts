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

/**
 * If any two graders differ by > thresholdSec on trueStart or trueEnd for a phase,
 * return discrepancy items to open.
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

  for (let i = 0; i < n; i++) {
    for (const field of ["trueStartTime", "trueEndTime"] as const) {
      const times: number[] = [];
      for (const g of usable) {
        const raw = timeAt(g, i, field);
        const sec = typeof raw === "string" ? timeToSeconds(raw) : null;
        if (sec != null) times.push(sec);
      }
      if (times.length < 2) continue;

      let diverge = false;
      for (let a = 0; a < times.length && !diverge; a++) {
        for (let b = a + 1; b < times.length; b++) {
          if (Math.abs(times[a] - times[b]) > thresholdSec) {
            diverge = true;
            break;
          }
        }
      }
      if (!diverge) continue;

      const path = `level2.phases.${i}.${field}`;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({
        path,
        label: `L2 Phase ${i + 1} ${field === "trueStartTime" ? "True Start" : "True End"} (>${thresholdSec}s apart)`,
      });
    }
  }

  return out;
}
