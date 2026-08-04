import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAiOutputToParsedData } from "@/lib/aiOutputParser";
import { stringifyJson } from "@/lib/json";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const videoOutputId = (body?.videoOutputId as string | undefined)?.trim();
    const aiOutputText = (body?.aiOutputText as string | undefined) ?? "";

    if (!videoOutputId) {
      return NextResponse.json({ error: "videoOutputId required" }, { status: 400 });
    }
    if (!aiOutputText.trim()) {
      return NextResponse.json({ error: "aiOutputText required" }, { status: 400 });
    }

    const parsedData = parseAiOutputToParsedData(aiOutputText);
    const parsedDataStr = stringifyJson(parsedData);

    const aiOutput = await prisma.aiOutput.upsert({
      where: { videoOutputId },
      update: { rawText: aiOutputText, parsedData: parsedDataStr },
      create: {
        videoOutputId,
        rawText: aiOutputText,
        parsedData: parsedDataStr,
      },
      select: { videoOutputId: true },
    });

    return NextResponse.json({
      ok: true,
      videoOutputId: aiOutput.videoOutputId,
      phasesCount: parsedData.level2.phases.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[aioutput/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
