import { NextResponse } from "next/server";
import {
  AssignmentKind,
  getAssignmentConfig,
  isInRanges,
  syncSharedAssignmentsForExpert,
} from "@/lib/assignmentConfig";
import { GRADERS_PER_VIDEO } from "@/lib/graders";
import { prisma } from "@/lib/prisma";
import { parseVideoNumber } from "@/lib/videoId";

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

  await syncSharedAssignmentsForExpert(expert.id);

  const config = await getAssignmentConfig();

  const assignments = await prisma.taskAssignment.findMany({
    where: { expertId: expert.id },
    include: {
      aiOutput: true,
      gradingResult: { select: { submittedAt: true, updatedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Sibling completion times per video — needed for this-round Grader N/3.
  const aiIds = [...new Set(assignments.map((a) => a.aiOutputId))];
  const siblingRows =
    aiIds.length === 0
      ? []
      : await prisma.taskAssignment.findMany({
          where: { aiOutputId: { in: aiIds } },
          include: {
            gradingResult: { select: { submittedAt: true, updatedAt: true } },
          },
        });
  const siblingsByAi = new Map<string, typeof siblingRows>();
  for (const row of siblingRows) {
    const list = siblingsByAi.get(row.aiOutputId) ?? [];
    list.push(row);
    siblingsByAi.set(row.aiOutputId, list);
  }

  const { gradingRoundSlot } = await import("@/lib/graders");

  const mapItem = (a: (typeof assignments)[number]) => {
    const sibs = (siblingsByAi.get(a.aiOutputId) ?? []).map((s) => ({
      id: s.id,
      status: s.status,
      completedAt:
        s.status === "COMPLETED" && s.gradingResult
          ? s.gradingResult.submittedAt ?? s.gradingResult.updatedAt
          : null,
    }));
    return {
      taskAssignmentId: a.id,
      aiOutputId: a.aiOutputId,
      videoOutputId: a.aiOutput.videoOutputId,
      status: a.status,
      kind: a.kind,
      graderSlot: a.graderSlot,
      graderRoundSlot: gradingRoundSlot(a.id, sibs),
      updatedAt: a.updatedAt,
      regradeNote: a.regradeNote,
      regradeRequestedAt: a.regradeRequestedAt,
    };
  };

  const pending = assignments.filter((a) => a.status === "PENDING").map(mapItem);
  const completed = assignments
    .filter((a) => a.status === "COMPLETED")
    .map(mapItem);

  const allOutputs = await prisma.aiOutput.findMany({
    select: { id: true, videoOutputId: true },
  });

  const counts = await prisma.taskAssignment.groupBy({
    by: ["aiOutputId"],
    _count: { _all: true },
  });
  const countByAi = new Map(counts.map((c) => [c.aiOutputId, c._count._all]));

  const myAiIds = new Set(assignments.map((a) => a.aiOutputId));

  // Claimable: any configured range video with < 3 graders and not already mine
  const claimable = allOutputs
    .filter((o) => {
      const n = parseVideoNumber(o.videoOutputId);
      if (n === null) return false;
      const inEx = isInRanges(n, config.exclusiveRanges);
      const inSh = isInRanges(n, config.sharedRanges);
      if (!inEx && !inSh) return false;
      if (myAiIds.has(o.id)) return false;
      return (countByAi.get(o.id) ?? 0) < GRADERS_PER_VIDEO;
    })
    .map((o) => ({
      videoOutputId: o.videoOutputId,
      videoNumber: parseVideoNumber(o.videoOutputId),
      slotsTaken: countByAi.get(o.id) ?? 0,
      slotsTotal: GRADERS_PER_VIDEO,
    }))
    .sort((a, b) => (a.videoNumber ?? 0) - (b.videoNumber ?? 0));

  const openDiscrepancies = await prisma.discrepancyItem.findMany({
    where: {
      status: "OPEN",
      aiOutput: {
        assignments: { some: { expertId: expert.id } },
      },
    },
    include: {
      votes: true,
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

  const discrepancies = openDiscrepancies.map((d) => {
    const myVote = d.votes.find((v) => v.expertId === expert.expertId);
    return {
      id: d.id,
      videoOutputId: d.aiOutput.videoOutputId,
      fieldPath: d.fieldPath,
      fieldLabel: d.fieldLabel,
      status: d.status,
      taskAssignmentId: d.aiOutput.assignments[0]?.id ?? null,
      submittedCount: d.votes.length,
      total: GRADERS_PER_VIDEO,
      mySubmitted: Boolean(myVote),
      myChoice: myVote?.choice ?? null,
    };
  });

  return NextResponse.json({
    config,
    gradersPerVideo: GRADERS_PER_VIDEO,
    pending,
    completed,
    claimable,
    discrepancies,
    sharedPending: pending.filter((p) => p.kind === AssignmentKind.SHARED),
    exclusivePending: pending.filter((p) => p.kind === AssignmentKind.EXCLUSIVE),
  });
}
