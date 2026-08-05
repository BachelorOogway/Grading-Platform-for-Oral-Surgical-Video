import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeGlobalGradingMetrics } from "@/lib/globalGradingMetrics";
import { requireAdmin } from "@/lib/adminAuth";

/** @deprecated Prefer /api/admin/global-metrics — kept for compatibility. */
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const results = await prisma.gradingResult.findMany({
    include: {
      taskAssignment: {
        include: {
          aiOutput: { select: { parsedData: true, videoOutputId: true } },
          expert: { select: { expertId: true } },
        },
      },
    },
  });

  const metrics = computeGlobalGradingMetrics(
    results.map((r) => ({
      gradingData: r.gradingData,
      parsedData: r.taskAssignment.aiOutput.parsedData,
      videoOutputId: r.taskAssignment.aiOutput.videoOutputId,
      expertId: r.taskAssignment.expert.expertId,
      kind: r.taskAssignment.kind,
    })),
  );

  return NextResponse.json({ metrics, level3: metrics.level3 });
}
