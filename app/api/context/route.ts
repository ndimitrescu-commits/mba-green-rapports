import { NextResponse } from "next/server";
import { buildReportContextWithLogistics, loadClientConfig, parseMonthLabel } from "@/lib/compute";
import { fetchGeodisFromSupabase, fetchGlsFromSupabase } from "@/lib/supabaseLogistics";
import { contextToJson } from "@/lib/contextJson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/context
 * FormData: { client, month_label }
 * Exécute la même collecte de données que /api/generate (NetSuite, Google
 * Sheets, Supabase) mais renvoie le ReportContext en JSON au lieu du PDF —
 * c'est la matière première de l'interface d'aperçu/édition (/preview).
 */
export async function POST(req: Request) {
  let clientKey = "";
  let monthLabel = "";
  try {
    const form = await req.formData();
    clientKey = String(form.get("client") ?? "");
    monthLabel = String(form.get("month_label") ?? "");
  } catch {
    return NextResponse.json({ error: "Requête invalide (FormData attendu)." }, { status: 400 });
  }

  if (!clientKey || !monthLabel) {
    return NextResponse.json({ error: "Client et mois requis." }, { status: 400 });
  }

  try {
    const cfg = loadClientConfig(clientKey);
    const month = parseMonthLabel(monthLabel);
    const from = `${month.dateFrom}T00:00:00Z`;
    const toExclusive = new Date(new Date(`${month.dateTo}T00:00:00Z`).getTime() + 86400000)
      .toISOString()
      .slice(0, 10);

    const [geodis, gls] = await Promise.all([
      fetchGeodisFromSupabase(cfg, from, `${toExclusive}T00:00:00Z`),
      fetchGlsFromSupabase(cfg, from, `${toExclusive}T00:00:00Z`),
    ]);

    const context = await buildReportContextWithLogistics(clientKey, monthLabel, geodis, gls);

    return new NextResponse(contextToJson(context), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    console.error("Erreur collecte contexte:", e);
    return NextResponse.json(
      { error: e?.message || "Erreur pendant la collecte des données." },
      { status: 500 }
    );
  }
}
