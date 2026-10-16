import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";
import { parseVideoNumber } from "@/lib/videoId";
import { GRADERS_PER_VIDEO } from "@/lib/graders";

function byVideoId(a: string, b: string) {
  const na = parseVideoNumber(a);
  const nb = parseVideoNumber(b);
  if (na != null && nb != null && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const [experts, videos] = await Promise.all([
    prisma.expert.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        expertId: true,
        name: true,
        assignments: {
          select: {
            status: true,
            regradeRequestedAt: true,
            aiOutput: { select: { videoOutputId: true } },
          },
        },
      },
    }),
    prisma.aiOutput.findMany({
      select: {
        videoOutputId: true,
        assignments: { select: { status: true } },
      },
    }),
  ]);

  const rows = experts.map((ex) => {
    const completedVideos: string[] = [];
    const pendingVideos: string[] = [];
    let regrade = 0;
    for (const a of ex.assignments) {
      const vid = a.aiOutput.videoOutputId;
      if (a.status === "COMPLETED") completedVideos.push(vid);
      else pendingVideos.push(vid);
      if (a.regradeRequestedAt && a.status !== "COMPLETED") regrade += 1;
    }
    completedVideos.sort(byVideoId);
    pendingVideos.sort(byVideoId);
    const claimed = ex.assignments.length;
    const completed = completedVideos.length;
    return {
      expertId: ex.expertId,
      name: ex.name,
      claimed,
      completed,
      pending: pendingVideos.length,
      regrade,
      pendingVideos,
      completedVideos,
    };
  });

  let fullSlots = 0;
  let fullyGraded = 0;
  for (const v of videos) {
    if (v.assignments.length >= GRADERS_PER_VIDEO) fullSlots += 1;
    const done = v.assignments.filter((a) => a.status === "COMPLETED").length;
    if (done >= GRADERS_PER_VIDEO) fullyGraded += 1;
  }

  const claimed = rows.reduce((n, r) => n + r.claimed, 0);
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const pending = rows.reduce((n, r) => n + r.pending, 0);

  return NextResponse.json({
    summary: {
      expertCount: rows.length,
      videoCount: videos.length,
      fullSlots,
      fullyGraded,
      claimed,
      completed,
      pending,
    },
    experts: rows,
  });
}
