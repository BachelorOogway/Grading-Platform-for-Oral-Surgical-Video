import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { normalizeAiParsedData } from "@/lib/normalizeParsed";
import { findCategoricalDisagreements } from "@/lib/categoricalFields";
import { GRADERS_PER_VIDEO, isTiebreakerSlot } from "@/lib/graders";

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
    priorStatus: Array<{
      graderSlot: number;
      expertId: string | null;
      name: string | null;
      status: string | null;
    }>;
  } = null;

  if (isTiebreakerSlot(assignment.graderSlot)) {
    const allPriors = await prisma.taskAssignment.findMany({
      where: {
        aiOutputId: assignment.aiOutputId,
        graderSlot: { in: [1, 2] },
      },
      include: {
        expert: { select: { expertId: true, name: true } },
        gradingResult: true,
      },
      orderBy: { graderSlot: "asc" },
    });
    const priors = allPriors.filter((p) => p.status === "COMPLETED");

    // Slots 1 and 2 always reported, so the tiebreaker can see who is holding
    // up the side-by-side view instead of just losing it.
    const priorStatus = [1, 2].map((slot) => {
      const a = allPriors.find((p) => p.graderSlot === slot);
      return {
        graderSlot: slot,
        expertId: a?.expert.expertId ?? null,
        name: a?.expert.name ?? null,
        status: a?.status ?? null,
      };
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
