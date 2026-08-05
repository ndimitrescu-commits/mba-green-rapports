/**
 * app/api/prevision/import/route.ts
 * =================================
 * Import UNIQUE (ou de rattrapage) du Prévisionnel Google Sheets vers la
 * table Supabase `forecasts` — à lancer depuis le bouton "Importer depuis
 * Google Sheets" de l'onglet /prevision. Récupère pour chaque enseigne :
 *  - l'onglet client du classeur Prévisionnel (mensuel) ;
 *  - complété par le repli hebdomadaire Demand Planning (Forecast_Client)
 *    pour les mois non couverts — y compris Black & White (périmètre
 *    restreint à son catalogue NetSuite).
 * Upsert sur (client, référence, mois) : relançable sans doublon, les
 * saisies manuelles plus récentes sont écrasées par le Sheet — d'où le
 * bouton avec confirmation plutôt qu'un import automatique.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasForecastTab, readForecast } from "@/lib/googleSheets";
import { fetchCatalogPriceByCarton } from "@/lib/netsuiteData";
import { bulkUpsertForecasts } from "@/lib/forecastsDb";
import { getClientsConfig } from "@/lib/compute";
import { checkAdminAuth } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (auth) return auth;
  try {
    const only = req.nextUrl.searchParams.get("client");
    const clients = getClientsConfig();
    const keys = only ? [only] : Object.keys(clients);
    const results: Record<string, number | string> = {};
    for (const key of keys) {
      const cfg = clients[key];
      if (!cfg) {
        results[key] = "client inconnu";
        continue;
      }
      try {
        let rows;
        if (hasForecastTab(key)) {
          rows = await readForecast(key);
        } else {
          const catalog = await fetchCatalogPriceByCarton(cfg.netsuite_parent_id);
          rows = await readForecast(key, new Set(catalog.keys()));
        }
        results[key] = await bulkUpsertForecasts(key, rows);
      } catch (e) {
        results[key] = `erreur : ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
