/**
 * lib/adminAuth.ts — contrôle du mot de passe admin des onglets RFAs et
 * Prévisionnel (env RFA_ADMIN_PASSWORD, en-tête x-admin-password ou
 * x-rfa-password). Renvoie une réponse d'erreur à retourner telle quelle,
 * ou null si l'accès est autorisé.
 */
import { NextRequest, NextResponse } from "next/server";

export function checkAdminAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.RFA_ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "RFA_ADMIN_PASSWORD n'est pas configuré sur le serveur (variable d'environnement Vercel)." },
      { status: 500 }
    );
  }
  const given = req.headers.get("x-admin-password") ?? req.headers.get("x-rfa-password");
  if (given !== expected) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }
  return null;
}
