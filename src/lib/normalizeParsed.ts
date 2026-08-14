import { parseAiOutputToParsedData, type AiParsedData } from "@/lib/aiOutputParser";

/**
 * Prefer stored parsedData when it has usable structures/phases;
 * otherwise fall back to re-parsing rawText.
 */
export function normalizeAiParsedData(
  raw: unknown,
  rawText: string,
): AiParsedData {
  const parsed = parseAiOutputToParsedData(rawText);
  const stored = raw as Partial<AiParsedData> | null;

  if (!stored || typeof stored !== "object") return parsed;

  const storedStructures = stored.level1?.structures;
  const storedPhases = stored.level2?.phases;
  const hasStoredShape =
    (Array.isArray(storedStructures) && storedStructures.length > 0) ||
    (Array.isArray(storedPhases) && storedPhases.length > 0);

  if (!hasStoredShape) return parsed;

  return {
    level1: {
      procedureType:
        stored.level1?.procedureType ?? parsed.level1.procedureType,
      structures:
        Array.isArray(storedStructures) && storedStructures.length > 0
          ? storedStructures
          : parsed.level1.structures,
      totalStructures:
        stored.level1?.totalStructures ?? parsed.level1.totalStructures,
      instruments:
        Array.isArray(stored.level1?.instruments) &&
        stored.level1!.instruments!.length > 0
          ? stored.level1!.instruments!
          : parsed.level1.instruments,
      totalInstruments:
        stored.level1?.totalInstruments ?? parsed.level1.totalInstruments,
      spatialPositioning:
        stored.level1?.spatialPositioning ?? parsed.level1.spatialPositioning,
    },
    level2: {
      phases:
        Array.isArray(storedPhases) && storedPhases.length > 0
          ? storedPhases
          : parsed.level2.phases,
      totalPhases: stored.level2?.totalPhases ?? parsed.level2.totalPhases,
      missedStepsEvaluation:
        stored.level2?.missedStepsEvaluation ??
        parsed.level2.missedStepsEvaluation,
      aiMissedPhasesCount:
        stored.level2?.aiMissedPhasesCount ?? parsed.level2.aiMissedPhasesCount,
    },
    level3: {
      nextActionPrediction:
        stored.level3?.nextActionPrediction ??
        parsed.level3.nextActionPrediction,
      clinicalRationale:
        stored.level3?.clinicalRationale ?? parsed.level3.clinicalRationale,
      surgeryCompleted:
        stored.level3?.surgeryCompleted ?? parsed.level3.surgeryCompleted,
    },
    level4: {
      dimensions:
        Array.isArray(stored.level4?.dimensions) &&
        stored.level4!.dimensions!.length > 0
          ? stored.level4!.dimensions!
          : parsed.level4.dimensions,
    },
  };
}

/**
 * If AI parse lost phases/structures, rebuild skeleton from a saved grading payload.
 */
export function enrichParsedFromGrading(
  parsed: AiParsedData,
  grading: unknown,
): AiParsedData {
  if (!grading || typeof grading !== "object") return parsed;
  const g = grading as any;
  let next = parsed;

  const gPhases = g.level2?.phases;
  if (
    (!next.level2.phases || next.level2.phases.length === 0) &&
    Array.isArray(gPhases) &&
    gPhases.length > 0
  ) {
    next = {
      ...next,
      level2: {
        ...next.level2,
        phases: gPhases.map((p: any) => ({
          description: String(p?.description ?? ""),
          aiStartTime: String(p?.aiStartTime ?? ""),
          aiEndTime: String(p?.aiEndTime ?? ""),
        })),
        totalPhases: next.level2.totalPhases ?? gPhases.length,
      },
    };
  }

  const gStructures = g.level1?.structures;
  if (
    (!next.level1.structures || next.level1.structures.length === 0) &&
    Array.isArray(gStructures) &&
    gStructures.length > 0
  ) {
    next = {
      ...next,
      level1: {
        ...next.level1,
        structures: gStructures.map((s: any) => ({
          name: String(s?.name ?? s?.finalName ?? ""),
        })),
        totalStructures: next.level1.totalStructures ?? gStructures.length,
      },
    };
  }

  const gInstruments = g.level1?.instruments;
  if (
    (!next.level1.instruments || next.level1.instruments.length === 0) &&
    Array.isArray(gInstruments) &&
    gInstruments.length > 0
  ) {
    next = {
      ...next,
      level1: {
        ...next.level1,
        instruments: gInstruments.map((s: any) => ({
          name: String(s?.name ?? s?.finalName ?? ""),
        })),
        totalInstruments: next.level1.totalInstruments ?? gInstruments.length,
      },
    };
  }

  return next;
}
