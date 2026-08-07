import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSafe, stringifyJson } from "@/lib/json";
import {
  findCategoricalDisagreements,
  getCategoricalRaw,
  majorityOfThree,
  setCategoricalRaw,
} from "@/lib/categoricalFields";
import { isTiebreakerSlot } from "@/lib/graders";

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
    if (isTiebreakerSlot(assignment.graderSlot)) {
      const priors = await prisma.taskAssignment.findMany({
        where: {
          aiOutputId: assignment.aiOutputId,
          graderSlot: { in: [1, 2] },
          status: "COMPLETED",
        },
        include: { gradingResult: true },
        orderBy: { graderSlot: "asc" },
      });
      const g1 = priors.find((p) => p.graderSlot === 1)?.gradingResult
        ? parseJsonSafe(
            priors.find((p) => p.graderSlot === 1)!.gradingResult!.gradingData,
            null,
          )
        : null;
      const g2 = priors.find((p) => p.graderSlot === 2)?.gradingResult
        ? parseJsonSafe(
            priors.find((p) => p.graderSlot === 2)!.gradingResult!.gradingData,
            null,
          )
        : null;

      // Paths already marked (or being marked now) as discrepancy solve — skip majority
      const existingOpen = await prisma.discrepancyItem.findMany({
        where: { aiOutputId: assignment.aiOutputId, status: "OPEN" },
        select: { fieldPath: true },
      });
      const skipMajority = new Set([
        ...existingOpen.map((d) => d.fieldPath),
        ...discrepancySolvePaths,
      ]);

      if (discrepancySolvePaths.length > 0) {
        const disagreements = g1 && g2 ? findCategoricalDisagreements(g1, g2) : [];
        const labelByPath = new Map(disagreements.map((d) => [d.path, d.label]));
        for (const path of discrepancySolvePaths) {
          await prisma.discrepancyItem.upsert({
            where: {
              aiOutputId_fieldPath: {
                aiOutputId: assignment.aiOutputId,
                fieldPath: path,
              },
            },
            update: {
              status: "OPEN",
              resolvedValue: null,
              fieldLabel: labelByPath.get(path) ?? path,
              createdByExpert: expert.expertId,
            },
            create: {
              aiOutputId: assignment.aiOutputId,
              fieldPath: path,
              fieldLabel: labelByPath.get(path) ?? path,
              status: "OPEN",
              createdByExpert: expert.expertId,
            },
          });
        }
      }

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

    return NextResponse.json({ ok: true, graderSlot: assignment.graderSlot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[grade POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
