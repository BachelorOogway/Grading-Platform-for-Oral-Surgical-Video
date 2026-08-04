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
  // 简化处理：读取所有 expertId 并取最大后递增（你专家数量不大时足够用）
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

export async function POST(req: Request) {
  const body = (await req.json()) as LoginBody;
  const name = body?.name?.trim();
  const password = body?.password ?? "";

  if (!name || !password) {
    return NextResponse.json({ error: "name/password required" }, { status: 400 });
  }

  // 需要你后续安装 bcryptjs（或 bcrypt），这里先给出接口逻辑骨架
  const bcrypt = await import("bcryptjs");

  // 找同名候选，再逐个比对密码
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

  // 第一次/密码不匹配：创建新的 Expert
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

  return NextResponse.json({ expertId: expert.expertId });
}

