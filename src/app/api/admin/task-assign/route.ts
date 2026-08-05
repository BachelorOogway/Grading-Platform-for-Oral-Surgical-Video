import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";

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
    select: { id: true, status: true },
  });

  if (existing) {
    const updated = await prisma.taskAssignment.update({
      where: { id: existing.id },
      data: { status: "PENDING" },
      select: { id: true, status: true },
    });
    return NextResponse.json({
      ok: true,
      taskAssignmentId: updated.id,
      status: updated.status,
    });
  }

  const created = await prisma.taskAssignment.create({
    data: { expertId: expert.id, aiOutputId: aiOutput.id, status: "PENDING" },
    select: { id: true, status: true },
  });

  return NextResponse.json({
    ok: true,
    taskAssignmentId: created.id,
    status: created.status,
  });
}
