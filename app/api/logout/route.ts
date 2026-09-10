/**
 * app/api/logout/route.ts
 * ========================
 * Efface le cookie posé par /api/login (voir middleware.ts) — ajouté pour
 * le bouton "Déconnexion" du nouveau header unifié (demande Nicolas
 * 10/09/2026), qui n'existait pas jusqu'ici sur cet outil.
 */
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
