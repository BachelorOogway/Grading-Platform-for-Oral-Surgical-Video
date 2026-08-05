import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const taskAssignmentId = (body?.taskAssignmentId as string | undefined)?.trim();
    const note = ((body?.note as string | undefined) ?? "").trim();

    if (!taskAssignmentId) {
      return NextResponse.json({ error: "taskAssignmentId required" }, { status: 400 });
    }

    const assignment = await prisma.taskAssignment.findUnique({
      where: { id: taskAssignmentId },
      include: {
        expert: { select: { expertId: true, name: true } },
        aiOutput: { select: { videoOutputId: true } },
        gradingResult: { select: { id: true } },
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }

    if (assignment.status !== "COMPLETED" && !assignment.gradingResult) {
      return NextResponse.json(
        { error: "task is not completed; nothing to regrade" },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      if (assignment.gradingResult) {
        await tx.gradingResult.delete({
          where: { taskAssignmentId },
        });
      }

      await tx.taskAssignment.update({
        where: { id: taskAssignmentId },
        data: {
          status: "PENDING",
          regradeNote:
            note ||
            "Admin requested a regrade. Please review carefully and submit again.",
          regradeRequestedAt: new Date(),
        },
      });
    });

    return NextResponse.json({
      ok: true,
      taskAssignmentId,
      expertId: assignment.expert.expertId,
      videoOutputId: assignment.aiOutput.videoOutputId,
      message: `Returned ${assignment.aiOutput.videoOutputId} to ${assignment.expert.expertId} for regrade`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/regrade]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
