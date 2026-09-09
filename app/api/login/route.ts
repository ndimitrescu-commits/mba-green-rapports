/**
 * app/api/login/route.ts
 * =======================
 * Porte d'entrée unique de l'outil (voir middleware.ts) — un seul mot de
 * passe (env RFA_ADMIN_PASSWORD), posé une fois via un cookie HttpOnly,
 * plutôt que redemandé à chaque onglet sensible.
 */
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.RFA_ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "RFA_ADMIN_PASSWORD n'est pas configuré sur le serveur (variable d'environnement Vercel)." },
      { status: 500 }
    );
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password !== expected) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 jours
  });
  return res;
}
