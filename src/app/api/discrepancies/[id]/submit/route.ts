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
import { isTimingPath } from "@/lib/timingDiscrepancy";
import {
  gradersAgreeOnPath,
  loadAllGradings,
  syncTimingDiscrepancies,
} from "@/lib/discrepancyOpen";

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

function resolveFieldValue(
  incoming: unknown,
  existing: unknown,
  fieldPath: string,
  explicit?: unknown,
): { value: unknown; token: string } | null {
  let newValue =
    explicit !== undefined && explicit !== null
      ? explicit
      : getCategoricalRaw(incoming, fieldPath);

  if (categoricalCompareToken(newValue) == null) {
    newValue = getFormPathRaw(incoming, fieldPath);
  }
  if (categoricalCompareToken(newValue) == null && existing) {
    newValue = getCategoricalRaw(existing, fieldPath);
  }
  const token = categoricalCompareToken(newValue);
  if (token == null) return null;
  return { value: newValue, token };
}

/** Derived aggregates recomputed by the form; keep them in sync with the answers. */
const DERIVED_METRIC_PATHS = [
  "level1.wrongStructuresCount",
  "level1.structureCorrectCount",
  "level1.structureTotalCount",
  "level1.structureHallucinationAbsentCount",
  "level1.structureMisrecognitionPresentCount",
  "level1.structurePrecision",
  "level1.structureHallucinationRate",
  "level1.structureMisrecognitionRate",
  "level1.wrongInstrumentsCount",
  "level1.instrumentCorrectCount",
  "level1.instrumentTotalCount",
  "level1.instrumentHallucinationAbsentCount",
  "level1.instrumentMisrecognitionPresentCount",
  "level1.instrumentPrecision",
  "level1.instrumentHallucinationRate",
  "level1.instrumentMisrecognitionRate",
  "level1.instrumentRecall",
  "level1.instrumentF1",
  "level2.metrics",
];

/**
 * Copy everything the expert may have edited alongside a discrepancy answer.
 * For list items (structure / instrument / phase) the whole item is copied so
 * follow-up inputs like the corrected instrument name survive the merge.
 */
function syncDiscrepancyGroup(
  merged: any,
  incoming: unknown,
  fieldPath: string,
): void {
  const listItem = /^(.*\.\d+)\.[^.]+$/.exec(fieldPath);
  if (listItem) {
    const itemPath = listItem[1];
    const item = getCategoricalRaw(incoming, itemPath);
    if (item && typeof item === "object") {
      setCategoricalRaw(merged, itemPath, structuredClone(item));
      return;
    }
  }

  for (const path of relatedDiscrepancyPaths(fieldPath)) {
    if (path === fieldPath) continue;
    let v = getCategoricalRaw(incoming, path);
    if (v == null || v === "") {
      v = getFormPathRaw(incoming, path);
    }
    if (v != null && v !== "") {
      setCategoricalRaw(merged, path, v);
    }
  }
}

/**
 * Submit this grader's answers for ALL open discrepancy fields on the same video.
 * Resolves each field independently when all 3 graders submit the same value.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const expertId = String(body?.expertId ?? "").trim();
  const gradingData = body?.gradingData;
  /** Optional map fieldPath → value */
  const fieldValues: Record<string, unknown> =
    body?.fieldValues && typeof body.fieldValues === "object"
      ? body.fieldValues
      : {};

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

  const seed = await prisma.discrepancyItem.findUnique({
    where: { id },
    select: { id: true, aiOutputId: true, status: true },
  });
  if (!seed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const assignment = await prisma.taskAssignment.findFirst({
    where: { aiOutputId: seed.aiOutputId, expertId: expert.id },
    include: { gradingResult: true },
  });
  if (!assignment) {
    return NextResponse.json(
      { error: "you are not a grader on this video" },
      { status: 403 },
    );
  }

  const openItems = await prisma.discrepancyItem.findMany({
    where: { aiOutputId: seed.aiOutputId, status: "OPEN" },
    include: { votes: true },
    orderBy: { createdAt: "asc" },
  });

  if (openItems.length === 0) {
    return NextResponse.json(
      { error: "no open discrepancies on this video" },
      { status: 409 },
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
  const merged =
    existing && typeof existing === "object"
      ? structuredClone(existing)
      : structuredClone(incoming);

  // Validate all open fields first (no partial vote writes on failure)
  const resolvedByPath = new Map<
    string,
    { value: unknown; token: string; discId: string; fieldLabel: string }
  >();
  const missing: string[] = [];

  for (const disc of openItems) {
    const resolved = resolveFieldValue(
      incoming,
      existing,
      disc.fieldPath,
      fieldValues[disc.fieldPath],
    );
    if (!resolved) {
      missing.push(disc.fieldLabel || disc.fieldPath);
      continue;
    }
    resolvedByPath.set(disc.fieldPath, {
      ...resolved,
      discId: disc.id,
      fieldLabel: disc.fieldLabel,
    });
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `please answer all pink discrepancy fields before submitting: ${missing.join(", ")}`,
        missing,
      },
      { status: 400 },
    );
  }

  const resolvedFields: Array<{ fieldPath: string; resolvedValue: string }> =
    [];
  const submittedFields: Array<{ fieldPath: string; choice: string }> = [];
  /** Everyone has answered these and they still do not line up. */
  const contestedFields: Array<{ fieldPath: string; fieldLabel: string }> = [];

  for (const path of DERIVED_METRIC_PATHS) {
    const v = getCategoricalRaw(incoming, path);
    if (v !== undefined && v !== null) {
      setCategoricalRaw(merged, path, v);
    }
  }

  for (const disc of openItems) {
    const resolved = resolvedByPath.get(disc.fieldPath)!;
    syncDiscrepancyGroup(merged, incoming, disc.fieldPath);
    setCategoricalRaw(merged, disc.fieldPath, resolved.value);

    await prisma.discrepancyVote.upsert({
      where: {
        discrepancyItemId_expertId: {
          discrepancyItemId: disc.id,
          expertId: expert.expertId,
        },
      },
      update: { choice: resolved.token },
      create: {
        discrepancyItemId: disc.id,
        expertId: expert.expertId,
        choice: resolved.token,
      },
    });

    submittedFields.push({
      fieldPath: disc.fieldPath,
      choice: resolved.token,
    });
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
        aiOutputId: seed.aiOutputId,
        gradingData: gradingDataStr,
      },
    });
  }

  // Resolve as soon as the three graders' saved answers already agree —
  // do not wait for every expert to submit the discrepancy form.
  const allGradings = await loadAllGradings(seed.aiOutputId);

  for (const disc of openItems) {
    const resolved = resolvedByPath.get(disc.fieldPath)!;
    const votes = await prisma.discrepancyVote.findMany({
      where: { discrepancyItemId: disc.id },
    });
    const timing = isTimingPath(disc.fieldPath);
    const consensus = gradersAgreeOnPath(allGradings, disc.fieldPath);

    if (!consensus.agreed) {
      // Only "contested" once everyone has voted and still disagree —
      // early submitters who have not yet lined up stay open quietly.
      if (votes.length >= GRADERS_PER_VIDEO) {
        contestedFields.push({
          fieldPath: disc.fieldPath,
          fieldLabel: disc.fieldLabel,
        });
      }
      continue;
    }

    const resolvedToken = consensus.token ?? resolved.token;
    const resolvedValue = consensus.value ?? resolved.value;

    // Times inside the tolerance stay as each grader recorded them; a single
    // categorical answer is copied to every grader so the video reads the same.
    if (!timing) {
      const assignments = await prisma.taskAssignment.findMany({
        where: { aiOutputId: seed.aiOutputId },
        include: { gradingResult: true },
      });
      for (const a of assignments) {
        if (!a.gradingResult) continue;
        const gd = parseJsonSafe(a.gradingResult.gradingData, {});
        const next = structuredClone(gd ?? {});
        setCategoricalRaw(next, disc.fieldPath, resolvedValue);
        await prisma.gradingResult.update({
          where: { id: a.gradingResult.id },
          data: { gradingData: stringifyJson(next) },
        });
      }
    }

    await prisma.discrepancyItem.update({
      where: { id: disc.id },
      data: { status: "RESOLVED", resolvedValue: resolvedToken },
    });
    resolvedFields.push({
      fieldPath: disc.fieldPath,
      resolvedValue: resolvedToken ?? resolved.token,
    });
  }

  // A revised time can push another phase past the tolerance.
  await syncTimingDiscrepancies(seed.aiOutputId, expert.expertId);

  return NextResponse.json({
    ok: true,
    submissionSuccessful: true,
    submittedFieldCount: submittedFields.length,
    resolvedFieldCount: resolvedFields.length,
    resolvedFields,
    submittedFields,
    contestedFields,
  });
}
