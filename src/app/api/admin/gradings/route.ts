import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { requireAdmin } from "@/lib/adminAuth";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const assignments = await prisma.taskAssignment.findMany({
    where: { status: "COMPLETED" },
    include: {
      expert: { select: { expertId: true, name: true } },
      aiOutput: { select: { videoOutputId: true, rawText: true } },
      gradingResult: {
        select: { id: true, submittedAt: true, gradingData: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    items: assignments.map((a) => {
      const gradingData = a.gradingResult?.gradingData
        ? parseJsonSafe(a.gradingResult.gradingData, null)
        : null;
      return {
        taskAssignmentId: a.id,
        gradingResultId: a.gradingResult?.id ?? null,
        expertId: a.expert.expertId,
        expertName: a.expert.name,
        videoOutputId: a.aiOutput.videoOutputId,
        kind: a.kind,
        submittedAt: a.gradingResult?.submittedAt ?? a.updatedAt,
        regradeNote: a.regradeNote,
        regradeRequestedAt: a.regradeRequestedAt,
        gradingData,
      };
    }),
  });
}
