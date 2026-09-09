/**
 * app/api/commissions/route.ts
 * ============================
 * Téléchargement du fichier de commissions mensuel (xlsx) d'une enseigne —
 * mêmes données et mêmes taux que le rapport PDF (base "facturé uniquement" +
 * référentiel rfa_rates). Protégé par le mot de passe admin : le fichier
 * expose les taux RFA par référence.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildCommissionsXlsx } from "@/lib/commissionsXlsx";
import { checkAdminAuth } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (auth) return auth;
  const client = req.nextUrl.searchParams.get("client") ?? "";
  const monthLabel = req.nextUrl.searchParams.get("month_label") ?? "";
  if (!client || !monthLabel) {
    return NextResponse.json({ error: "client et month_label sont requis." }, { status: 400 });
  }
  try {
    const { buffer, filename, warnings } = await buildCommissionsXlsx(client, monthLabel);
    // Alertes multi-client (Price Levels) transmises au navigateur via un
    // en-tête dédié — évite un second aller-retour pour un simple encart
    // dans l'outil (décision Nicolas, 09/09/2026 : jamais dans le PDF client).
    const warningsHeader = Buffer.from(JSON.stringify(warnings), "utf-8").toString("base64");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "X-Commission-Warnings": warningsHeader,
        "Access-Control-Expose-Headers": "X-Commission-Warnings",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
