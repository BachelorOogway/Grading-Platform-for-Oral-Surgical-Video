import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parseAiOutputToParsedData,
  validateAiParsedData,
} from "@/lib/aiOutputParser";
import { stringifyJson } from "@/lib/json";
import { normalizeVideoOutputId, parseVideoNumber } from "@/lib/videoId";
import { requireAdmin } from "@/lib/adminAuth";

const OVERRIDE_REGRADE_NOTE =
  "The AI output for this video was re-uploaded, so the previous grading was voided. Please grade the new output from scratch.";

/**
 * Replacing an AI output invalidates every answer written against the old
 * text: grading results, discrepancy items and their votes are removed and the
 * assignments go back to PENDING for the same graders.
 */
async function voidGradingsFor(tx: Prisma.TransactionClient, aiOutputId: string) {
  const items = await tx.discrepancyItem.findMany({
    where: { aiOutputId },
    select: { id: true },
  });
  if (items.length > 0) {
    await tx.discrepancyVote.deleteMany({
      where: { discrepancyItemId: { in: items.map((i) => i.id) } },
    });
    await tx.discrepancyItem.deleteMany({ where: { aiOutputId } });
  }

  const gradings = await tx.gradingResult.deleteMany({
    where: { aiOutputId },
  });
  const assignments = await tx.taskAssignment.updateMany({
    where: { aiOutputId },
    data: {
      status: "PENDING",
      regradeNote: OVERRIDE_REGRADE_NOTE,
      regradeRequestedAt: new Date(),
    },
  });

  return {
    voidedGradings: gradings.count,
    reopenedAssignments: assignments.count,
    clearedDiscrepancies: items.length,
  };
}

async function findExistingByVideoId(normalizedId: string) {
  const targetNum = parseVideoNumber(normalizedId);
  if (targetNum == null) return null;

  const rows = await prisma.aiOutput.findMany({
    select: {
      id: true,
      videoOutputId: true,
      updatedAt: true,
      createdAt: true,
      rawText: true,
    },
  });

  return (
    rows.find((r) => parseVideoNumber(r.videoOutputId) === targetNum) ?? null
  );
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const rawId = (body?.videoOutputId as string | undefined)?.trim() ?? "";
    const aiOutputText = (body?.aiOutputText as string | undefined) ?? "";
    const override = body?.override === true;

    const videoOutputId = normalizeVideoOutputId(rawId);
    if (!videoOutputId) {
      return NextResponse.json(
        {
          error:
            "Invalid Video ID. Use exclusive format V01, V02, … (digits only after V).",
        },
        { status: 400 },
      );
    }
    if (!aiOutputText.trim()) {
      return NextResponse.json({ error: "aiOutputText required" }, { status: 400 });
    }

    const existing = await findExistingByVideoId(videoOutputId);
    if (existing && !override) {
      const existingGradingCount = await prisma.gradingResult.count({
        where: { aiOutputId: existing.id },
      });
      return NextResponse.json(
        {
          conflict: true,
          error: `Video ID ${videoOutputId} already exists`,
          videoOutputId,
          existingVideoOutputId: existing.videoOutputId,
          existingUpdatedAt: existing.updatedAt,
          existingPreview: existing.rawText.slice(0, 200),
          existingGradingCount,
        },
        { status: 409 },
      );
    }

    const parsedData = parseAiOutputToParsedData(aiOutputText);
    const validation = validateAiParsedData(parsedData);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.message,
          missingFields: validation.missing,
          incomplete: true,
        },
        { status: 400 },
      );
    }
    const parsedDataStr = stringifyJson(parsedData);

    let aiOutput;
    let voided = {
      voidedGradings: 0,
      reopenedAssignments: 0,
      clearedDiscrepancies: 0,
    };
    if (existing) {
      // One transaction: the new text must never coexist with the old answers.
      [aiOutput, voided] = await prisma.$transaction(async (tx) => {
        const updated = await tx.aiOutput.update({
          where: { id: existing.id },
          data: {
            videoOutputId,
            rawText: aiOutputText,
            parsedData: parsedDataStr,
          },
          select: { videoOutputId: true },
        });
        return [updated, await voidGradingsFor(tx, existing.id)] as const;
      });
    } else {
      aiOutput = await prisma.aiOutput.create({
        data: {
          videoOutputId,
          rawText: aiOutputText,
          parsedData: parsedDataStr,
        },
        select: { videoOutputId: true },
      });
    }

    return NextResponse.json({
      ok: true,
      overridden: Boolean(existing && override),
      videoOutputId: aiOutput.videoOutputId,
      phasesCount: parsedData.level2.phases.length,
      ...voided,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[aioutput/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
