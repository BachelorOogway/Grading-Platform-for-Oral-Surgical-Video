import { NextResponse } from "next/server";
import {
  getAssignmentConfig,
  saveAssignmentConfig,
  type NumericRange,
} from "@/lib/assignmentConfig";
import { requireAdmin } from "@/lib/adminAuth";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const config = await getAssignmentConfig();
  return NextResponse.json(config);
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const exclusiveRanges = (body?.exclusiveRanges ?? []) as NumericRange[];

  await saveAssignmentConfig({ exclusiveRanges, sharedRanges: [] });
  const config = await getAssignmentConfig();
  return NextResponse.json({ ok: true, ...config });
}
