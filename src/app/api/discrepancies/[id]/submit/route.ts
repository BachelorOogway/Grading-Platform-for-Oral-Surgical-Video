import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe, stringifyJson } from "@/lib/json";
import { GRADERS_PER_VIDEO } from "@/lib/graders";
import {
  categoricalCompareToken,
  getCategoricalRaw,
  relatedDiscrepancyPaths,
  setCategoricalRaw,
} from "@/lib/categoricalFields";

/** Read a path from live form values (correct/incorrect / yes/no / times). */
function getFormPathRaw(values: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: any = values;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  if (cur === "correct" || cur === "yes" || cur === "pass") return true;
  if (cur === "incorrect" || cur === "no" || cur === "fail") return false;
  return cur ?? null;
}

/**
 * Submit this grader's answer for a discrepancy field.
 * Resolves only when all 3 graders have submitted the exact same categorical value.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const expertId = String(body?.expertId ?? "").trim();
  const gradingData = body?.gradingData;
  const explicitFieldValue = body?.fieldValue;

  if (!id || !expertId || !gradingData) {
    return NextResponse.json(
      { error: "id, expertId, gradingData required" },
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

  const item = await prisma.discrepancyItem.findUnique({
    where: { id },
    include: {
      votes: true,
      aiOutput: {
        select: {
          id: true,
          assignments: {
            include: {
              expert: { select: { expertId: true } },
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
  if (item.status !== "OPEN") {
    return NextResponse.json({ error: "already resolved" }, { status: 409 });
  }

  const assignment = item.aiOutput.assignments.find(
    (a) => a.expertId === expert.id,
  );
  if (!assignment) {
    return NextResponse.json(
      { error: "you are not a grader on this video" },
      { status: 403 },
    );
  }

  const incoming =
    typeof gradingData === "string"
      ? parseJsonSafe(gradingData, null)
      : gradingData;
  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json({ error: "invalid gradingData" }, { status: 400 });
  }

  const existing = assignment.gradingResult
    ? parseJsonSafe(assignment.gradingResult.gradingData, {})
    : {};

  let newValue =
    explicitFieldValue !== undefined && explicitFieldValue !== null
      ? explicitFieldValue
      : getCategoricalRaw(incoming, item.fieldPath);

  // Form-shaped payload fallback (e.g. "correct" / "00:00:07")
  if (categoricalCompareToken(newValue) == null) {
    newValue = getFormPathRaw(incoming, item.fieldPath);
  }
  // Keep previous answer if rebuild dropped the field but expert didn't clear it
  if (categoricalCompareToken(newValue) == null && existing) {
    newValue = getCategoricalRaw(existing, item.fieldPath);
  }

  const token = categoricalCompareToken(newValue);
  if (token == null) {
    return NextResponse.json(
      {
        error:
          "please answer the discrepancy field before submitting (highlighted in pink)",
      },
      { status: 400 },
    );
  }

  const merged =
    existing && typeof existing === "object"
      ? structuredClone(existing)
      : structuredClone(incoming);

  // Always write the primary discrepancy answer
  setCategoricalRaw(merged, item.fieldPath, newValue);

  for (const path of relatedDiscrepancyPaths(item.fieldPath)) {
    if (path === item.fieldPath) continue;
    let v = getCategoricalRaw(incoming, path);
    if (categoricalCompareToken(v) == null) {
      v = getFormPathRaw(incoming, path);
    }
    if (v != null && v !== "") {
      setCategoricalRaw(merged, path, v);
    }
  }

  const gradingDataStr = stringifyJson(merged);

  if (assignment.gradingResult) {
    await prisma.gradingResult.update({
      where: { id: assignment.gradingResult.id },
      data: { gradingData: gradingDataStr },
    });
  } else {
    await prisma.gradingResult.create({
      data: {
        taskAssignmentId: assignment.id,
        expertId: assignment.expertId,
        aiOutputId: item.aiOutputId,
        gradingData: gradingDataStr,
      },
    });
  }

  await prisma.discrepancyVote.upsert({
    where: {
      discrepancyItemId_expertId: {
        discrepancyItemId: item.id,
        expertId: expert.expertId,
      },
    },
    update: { choice: token },
    create: {
      discrepancyItemId: item.id,
      expertId: expert.expertId,
      choice: token,
    },
  });

  const votes = await prisma.discrepancyVote.findMany({
    where: { discrepancyItemId: item.id },
  });

  const allSubmitted = votes.length >= GRADERS_PER_VIDEO;
  const allSame =
    allSubmitted && votes.every((v) => v.choice === votes[0].choice);

  if (allSame) {
    const agreedRaw = newValue;
    for (const a of item.aiOutput.assignments) {
      if (!a.gradingResult) continue;
      const gd = parseJsonSafe(a.gradingResult.gradingData, {});
      const next = structuredClone(gd ?? {});
      setCategoricalRaw(next, item.fieldPath, agreedRaw);
      await prisma.gradingResult.update({
        where: { id: a.gradingResult.id },
        data: { gradingData: stringifyJson(next) },
      });
    }

    await prisma.discrepancyItem.update({
      where: { id: item.id },
      data: {
        status: "RESOLVED",
        resolvedValue: token,
      },
    });

    return NextResponse.json({
      ok: true,
      resolved: true,
      resolvedValue: token,
      submittedCount: votes.length,
      total: GRADERS_PER_VIDEO,
    });
  }

  return NextResponse.json({
    ok: true,
    resolved: false,
    submittedCount: votes.length,
    total: GRADERS_PER_VIDEO,
    choices: votes.map((v) => ({ expertId: v.expertId, choice: v.choice })),
  });
}

