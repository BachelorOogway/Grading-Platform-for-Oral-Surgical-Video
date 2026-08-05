import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stringifyJson } from "@/lib/json";

type RouteContext = { params: Promise<{ taskId: string }> };

async function resolveTaskId(params: RouteContext["params"]) {
  const p = await params;
  return p?.taskId?.trim() ?? "";
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const taskAssignmentId = await resolveTaskId(params);
    if (!taskAssignmentId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 });
    }

    const body = await req.json();
    const expertId = (body?.expertId as string | undefined)?.trim();
    const gradingData = body?.gradingData;

    if (!expertId) {
      return NextResponse.json({ error: "expertId required" }, { status: 400 });
    }
    if (!gradingData) {
      return NextResponse.json({ error: "gradingData required" }, { status: 400 });
    }

    const assignment = await prisma.taskAssignment.findUnique({
      where: { id: taskAssignmentId },
      select: { id: true, expertId: true, aiOutputId: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }

    const expert = await prisma.expert.findUnique({
      where: { expertId },
      select: { id: true },
    });
    if (!expert || assignment.expertId !== expert.id) {
      return NextResponse.json(
        { error: "forbidden: expertId does not match this task" },
        { status: 403 },
      );
    }

    const gradingDataStr = stringifyJson(gradingData);

    await prisma.gradingResult.upsert({
      where: { taskAssignmentId },
      update: { gradingData: gradingDataStr },
      create: {
        taskAssignmentId,
        expertId: assignment.expertId,
        aiOutputId: assignment.aiOutputId,
        gradingData: gradingDataStr,
      },
    });

    await prisma.taskAssignment.update({
      where: { id: taskAssignmentId },
      data: {
        status: "COMPLETED",
        regradeNote: null,
        regradeRequestedAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[grade POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
