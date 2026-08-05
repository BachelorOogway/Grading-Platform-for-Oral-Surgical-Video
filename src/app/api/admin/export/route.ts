import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeGlobalGradingMetrics,
  level1SignalsFromGradingData,
  level2SignalsFromGradingData,
  type GlobalGradingMetrics,
} from "@/lib/globalGradingMetrics";
import {
  aiCompletedFromParsedData,
  level3SignalsFromGradingData,
} from "@/lib/level3Metrics";
import { level4HallucinationFromGradingData } from "@/lib/level4Metrics";

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return '""';
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function parseGradingData(raw: unknown) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

function isHallucinationReason(reason: unknown) {
  return (
    reason === "hallucination_absent" ||
    reason === "seg_correct_hallucination_absent" ||
    reason === "seg_incorrect_hallucination_absent"
  );
}

function isMisrecognitionReason(reason: unknown) {
  return (
    reason === "misrecognition_present" ||
    reason === "seg_correct_misrecognition_present" ||
    reason === "seg_incorrect_misrecognition_present"
  );
}

function countItemErrorRates(items: any[]) {
  let correct = 0;
  let wrong = 0;
  let hallucinationAbsent = 0;
  let misrecognitionPresent = 0;
  for (const s of items) {
    const isCorrect = s?.correct === true || s?.correct === "correct";
    if (isCorrect) correct += 1;
    else if (s?.correct === false || s?.correct === "incorrect") {
      wrong += 1;
      if (isHallucinationReason(s?.incorrectReason)) hallucinationAbsent += 1;
      else if (isMisrecognitionReason(s?.incorrectReason)) misrecognitionPresent += 1;
    }
  }
  return { correct, wrong, hallucinationAbsent, misrecognitionPresent };
}

function countStructureInputs(l1: any) {
  const counted = countItemErrorRates(
    Array.isArray(l1.structures) ? l1.structures : [],
  );
  const correct = Number.isFinite(Number(l1.structureCorrectCount))
    ? Number(l1.structureCorrectCount)
    : counted.correct;
  const wrong = Number.isFinite(Number(l1.wrongStructuresCount))
    ? Number(l1.wrongStructuresCount)
    : counted.wrong;
  const total = Number.isFinite(Number(l1.structureTotalCount))
    ? Number(l1.structureTotalCount)
    : correct + wrong;
  const hallucinationAbsent = Number.isFinite(
    Number(l1.structureHallucinationAbsentCount),
  )
    ? Number(l1.structureHallucinationAbsentCount)
    : counted.hallucinationAbsent;
  const misrecognitionPresent = Number.isFinite(
    Number(l1.structureMisrecognitionPresentCount),
  )
    ? Number(l1.structureMisrecognitionPresentCount)
    : counted.misrecognitionPresent;

  return {
    correct,
    wrong,
    total,
    hallucinationAbsent,
    misrecognitionPresent,
    hallucinationRate: total > 0 ? hallucinationAbsent / total : null,
    misrecognitionRate: total > 0 ? misrecognitionPresent / total : null,
  };
}

function countInstrumentInputs(l1: any) {
  const counted = countItemErrorRates(
    Array.isArray(l1.instruments) ? l1.instruments : [],
  );
  const correct = Number.isFinite(Number(l1.instrumentCorrectCount))
    ? Number(l1.instrumentCorrectCount)
    : counted.correct;
  const wrong = Number.isFinite(Number(l1.wrongInstrumentsCount))
    ? Number(l1.wrongInstrumentsCount)
    : counted.wrong;
  const total = Number.isFinite(Number(l1.instrumentTotalCount))
    ? Number(l1.instrumentTotalCount)
    : correct + wrong;
  const hallucinationAbsent = Number.isFinite(
    Number(l1.instrumentHallucinationAbsentCount),
  )
    ? Number(l1.instrumentHallucinationAbsentCount)
    : counted.hallucinationAbsent;
  const misrecognitionPresent = Number.isFinite(
    Number(l1.instrumentMisrecognitionPresentCount),
  )
    ? Number(l1.instrumentMisrecognitionPresentCount)
    : counted.misrecognitionPresent;

  return {
    correct,
    wrong,
    total,
    hallucinationAbsent,
    misrecognitionPresent,
    hallucinationRate: total > 0 ? hallucinationAbsent / total : null,
    misrecognitionRate: total > 0 ? misrecognitionPresent / total : null,
    missed: Number(l1.missedInstrumentsCount) || 0,
  };
}

function globalSummaryLines(m: GlobalGradingMetrics): string[] {
  const l1 = m.level1;
  const l2 = m.level2;
  const l3 = m.level3;
  const l4 = m.level4;
  const rows: Array<[string, string, unknown, unknown, unknown]> = [
    ["global", "form_count", m.formCount, "", ""],
    [
      "level1_global",
      "procedure_type_accuracy",
      l1.procedureTypeAccuracy,
      l1.procedureTypeCorrectCount,
      l1.procedureTypeLabeledCount,
    ],
    [
      "level1_global",
      "spatial_positioning_accuracy",
      l1.spatialPositioningAccuracy,
      l1.spatialPositioningCorrectCount,
      l1.spatialPositioningLabeledCount,
    ],
    [
      "level2_global",
      "missed_phases_count_correlation",
      l2.missedPhasesCountCorrelation,
      "",
      l2.countPairCount,
    ],
    [
      "level2_global",
      "missed_phases_content_accuracy",
      l2.missedPhasesContentAccuracy,
      l2.contentCorrectCount,
      l2.contentLabeledCount,
    ],
    ["level3_global", "exit_eligible_count", l3.exitEligibleCount, "", ""],
    ["level3_global", "incomplete_expert_count", l3.incompleteExpertCount, "", ""],
    [
      "level3_global",
      "exit_precision",
      l3.exitPrecision,
      l3.exitTruePositive,
      l3.exitTruePositive + l3.exitFalsePositive,
    ],
    [
      "level3_global",
      "exit_recall",
      l3.exitRecall,
      l3.exitTruePositive,
      l3.exitTruePositive + l3.exitFalseNegative,
    ],
    [
      "level3_global",
      "global_precision",
      l3.globalPrecision,
      "",
      l3.incompleteExpertCount,
    ],
    [
      "level3_global",
      "nomenclature_accuracy",
      l3.nomenclatureAccuracy,
      "",
      l3.incompleteExpertCount,
    ],
    [
      "level3_global",
      "safety_fail_rate",
      l3.safetyFailRate,
      "",
      l3.incompleteExpertCount,
    ],
    [
      "level3_global",
      "false_exit_rate",
      l3.falseExitRate,
      l3.exitFalsePositive,
      l3.formCount,
    ],
    ["level3_global", "exit_true_positive", l3.exitTruePositive, "", ""],
    ["level3_global", "exit_false_positive", l3.exitFalsePositive, "", ""],
    ["level3_global", "exit_false_negative", l3.exitFalseNegative, "", ""],
    ["level3_global", "exit_true_negative", l3.exitTrueNegative, "", ""],
    ["level4_global", "pair_count", l4.pairCount, "", ""],
    ["level4_global", "mae", l4.mae, "", l4.pairCount],
    ["level4_global", "lcc", l4.lcc, "", l4.pairCount],
    ["level4_global", "srocc", l4.srocc, "", l4.pairCount],
    [
      "level4_global",
      "mean_hallucination_rate",
      l4.meanHallucinationRate,
      l4.hallucinationYesCount,
      l4.hallucinationTotalCount,
    ],
    [
      "level4_global",
      "hallucination_form_count",
      l4.hallucinationFormCount,
      "",
      "",
    ],
    [
      "inter_expert",
      "shared_video_count",
      m.interExpert.sharedVideoCount,
      "",
      "",
    ],
    [
      "inter_expert",
      "shared_expert_count",
      m.interExpert.sharedExpertCount,
      "",
      "",
    ],
    [
      "inter_expert",
      "expert_pair_count",
      m.interExpert.expertPairCount,
      "",
      "",
    ],
    [
      "inter_expert",
      "score_pair_count",
      m.interExpert.scorePairCount,
      "",
      "",
    ],
    [
      "inter_expert",
      "icc",
      m.interExpert.icc,
      "",
      m.interExpert.scorePairCount,
    ],
    [
      "inter_expert",
      "icc_fisher_z",
      m.interExpert.iccFisherZ,
      "",
      m.interExpert.expertPairCount,
    ],
  ];

  return [
    ["section", "metric", "value", "numerator", "denominator"]
      .map(csvEscape)
      .join(","),
    ...rows.map(([section, metric, value, num, den]) =>
      [section, metric, value, num, den].map(csvEscape).join(","),
    ),
  ];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = req.headers.get("x-admin-secret") || url.searchParams.get("secret");

  if (process.env.ADMIN_SECRET) {
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const results = await prisma.gradingResult.findMany({
    include: {
      taskAssignment: {
        include: { expert: true, aiOutput: true },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  const globalMetrics = computeGlobalGradingMetrics(
    results.map((r) => ({
      gradingData: r.gradingData,
      parsedData: r.taskAssignment.aiOutput.parsedData,
      videoOutputId: r.taskAssignment.aiOutput.videoOutputId,
      expertId: r.taskAssignment.expert.expertId,
      kind: r.taskAssignment.kind,
    })),
  );

  const level3Forms = results.map((r) => {
    const aiCompleted = aiCompletedFromParsedData(
      r.taskAssignment.aiOutput.parsedData,
    );
    return level3SignalsFromGradingData(r.gradingData, aiCompleted);
  });

  const headers = [
    "videoOutputId",
    "expertId",
    "submittedAt",
    "l1_procedure_type_correct",
    "l1_spatial_positioning_correct",
    "structures_correct_count",
    "structures_total_count",
    "structures_precision",
    "structures_hallucination_rate",
    "structures_misrecognition_rate",
    "instruments_correct_count",
    "instruments_total_count",
    "instruments_missed_count",
    "instruments_precision",
    "instruments_hallucination_rate",
    "instruments_misrecognition_rate",
    "instruments_recall",
    "instruments_f1",
    "mean_temporal_iou",
    "map_at_iou",
    "content_accuracy",
    "content_hallucination_rate",
    "content_misrecognition_rate",
    "phases_tiou_inputs_json",
    "l2_ai_missed_phases_count",
    "l2_expert_missed_phases_count",
    "l2_missed_phases_content_correct",
    "l3_ai_surgery_completed",
    "l3_expert_surgery_completed",
    "l3_next_action_accurate",
    "l3_nomenclature_standardized",
    "l3_safety_check_pass",
    "l4_hallucination_yes_count",
    "l4_hallucination_total_count",
    "l4_hallucination_rate",
  ];

  const lines: string[] = [
    ...globalSummaryLines(globalMetrics),
    "",
    headers.map(csvEscape).join(","),
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ta = r.taskAssignment;
    const gd: any = parseGradingData(r.gradingData);
    const l1: any = gd.level1 ?? {};
    const l2: any = gd.level2 ?? {};
    const phases: any[] = Array.isArray(l2.phases) ? l2.phases : [];
    const l1sig = level1SignalsFromGradingData(r.gradingData);
    const l2sig = level2SignalsFromGradingData(r.gradingData);
    const l3sig = level3Forms[i];
    const l4hall = level4HallucinationFromGradingData(r.gradingData);

    const structures = countStructureInputs(l1);
    const instruments = countInstrumentInputs(l1);

    const structurePrecision =
      structures.total > 0 ? structures.correct / structures.total : null;

    const instrumentPrecision =
      instruments.total > 0 ? instruments.correct / instruments.total : null;

    const instrumentRecall =
      instruments.correct + instruments.missed > 0
        ? instruments.correct / (instruments.correct + instruments.missed)
        : null;

    const instrumentF1 =
      instrumentPrecision != null &&
      instrumentRecall != null &&
      instrumentPrecision + instrumentRecall > 0
        ? (2 * instrumentPrecision * instrumentRecall) /
          (instrumentPrecision + instrumentRecall)
        : null;

    let contentAccuracy =
      typeof l2.metrics?.contentAccuracy === "number"
        ? l2.metrics.contentAccuracy
        : null;
    let contentHallucinationRate =
      typeof l2.metrics?.contentHallucinationRate === "number"
        ? l2.metrics.contentHallucinationRate
        : null;
    let contentMisrecognitionRate =
      typeof l2.metrics?.contentMisrecognitionRate === "number"
        ? l2.metrics.contentMisrecognitionRate
        : null;

    if (
      contentAccuracy == null ||
      contentHallucinationRate == null ||
      contentMisrecognitionRate == null
    ) {
      const n = phases.length;
      let ok = 0;
      let halluc = 0;
      let misrecog = 0;
      for (const p of phases) {
        const isOk = p?.contentCorrect === true || p?.contentCorrect === "correct";
        if (isOk) {
          ok += 1;
          continue;
        }
        const err = String(p?.phaseErrorType ?? "");
        if (isHallucinationReason(err)) halluc += 1;
        else if (isMisrecognitionReason(err)) misrecog += 1;
      }
      if (n > 0) {
        if (contentAccuracy == null) contentAccuracy = ok / n;
        if (contentHallucinationRate == null) contentHallucinationRate = halluc / n;
        if (contentMisrecognitionRate == null) {
          contentMisrecognitionRate = misrecog / n;
        }
      }
    }

    const phasesForTiou = phases.map((p) => ({
      aiStartTime: p?.aiStartTime ?? "",
      aiEndTime: p?.aiEndTime ?? "",
      trueStartTime: p?.trueStartTime ?? "",
      trueEndTime: p?.trueEndTime ?? "",
      temporalIoU: p?.temporalIoU ?? null,
    }));

    const row = [
      ta.aiOutput.videoOutputId,
      ta.expert.expertId,
      r.submittedAt?.toISOString?.() ?? String(r.submittedAt),
      l1sig.procedureTypeCorrect,
      l1sig.spatialPositioningCorrect,
      structures.correct,
      structures.total,
      structurePrecision,
      structures.hallucinationRate,
      structures.misrecognitionRate,
      instruments.correct,
      instruments.total,
      instruments.missed,
      instrumentPrecision,
      instruments.hallucinationRate,
      instruments.misrecognitionRate,
      instrumentRecall,
      instrumentF1,
      l2.metrics?.meanTemporalIoU ?? "",
      l2.metrics?.mapAtIoU ?? "",
      contentAccuracy,
      contentHallucinationRate,
      contentMisrecognitionRate,
      JSON.stringify(phasesForTiou),
      l2sig.aiMissedPhasesCount,
      l2sig.expertMissedPhasesCount,
      l2sig.missedPhasesContentCorrect,
      l3sig.aiCompleted ?? "",
      l3sig.expertCompleted ?? "",
      l3sig.nextActionAccurate,
      l3sig.nomenclatureStandardized,
      l3sig.safetyCheckPass,
      l4hall?.yesCount ?? "",
      l4hall?.totalCount ?? "",
      l4hall?.rate ?? "",
    ];

    lines.push(row.map(csvEscape).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="grading_metrics.csv"',
    },
  });
}
