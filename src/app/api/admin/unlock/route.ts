import { NextResponse } from "next/server";
import {
  clearAdminCookie,
  getAdminSecret,
  requireAdmin,
  setAdminCookie,
} from "@/lib/adminAuth";

/** Verify admin secret and set httpOnly session cookie. */
export async function POST(req: Request) {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "ADMIN_SECRET is not set. Configure it in Vercel Environment Variables.",
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const provided = String(body?.secret ?? "").trim();
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  setAdminCookie(res, secret);
  return res;
}

/** Check whether current cookie/header is authorized. */
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true });
}

/** Clear admin session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearAdminCookie(res);
  return res;
}
