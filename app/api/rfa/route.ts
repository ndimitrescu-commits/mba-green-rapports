/**
 * app/api/rfa/route.ts
 * ====================
 * CRUD du référentiel RFA (table Supabase `rfa_rates`), utilisé par l'onglet
 * /rfa. Toutes les opérations exigent le mot de passe admin (en-tête
 * `x-rfa-password`, comparé à la variable d'environnement RFA_ADMIN_PASSWORD)
 * — les prix centrale révèlent les marges, la lecture est donc protégée
 * aussi. Les écritures passent par la clé service Supabase, jamais exposée
 * au navigateur.
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteRfaRate, listRfaRates, upsertRfaRate, type RfaRate } from "@/lib/rfaRates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): NextResponse | null {
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
  return null;
}

export async function GET(req: NextRequest) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const clientKey = req.nextUrl.searchParams.get("client") ?? undefined;
    const rates = await listRfaRates(clientKey || undefined);
    return NextResponse.json({ rates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = (await req.json()) as RfaRate;
    if (!body.client_key || !body.reference?.trim()) {
      return NextResponse.json({ error: "client_key et reference sont requis." }, { status: 400 });
    }
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const saved = await upsertRfaRate({
      client_key: body.client_key,
      reference: body.reference,
      prix_centrale: num(body.prix_centrale),
      prix_restaurant: num(body.prix_restaurant),
      rfa_par_colis: num(body.rfa_par_colis),
      commission_pct: num(body.commission_pct),
    });
    return NextResponse.json({ rate: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis." }, { status: 400 });
    await deleteRfaRate(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
