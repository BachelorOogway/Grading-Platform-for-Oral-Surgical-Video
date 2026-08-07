import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { parseAiOutputToParsedData, type AiParsedData } from "@/lib/aiOutputParser";
import { findCategoricalDisagreements } from "@/lib/categoricalFields";
import { GRADERS_PER_VIDEO, isTiebreakerSlot } from "@/lib/graders";

function normalizeParsed(raw: unknown, rawText: string): AiParsedData {
  const parsed = parseAiOutputToParsedData(rawText);
  const stored = raw as Partial<AiParsedData> | null;

  if (stored?.level1?.structures?.length && stored?.level2?.phases?.length) {
    return {
      level1: {
        procedureType: stored.level1.procedureType ?? parsed.level1.procedureType,
        structures: stored.level1.structures ?? parsed.level1.structures,
        totalStructures: stored.level1.totalStructures ?? parsed.level1.totalStructures,
        instruments: stored.level1.instruments ?? parsed.level1.instruments,
        totalInstruments: stored.level1.totalInstruments ?? parsed.level1.totalInstruments,
        spatialPositioning:
          stored.level1.spatialPositioning ?? parsed.level1.spatialPositioning,
      },
      level2: {
        phases: stored.level2?.phases?.length
          ? stored.level2.phases
          : parsed.level2.phases,
        totalPhases: stored.level2?.totalPhases ?? parsed.level2.totalPhases,
        missedStepsEvaluation:
          stored.level2?.missedStepsEvaluation ?? parsed.level2.missedStepsEvaluation,
        aiMissedPhasesCount:
          stored.level2?.aiMissedPhasesCount ?? parsed.level2.aiMissedPhasesCount,
      },
      level3: {
        nextActionPrediction:
          stored.level3?.nextActionPrediction ?? parsed.level3.nextActionPrediction,
        clinicalRationale:
          stored.level3?.clinicalRationale ?? parsed.level3.clinicalRationale,
        surgeryCompleted: stored.level3?.surgeryCompleted ?? parsed.level3.surgeryCompleted,
      },
      level4: {
        dimensions:
          stored.level4?.dimensions?.length
            ? stored.level4.dimensions
            : parsed.level4.dimensions,
      },
    };
  }

  return parsed;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const url = new URL(req.url);
  const expertId = url.searchParams.get("expertId")?.trim();

  const resolved = await params;
  const taskAssignmentId = resolved?.taskId?.trim();
  if (!taskAssignmentId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: taskAssignmentId },
    include: {
      aiOutput: true,
      gradingResult: true,
      expert: { select: { expertId: true, name: true } },
    },
  });

  if (!assignment) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  if (expertId && assignment.expert.expertId !== expertId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let consensus: null | {
    isTiebreaker: boolean;
    graderSlot: number;
    priorGraders: Array<{
      expertId: string;
      name: string;
      graderSlot: number;
      gradingData: unknown;
    }>;
    disagreements: ReturnType<typeof findCategoricalDisagreements>;
  } = null;

  if (isTiebreakerSlot(assignment.graderSlot)) {
    const priors = await prisma.taskAssignment.findMany({
      where: {
        aiOutputId: assignment.aiOutputId,
        graderSlot: { in: [1, 2] },
        status: "COMPLETED",
      },
      include: {
        expert: { select: { expertId: true, name: true } },
        gradingResult: true,
      },
      orderBy: { graderSlot: "asc" },
    });

    const priorGraders = priors
      .filter((p) => p.gradingResult)
      .map((p) => ({
        expertId: p.expert.expertId,
        name: p.expert.name,
        graderSlot: p.graderSlot,
        gradingData: parseJsonSafe(p.gradingResult!.gradingData, null),
      }));

    const g1 = priorGraders.find((p) => p.graderSlot === 1)?.gradingData;
    const g2 = priorGraders.find((p) => p.graderSlot === 2)?.gradingData;
    const disagreements =
      g1 && g2 ? findCategoricalDisagreements(g1, g2) : [];

    consensus = {
      isTiebreaker: true,
      graderSlot: assignment.graderSlot,
      priorGraders,
      disagreements,
    };
  } else {
    consensus = {
      isTiebreaker: false,
      graderSlot: assignment.graderSlot,
      priorGraders: [],
      disagreements: [],
    };
  }

  const openDiscrepancies = await prisma.discrepancyItem.findMany({
    where: { aiOutputId: assignment.aiOutputId, status: "OPEN" },
    select: { fieldPath: true, fieldLabel: true },
  });

  return NextResponse.json({
    taskAssignmentId: assignment.id,
    status: assignment.status,
    graderSlot: assignment.graderSlot,
    gradersPerVideo: GRADERS_PER_VIDEO,
    expert: assignment.expert,
    regradeNote: assignment.regradeNote,
    regradeRequestedAt: assignment.regradeRequestedAt,
    aiOutput: {
      videoOutputId: assignment.aiOutput.videoOutputId,
      rawText: assignment.aiOutput.rawText,
      parsedData: normalizeParsed(
        parseJsonSafe(assignment.aiOutput.parsedData, null),
        assignment.aiOutput.rawText,
      ),
    },
    gradingResult: assignment.gradingResult
      ? parseJsonSafe(assignment.gradingResult.gradingData, null)
      : null,
    consensus,
    openDiscrepancies,
  });
}
