import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";
import { buildGroundTruthCsv } from "@/lib/groundTruthExport";

/** Per-video corrected ground truth (AI kept when correct; else expert correction). */
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const results = await prisma.gradingResult.findMany({
    include: {
      taskAssignment: {
        include: { expert: true, aiOutput: true },
      },
    },
    orderBy: { submittedAt: "asc" },
  });

  const csv = buildGroundTruthCsv(
    results.map((r) => ({
      videoOutputId: r.taskAssignment.aiOutput.videoOutputId,
      expertId: r.taskAssignment.expert.expertId,
      submittedAt: r.submittedAt?.toISOString?.() ?? String(r.submittedAt),
      gradingData: r.gradingData,
      parsedData: r.taskAssignment.aiOutput.parsedData,
    })),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="video_ground_truth.csv"',
    },
  });
}
