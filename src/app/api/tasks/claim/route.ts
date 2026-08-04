import { NextResponse } from "next/server";
import {
  AssignmentKind,
  classifyVideoOutputId,
  getAssignmentConfig,
} from "@/lib/assignmentConfig";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const body = await req.json();
  const expertIdHuman = (body?.expertId as string | undefined)?.trim();
  const videoOutputId = (body?.videoOutputId as string | undefined)?.trim();

  if (!expertIdHuman || !videoOutputId) {
    return NextResponse.json(
      { error: "expertId and videoOutputId required" },
      { status: 400 },
    );
  }

  const expert = await prisma.expert.findUnique({
    where: { expertId: expertIdHuman },
    select: { id: true },
  });
  if (!expert) {
    return NextResponse.json({ error: "expert not found" }, { status: 404 });
  }

  const config = await getAssignmentConfig();
  const kind = classifyVideoOutputId(videoOutputId, config);
  if (kind !== AssignmentKind.EXCLUSIVE) {
    return NextResponse.json(
      { error: "该视频不在「独占认领」区间内，或编号无效" },
      { status: 400 },
    );
  }

  const aiOutput = await prisma.aiOutput.findUnique({
    where: { videoOutputId },
    select: { id: true },
  });
  if (!aiOutput) {
    return NextResponse.json({ error: "aiOutput not found" }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const taken = await tx.taskAssignment.findFirst({
      where: { aiOutputId: aiOutput.id },
      select: { id: true, expertId: true },
    });

    if (taken) {
      if (taken.expertId === expert.id) {
        return { taskAssignmentId: taken.id, alreadyOwned: true };
      }
      return { conflict: true as const };
    }

    const created = await tx.taskAssignment.create({
      data: {
        expertId: expert.id,
        aiOutputId: aiOutput.id,
        kind: AssignmentKind.EXCLUSIVE,
        status: "PENDING",
      },
      select: { id: true },
    });
    return { taskAssignmentId: created.id, alreadyOwned: false };
  });

  if ("conflict" in result && result.conflict) {
    return NextResponse.json({ error: "该视频已被其他专家认领" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    taskAssignmentId: result.taskAssignmentId,
    alreadyOwned: result.alreadyOwned,
  });
}
