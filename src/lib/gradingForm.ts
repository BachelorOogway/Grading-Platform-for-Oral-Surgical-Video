import type { AiParsedData } from "./aiOutputParser";
import {
  computeLevel2ContentMetrics,
  computeLevel2TemporalMetrics,
  temporalIoU,
} from "./temporalMetrics";

export type Correctness = "correct" | "incorrect";

/** Incorrect 细分原因 */
export type IncorrectReason =
  | "hallucination_absent" // hallucinates when the target is absent
  | "misrecognition_present"; // misrecognition when the target is present

export type ItemJudgement = {
  correct: Correctness;
  incorrectReason?: IncorrectReason | "";
};

export type Level1Form = {
  procedureTypeCorrect: Correctness;
  structures: ItemJudgement[];
  wrongStructuresCount: number;
  instruments: ItemJudgement[];
  wrongInstrumentsCount: number;
  missedInstrumentsCount: number;
  spatialPositioningCorrect: Correctness;
};

export type Level2PhaseErrorType = IncorrectReason | "";

export type Level2PhaseForm = {
  /** Is the temporal segmentation (boundaries) correct? */
  segmentationCorrect: Correctness;
  /** Is the phase content / description correct? */
  contentCorrect: Correctness;
  /**
   * Shown only when content is Incorrect.
   * hallucinates when the target is absent | misrecognition when the target is present
   */
  phaseErrorType: Level2PhaseErrorType;
  trueStartTime: string;
  trueEndTime: string;
};

export type Level2Form = {
  phases: Level2PhaseForm[];
  missedPhasesCount: number;
  missedStepsDetectedCorrect: Correctness;
};

export type Level3Form = {
  surgeryCompleted: "yes" | "no";
  nextActionAccurate: Correctness;
  nomenclatureStandardized: Correctness;
  safetyCheckPass: "pass" | "fail";
  hallucinationNotes: string;
};

export type Level4DimensionForm = {
  expertScore: 1 | 2 | 3 | 4 | 5;
  aiJustificationHallucination: "yes" | "no";
};

export type GradingForm = {
  level1: Level1Form;
  level2: Level2Form;
  level3: Level3Form;
  level4: {
    dimensions: Record<string, Level4DimensionForm>;
  };
};

const defaultL4Dim = (): Level4DimensionForm => ({
  expertScore: 1,
  aiJustificationHallucination: "no",
});

export function buildDefaultGradingForm(parsed: AiParsedData): GradingForm {
  const l4Dims: Record<string, Level4DimensionForm> = {};
  for (const d of parsed.level4.dimensions) {
    l4Dims[d.key] = defaultL4Dim();
  }
  if (Object.keys(l4Dims).length === 0) {
    for (const key of [
      "respectForTissue",
      "sutureNeedleHandling",
      "timeAndMotion",
      "flowOfOperation",
      "qualityOfFinalProduct",
      "overallPerformance",
    ]) {
      l4Dims[key] = defaultL4Dim();
    }
  }

  return {
    level1: {
      procedureTypeCorrect: "correct",
      structures: parsed.level1.structures.map(() => ({
        correct: "correct",
        incorrectReason: "",
      })),
      wrongStructuresCount: 0,
      instruments: parsed.level1.instruments.map(() => ({
        correct: "correct",
        incorrectReason: "",
      })),
      wrongInstrumentsCount: 0,
      missedInstrumentsCount: 0,
      spatialPositioningCorrect: "correct",
    },
    level2: {
      phases: parsed.level2.phases.map((p) => ({
        segmentationCorrect: "correct",
        contentCorrect: "correct",
        phaseErrorType: "" as const,
        trueStartTime: p.aiStartTime || "",
        trueEndTime: p.aiEndTime || "",
      })),
      missedPhasesCount: 0,
      missedStepsDetectedCorrect: "correct",
    },
    level3: {
      surgeryCompleted: "yes",
      nextActionAccurate: "correct",
      nomenclatureStandardized: "correct",
      safetyCheckPass: "pass",
      hallucinationNotes: "N/A",
    },
    level4: { dimensions: l4Dims },
  };
}

/** Classic Precision = correct / total, where total = correct + incorrect */
export function calcPrecision(correct: number, total: number): number | null {
  if (total <= 0) return null;
  return correct / total;
}

/** Recall = correct / (missed + correct) */
export function calcRecall(correct: number, missed: number): number | null {
  const denom = correct + missed;
  if (denom <= 0) return null;
  return correct / denom;
}

export function calcF1(precision: number | null, recall: number | null): number | null {
  if (precision == null || recall == null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export function formatMetric(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function countCorrectItems(items: ItemJudgement[] | undefined): number {
  if (!items) return 0;
  return items.filter((x) => x?.correct === "correct").length;
}

export function countIncorrectItems(items: ItemJudgement[] | undefined): number {
  if (!items) return 0;
  return items.filter((x) => x?.correct === "incorrect").length;
}

export function countHallucinationAbsent(items: ItemJudgement[] | undefined): number {
  if (!items) return 0;
  return items.filter(
    (x) =>
      x?.correct === "incorrect" && x?.incorrectReason === "hallucination_absent",
  ).length;
}

export function countMisrecognitionPresent(items: ItemJudgement[] | undefined): number {
  if (!items) return 0;
  return items.filter(
    (x) =>
      x?.correct === "incorrect" && x?.incorrectReason === "misrecognition_present",
  ).length;
}

/** Rate = count / total (of AI-listed items) */
export function calcRate(count: number, total: number): number | null {
  if (total <= 0) return null;
  return count / total;
}

export function buildLevel1LiveMetrics(values: GradingForm) {
  const structures = values.level1?.structures ?? [];
  const instruments = values.level1?.instruments ?? [];

  const structureCorrect = countCorrectItems(structures);
  const structureWrong = countIncorrectItems(structures);
  const structureTotal = structureCorrect + structureWrong;
  const structureHalluc = countHallucinationAbsent(structures);
  const structureMisrecog = countMisrecognitionPresent(structures);
  const structurePrecision = calcPrecision(structureCorrect, structureTotal);
  const structureHallucRate = calcRate(structureHalluc, structureTotal);
  const structureMisrecogRate = calcRate(structureMisrecog, structureTotal);

  const instrumentCorrect = countCorrectItems(instruments);
  const instrumentWrong = countIncorrectItems(instruments);
  const instrumentTotal = instrumentCorrect + instrumentWrong;
  const instrumentHalluc = countHallucinationAbsent(instruments);
  const instrumentMisrecog = countMisrecognitionPresent(instruments);
  const missed = Number(values.level1?.missedInstrumentsCount) || 0;
  const instrumentPrecision = calcPrecision(instrumentCorrect, instrumentTotal);
  const instrumentHallucRate = calcRate(instrumentHalluc, instrumentTotal);
  const instrumentMisrecogRate = calcRate(instrumentMisrecog, instrumentTotal);
  const instrumentRecall = calcRecall(instrumentCorrect, missed);
  const instrumentF1 = calcF1(instrumentPrecision, instrumentRecall);

  return {
    structures: {
      correct: structureCorrect,
      wrong: structureWrong,
      total: structureTotal,
      hallucinationAbsent: structureHalluc,
      misrecognitionPresent: structureMisrecog,
      precision: structurePrecision,
      hallucinationRate: structureHallucRate,
      misrecognitionRate: structureMisrecogRate,
    },
    instruments: {
      correct: instrumentCorrect,
      wrong: instrumentWrong,
      total: instrumentTotal,
      hallucinationAbsent: instrumentHalluc,
      misrecognitionPresent: instrumentMisrecog,
      missed,
      precision: instrumentPrecision,
      hallucinationRate: instrumentHallucRate,
      misrecognitionRate: instrumentMisrecogRate,
      recall: instrumentRecall,
      f1: instrumentF1,
    },
  };
}

export function buildGradingPayload(values: GradingForm, parsed: AiParsedData) {
  const metrics = buildLevel1LiveMetrics(values);

  return {
    level1: {
      procedureTypeCorrect: values.level1.procedureTypeCorrect === "correct",
      structures: parsed.level1.structures.map((s, i) => {
        const j = values.level1.structures[i];
        return {
          name: s.name,
          correct: j?.correct === "correct",
          incorrectReason:
            j?.correct === "incorrect" ? j?.incorrectReason || null : null,
        };
      }),
      wrongStructuresCount: metrics.structures.wrong,
      structureCorrectCount: metrics.structures.correct,
      structureTotalCount: metrics.structures.total,
      structureHallucinationAbsentCount: metrics.structures.hallucinationAbsent,
      structureMisrecognitionPresentCount: metrics.structures.misrecognitionPresent,
      structurePrecision: metrics.structures.precision,
      structureHallucinationRate: metrics.structures.hallucinationRate,
      structureMisrecognitionRate: metrics.structures.misrecognitionRate,
      instruments: parsed.level1.instruments.map((inst, i) => {
        const j = values.level1.instruments[i];
        return {
          name: inst.name,
          correct: j?.correct === "correct",
          incorrectReason:
            j?.correct === "incorrect" ? j?.incorrectReason || null : null,
        };
      }),
      wrongInstrumentsCount: metrics.instruments.wrong,
      instrumentCorrectCount: metrics.instruments.correct,
      instrumentTotalCount: metrics.instruments.total,
      instrumentHallucinationAbsentCount: metrics.instruments.hallucinationAbsent,
      instrumentMisrecognitionPresentCount: metrics.instruments.misrecognitionPresent,
      missedInstrumentsCount: values.level1.missedInstrumentsCount,
      instrumentPrecision: metrics.instruments.precision,
      instrumentHallucinationRate: metrics.instruments.hallucinationRate,
      instrumentMisrecognitionRate: metrics.instruments.misrecognitionRate,
      instrumentRecall: metrics.instruments.recall,
      instrumentF1: metrics.instruments.f1,
      spatialPositioningCorrect:
        values.level1.spatialPositioningCorrect === "correct",
    },
    level2: {
      phases: parsed.level2.phases.map((p, i) => {
        const phase = values.level2.phases[i];
        const needsError = phase?.contentCorrect === "incorrect";
        return {
          description: p.description,
          aiStartTime: p.aiStartTime,
          aiEndTime: p.aiEndTime,
          segmentationCorrect: phase?.segmentationCorrect === "correct",
          contentCorrect: phase?.contentCorrect === "correct",
          phaseErrorType: needsError ? phase?.phaseErrorType || null : null,
          trueStartTime: phase?.trueStartTime ?? "",
          trueEndTime: phase?.trueEndTime ?? "",
          temporalIoU: temporalIoU(
            p.aiStartTime,
            p.aiEndTime,
            phase?.trueStartTime ?? "",
            phase?.trueEndTime ?? "",
          ),
        };
      }),
      aiMissedPhasesCount: parsed.level2.aiMissedPhasesCount,
      missedPhasesCount: values.level2.missedPhasesCount,
      missedStepsDetectedCorrect:
        values.level2.missedStepsDetectedCorrect === "correct",
      metrics: (() => {
        const m = computeLevel2TemporalMetrics(
          parsed.level2.phases.map((p, i) => ({
            aiStartTime: p.aiStartTime,
            aiEndTime: p.aiEndTime,
            trueStartTime: values.level2.phases[i]?.trueStartTime ?? "",
            trueEndTime: values.level2.phases[i]?.trueEndTime ?? "",
          })),
        );
        const c = computeLevel2ContentMetrics(
          values.level2.phases.map((phase) => ({
            contentCorrect: phase?.contentCorrect,
            phaseErrorType: phase?.phaseErrorType,
          })),
        );
        return {
          meanTemporalIoU: m.meanTemporalIoU,
          mapAtIoU: m.mapAtIoU,
          contentAccuracy: c.contentAccuracy,
          contentHallucinationRate: c.contentHallucinationRate,
          contentMisrecognitionRate: c.contentMisrecognitionRate,
          contentCorrectCount: c.contentCorrectCount,
          contentHallucinationCount: c.contentHallucinationCount,
          contentMisrecognitionCount: c.contentMisrecognitionCount,
          contentTotalCount: c.total,
        };
      })(),
    },
    level3: {
      surgeryCompleted: values.level3.surgeryCompleted === "yes",
      nextActionAccurate: values.level3.nextActionAccurate === "correct",
      nomenclatureStandardized:
        values.level3.nomenclatureStandardized === "correct",
      safetyCheckPass: values.level3.safetyCheckPass === "pass",
      hallucinationNotes: values.level3.hallucinationNotes,
    },
    level4: {
      dimensions: parsed.level4.dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        aiScore: d.aiScore,
        expertScore: values.level4.dimensions[d.key]?.expertScore ?? 1,
        aiJustificationHallucination:
          values.level4.dimensions[d.key]?.aiJustificationHallucination ===
          "yes",
      })),
      ...(() => {
        let yesCount = 0;
        let totalCount = 0;
        for (const d of parsed.level4.dimensions) {
          const v = values.level4.dimensions[d.key]?.aiJustificationHallucination;
          if (v === "yes") {
            yesCount += 1;
            totalCount += 1;
          } else if (v === "no") {
            totalCount += 1;
          }
        }
        return {
          hallucinationYesCount: yesCount,
          hallucinationTotalCount: totalCount,
          hallucinationRate: totalCount > 0 ? yesCount / totalCount : null,
        };
      })(),
    },
  };
}

function toCorrectness(v: unknown): Correctness {
  if (v === true || v === "correct") return "correct";
  if (v === false || v === "incorrect") return "incorrect";
  return "correct";
}

function toIncorrectReason(v: unknown): IncorrectReason | "" {
  if (v === "hallucination_absent" || v === "misrecognition_present") return v;
  return "";
}

/** 把已保存的 grading payload / 草稿 还原成表单值（刷新后可回填） */
export function hydrateGradingForm(
  parsed: AiParsedData,
  saved: any | null | undefined,
): GradingForm {
  const base = buildDefaultGradingForm(parsed);
  if (!saved || typeof saved !== "object") return base;

  const l1 = saved.level1 ?? {};
  const l2 = saved.level2 ?? {};
  const l3 = saved.level3 ?? {};
  const l4 = saved.level4 ?? {};

  const savedStructures: any[] = Array.isArray(l1.structures) ? l1.structures : [];
  const savedInstruments: any[] = Array.isArray(l1.instruments) ? l1.instruments : [];
  const savedPhases: any[] = Array.isArray(l2.phases) ? l2.phases : [];
  const savedDims: any[] = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  const savedDimsRecord =
    l4.dimensions && !Array.isArray(l4.dimensions) ? l4.dimensions : null;

  return {
    level1: {
      procedureTypeCorrect: toCorrectness(
        l1.procedureTypeCorrect ?? base.level1.procedureTypeCorrect,
      ),
      structures: parsed.level1.structures.map((_, i) => {
        const s = savedStructures[i] ?? base.level1.structures[i];
        const correct = toCorrectness(s?.correct);
        return {
          correct,
          incorrectReason:
            correct === "incorrect" ? toIncorrectReason(s?.incorrectReason) : "",
        };
      }),
      wrongStructuresCount: Number(l1.wrongStructuresCount) || 0,
      instruments: parsed.level1.instruments.map((_, i) => {
        const s = savedInstruments[i] ?? base.level1.instruments[i];
        const correct = toCorrectness(s?.correct);
        return {
          correct,
          incorrectReason:
            correct === "incorrect" ? toIncorrectReason(s?.incorrectReason) : "",
        };
      }),
      wrongInstrumentsCount: Number(l1.wrongInstrumentsCount) || 0,
      missedInstrumentsCount: Number(l1.missedInstrumentsCount) || 0,
      spatialPositioningCorrect: toCorrectness(
        l1.spatialPositioningCorrect ?? base.level1.spatialPositioningCorrect,
      ),
    },
    level2: {
      phases: parsed.level2.phases.map((_, i) => {
        const p = savedPhases[i] ?? base.level2.phases[i];
        const segmentationCorrect = toCorrectness(p?.segmentationCorrect);
        const contentCorrect = toCorrectness(
          p?.contentCorrect ?? base.level2.phases[i]?.contentCorrect,
        );
        const needsError = contentCorrect === "incorrect";
        const err = String(p?.phaseErrorType ?? "");
        // migrate old 4-way labels if present
        const normalized =
          err === "hallucination_absent" ||
          err === "seg_correct_hallucination_absent" ||
          err === "seg_incorrect_hallucination_absent"
            ? "hallucination_absent"
            : err === "misrecognition_present" ||
                err === "seg_correct_misrecognition_present" ||
                err === "seg_incorrect_misrecognition_present"
              ? "misrecognition_present"
              : "";
        const phaseErrorType = needsError
          ? (normalized as Level2PhaseErrorType)
          : ("" as const);
        return {
          segmentationCorrect,
          contentCorrect,
          phaseErrorType,
          trueStartTime: String(
            p?.trueStartTime ||
              parsed.level2.phases[i]?.aiStartTime ||
              "",
          ),
          trueEndTime: String(
            p?.trueEndTime || parsed.level2.phases[i]?.aiEndTime || "",
          ),
        };
      }),
      missedPhasesCount: Number(l2.missedPhasesCount) || 0,
      missedStepsDetectedCorrect: toCorrectness(
        l2.missedStepsDetectedCorrect ?? base.level2.missedStepsDetectedCorrect,
      ),
    },
    level3: {
      surgeryCompleted:
        l3.surgeryCompleted === true ||
        l3.surgeryCompleted === "yes" ||
        l3.surgeryCompleted === "Yes"
          ? "yes"
          : l3.surgeryCompleted === false ||
              l3.surgeryCompleted === "no" ||
              l3.surgeryCompleted === "No"
            ? "no"
            : base.level3.surgeryCompleted,
      nextActionAccurate: toCorrectness(
        l3.nextActionAccurate ?? base.level3.nextActionAccurate,
      ),
      nomenclatureStandardized: toCorrectness(
        l3.nomenclatureStandardized ?? base.level3.nomenclatureStandardized,
      ),
      safetyCheckPass:
        l3.safetyCheckPass === true || l3.safetyCheckPass === "pass"
          ? "pass"
          : l3.safetyCheckPass === false || l3.safetyCheckPass === "fail"
            ? "fail"
            : base.level3.safetyCheckPass,
      hallucinationNotes: String(
        l3.hallucinationNotes ?? base.level3.hallucinationNotes,
      ),
    },
    level4: {
      dimensions: Object.fromEntries(
        Object.keys(base.level4.dimensions).map((key) => {
          const fromArr = savedDims.find((d) => d?.key === key);
          const fromRec = savedDimsRecord?.[key];
          const d = fromArr ?? fromRec ?? base.level4.dimensions[key];
          const expertScore = Number(d?.expertScore) || 1;
          const hall =
            d?.aiJustificationHallucination === true ||
            d?.aiJustificationHallucination === "yes"
              ? "yes"
              : d?.aiJustificationHallucination === false ||
                  d?.aiJustificationHallucination === "no"
                ? "no"
                : base.level4.dimensions[key].aiJustificationHallucination;
          return [
            key,
            {
              expertScore: Math.min(5, Math.max(1, expertScore)) as 1 | 2 | 3 | 4 | 5,
              aiJustificationHallucination: hall as "yes" | "no",
            },
          ];
        }),
      ),
    },
  };
}

export function draftStorageKey(expertId: string, taskId: string) {
  return `grading-draft:${expertId}:${taskId}`;
}

export function loadGradingDraft(
  expertId: string,
  taskId: string,
): GradingForm | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(expertId, taskId));
    if (!raw) return null;
    return JSON.parse(raw) as GradingForm;
  } catch {
    return null;
  }
}

export function saveGradingDraft(
  expertId: string,
  taskId: string,
  values: GradingForm,
) {
  try {
    localStorage.setItem(draftStorageKey(expertId, taskId), JSON.stringify(values));
  } catch {
    // ignore quota errors
  }
}

export function clearGradingDraft(expertId: string, taskId: string) {
  try {
    localStorage.removeItem(draftStorageKey(expertId, taskId));
  } catch {
    // ignore
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

function hasChoice(v: unknown) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export type IncompleteField = {
  /** DOM id suffix: element id is `gf-${id}` */
  id: string;
  message: string;
};

/** 返回未填完的必填项（含可滚动定位的 field id） */
export function getGradingIncompleteFields(
  values: GradingForm | undefined,
  parsed: AiParsedData,
): IncompleteField[] {
  const missing: IncompleteField[] = [];
  if (!values?.level1 || !values?.level2 || !values?.level3 || !values?.level4) {
    return [{ id: "form-root", message: "表单尚未加载完成" }];
  }

  const l1 = values.level1;
  if (!hasChoice(l1.procedureTypeCorrect)) {
    missing.push({ id: "l1-procedureType", message: "Level 1: Procedure Type" });
  }
  if (!hasChoice(l1.spatialPositioningCorrect)) {
    missing.push({ id: "l1-spatial", message: "Level 1: Spatial Positioning" });
  }
  if (
    l1.missedInstrumentsCount === undefined ||
    l1.missedInstrumentsCount === null ||
    Number.isNaN(Number(l1.missedInstrumentsCount))
  ) {
    missing.push({
      id: "l1-missedInstruments",
      message: "Level 1: Number of Instrument Missed",
    });
  }

  parsed.level1.structures.forEach((s, i) => {
    const item = l1.structures?.[i];
    if (!hasChoice(item?.correct)) {
      missing.push({ id: `l1-structure-${i}`, message: `Level 1 structure: ${s.name}` });
      return;
    }
    if (
      item.correct === "incorrect" &&
      item.incorrectReason !== "hallucination_absent" &&
      item.incorrectReason !== "misrecognition_present"
    ) {
      missing.push({
        id: `l1-structure-${i}-reason`,
        message: `Level 1 structure error type: ${s.name}`,
      });
    }
  });

  parsed.level1.instruments.forEach((inst, i) => {
    const item = l1.instruments?.[i];
    if (!hasChoice(item?.correct)) {
      missing.push({ id: `l1-instrument-${i}`, message: `Level 1 instrument: ${inst.name}` });
      return;
    }
    if (
      item.correct === "incorrect" &&
      item.incorrectReason !== "hallucination_absent" &&
      item.incorrectReason !== "misrecognition_present"
    ) {
      missing.push({
        id: `l1-instrument-${i}-reason`,
        message: `Level 1 instrument error type: ${inst.name}`,
      });
    }
  });

  if (!parsed.level2.phases.length) {
    missing.push({
      id: "l2-phases",
      message: "Level 2: no phases parsed (re-upload AI text)",
    });
  }

  parsed.level2.phases.forEach((p, i) => {
    const phase = values.level2.phases?.[i];
    const label = `Phase ${i + 1}`;
    if (!hasChoice(phase?.segmentationCorrect)) {
      missing.push({ id: `l2-phase-${i}-timing`, message: `${label}: segmentation timing` });
    }
    if (!hasChoice(phase?.contentCorrect)) {
      missing.push({ id: `l2-phase-${i}-content`, message: `${label}: segmentation content` });
    }
    if (!TIME_RE.test(phase?.trueStartTime ?? "")) {
      missing.push({ id: `l2-phase-${i}-trueStart`, message: `${label}: True Start (HH:MM:SS)` });
    }
    if (!TIME_RE.test(phase?.trueEndTime ?? "")) {
      missing.push({ id: `l2-phase-${i}-trueEnd`, message: `${label}: True End (HH:MM:SS)` });
    }
    if (
      phase?.contentCorrect === "incorrect" &&
      phase.phaseErrorType !== "hallucination_absent" &&
      phase.phaseErrorType !== "misrecognition_present"
    ) {
      missing.push({ id: `l2-phase-${i}-error`, message: `${label}: content error type` });
    }
  });

  if (
    values.level2.missedPhasesCount === undefined ||
    values.level2.missedPhasesCount === null ||
    Number.isNaN(Number(values.level2.missedPhasesCount))
  ) {
    missing.push({ id: "l2-missedPhases", message: "Level 2: missed phases count" });
  }
  if (!hasChoice(values.level2.missedStepsDetectedCorrect)) {
    missing.push({
      id: "l2-missedSteps",
      message: "Level 2: missed steps detected correctly",
    });
  }

  const l3 = values.level3;
  if (l3.surgeryCompleted !== "yes" && l3.surgeryCompleted !== "no") {
    missing.push({ id: "l3-surgeryCompleted", message: "Level 3: Is the surgery completed?" });
  }
  if (!hasChoice(l3.nextActionAccurate)) {
    missing.push({ id: "l3-nextAction", message: "Level 3: Next Action accurate" });
  }
  if (!hasChoice(l3.nomenclatureStandardized)) {
    missing.push({ id: "l3-nomenclature", message: "Level 3: nomenclature standardized" });
  }
  if (l3.safetyCheckPass !== "pass" && l3.safetyCheckPass !== "fail") {
    missing.push({ id: "l3-safety", message: "Level 3: Safety Check" });
  }
  if (!String(l3.hallucinationNotes ?? "").trim()) {
    missing.push({ id: "l3-notes", message: "Level 3: Hallucination Notes" });
  }

  const dimKeys =
    parsed.level4.dimensions.length > 0
      ? parsed.level4.dimensions.map((d) => d.key)
      : Object.keys(values.level4.dimensions ?? {});
  for (const key of dimKeys) {
    const d = values.level4.dimensions?.[key];
    const label =
      parsed.level4.dimensions.find((x) => x.key === key)?.label ?? key;
    if (![1, 2, 3, 4, 5].includes(Number(d?.expertScore))) {
      missing.push({ id: `l4-${key}-score`, message: `Level 4: ${label} expert score` });
    }
    if (
      d?.aiJustificationHallucination !== "yes" &&
      d?.aiJustificationHallucination !== "no"
    ) {
      missing.push({
        id: `l4-${key}-hallucination`,
        message: `Level 4: ${label} hallucination`,
      });
    }
  }

  return missing;
}

/** 返回未填完的必填项说明；空数组表示可提交 */
export function getGradingIncompleteMessages(
  values: GradingForm | undefined,
  parsed: AiParsedData,
): string[] {
  return getGradingIncompleteFields(values, parsed).map((f) => f.message);
}

export function isGradingFormComplete(
  values: GradingForm | undefined,
  parsed: AiParsedData,
) {
  return getGradingIncompleteFields(values, parsed).length === 0;
}

export function gradingFieldDomId(fieldId: string) {
  return `gf-${fieldId}`;
}

export function scrollToGradingField(fieldId: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(gradingFieldDomId(fieldId));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("grading-error-flash");
  // reflow so animation can replay
  void (el as HTMLElement).offsetWidth;
  el.classList.add("grading-error-flash");
  window.setTimeout(() => el.classList.remove("grading-error-flash"), 900);
  if (el instanceof HTMLElement) {
    const focusable = el.querySelector(
      "input:not([type='hidden']), textarea, select, button",
    ) as HTMLElement | null;
    focusable?.focus({ preventScroll: true });
  }
}
