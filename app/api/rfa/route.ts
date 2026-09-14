/**
 * app/api/rfa/route.ts
 * ====================
 * Aperçu lecture-seule des taux de commission réellement appliqués à un
 * client — décision Nicolas (09/09/2026). Ancien CRUD retiré : la table
 * Supabase `rfa_rates` qu'il éditait n'est plus lue par aucun calcul depuis
 * le passage sur NetSuite (champ général custitem + table d'exceptions
 * "Commission par client (MBA)"). Protégé par le mot de passe global de
 * l'outil (middleware.ts) plutôt que par onglet (décision Nicolas,
 * 09/09/2026) : les taux révèlent les marges, mais un seul mot de passe à
 * l'entrée suffit.
 *
 * Références couvertes = celles du Prévisionnel de ce client (remarque
 * Nicolas, 09/09/2026 : "la mercuriale correspond exactement aux références
 * qui sont présentes dans les forecasts") — donc TOUTE la mercuriale, pas
 * seulement ce qui a été facturé récemment. Si le Prévisionnel du client
 * est vide (pas encore importé), pas de références à vérifier : voir
 * app/prevision pour l'importer.
 *
 * Complément (décision Nicolas, 14/09/2026, cas BWBxGMK/MMxBWB) : une
 * référence ponctuelle/limitée (ex. boîte de collab) jamais ajoutée au
 * Prévisionnel restait invisible ici même si son taux NetSuite était
 * erroné ou manquant. On fusionne donc les références du Prévisionnel avec
 * celles facturées au client sur les 12 derniers mois glissants
 * (fetchRecentlyInvoicedItemCodes) — repli silencieux sur le Prévisionnel
 * seul si cette requête échoue.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchRatesForReferences, fetchRecentlyInvoicedItemCodes } from "@/lib/netsuiteFinancials";
import { listForecasts } from "@/lib/forecastsDb";
import clientsConfig from "@/lib/clients.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientsConfig = Record<string, { netsuite_parent_id: number }>;
const CLIENTS = clientsConfig as ClientsConfig;

export async function GET(req: NextRequest) {
  const clientKey = req.nextUrl.searchParams.get("client") ?? "";
  const cfg = CLIENTS[clientKey];
  if (!cfg) {
    return NextResponse.json({ error: "Client inconnu." }, { status: 400 });
  }

  try {
    const [forecastRows, invoicedCodes] = await Promise.all([
      listForecasts(clientKey),
      fetchRecentlyInvoicedItemCodes(cfg.netsuite_parent_id),
    ]);
    const refs = [
      ...new Set([...forecastRows.map((r) => r.reference), ...invoicedCodes]),
    ];
    const rates = await fetchRatesForReferences(
      cfg.netsuite_parent_id,
      refs,
      process.env.NETSUITE_COMMISSION_FIELD_ID
    );
    return NextResponse.json({ rates, refSource: "prevision+facture_recente" as const });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
