import { NextRequest, NextResponse } from "next/server";
import { buildReportContextWithLogistics, getClientsConfig } from "@/lib/compute";
import { buildReportData } from "@/lib/reportData";
import { renderDesignReportPdf } from "@/lib/renderDesignPdf";
import { fetchGeodisFromSupabase, fetchGlsFromSupabase } from "@/lib/supabaseLogistics";
import type { GeodisResult, GlsResult } from "@/lib/types";

export const runtime = "nodejs";
// Generous serverless timeout for Puppeteer + Chromium cold start + PDF
// rendering. Hobby plans on Vercel cap at 60s; Pro/Enterprise can go higher --
// adjust maxDuration (and vercel.json) to match the deployed plan.
export const maxDuration = 60;

// "data_feb" (Prévisions/Consommation), "breakdown" (stock/transit) and
// "financials" (Rapports Clients Mensuel) were all removed from here.
// consumption + forecast come from NetSuite and the Prévisionnel Google
// Sheet (lib/compute.ts's buildArticles()), stock/transit are a computed
// weekly projection (buildStockStatus()), and CA H.T. / règlements /
// nombre de commande now come live from NetSuite invoices and sales orders
// (fetchFinancials() in lib/netsuiteFinancials.ts).
//
// GEODIS and GLS: now fetched from Supabase (where workers ingest them).
// Files can still be uploaded as override/fallback (e.g., for testing,
// backfill, or when Supabase is unavailable).

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const clientKey = String(formData.get("client") ?? "");
    const monthLabel = String(formData.get("month_label") ?? "").trim();

    const clients = getClientsConfig();
    const clientCfg = clients[clientKey];
    if (!clientKey || !clientCfg) {
      return NextResponse.json({ error: "Client inconnu." }, { status: 400 });
    }
    if (!monthLabel) {
      return NextResponse.json(
        { error: "Merci de renseigner le mois." },
        { status: 400 }
      );
    }

    // Parse month label to get date range
    const [monthName, yearStr] = monthLabel.trim().split(/\s+/);
    const year = parseInt(yearStr, 10);
    const monthNum = getMonthNumber(monthName);
    if (isNaN(year) || monthNum === -1) {
      return NextResponse.json(
        { error: "Format de mois invalide." },
        { status: 400 }
      );
    }
    const startDate = new Date(year, monthNum, 1);
    const endDate = new Date(year, monthNum + 1, 0);

    // Read files (optional) or fetch from Supabase
    let geodisResult: GeodisResult;
    let glsResult: GlsResult;

    const geodisFile = formData.get("geodis");
    if (geodisFile instanceof File && geodisFile.size > 0) {
      // File uploaded: use it
      const buffer = await geodisFile.arrayBuffer();
      const { parseGeodis } = await import("@/lib/parsers");
      geodisResult = parseGeodis(buffer, clientCfg);
    } else {
      // No file: fetch from Supabase
      geodisResult = await fetchGeodisFromSupabase(clientCfg, startDate, endDate);
    }

    const glsFile = formData.get("gls");
    if (glsFile instanceof File && glsFile.size > 0) {
      // File uploaded: use it
      const buffer = await glsFile.arrayBuffer();
      const { parseGls } = await import("@/lib/parsers");
      glsResult = parseGls(buffer, clientCfg);
    } else {
      // No file: fetch from Supabase
      glsResult = await fetchGlsFromSupabase(clientCfg, startDate, endDate);
    }

    try {
      // Build context using parsed GEODIS/GLS data (from Supabase or files)
      const context = await buildReportContextWithLogistics(
        clientKey,
        monthLabel,
        geodisResult,
        glsResult
      );

      const reportData = buildReportData(context);
      const pdf = await renderDesignReportPdf(reportData);

      const outName = `${clientKey}_${monthLabel.replace(/\s+/g, "_")}.pdf`;

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${outName}"`,
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Erreur pendant la génération : ${message}` },
        { status: 500 }
      );
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Erreur pendant la génération : ${message}` },
      { status: 500 }
    );
  }
}

// Helper: convert French month name to number (0-11)
function getMonthNumber(monthName: string): number {
  const months: Record<string, number> = {
    janvier: 0, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
    juillet: 6, août: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11,
  };
  return months[monthName.toLowerCase()] ?? -1;
}
