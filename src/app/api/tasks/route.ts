import { NextResponse } from "next/server";
import {
  AssignmentKind,
  getAssignmentConfig,
  isInRanges,
  syncSharedAssignmentsForExpert,
} from "@/lib/assignmentConfig";
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
    include: { aiOutput: true },
    orderBy: { updatedAt: "desc" },
  });

  const mapItem = (a: (typeof assignments)[number]) => ({
    taskAssignmentId: a.id,
    aiOutputId: a.aiOutputId,
    videoOutputId: a.aiOutput.videoOutputId,
    status: a.status,
    kind: a.kind,
    updatedAt: a.updatedAt,
    regradeNote: a.regradeNote,
    regradeRequestedAt: a.regradeRequestedAt,
  });

  const pending = assignments.filter((a) => a.status === "PENDING").map(mapItem);
  const completed = assignments
    .filter((a) => a.status === "COMPLETED")
    .map(mapItem);

  const allOutputs = await prisma.aiOutput.findMany({
    select: { id: true, videoOutputId: true },
  });

  const claimedAiOutputIds = new Set(
    (await prisma.taskAssignment.findMany({ select: { aiOutputId: true } })).map(
      (x) => x.aiOutputId,
    ),
  );

  const claimable = allOutputs
    .filter((o) => {
      const n = parseVideoNumber(o.videoOutputId);
      if (n === null) return false;
      if (!isInRanges(n, config.exclusiveRanges)) return false;
      return !claimedAiOutputIds.has(o.id);
    })
    .map((o) => ({
      videoOutputId: o.videoOutputId,
      videoNumber: parseVideoNumber(o.videoOutputId),
    }))
    .sort((a, b) => (a.videoNumber ?? 0) - (b.videoNumber ?? 0));

  return NextResponse.json({
    config,
    pending,
    completed,
    claimable,
    sharedPending: pending.filter((p) => p.kind === AssignmentKind.SHARED),
    exclusivePending: pending.filter((p) => p.kind === AssignmentKind.EXCLUSIVE),
  });
}
