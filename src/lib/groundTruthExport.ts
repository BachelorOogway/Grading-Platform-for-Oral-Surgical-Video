import { parseJsonSafe } from "@/lib/json";
import { LEVEL4_DIMENSIONS } from "@/lib/level4Dimensions";
import {
  getCategoricalRaw,
  mergeMissedInstrumentNames,
  missedInstrumentCountOf,
  missedInstrumentNames,
} from "@/lib/categoricalFields";
import { computeLevel4HallucinationRate } from "@/lib/level4Metrics";
import {
  computeLevel2ContentMetrics,
  computeLevel2TemporalMetrics,
  temporalIoU,
  timeToSeconds,
} from "@/lib/temporalMetrics";
import {
  TIMING_DISCREPANCY_THRESHOLD_SEC,
  timesWithinThreshold,
} from "@/lib/timingDiscrepancy";

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return '""';
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export type GroundTruthRowInput = {
  videoOutputId: string;
  expertId: string;
  submittedAt: string;
  gradingData: unknown;
  parsedData: unknown;
  /** 1 | 2 | 3 — used only as a fallback when building consensus */
  graderSlot?: number;
};

function asObject(raw: unknown): any {
  if (typeof raw === "string") return parseJsonSafe(raw, {}) ?? {};
  if (raw && typeof raw === "object") return raw;
  return {};
}

function ynHall(v: unknown): "yes" | "no" | "" {
  if (v === true || v === "yes" || v === "Yes") return "yes";
  if (v === false || v === "no" || v === "No") return "no";
  return "";
}

function expertScoreOf(grading: any, key: string): number | null {
  const raw = getCategoricalRaw(
    grading,
    `level4.dimensions.${key}.expertScore`,
  );
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function secondsToTime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function meanSeconds(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function missedPhaseNames(grading: any): string[] {
  const list = grading?.level2?.missedPhases;
  if (!Array.isArray(list)) return [];
  return list
    .map((x: unknown) => String(x ?? "").trim())
    .filter(Boolean);
}

function missedPhaseCountOf(grading: any): number {
  const fromList = missedPhaseNames(grading).length;
  if (fromList > 0 || Array.isArray(grading?.level2?.missedPhases)) {
    return fromList;
  }
  const n = Number(grading?.level2?.missedPhasesCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function mergeMissedPhaseNames(gradings: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of gradings) {
    for (const name of missedPhaseNames(g)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function retainedStructureNames(grading: any): string[] {
  const structures: any[] = Array.isArray(grading?.level1?.structures)
    ? grading.level1.structures
    : [];
  return structures
    .filter(
      (s) =>
        s?.correct === true ||
        (s?.finalName && s?.incorrectReason !== "hallucination_absent"),
    )
    .map((s) => String(s.finalName ?? s.name ?? "").trim())
    .filter(Boolean);
}

function mergeStructureNamesWhenSameCount(gradings: any[]): string[] | null {
  const counts = gradings.map((g) => retainedStructureNames(g).length);
  if (counts.length === 0) return null;
  if (!counts.every((c) => c === counts[0])) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of gradings) {
    for (const name of retainedStructureNames(g)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

type PhaseBounds = { start: number; end: number };

/**
 * Average phase bounds across experts when every start (and every end) is
 * within the timing threshold; then stitch so consecutive phases share a
 * boundary with no gaps.
 */
export function averageAndStitchPhaseTimes(
  gradings: any[],
  thresholdSec = TIMING_DISCREPANCY_THRESHOLD_SEC,
): Array<{ trueStartTime: string; trueEndTime: string } | null> {
  let n = 0;
  for (const g of gradings) {
    const phases = g?.level2?.phases;
    if (Array.isArray(phases)) n = Math.max(n, phases.length);
  }
  if (n === 0) return [];

  const averaged: Array<PhaseBounds | null> = [];
  for (let i = 0; i < n; i++) {
    const starts: number[] = [];
    const ends: number[] = [];
    const startStrs: string[] = [];
    const endStrs: string[] = [];
    for (const g of gradings) {
      const p = g?.level2?.phases?.[i];
      const startRaw = String(p?.trueStartTime || p?.aiStartTime || "").trim();
      const endRaw = String(p?.trueEndTime || p?.aiEndTime || "").trim();
      const s = timeToSeconds(startRaw);
      const e = timeToSeconds(endRaw);
      if (s != null) {
        starts.push(s);
        startStrs.push(startRaw);
      }
      if (e != null) {
        ends.push(e);
        endStrs.push(endRaw);
      }
    }
    const startOk =
      starts.length > 0 && timesWithinThreshold(startStrs, thresholdSec);
    const endOk =
      ends.length > 0 && timesWithinThreshold(endStrs, thresholdSec);
    if (!startOk || !endOk) {
      averaged.push(null);
      continue;
    }
    const start = meanSeconds(starts);
    const end = meanSeconds(ends);
    if (start == null || end == null) {
      averaged.push(null);
      continue;
    }
    averaged.push({ start, end: Math.max(end, start) });
  }

  for (let i = 0; i < n - 1; i++) {
    const cur = averaged[i];
    const next = averaged[i + 1];
    if (!cur || !next) continue;
    const boundary = Math.round((cur.end + next.start) / 2);
    cur.end = boundary;
    next.start = boundary;
  }

  for (const b of averaged) {
    if (!b) continue;
    if (b.end <= b.start) b.end = b.start + 1;
  }

  return averaged.map((b) =>
    b
      ? {
          trueStartTime: secondsToTime(b.start),
          trueEndTime: secondsToTime(b.end),
        }
      : null,
  );
}

/**
 * Build one consensus grading per video from all completed forms.
 */
export function buildConsensusGrading(
  rows: GroundTruthRowInput[],
): {
  grading: any;
  expertIds: string[];
  submittedAt: string;
  structuresMerged: string[] | null;
} | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const slotA = a.graderSlot ?? 0;
    const slotB = b.graderSlot ?? 0;
    if (slotA === 3 && slotB !== 3) return -1;
    if (slotB === 3 && slotA !== 3) return 1;
    const tA = Date.parse(a.submittedAt) || 0;
    const tB = Date.parse(b.submittedAt) || 0;
    if (tA !== tB) return tB - tA;
    return a.expertId.localeCompare(b.expertId);
  });

  const gradings = sorted.map((r) => asObject(r.gradingData));
  const base = structuredClone(gradings[0] ?? {});

  const instrCounts = gradings.map((g) => missedInstrumentCountOf(g));
  const sameInstrCount =
    instrCounts.length > 0 && instrCounts.every((c) => c === instrCounts[0]);
  if (sameInstrCount) {
    const merged = mergeMissedInstrumentNames(gradings);
    if (!base.level1 || typeof base.level1 !== "object") base.level1 = {};
    base.level1.missedInstruments = merged;
    base.level1.missedInstrumentsCount = merged.length;
  }

  const phaseMissCounts = gradings.map((g) => missedPhaseCountOf(g));
  const samePhaseMiss =
    phaseMissCounts.length > 0 &&
    phaseMissCounts.every((c) => c === phaseMissCounts[0]);
  if (samePhaseMiss) {
    const merged = mergeMissedPhaseNames(gradings);
    if (!base.level2 || typeof base.level2 !== "object") base.level2 = {};
    base.level2.missedPhases = merged;
    base.level2.missedPhasesCount = merged.length;
  }

  const structuresMerged = mergeStructureNamesWhenSameCount(gradings);

  const stitched = averageAndStitchPhaseTimes(gradings);
  if (!base.level2 || typeof base.level2 !== "object") base.level2 = {};
  if (!Array.isArray(base.level2.phases)) base.level2.phases = [];
  for (let i = 0; i < stitched.length; i++) {
    const t = stitched[i];
    if (!t) continue;
    if (!base.level2.phases[i] || typeof base.level2.phases[i] !== "object") {
      base.level2.phases[i] = {};
    }
    base.level2.phases[i].trueStartTime = t.trueStartTime;
    base.level2.phases[i].trueEndTime = t.trueEndTime;
    const aiStart = String(base.level2.phases[i].aiStartTime ?? "");
    const aiEnd = String(base.level2.phases[i].aiEndTime ?? "");
    if (aiStart && aiEnd) {
      base.level2.phases[i].temporalIoU = temporalIoU(
        aiStart,
        aiEnd,
        t.trueStartTime,
        t.trueEndTime,
      );
    }
  }

  {
    const phases = Array.isArray(base.level2.phases) ? base.level2.phases : [];
    const temporal = computeLevel2TemporalMetrics(
      phases.map((p: any) => ({
        aiStartTime: String(p?.aiStartTime ?? ""),
        aiEndTime: String(p?.aiEndTime ?? ""),
        trueStartTime: String(p?.trueStartTime ?? ""),
        trueEndTime: String(p?.trueEndTime ?? ""),
      })),
    );
    const content = computeLevel2ContentMetrics(
      phases.map((p: any) => ({
        contentCorrect: p?.contentCorrect,
        phaseErrorType: p?.phaseErrorType,
      })),
    );
    base.level2.metrics = {
      meanTemporalIoU: temporal.meanTemporalIoU,
      mapAtIoU: temporal.mapAtIoU,
      contentAccuracy: content.contentAccuracy,
      contentHallucinationRate: content.contentHallucinationRate,
      contentMisrecognitionRate: content.contentMisrecognitionRate,
      contentCorrectCount: content.contentCorrectCount,
      contentHallucinationCount: content.contentHallucinationCount,
      contentMisrecognitionCount: content.contentMisrecognitionCount,
      contentTotalCount: content.total,
      perPhaseIoU: temporal.perPhaseIoU,
    };
  }

  if (!base.level4 || typeof base.level4 !== "object") base.level4 = {};
  const dimMap = new Map<string, any>();
  const existing = base.level4.dimensions;
  if (Array.isArray(existing)) {
    for (const d of existing) {
      if (d?.key) dimMap.set(String(d.key), { ...d });
    }
  } else if (existing && typeof existing === "object") {
    for (const [k, d] of Object.entries(existing as Record<string, any>)) {
      dimMap.set(k, { key: k, ...(d as object) });
    }
  }

  for (const def of LEVEL4_DIMENSIONS) {
    const scores = gradings
      .map((g) => expertScoreOf(g, def.key))
      .filter((n): n is number => n != null);
    const avg =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) /
          100
        : null;
    const prev = dimMap.get(def.key) ?? { key: def.key };
    let hall = prev.aiJustificationHallucination;
    if (hall !== true && hall !== false && hall !== "yes" && hall !== "no") {
      const votes = gradings.map((g) =>
        ynHall(
          getCategoricalRaw(
            g,
            `level4.dimensions.${def.key}.aiJustificationHallucination`,
          ),
        ),
      );
      const yes = votes.filter((v) => v === "yes").length;
      const no = votes.filter((v) => v === "no").length;
      hall = yes > no ? true : no > yes ? false : hall;
    }
    dimMap.set(def.key, {
      ...prev,
      key: def.key,
      label: def.label,
      expertScore: avg,
      aiJustificationHallucination:
        hall === true || hall === "yes"
          ? true
          : hall === false || hall === "no"
            ? false
            : hall,
    });
  }

  base.level4.dimensions = LEVEL4_DIMENSIONS.map(
    (d) => dimMap.get(d.key) ?? { key: d.key, label: d.label },
  );
  const hall = computeLevel4HallucinationRate(
    Object.fromEntries(
      LEVEL4_DIMENSIONS.map((d) => {
        const row = dimMap.get(d.key);
        return [
          d.key,
          {
            aiJustificationHallucination: ynHall(
              row?.aiJustificationHallucination,
            ),
          },
        ];
      }),
    ),
    LEVEL4_DIMENSIONS.map((d) => d.key),
  );
  if (hall) {
    base.level4.hallucinationRate = hall.rate;
    base.level4.hallucinationYesCount = hall.yesCount;
    base.level4.hallucinationTotalCount = hall.totalCount;
  }

  return {
    grading: base,
    expertIds: sorted.map((r) => r.expertId),
    submittedAt: sorted[0]?.submittedAt ?? "",
    structuresMerged,
  };
}

/**
 * Build per-video ground truth CSV: one row per video with all metrics,
 * including Level 2 timing (averaged + contiguous when within 3s).
 */
export function buildGroundTruthCsv(rows: GroundTruthRowInput[]): string {
  const byVideo = new Map<string, GroundTruthRowInput[]>();
  for (const row of rows) {
    const list = byVideo.get(row.videoOutputId) ?? [];
    list.push(row);
    byVideo.set(row.videoOutputId, list);
  }

  const l4Headers = LEVEL4_DIMENSIONS.flatMap((d) => [
    `l4_${d.key}_expert_score`,
    `l4_${d.key}_hallucination`,
  ]);

  const headers = [
    "videoOutputId",
    "expertIds",
    "submittedAt",
    "procedure_type_final",
    "procedure_type_source",
    "structures_final_json",
    "structures_merged_json",
    "structures_removed_hallucinations_json",
    "structure_correct_count",
    "structure_total_count",
    "structure_precision",
    "structure_hallucination_rate",
    "structure_misrecognition_rate",
    "instruments_final_json",
    "instruments_removed_hallucinations_json",
    "missed_instruments_json",
    "missed_instruments_count",
    "instrument_correct_count",
    "instrument_total_count",
    "instrument_precision",
    "instrument_recall",
    "instrument_f1",
    "instrument_hallucination_rate",
    "instrument_misrecognition_rate",
    "spatial_positioning_final",
    "spatial_positioning_source",
    "phases_final_json",
    "phases_timing_json",
    "missed_phases_json",
    "missed_phases_count",
    "missed_steps_final",
    "l2_mean_temporal_iou",
    "l2_map_at_iou",
    "l2_content_accuracy",
    "l2_content_hallucination_rate",
    "l2_content_misrecognition_rate",
    "next_action_final",
    "next_action_source",
    "nomenclature_correction",
    "surgery_completed_expert",
    "safety_check_pass",
    ...l4Headers,
    "l4_hallucination_rate",
  ];

  const lines = [headers.map(csvEscape).join(",")];

  const videos = Array.from(byVideo.keys()).sort((a, b) => a.localeCompare(b));
  for (const videoOutputId of videos) {
    const group = byVideo.get(videoOutputId)!;
    const consensus = buildConsensusGrading(group);
    if (!consensus) continue;

    const gd = consensus.grading;
    const parsed = asObject(group[0]?.parsedData);

    const l1 = gd.level1 ?? {};
    const l2 = gd.level2 ?? {};
    const l3 = gd.level3 ?? {};
    const l4 = gd.level4 ?? {};
    const l2m = l2.metrics ?? {};

    const procedureFinal =
      l1.procedureType ??
      (l1.procedureTypeCorrect
        ? parsed.level1?.procedureType
        : l1.procedureTypeCorrection) ??
      "";
    const procedureSource = l1.procedureTypeCorrect
      ? "ai"
      : l1.procedureTypeCorrection
        ? "expert"
        : "";

    const structures: any[] = Array.isArray(l1.structures) ? l1.structures : [];
    const structuresFinal = structures
      .filter((s) => s?.correct === true || s?.finalName)
      .map((s) => ({
        aiName: s.name,
        finalName: s.finalName ?? s.name,
        source: s.correct ? "ai" : "expert",
      }));
    const structuresRemoved = structures
      .filter(
        (s) =>
          s?.correct === false && s?.incorrectReason === "hallucination_absent",
      )
      .map((s) => s.name);

    const instruments: any[] = Array.isArray(l1.instruments)
      ? l1.instruments
      : [];
    const instrumentsFinal = instruments
      .filter((s) => s?.correct === true || s?.finalName)
      .map((s) => ({
        aiName: s.name,
        finalName: s.finalName ?? s.name,
        source: s.correct ? "ai" : "expert",
      }));
    const instrumentsRemoved = instruments
      .filter(
        (s) =>
          s?.correct === false && s?.incorrectReason === "hallucination_absent",
      )
      .map((s) => s.name);

    const missedInstruments = missedInstrumentNames(gd);

    const spatialFinal =
      l1.spatialPositioning ??
      (l1.spatialPositioningCorrect
        ? parsed.level1?.spatialPositioning
        : l1.spatialPositioningCorrection) ??
      "";
    const spatialSource = l1.spatialPositioningCorrect
      ? "ai"
      : l1.spatialPositioningCorrection
        ? "expert"
        : "";

    const phases: any[] = Array.isArray(l2.phases) ? l2.phases : [];
    const phasesFinal = phases.map((p, i) => ({
      index: i + 1,
      aiDescription: p.description,
      finalDescription: p.finalDescription ?? p.description,
      aiStart: p.aiStartTime ?? "",
      aiEnd: p.aiEndTime ?? "",
      trueStart: p.trueStartTime || p.aiStartTime || "",
      trueEnd: p.trueEndTime || p.aiEndTime || "",
      temporalIoU: p.temporalIoU ?? null,
      segmentationCorrect: p.segmentationCorrect === true,
      contentCorrect: p.contentCorrect === true,
      contentSource: p.contentCorrect ? "ai" : "expert",
      phaseErrorType: p.phaseErrorType ?? null,
      timingAdjusted:
        Boolean(p.trueStartTime || p.trueEndTime) &&
        (p.trueStartTime !== p.aiStartTime || p.trueEndTime !== p.aiEndTime),
    }));

    const phasesTiming = phases.map((p, i) => ({
      index: i + 1,
      trueStart: p.trueStartTime || p.aiStartTime || "",
      trueEnd: p.trueEndTime || p.aiEndTime || "",
      temporalIoU: p.temporalIoU ?? null,
    }));

    const missedPhases: string[] = Array.isArray(l2.missedPhases)
      ? l2.missedPhases.filter((x: unknown) => String(x ?? "").trim())
      : [];

    const nextActionFinal =
      l3.nextAction ??
      (l3.nextActionAccurate
        ? parsed.level3?.nextActionPrediction
        : l3.nextActionCorrection) ??
      "";
    const nextActionSource = l3.nextActionAccurate
      ? "ai"
      : l3.nextActionCorrection
        ? "expert"
        : "";

    const l4Dims: any[] = Array.isArray(l4.dimensions) ? l4.dimensions : [];
    const l4ByKey = new Map<string, any>();
    for (const d of l4Dims) {
      if (d?.key) l4ByKey.set(String(d.key), d);
    }

    const l4Cols = LEVEL4_DIMENSIONS.flatMap((def) => {
      const d = l4ByKey.get(def.key);
      const score = d?.expertScore ?? "";
      const h = ynHall(d?.aiJustificationHallucination);
      return [score, h];
    });

    const hallRate =
      typeof l4.hallucinationRate === "number" ? l4.hallucinationRate : "";

    lines.push(
      [
        videoOutputId,
        consensus.expertIds.join("|"),
        consensus.submittedAt,
        procedureFinal,
        procedureSource,
        JSON.stringify(structuresFinal),
        JSON.stringify(consensus.structuresMerged ?? []),
        JSON.stringify(structuresRemoved),
        l1.structureCorrectCount ?? "",
        l1.structureTotalCount ?? structures.length,
        l1.structurePrecision ?? "",
        l1.structureHallucinationRate ?? "",
        l1.structureMisrecognitionRate ?? "",
        JSON.stringify(instrumentsFinal),
        JSON.stringify(instrumentsRemoved),
        JSON.stringify(missedInstruments),
        missedInstruments.length,
        l1.instrumentCorrectCount ?? "",
        l1.instrumentTotalCount ?? instruments.length,
        l1.instrumentPrecision ?? "",
        l1.instrumentRecall ?? "",
        l1.instrumentF1 ?? "",
        l1.instrumentHallucinationRate ?? "",
        l1.instrumentMisrecognitionRate ?? "",
        spatialFinal,
        spatialSource,
        JSON.stringify(phasesFinal),
        JSON.stringify(phasesTiming),
        JSON.stringify(missedPhases),
        missedPhases.length,
        l2.missedStepsFinal ?? l2.missedStepsCorrection ?? "",
        l2m.meanTemporalIoU ?? "",
        l2m.mapAtIoU ?? "",
        l2m.contentAccuracy ?? "",
        l2m.contentHallucinationRate ?? "",
        l2m.contentMisrecognitionRate ?? "",
        nextActionFinal,
        nextActionSource,
        l3.nomenclatureCorrection ?? "",
        l3.surgeryCompleted === true
          ? "yes"
          : l3.surgeryCompleted === false
            ? "no"
            : "",
        l3.safetyCheckPass === true
          ? "pass"
          : l3.safetyCheckPass === false
            ? "fail"
            : "",
        ...l4Cols,
        hallRate,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return lines.join("\n");
}

/** @deprecated Prefer buildConsensusGrading — kept for callers that expect one row. */
export function pickFirstExpertPerVideo(
  rows: GroundTruthRowInput[],
): GroundTruthRowInput[] {
  const byVideo = new Map<string, GroundTruthRowInput>();

  function better(a: GroundTruthRowInput, b: GroundTruthRowInput): boolean {
    const slotA = a.graderSlot ?? 0;
    const slotB = b.graderSlot ?? 0;
    if (slotA === 3 && slotB !== 3) return true;
    if (slotB === 3 && slotA !== 3) return false;
    const tA = Date.parse(a.submittedAt) || 0;
    const tB = Date.parse(b.submittedAt) || 0;
    if (tA !== tB) return tA < tB;
    return a.expertId.localeCompare(b.expertId) < 0;
  }

  for (const row of rows) {
    const key = row.videoOutputId;
    const prev = byVideo.get(key);
    if (!prev || better(row, prev)) {
      byVideo.set(key, row);
    }
  }
  return Array.from(byVideo.values()).sort((a, b) =>
    a.videoOutputId.localeCompare(b.videoOutputId),
  );
}
