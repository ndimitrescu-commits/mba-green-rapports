import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

/**
 * middleware.ts
 * =============
 * Porte d'entrée unique de l'outil — décision Nicolas (09/09/2026) : "le
 * password, il faut le mettre en rentrant dans l'outil, et après, on n'a
 * plus besoin de password pour naviguer". Avant ça, chaque onglet sensible
 * (Prévisionnel, RFAs) redemandait le même mot de passe (RFA_ADMIN_PASSWORD)
 * séparément — redondant.
 *
 * Toute page/API (sauf /login, son API, et les fichiers statiques) exige
 * maintenant un cookie posé par /api/login après saisie du mot de passe.
 * Le cookie contient directement le mot de passe (comparaison simple, pas
 * de hash) : il est HttpOnly + Secure, donc jamais lisible en JS côté
 * client — même niveau d'exposition que l'ancien en-tête x-admin-password
 * envoyé en clair sur chaque requête, juste posé une fois au lieu de
 * ressaisi à chaque onglet.
 *
 * Si RFA_ADMIN_PASSWORD n'est pas configuré côté serveur, on bloque tout
 * (fail-closed) plutôt que de laisser l'outil grand ouvert.
 */
const PUBLIC_PATHS = ["/login", "/api/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const expected = process.env.RFA_ADMIN_PASSWORD;
  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const authed = !!expected && cookie === expected;

  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentification requise — reconnecte-toi à l'outil." }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|svg|jpg|jpeg|gif|ico)$).*)"],
};
