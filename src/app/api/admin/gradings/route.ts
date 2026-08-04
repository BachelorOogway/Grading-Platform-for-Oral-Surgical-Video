import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const assignments = await prisma.taskAssignment.findMany({
    where: { status: "COMPLETED" },
    include: {
      expert: { select: { expertId: true, name: true } },
      aiOutput: { select: { videoOutputId: true } },
      gradingResult: { select: { id: true, submittedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    items: assignments.map((a) => ({
      taskAssignmentId: a.id,
      expertId: a.expert.expertId,
      expertName: a.expert.name,
      videoOutputId: a.aiOutput.videoOutputId,
      kind: a.kind,
      submittedAt: a.gradingResult?.submittedAt ?? a.updatedAt,
      regradeNote: a.regradeNote,
      regradeRequestedAt: a.regradeRequestedAt,
    })),
  });
}
