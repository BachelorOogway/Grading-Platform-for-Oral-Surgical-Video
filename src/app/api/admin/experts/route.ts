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
    select: {
      expertId: true,
      name: true,
      createdAt: true,
      _count: { select: { assignments: true, grading: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: experts.map((e) => ({
      expertId: e.expertId,
      name: e.name,
      createdAt: e.createdAt,
      assignmentCount: e._count.assignments,
      gradingCount: e._count.grading,
    })),
  });
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

/**
 * Remove an expert and their task assignments / grading results.
 * AiOutput records are kept.
 */
export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const expertIdHuman = String(body?.expertId ?? "").trim();
  if (!expertIdHuman) {
    return NextResponse.json({ error: "expertId required" }, { status: 400 });
  }

  const expert = await prisma.expert.findUnique({
    where: { expertId: expertIdHuman },
    select: {
      id: true,
      expertId: true,
      name: true,
      _count: { select: { assignments: true, grading: true } },
    },
  });

  if (!expert) {
    return NextResponse.json({ error: "expert not found" }, { status: 404 });
  }

  const assignmentCount = expert._count.assignments;
  const gradingCount = expert._count.grading;

  await prisma.$transaction(async (tx) => {
    // GradingResult / TaskAssignment expert FKs are RESTRICT — delete dependents first.
    await tx.gradingResult.deleteMany({ where: { expertId: expert.id } });
    await tx.taskAssignment.deleteMany({ where: { expertId: expert.id } });
    await tx.expert.delete({ where: { id: expert.id } });
  });

  return NextResponse.json({
    ok: true,
    expertId: expert.expertId,
    name: expert.name,
    deletedAssignments: assignmentCount,
    deletedGradings: gradingCount,
  });
}
