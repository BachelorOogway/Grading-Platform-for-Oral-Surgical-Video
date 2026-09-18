import { parseJsonSafe } from "@/lib/json";
import { LEVEL4_DIMENSIONS } from "@/lib/level4Dimensions";
import {
  getCategoricalRaw,
  mergeMissedInstrumentNames,
  missedInstrumentCountOf,
  missedInstrumentNames,
} from "@/lib/categoricalFields";
import { computeLevel4HallucinationRate } from "@/lib/level4Metrics";

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

/**
 * Build one consensus grading per video from all completed forms:
 * - Categorical fields are already aligned after discrepancy resolve / majority.
 * - Prefer the chronologically last completer (usually the tiebreaker) as the
 *   structural base, then overlay averaged Level 4 scores and merged missed
 *   instruments when counts agree.
 */
export function buildConsensusGrading(
  rows: GroundTruthRowInput[],
): { grading: any; expertIds: string[]; submittedAt: string } | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const slotA = a.graderSlot ?? 0;
    const slotB = b.graderSlot ?? 0;
    // Prefer slot 3 as base when present (post-majority / resolve write-back).
    if (slotA === 3 && slotB !== 3) return -1;
    if (slotB === 3 && slotA !== 3) return 1;
    const tA = Date.parse(a.submittedAt) || 0;
    const tB = Date.parse(b.submittedAt) || 0;
    if (tA !== tB) return tB - tA;
    return a.expertId.localeCompare(b.expertId);
  });

  const gradings = sorted.map((r) => asObject(r.gradingData));
  const base = structuredClone(gradings[0] ?? {});

  // Missed instruments: same count → union of names; else keep base (discrepancy).
  const counts = gradings.map((g) => missedInstrumentCountOf(g));
  const sameCount = counts.length > 0 && counts.every((c) => c === counts[0]);
  if (sameCount) {
    const merged = mergeMissedInstrumentNames(gradings);
    if (!base.level1 || typeof base.level1 !== "object") base.level1 = {};
    base.level1.missedInstruments = merged;
    base.level1.missedInstrumentsCount = merged.length;
  }

  // Level 4 scores: arithmetic mean of the three experts; hallucination from base
  // (already consensus after resolve / majority skip).
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
    // Hallucination: prefer resolved base; if still empty, majority of yes/no.
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
  };
}

/**
 * Build per-video ground truth from all graders on each video.
 * Level 4 expert scores are the mean of the three; other fields follow the
 * consensus grading (post discrepancy-solve / majority).
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
    "structures_removed_hallucinations_json",
    "instruments_final_json",
    "instruments_removed_hallucinations_json",
    "missed_instruments_json",
    "missed_instruments_count",
    "spatial_positioning_final",
    "spatial_positioning_source",
    "phases_final_json",
    "missed_phases_json",
    "missed_phases_count",
    "missed_steps_final",
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

    const instruments: any[] = Array.isArray(l1.instruments) ? l1.instruments : [];
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
    const phasesFinal = phases
      .filter((p) => p?.contentCorrect === true || p?.finalDescription)
      .map((p) => ({
        aiDescription: p.description,
        finalDescription: p.finalDescription ?? p.description,
        start: p.trueStartTime || p.aiStartTime,
        end: p.trueEndTime || p.aiEndTime,
        contentSource: p.contentCorrect ? "ai" : "expert",
        timingAdjusted:
          p.trueStartTime !== p.aiStartTime || p.trueEndTime !== p.aiEndTime,
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
      const hall = ynHall(d?.aiJustificationHallucination);
      return [score, hall];
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
        JSON.stringify(structuresRemoved),
        JSON.stringify(instrumentsFinal),
        JSON.stringify(instrumentsRemoved),
        JSON.stringify(missedInstruments),
        missedInstruments.length,
        spatialFinal,
        spatialSource,
        JSON.stringify(phasesFinal),
        JSON.stringify(missedPhases),
        missedPhases.length,
        l2.missedStepsFinal ?? l2.missedStepsCorrection ?? "",
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
