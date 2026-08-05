import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAiOutputToParsedData } from "@/lib/aiOutputParser";
import { stringifyJson } from "@/lib/json";
import { normalizeVideoOutputId, parseVideoNumber } from "@/lib/videoId";
import { requireAdmin } from "@/lib/adminAuth";

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
      return NextResponse.json(
        {
          conflict: true,
          error: `Video ID ${videoOutputId} already exists`,
          videoOutputId,
          existingVideoOutputId: existing.videoOutputId,
          existingUpdatedAt: existing.updatedAt,
          existingPreview: existing.rawText.slice(0, 200),
        },
        { status: 409 },
      );
    }

    const parsedData = parseAiOutputToParsedData(aiOutputText);
    const parsedDataStr = stringifyJson(parsedData);

    let aiOutput;
    if (existing) {
      aiOutput = await prisma.aiOutput.update({
        where: { id: existing.id },
        data: {
          videoOutputId,
          rawText: aiOutputText,
          parsedData: parsedDataStr,
        },
        select: { videoOutputId: true },
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[aioutput/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
