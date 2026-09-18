import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe, stringifyJson } from "@/lib/json";
import {
  describeCategoricalPath,
  findCategoricalDisagreements,
  getCategoricalRaw,
  majorityOfThree,
  mergeMissedInstrumentNames,
  missedInstrumentCountOf,
  setCategoricalRaw,
} from "@/lib/categoricalFields";
import {
  completedInSubmitOrder,
  GRADERS_PER_VIDEO,
  isSubmissionOrderTiebreaker,
  type GradingOrderPeer,
} from "@/lib/graders";
import {
  autoOpenDisagreements,
  openDiscrepancyItems,
  syncTimingDiscrepancies,
} from "@/lib/discrepancyOpen";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const taskAssignmentId = taskId?.trim() ?? "";
    if (!taskAssignmentId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 });
    }

    const body = await req.json();
    const expertId = (body?.expertId as string | undefined)?.trim();
    const gradingData = body?.gradingData;
    const discrepancySolvePaths: string[] = Array.isArray(
      body?.discrepancySolvePaths,
    )
      ? body.discrepancySolvePaths.map((p: unknown) => String(p).trim()).filter(Boolean)
      : [];

    if (!expertId) {
      return NextResponse.json({ error: "expertId required" }, { status: 400 });
    }
    if (!gradingData) {
      return NextResponse.json({ error: "gradingData required" }, { status: 400 });
    }

    const assignment = await prisma.taskAssignment.findUnique({
      where: { id: taskAssignmentId },
      select: {
        id: true,
        expertId: true,
        aiOutputId: true,
        graderSlot: true,
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }

    const expert = await prisma.expert.findUnique({
      where: { expertId },
      select: { id: true, expertId: true },
    });
    if (!expert || assignment.expertId !== expert.id) {
      return NextResponse.json(
        { error: "forbidden: expertId does not match this task" },
        { status: 403 },
      );
    }

    let payload: any = gradingData;

    const siblings = await prisma.taskAssignment.findMany({
      where: { aiOutputId: assignment.aiOutputId },
      include: { gradingResult: true },
    });
    const peers: GradingOrderPeer[] = siblings.map((a) => ({
      id: a.id,
      status: a.status,
      completedAt:
        a.status === "COMPLETED" && a.gradingResult
          ? a.gradingResult.submittedAt ?? a.gradingResult.updatedAt
          : null,
    }));
    const me: GradingOrderPeer = {
      id: assignment.id,
      // Treat this submit as not-yet-completed for the role check: we become
      // the third grader only when two others are already COMPLETED.
      status: "PENDING",
      completedAt: null,
    };
    const isTiebreaker = isSubmissionOrderTiebreaker(me, peers);

    // Non-tiebreakers cannot open discrepancy items via grade submit.
    const allowedDiscPaths = isTiebreaker ? discrepancySolvePaths : [];

    if (isTiebreaker) {
      const priorPeers = completedInSubmitOrder(
        peers.filter((p) => p.id !== assignment.id),
      ).slice(0, 2);
      const g1Row = siblings.find((s) => s.id === priorPeers[0]?.id);
      const g2Row = siblings.find((s) => s.id === priorPeers[1]?.id);
      const g1 = g1Row?.gradingResult
        ? parseJsonSafe(g1Row.gradingResult.gradingData, null)
        : null;
      const g2 = g2Row?.gradingResult
        ? parseJsonSafe(g2Row.gradingResult.gradingData, null)
        : null;

      // Hallucination + missed-instrument count: any pairwise disagreement opens.
      const autoOpen = autoOpenDisagreements(g1, g2, gradingData);

      // Paths already marked (or being marked now) as discrepancy solve — skip majority
      const existingOpen = await prisma.discrepancyItem.findMany({
        where: { aiOutputId: assignment.aiOutputId, status: "OPEN" },
        select: { fieldPath: true },
      });
      const skipMajority = new Set([
        ...existingOpen.map((d) => d.fieldPath),
        ...allowedDiscPaths,
        ...autoOpen.map((d) => d.path),
      ]);

      if (allowedDiscPaths.length > 0) {
        const disagreements = g1 && g2 ? findCategoricalDisagreements(g1, g2) : [];
        const labelByPath = new Map(disagreements.map((d) => [d.path, d.label]));
        await openDiscrepancyItems(
          assignment.aiOutputId,
          allowedDiscPaths.map((path) => ({
            path,
            label:
              labelByPath.get(path) ?? describeCategoricalPath(path),
          })),
          expert.expertId,
          { resetVotes: true },
        );
      }

      await openDiscrepancyItems(
        assignment.aiOutputId,
        autoOpen,
        expert.expertId,
      );

      if (g1 && g2) {
        const disagreements = findCategoricalDisagreements(g1, g2);
        const majority: Record<string, unknown> = {};
        const skippedForSolve: string[] = [];
        payload = structuredClone(gradingData);
        for (const d of disagreements) {
          if (skipMajority.has(d.path)) {
            skippedForSolve.push(d.path);
            continue;
          }
          // Not flagged → final answer is majority of 3 (2:1)
          const c = getCategoricalRaw(payload, d.path);
          const maj = majorityOfThree(d.grader1Raw, d.grader2Raw, c);
          majority[d.path] = maj;
          if (maj != null) setCategoricalRaw(payload, d.path, maj);
        }
        payload.consensusMeta = {
          role: "tiebreaker",
          graderSlot: assignment.graderSlot,
          disagreementCount: disagreements.length,
          majorityCategorical: majority,
          discrepancySolvePaths: skippedForSolve,
        };
      }
    } else {
      payload = {
        ...gradingData,
        consensusMeta: {
          role: "primary",
          graderSlot: assignment.graderSlot,
        },
      };
    }

    const gradingDataStr = stringifyJson(payload);

    await prisma.gradingResult.upsert({
      where: { taskAssignmentId },
      update: { gradingData: gradingDataStr },
      create: {
        taskAssignmentId,
        expertId: assignment.expertId,
        aiOutputId: assignment.aiOutputId,
        gradingData: gradingDataStr,
      },
    });

    await prisma.taskAssignment.update({
      where: { id: taskAssignmentId },
      data: {
        status: "COMPLETED",
        regradeNote: null,
        regradeRequestedAt: null,
      },
    });

    // When every grader reports the same missed-instrument count, union their
    // free-text names into every saved grading (GT / metrics read this list).
    const after = await prisma.taskAssignment.findMany({
      where: { aiOutputId: assignment.aiOutputId, status: "COMPLETED" },
      include: { gradingResult: true },
    });
    if (after.length >= GRADERS_PER_VIDEO) {
      const gs = after.flatMap((a) => {
        if (!a.gradingResult) return [];
        const g = parseJsonSafe(a.gradingResult.gradingData, null);
        return g && typeof g === "object" ? [g] : [];
      });
      if (gs.length >= GRADERS_PER_VIDEO) {
        const counts = gs.map((g) => missedInstrumentCountOf(g));
        const sameCount = counts.every((c) => c === counts[0]);
        const countOpen = await prisma.discrepancyItem.findFirst({
          where: {
            aiOutputId: assignment.aiOutputId,
            fieldPath: "level1.missedInstrumentsCount",
            status: "OPEN",
          },
        });
        if (sameCount && !countOpen) {
          const merged = mergeMissedInstrumentNames(gs);
          for (const a of after) {
            if (!a.gradingResult) continue;
            const gd = parseJsonSafe(a.gradingResult.gradingData, {});
            const next = structuredClone(gd ?? {});
            setCategoricalRaw(next, "level1.missedInstruments", merged);
            setCategoricalRaw(next, "level1.missedInstrumentsCount", merged.length);
            await prisma.gradingResult.update({
              where: { id: a.gradingResult.id },
              data: { gradingData: stringifyJson(next) },
            });
          }
        }
      }
    }

    // Open hallucination / missed-count discrepancies as soon as any pair of
    // completed graders disagrees (not only when the tiebreaker submits).
    if (after.length >= 2) {
      const completedGs = after.flatMap((a) => {
        if (!a.gradingResult) return [];
        const g = parseJsonSafe(a.gradingResult.gradingData, null);
        return g && typeof g === "object" ? [g] : [];
      });
      await openDiscrepancyItems(
        assignment.aiOutputId,
        autoOpenDisagreements(...completedGs),
        expert.expertId,
      );
    }

    // Level 2 timing: >3s apart on a bound or on the window length
    const timingPaths = await syncTimingDiscrepancies(
      assignment.aiOutputId,
      expert.expertId,
    );

    return NextResponse.json({
      ok: true,
      graderSlot: assignment.graderSlot,
      timingDiscrepancies: timingPaths,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[grade POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
