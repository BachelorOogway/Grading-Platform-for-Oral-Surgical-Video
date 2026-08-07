import { NextResponse } from "next/server";
import {
  AssignmentKind,
  classifyVideoOutputId,
  getAssignmentConfig,
} from "@/lib/assignmentConfig";
import { GRADERS_PER_VIDEO } from "@/lib/graders";
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
  if (!kind) {
    return NextResponse.json(
      { error: "该视频不在可认领区间内，或编号无效" },
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
    const mine = await tx.taskAssignment.findFirst({
      where: { expertId: expert.id, aiOutputId: aiOutput.id },
      select: { id: true, graderSlot: true },
    });
    if (mine) {
      return {
        taskAssignmentId: mine.id,
        alreadyOwned: true,
        graderSlot: mine.graderSlot,
      };
    }

    const existing = await tx.taskAssignment.findMany({
      where: { aiOutputId: aiOutput.id },
      select: { id: true, graderSlot: true },
      orderBy: { graderSlot: "asc" },
    });

    if (existing.length >= GRADERS_PER_VIDEO) {
      return { full: true as const };
    }

    const usedSlots = new Set(existing.map((e) => e.graderSlot));
    let slot = 1;
    while (usedSlots.has(slot) && slot <= GRADERS_PER_VIDEO) slot += 1;

    const created = await tx.taskAssignment.create({
      data: {
        expertId: expert.id,
        aiOutputId: aiOutput.id,
        kind,
        status: "PENDING",
        graderSlot: slot,
      },
      select: { id: true, graderSlot: true },
    });
    return {
      taskAssignmentId: created.id,
      alreadyOwned: false,
      graderSlot: created.graderSlot,
    };
  });

  if ("full" in result && result.full) {
    return NextResponse.json(
      { error: `该视频已有 ${GRADERS_PER_VIDEO} 位评分者` },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    taskAssignmentId: result.taskAssignmentId,
    alreadyOwned: result.alreadyOwned,
    graderSlot: result.graderSlot,
  });
}
