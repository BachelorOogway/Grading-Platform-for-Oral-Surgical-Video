import { parseJsonSafe } from "@/lib/json";
import { LEVEL4_DIMENSIONS } from "@/lib/level4Dimensions";

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
  /** 1 | 2 | 3 — prefer slot 3 (majority consensus) when present */
  graderSlot?: number;
};

/**
 * One row per video: prefer grader slot 3 (tiebreaker with 2:1 majority applied),
 * else earliest submission. Tie-break by expertId ascending.
 */
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

/**
 * Build per-video ground truth:
 * AI value kept when expert marked correct; otherwise expert correction.
 * Level 4 expert scores included. Prefer 3rd grader (majority) when available.
 */
export function buildGroundTruthCsv(rows: GroundTruthRowInput[]): string {
  const selected = pickFirstExpertPerVideo(rows);

  const l4Headers = LEVEL4_DIMENSIONS.flatMap((d) => [
    `l4_${d.key}_expert_score`,
    `l4_${d.key}_hallucination`,
  ]);

  const headers = [
    "videoOutputId",
    "expertId",
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

  for (const row of selected) {
    const gd: any =
      typeof row.gradingData === "string"
        ? parseJsonSafe(row.gradingData, {})
        : row.gradingData && typeof row.gradingData === "object"
          ? row.gradingData
          : {};
    const parsed: any =
      typeof row.parsedData === "string"
        ? parseJsonSafe(row.parsedData, {})
        : row.parsedData && typeof row.parsedData === "object"
          ? row.parsedData
          : {};

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

    const missedInstruments: string[] = Array.isArray(l1.missedInstruments)
      ? l1.missedInstruments
      : [];

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
      ? l2.missedPhases
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
      const hall =
        d?.aiJustificationHallucination === true ||
        d?.aiJustificationHallucination === "yes"
          ? "yes"
          : d?.aiJustificationHallucination === false ||
              d?.aiJustificationHallucination === "no"
            ? "no"
            : "";
      return [score, hall];
    });

    const hallRate =
      typeof l4.hallucinationRate === "number" ? l4.hallucinationRate : "";

    lines.push(
      [
        row.videoOutputId,
        row.expertId,
        row.submittedAt,
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
