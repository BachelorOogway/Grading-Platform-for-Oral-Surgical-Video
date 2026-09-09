import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";
import { GRADERS_PER_VIDEO } from "@/lib/graders";
import { classifyVideoOutputId, getAssignmentConfig } from "@/lib/assignmentConfig";

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const expertIdHuman = (body?.expertId as string | undefined)?.trim();
  const videoOutputId = (body?.videoOutputId as string | undefined)?.trim();

  if (!expertIdHuman || !videoOutputId) {
    return NextResponse.json(
      { error: "expertId + videoOutputId required" },
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

  const aiOutput = await prisma.aiOutput.findUnique({
    where: { videoOutputId },
    select: { id: true },
  });
  if (!aiOutput) {
    return NextResponse.json({ error: "aiOutput not found" }, { status: 404 });
  }

  const existing = await prisma.taskAssignment.findFirst({
    where: { expertId: expert.id, aiOutputId: aiOutput.id },
    select: { id: true, status: true, graderSlot: true },
  });

  if (existing) {
    const updated = await prisma.taskAssignment.update({
      where: { id: existing.id },
      data: { status: "PENDING" },
      select: { id: true, status: true, graderSlot: true },
    });
    return NextResponse.json({
      ok: true,
      taskAssignmentId: updated.id,
      status: updated.status,
      graderSlot: updated.graderSlot,
    });
  }

  const siblings = await prisma.taskAssignment.findMany({
    where: { aiOutputId: aiOutput.id },
    select: { graderSlot: true },
  });
  if (siblings.length >= GRADERS_PER_VIDEO) {
    return NextResponse.json(
      { error: `该视频已有 ${GRADERS_PER_VIDEO} 位评分者` },
      { status: 409 },
    );
  }

  // Slot 3 is the tiebreaker; leaving everyone on the default slot 1 would
  // silently disable the side-by-side consensus view and discrepancy solve.
  const usedSlots = new Set(siblings.map((s) => s.graderSlot));
  let graderSlot = 1;
  while (usedSlots.has(graderSlot) && graderSlot <= GRADERS_PER_VIDEO) {
    graderSlot += 1;
  }

  const config = await getAssignmentConfig();
  const kind = classifyVideoOutputId(videoOutputId, config);

  const created = await prisma.taskAssignment.create({
    data: {
      expertId: expert.id,
      aiOutputId: aiOutput.id,
      status: "PENDING",
      graderSlot,
      ...(kind ? { kind } : {}),
    },
    select: { id: true, status: true, graderSlot: true },
  });

  return NextResponse.json({
    ok: true,
    taskAssignmentId: created.id,
    status: created.status,
    graderSlot: created.graderSlot,
  });
}
