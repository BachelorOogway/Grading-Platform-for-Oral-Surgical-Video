import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const ADMIN_COOKIE = "admin_auth";

function expectedToken(secret: string) {
  return createHmac("sha256", secret).update("grading-admin-v1").digest("hex");
}

export function getAdminSecret(): string | null {
  const s = process.env.ADMIN_SECRET?.trim();
  return s ? s : null;
}

/** Production / Vercel must configure ADMIN_SECRET. */
export function adminSecretRequired(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    Boolean(process.env.ADMIN_SECRET?.trim())
  );
}

export function adminCookieValue(secret: string) {
  return expectedToken(secret);
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Returns an error NextResponse if unauthorized; otherwise null.
 * Accepts `x-admin-secret` header or signed `admin_auth` cookie.
 */
export async function requireAdmin(req: Request): Promise<NextResponse | null> {
  const secret = getAdminSecret();

  if (!secret) {
    if (adminSecretRequired()) {
      return NextResponse.json(
        { error: "ADMIN_SECRET is not configured on the server" },
        { status: 503 },
      );
    }
    // Local dev without secret: allow
    return null;
  }

  const header = req.headers.get("x-admin-secret")?.trim() ?? "";
  if (header && safeEqual(header, secret)) return null;

  const jar = await cookies();
  const cookie = jar.get(ADMIN_COOKIE)?.value ?? "";
  const expected = expectedToken(secret);
  if (cookie && safeEqual(cookie, expected)) return null;

  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function setAdminCookie(res: NextResponse, secret: string) {
  res.cookies.set(ADMIN_COOKIE, expectedToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
}

export function clearAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
