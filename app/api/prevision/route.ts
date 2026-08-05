/**
 * app/api/prevision/route.ts
 * ==========================
 * CRUD du Prévisionnel client — table Supabase `forecasts`, LA source de
 * référence des rapports (le Google Sheet n'est plus lu à la génération).
 * Protégé par le mot de passe admin (env RFA_ADMIN_PASSWORD, en-tête
 * x-admin-password). Écritures via la clé service, côté serveur uniquement.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  deleteForecast,
  listForecasts,
  upsertForecast,
} from "@/lib/forecastsDb";
import { checkAdminAuth } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (auth) return auth;
  const clientKey = req.nextUrl.searchParams.get("client") ?? "";
  if (!clientKey) return NextResponse.json({ error: "client requis." }, { status: 400 });
  try {
    const rows = await listForecasts(clientKey);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (auth) return auth;
  try {
    const body = (await req.json()) as {
      client: string;
      reference: string;
      month: string;
      quantity_cartons: number | string;
    };
    if (!body.client || !body.reference?.trim()) {
      return NextResponse.json({ error: "client et reference sont requis." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}$/.test(body.month ?? "")) {
      return NextResponse.json(
        { error: `Mois invalide "${body.month}" — format attendu : YYYY-MM (ex. 2026-09).` },
        { status: 400 }
      );
    }
    const qty = Number(String(body.quantity_cartons).replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0) {
      return NextResponse.json({ error: "Quantité (cartons) invalide." }, { status: 400 });
    }
    const saved = await upsertForecast({
      client_key: body.client,
      reference: body.reference,
      month: body.month,
      quantity_cartons: qty,
    });
    return NextResponse.json({ row: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (auth) return auth;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis." }, { status: 400 });
    await deleteForecast(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
