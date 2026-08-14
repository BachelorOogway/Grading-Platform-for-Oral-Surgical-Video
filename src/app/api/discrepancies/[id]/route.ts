import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import { GRADERS_PER_VIDEO } from "@/lib/graders";
import {
  categoricalCompareToken,
  getCategoricalRaw,
} from "@/lib/categoricalFields";
import { parseAiOutputToParsedData } from "@/lib/aiOutputParser";
import type { AiParsedData } from "@/lib/aiOutputParser";

function normalizeParsed(raw: unknown, rawText: string): AiParsedData {
  const parsed = parseAiOutputToParsedData(rawText);
  const stored = raw as Partial<AiParsedData> | null;
  // Prefer live re-parse from rawText for structure; stored may be stale.
  return {
    ...parsed,
    ...(stored && typeof stored === "object" ? {} : {}),
  };
}

/** Detail for discrepancy regrade UI (same 3-column layout as grader 3). */
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
      votes: true,
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

  const graders = item.aiOutput.assignments.map((a) => {
    const gradingData = a.gradingResult
      ? parseJsonSafe(a.gradingResult.gradingData, null)
      : null;
    const vote = item.votes.find((v) => v.expertId === a.expert.expertId);
    const currentRaw = gradingData
      ? getCategoricalRaw(gradingData, item.fieldPath)
      : null;
    return {
      taskAssignmentId: a.id,
      graderSlot: a.graderSlot,
      expertId: a.expert.expertId,
      name: a.expert.name,
      gradingData,
      submittedForDiscrepancy: Boolean(vote),
      submittedChoice: vote?.choice ?? null,
      currentValue: currentRaw,
      currentToken: categoricalCompareToken(currentRaw),
    };
  });

  // Pad missing slots for UI stability
  while (graders.length < GRADERS_PER_VIDEO) {
    graders.push({
      taskAssignmentId: "",
      graderSlot: graders.length + 1,
      expertId: "",
      name: "",
      gradingData: null,
      submittedForDiscrepancy: false,
      submittedChoice: null,
      currentValue: null,
      currentToken: null,
    });
  }

  const submitted = graders.filter((g) => g.submittedForDiscrepancy);
  const tokens = submitted
    .map((g) => g.submittedChoice)
    .filter((t): t is string => Boolean(t));
  const allSubmitted = submitted.length >= GRADERS_PER_VIDEO;
  const allSame =
    allSubmitted && tokens.length > 0 && tokens.every((t) => t === tokens[0]);

  return NextResponse.json({
    id: item.id,
    status: item.status,
    fieldPath: item.fieldPath,
    fieldLabel: item.fieldLabel,
    resolvedValue: item.resolvedValue,
    videoOutputId: item.aiOutput.videoOutputId,
    parsedData: normalizeParsed(
      parseJsonSafe(item.aiOutput.parsedData, null),
      item.aiOutput.rawText,
    ),
    mySlot: myAssignment.graderSlot,
    myExpertId: expert.expertId,
    myTaskAssignmentId: myAssignment.id,
    graders: graders.slice(0, GRADERS_PER_VIDEO),
    progress: {
      submittedCount: submitted.length,
      total: GRADERS_PER_VIDEO,
      allSubmitted,
      allSame,
    },
  });
}
