/**
 * app/api/rfa/route.ts
 * ====================
 * Aperçu lecture-seule des taux de commission réellement appliqués à un
 * client — décision Nicolas (09/09/2026). Ancien CRUD retiré : la table
 * Supabase `rfa_rates` qu'il éditait n'est plus lue par aucun calcul depuis
 * le passage sur NetSuite (champ général custitem + table d'exceptions
 * "Commission par client (MBA)"). Mot de passe admin conservé : les taux
 * révèlent les marges.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchClientRatesOverview } from "@/lib/netsuiteFinancials";
import clientsConfig from "@/lib/clients.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientsConfig = Record<string, { netsuite_parent_id: number }>;
const CLIENTS = clientsConfig as ClientsConfig;

export async function GET(req: NextRequest) {
  const expected = process.env.RFA_ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "RFA_ADMIN_PASSWORD n'est pas configuré sur le serveur (variable d'environnement Vercel)." },
      { status: 500 }
    );
  }
  if (req.headers.get("x-rfa-password") !== expected) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  const clientKey = req.nextUrl.searchParams.get("client") ?? "";
  const cfg = CLIENTS[clientKey];
  if (!cfg) {
    return NextResponse.json({ error: "Client inconnu." }, { status: 400 });
  }

  try {
    const rates = await fetchClientRatesOverview(
      cfg.netsuite_parent_id,
      process.env.NETSUITE_COMMISSION_FIELD_ID
    );
    return NextResponse.json({ rates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
