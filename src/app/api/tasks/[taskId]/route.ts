import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { normalizeAiParsedData } from "@/lib/normalizeParsed";
import { findCategoricalDisagreements } from "@/lib/categoricalFields";
import {
  GRADERS_PER_VIDEO,
  isChronologicalTiebreaker,
} from "@/lib/graders";

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

  const siblings = await prisma.taskAssignment.findMany({
    where: { aiOutputId: assignment.aiOutputId },
    include: {
      expert: { select: { expertId: true, name: true } },
      gradingResult: true,
    },
    orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
  });

  // Only the chronologically third claimer gets discrepancy-solve UI.
  const isTiebreaker = isChronologicalTiebreaker(assignment.id, siblings);

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
    priorStatus: Array<{
      graderSlot: number;
      expertId: string | null;
      name: string | null;
      status: string | null;
    }>;
  } = null;

  if (isTiebreaker) {
    const priors = siblings.slice(0, GRADERS_PER_VIDEO - 1);
    const priorStatus = priors.map((a, i) => ({
      graderSlot: i + 1,
      expertId: a.expert.expertId,
      name: a.expert.name,
      status: a.status,
    }));
    while (priorStatus.length < GRADERS_PER_VIDEO - 1) {
      priorStatus.push({
        graderSlot: priorStatus.length + 1,
        expertId: null,
        name: null,
        status: null,
      });
    }

    const priorGraders = priors
      .filter((p) => p.status === "COMPLETED" && p.gradingResult)
      .map((p, i) => ({
        expertId: p.expert.expertId,
        name: p.expert.name,
        // Display order = claim order among the first two, not DB graderSlot.
        graderSlot: i + 1,
        gradingData: parseJsonSafe(p.gradingResult!.gradingData, null),
      }));

    const g1 = priorGraders[0]?.gradingData;
    const g2 = priorGraders[1]?.gradingData;
    const disagreements =
      g1 && g2 && priorGraders.length >= 2
        ? findCategoricalDisagreements(g1, g2)
        : [];

    consensus = {
      isTiebreaker: true,
      graderSlot: assignment.graderSlot,
      priorGraders,
      disagreements,
      priorStatus,
    };
  } else {
    consensus = {
      isTiebreaker: false,
      graderSlot: assignment.graderSlot,
      priorGraders: [],
      disagreements: [],
      priorStatus: [],
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
      parsedData: normalizeAiParsedData(
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
