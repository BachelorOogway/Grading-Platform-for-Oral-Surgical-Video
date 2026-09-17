import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSubmissionOrderTiebreaker, type GradingOrderPeer } from "@/lib/graders";

/** Create or cancel discrepancy-solve items (no voting). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const expertId = String(body?.expertId ?? "").trim();
  const videoOutputId = String(body?.videoOutputId ?? "").trim();
  const action = String(body?.action ?? "create").trim(); // create | cancel
  const fields: Array<{ path: string; label: string }> = Array.isArray(
    body?.fields,
  )
    ? body.fields
    : [];

  if (!expertId || !videoOutputId || fields.length === 0) {
    return NextResponse.json(
      { error: "expertId, videoOutputId, fields required" },
      { status: 400 },
    );
  }

  const expert = await prisma.expert.findUnique({
    where: { expertId },
    select: { id: true, expertId: true },
  });
  if (!expert) {
    return NextResponse.json({ error: "expert not found" }, { status: 404 });
  }

  const ai = await prisma.aiOutput.findUnique({
    where: { videoOutputId },
    select: { id: true },
  });
  if (!ai) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const assignment = await prisma.taskAssignment.findFirst({
    where: { expertId: expert.id, aiOutputId: ai.id },
    select: { id: true, status: true, graderSlot: true },
  });
  if (!assignment) {
    return NextResponse.json(
      { error: "only the 3rd grader can initiate discrepancy solve" },
      { status: 403 },
    );
  }

  const siblings = await prisma.taskAssignment.findMany({
    where: { aiOutputId: ai.id },
    include: { gradingResult: { select: { submittedAt: true, updatedAt: true } } },
  });
  const peers: GradingOrderPeer[] = siblings.map((a) => ({
    id: a.id,
    status: a.status,
    completedAt:
      a.status === "COMPLETED" && a.gradingResult
        ? a.gradingResult.submittedAt ?? a.gradingResult.updatedAt
        : null,
  }));
  const me = peers.find((p) => p.id === assignment.id) ?? {
    id: assignment.id,
    status: assignment.status,
    completedAt: null,
  };
  if (!isSubmissionOrderTiebreaker(me, peers)) {
    return NextResponse.json(
      {
        error:
          "only the third expert to grade this round (after two others have submitted) can initiate discrepancy solve",
      },
      { status: 403 },
    );
  }

  if (action === "cancel") {
    const paths = fields.map((f) => String(f.path ?? "").trim()).filter(Boolean);
    const result = await prisma.discrepancyItem.deleteMany({
      where: {
        aiOutputId: ai.id,
        fieldPath: { in: paths },
        status: "OPEN",
      },
    });
    return NextResponse.json({ ok: true, cancelled: result.count });
  }

  const created = [];
  for (const f of fields) {
    const path = String(f.path ?? "").trim();
    const label = String(f.label ?? path).trim();
    if (!path) continue;
    const item = await prisma.discrepancyItem.upsert({
      where: {
        aiOutputId_fieldPath: { aiOutputId: ai.id, fieldPath: path },
      },
      update: {
        status: "OPEN",
        resolvedValue: null,
        fieldLabel: label,
        createdByExpert: expert.expertId,
      },
      create: {
        aiOutputId: ai.id,
        fieldPath: path,
        fieldLabel: label,
        status: "OPEN",
        createdByExpert: expert.expertId,
      },
    });
    // Fresh round: clear previous submissions
    await prisma.discrepancyVote.deleteMany({
      where: { discrepancyItemId: item.id },
    });
    created.push(item);
  }

  return NextResponse.json({ ok: true, count: created.length, items: created });
}

/** List open discrepancy-solve items for an expert (videos they grade). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const expertId = url.searchParams.get("expertId")?.trim();
  if (!expertId) {
    return NextResponse.json({ error: "expertId required" }, { status: 400 });
  }

  const expert = await prisma.expert.findUnique({
    where: { expertId },
    select: { id: true, expertId: true },
  });
  if (!expert) {
    return NextResponse.json({ error: "expert not found" }, { status: 404 });
  }

  const items = await prisma.discrepancyItem.findMany({
    where: {
      status: "OPEN",
      aiOutput: { assignments: { some: { expertId: expert.id } } },
    },
    include: {
      aiOutput: {
        select: {
          videoOutputId: true,
          assignments: {
            where: { expertId: expert.id },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      videoOutputId: d.aiOutput.videoOutputId,
      fieldPath: d.fieldPath,
      fieldLabel: d.fieldLabel,
      taskAssignmentId: d.aiOutput.assignments[0]?.id ?? null,
    })),
  });
}
