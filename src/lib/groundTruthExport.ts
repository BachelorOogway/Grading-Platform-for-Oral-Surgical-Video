import { parseJsonSafe } from "@/lib/json";

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return '""';
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

type GroundTruthRowInput = {
  videoOutputId: string;
  expertId: string;
  submittedAt: string;
  gradingData: unknown;
  parsedData: unknown;
};

/**
 * Build a per-submission "canonical / corrected" view of the video:
 * AI value kept when expert marked correct; otherwise expert correction.
 */
export function buildGroundTruthCsv(rows: GroundTruthRowInput[]): string {
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
  ];

  const lines = [headers.map(csvEscape).join(",")];

  for (const row of rows) {
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
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return lines.join("\n");
}
