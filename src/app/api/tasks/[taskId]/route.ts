import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { normalizeAiParsedData } from "@/lib/normalizeParsed";
import { findCategoricalDisagreements } from "@/lib/categoricalFields";
import {
  GRADERS_PER_VIDEO,
  completedInSubmitOrder,
  gradingRoundSlot,
  isSubmissionOrderTiebreaker,
  type GradingOrderPeer,
} from "@/lib/graders";

function toPeer(a: {
  id: string;
  status: string;
  gradingResult: { submittedAt: Date; updatedAt: Date } | null;
}): GradingOrderPeer {
  return {
    id: a.id,
    status: a.status,
    completedAt:
      a.status === "COMPLETED" && a.gradingResult
        ? a.gradingResult.submittedAt ?? a.gradingResult.updatedAt
        : null,
  };
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

  const siblings = await prisma.taskAssignment.findMany({
    where: { aiOutputId: assignment.aiOutputId },
    include: {
      expert: { select: { expertId: true, name: true } },
      gradingResult: true,
    },
  });

  const peers = siblings.map(toPeer);
  const me = toPeer(assignment);
  // Only after two others have submitted this round.
  const isTiebreaker = isSubmissionOrderTiebreaker(me, peers);
  const roundSlot = gradingRoundSlot(assignment.id, peers);

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
    // Priors = the two earliest completers this round (not claim-order slots).
    const priorPeers = completedInSubmitOrder(
      peers.filter((p) => p.id !== assignment.id),
    ).slice(0, GRADERS_PER_VIDEO - 1);

    const priorGraders = priorPeers.map((peer, i) => {
      const row = siblings.find((s) => s.id === peer.id)!;
      return {
        expertId: row.expert.expertId,
        name: row.expert.name,
        graderSlot: i + 1,
        gradingData: row.gradingResult
          ? parseJsonSafe(row.gradingResult.gradingData, null)
          : null,
      };
    });

    const priorStatus: Array<{
      graderSlot: number;
      expertId: string | null;
      name: string | null;
      status: string | null;
    }> = priorGraders.map((g, i) => ({
      graderSlot: i + 1,
      expertId: g.expertId,
      name: g.name,
      status: "COMPLETED",
    }));
    while (priorStatus.length < GRADERS_PER_VIDEO - 1) {
      priorStatus.push({
        graderSlot: priorStatus.length + 1,
        expertId: null,
        name: null,
        status: null,
      });
    }

    const g1 = priorGraders[0]?.gradingData;
    const g2 = priorGraders[1]?.gradingData;
    const disagreements =
      g1 && g2 && priorGraders.length >= 2
        ? findCategoricalDisagreements(g1, g2)
        : [];

    consensus = {
      isTiebreaker: true,
      graderSlot: roundSlot,
      priorGraders,
      disagreements,
      priorStatus,
    };
  } else {
    consensus = {
      isTiebreaker: false,
      graderSlot: roundSlot,
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
    /** DB slot (claim order) — prefer graderRoundSlot for UI. */
    graderSlot: assignment.graderSlot,
    /** Position in the current grading round by who submitted first. */
    graderRoundSlot: roundSlot,
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
