import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";

function formatExpertId(seq: number) {
  return `EXP-${String(seq).padStart(3, "0")}`;
}

async function nextExpertId() {
  const experts = await prisma.expert.findMany({ select: { expertId: true } });
  let max = 0;
  for (const e of experts) {
    const m = /^EXP-(\d+)$/.exec(e.expertId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatExpertId(max + 1);
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const experts = await prisma.expert.findMany({
    select: { expertId: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ items: experts });
}

/** Admin creates an expert account (required when self-register is disabled). */
export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const password = String(body?.password ?? "");

  if (!name || !password) {
    return NextResponse.json({ error: "name/password required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const bcrypt = await import("bcryptjs");
  const expertId = await nextExpertId();
  const passwordHash = await bcrypt.hash(password, 10);

  const expert = await prisma.expert.create({
    data: { expertId, name, passwordHash },
    select: { expertId: true, name: true },
  });

  return NextResponse.json({ ok: true, ...expert });
}
