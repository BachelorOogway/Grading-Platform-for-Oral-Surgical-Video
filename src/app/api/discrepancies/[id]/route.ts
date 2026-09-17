import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { GRADERS_PER_VIDEO } from "@/lib/graders";
import {
  getCategoricalRaw,
  relatedDiscrepancyPaths,
} from "@/lib/categoricalFields";
import {
  enrichParsedFromGrading,
  normalizeAiParsedData,
} from "@/lib/normalizeParsed";
import { isTimingPath, TIMING_DISCREPANCY_THRESHOLD_SEC } from "@/lib/timingDiscrepancy";
import { gradersAgreeOnPath } from "@/lib/discrepancyOpen";

/** Detail for discrepancy regrade UI — all OPEN items on the same video share one form. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const expertId = url.searchParams.get("expertId")?.trim();
  if (!id || !expertId) {
    return NextResponse.json(
      { error: "id and expertId required" },
      { status: 400 },
    );
  }

  const expert = await prisma.expert.findUnique({
    where: { expertId },
    select: { id: true, expertId: true, name: true },
  });
  if (!expert) {
    return NextResponse.json({ error: "expert not found" }, { status: 404 });
  }

  const item = await prisma.discrepancyItem.findUnique({
    where: { id },
    include: {
      aiOutput: {
        select: {
          id: true,
          videoOutputId: true,
          rawText: true,
          parsedData: true,
          assignments: {
            include: {
              expert: { select: { expertId: true, name: true } },
              gradingResult: true,
            },
            orderBy: { graderSlot: "asc" },
          },
        },
      },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const myAssignment = item.aiOutput.assignments.find(
    (a) => a.expertId === expert.id,
  );
  if (!myAssignment) {
    return NextResponse.json(
      { error: "you are not a grader on this video" },
      { status: 403 },
    );
  }

  const openItems = await prisma.discrepancyItem.findMany({
    where: { aiOutputId: item.aiOutputId, status: "OPEN" },
    include: { votes: true },
    orderBy: { createdAt: "asc" },
  });

  const openPaths = openItems.map((d) => d.fieldPath);
  const highlightPaths = Array.from(
    new Set(openPaths.flatMap((p) => relatedDiscrepancyPaths(p))),
  );

  type SubmittedAnswer = {
    fieldPath: string;
    fieldLabel: string;
    choice: string;
    /** Raw value from their saved grading, so the UI can show the real answer */
    value: unknown;
    submittedAt: string;
  };

  const graders = item.aiOutput.assignments.map((a) => {
    const gradingData = a.gradingResult
      ? parseJsonSafe(a.gradingResult.gradingData, null)
      : null;
    const eid = a.expert.expertId;

    const submittedAnswers: SubmittedAnswer[] = [];
    for (const d of openItems) {
      const vote = d.votes.find((v) => v.expertId === eid);
      if (!vote) continue;
      submittedAnswers.push({
        fieldPath: d.fieldPath,
        fieldLabel: d.fieldLabel,
        choice: vote.choice,
        value: gradingData ? getCategoricalRaw(gradingData, d.fieldPath) : null,
        submittedAt: vote.updatedAt.toISOString(),
      });
    }

    const submittedAllOpen =
      openItems.length > 0 && submittedAnswers.length === openItems.length;

    return {
      taskAssignmentId: a.id,
      graderSlot: a.graderSlot,
      expertId: eid,
      name: a.expert.name,
      gradingData,
      submittedForDiscrepancy: submittedAllOpen,
      submittedPaths: submittedAnswers.map((s) => s.fieldPath),
      submittedAnswers,
      /** Shown above their column once they have solved anything this round */
      solvingResultsLabel:
        submittedAnswers.length > 0
          ? `Solving results from expert ${eid}`
          : null,
    };
  });

  while (graders.length < GRADERS_PER_VIDEO) {
    graders.push({
      taskAssignmentId: "",
      graderSlot: graders.length + 1,
      expertId: "",
      name: "",
      gradingData: null,
      submittedForDiscrepancy: false,
      submittedPaths: [] as string[],
      submittedAnswers: [] as SubmittedAnswer[],
      solvingResultsLabel: null as string | null,
    });
  }

  const expertsFullySubmitted = graders.filter((g) => g.submittedForDiscrepancy);
  const gradingSnapshot = graders
    .filter((g) => g.expertId && g.gradingData)
    .map((g) => g.gradingData);
  const perItemProgress = openItems.map((d) => {
    const submittedCount = d.votes.length;
    const allSubmitted = submittedCount >= GRADERS_PER_VIDEO;
    // Agreement is judged on the three graders' current answers, not on
    // whether every expert has clicked submit yet.
    const agreed = gradersAgreeOnPath(gradingSnapshot, d.fieldPath).agreed;
    return {
      id: d.id,
      fieldPath: d.fieldPath,
      fieldLabel: d.fieldLabel,
      submittedCount,
      total: GRADERS_PER_VIDEO,
      allSame: agreed,
      /** Everyone answered and they still do not line up — needs another round. */
      contested: allSubmitted && !agreed,
      isTiming: isTimingPath(d.fieldPath),
      mySubmitted: d.votes.some((v) => v.expertId === expert.expertId),
    };
  });

  let parsedData = normalizeAiParsedData(
    parseJsonSafe(item.aiOutput.parsedData, null),
    item.aiOutput.rawText,
  );
  for (const g of graders) {
    if (g.gradingData) {
      parsedData = enrichParsedFromGrading(parsedData, g.gradingData);
    }
  }

  return NextResponse.json({
    id: item.id,
    aiOutputId: item.aiOutputId,
    status: item.status,
    videoOutputId: item.aiOutput.videoOutputId,
    parsedData,
    mySlot: myAssignment.graderSlot,
    myExpertId: expert.expertId,
    myTaskAssignmentId: myAssignment.id,
    /** All OPEN discrepancy fields on this video (same form). */
    items: openItems.map((d) => ({
      id: d.id,
      fieldPath: d.fieldPath,
      fieldLabel: d.fieldLabel,
      status: d.status,
    })),
    openItems: perItemProgress,
    highlightPaths,
    graders: graders.slice(0, GRADERS_PER_VIDEO),
    timingThresholdSec: TIMING_DISCREPANCY_THRESHOLD_SEC,
    progress: {
      openFieldCount: openItems.length,
      expertsSubmittedCount: expertsFullySubmitted.length,
      totalExperts: GRADERS_PER_VIDEO,
      contestedCount: perItemProgress.filter((d) => d.contested).length,
    },
  });
}
