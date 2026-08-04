import { NextResponse } from "next/server";
import {
  getAssignmentConfig,
  saveAssignmentConfig,
  type NumericRange,
} from "@/lib/assignmentConfig";

export async function GET() {
  const config = await getAssignmentConfig();
  return NextResponse.json(config);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const exclusiveRanges = (body?.exclusiveRanges ?? []) as NumericRange[];
  const sharedRanges = (body?.sharedRanges ?? []) as NumericRange[];

  await saveAssignmentConfig({ exclusiveRanges, sharedRanges });
  const config = await getAssignmentConfig();
  return NextResponse.json({ ok: true, ...config });
}
