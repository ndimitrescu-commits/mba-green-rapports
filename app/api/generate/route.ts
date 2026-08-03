import { NextResponse } from "next/server";
import { buildReportContextWithLogistics, loadClientConfig, parseMonthLabel } from "@/lib/compute";
import { fetchGeodisFromSupabase, fetchGlsFromSupabase } from "@/lib/supabaseLogistics";
import { buildReportData } from "@/lib/reportData";
import { renderDesignReportPdf } from "@/lib/renderDesignPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/generate
 * FormData: { client, month_label }
 * Les données logistiques GEODIS/GLS sont récupérées depuis Supabase
 * (tables alimentées par les workers Railway) — plus d'upload de fichiers.
 * Retourne le PDF du rapport mensuel.
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
    // Bornes ISO [from, to) — dateTo est le dernier jour du mois, on prend le jour suivant.
    const from = `${month.dateFrom}T00:00:00Z`;
    const toExclusive = new Date(new Date(`${month.dateTo}T00:00:00Z`).getTime() + 86400000)
      .toISOString()
      .slice(0, 10);

    const [geodis, gls] = await Promise.all([
      fetchGeodisFromSupabase(cfg, from, `${toExclusive}T00:00:00Z`),
      fetchGlsFromSupabase(cfg, from, `${toExclusive}T00:00:00Z`),
    ]);

    const context = await buildReportContextWithLogistics(clientKey, monthLabel, geodis, gls);

    const data = buildReportData(context);
    const pdfBytes = await renderDesignReportPdf(data);

    const safeMonth = monthLabel.replace(/\s+/g, "_");
    const filename = `Rapport_${cfg.display_name}_${safeMonth}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("Erreur génération rapport:", e);
    return NextResponse.json(
      { error: e?.message || "Erreur pendant la génération." },
      { status: 500 }
    );
  }
}
