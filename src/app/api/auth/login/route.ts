import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type LoginBody = {
  name: string;
  password: string;
};

function formatExpertId(seq: number) {
  return `EXP-${String(seq).padStart(3, "0")}`;
}

async function nextExpertId() {
  const experts = await prisma.expert.findMany({
    select: { expertId: true },
  });
  let max = 0;
  for (const e of experts) {
    const m = /^EXP-(\d+)$/.exec(e.expertId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatExpertId(max + 1);
}

function allowSelfRegister() {
  const v = process.env.ALLOW_EXPERT_SELF_REGISTER?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  if (v === "true" || v === "1" || v === "yes") return true;
  // Default: allow locally, deny on Vercel/production unless explicitly enabled
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  const body = (await req.json()) as LoginBody;
  const name = body?.name?.trim();
  const password = body?.password ?? "";

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

  const candidates = await prisma.expert.findMany({
    where: { name },
    select: { id: true, expertId: true, passwordHash: true },
  });

  for (const c of candidates) {
    const ok = await bcrypt.compare(password, c.passwordHash);
    if (ok) {
      return NextResponse.json({ expertId: c.expertId });
    }
  }

  if (candidates.length > 0) {
    return NextResponse.json(
      { error: "invalid name or password" },
      { status: 401 },
    );
  }

  if (!allowSelfRegister()) {
    return NextResponse.json(
      {
        error:
          "Self-registration is disabled. Ask an admin to create your expert account.",
      },
      { status: 403 },
    );
  }

  const expertId = await nextExpertId();
  const passwordHash = await bcrypt.hash(password, 10);

  const expert = await prisma.expert.create({
    data: {
      expertId,
      name,
      passwordHash,
    },
    select: { expertId: true },
  });

  return NextResponse.json({ expertId: expert.expertId, created: true });
}
