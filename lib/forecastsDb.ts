/**
 * lib/forecastsDb.ts
 * ==================
 * Prévisionnel mensuel par client/référence (cartons) — SOURCE DE RÉFÉRENCE
 * des rapports depuis août 2026 : table Supabase `forecasts`, éditée via
 * l'onglet /prevision de l'app. Le Google Sheet Prévisionnel n'est plus lu au
 * moment de la génération ; il ne sert plus qu'à l'import initial
 * (/api/prevision/import) puis peut être abandonné.
 * RLS activée sans policy anon : accès uniquement via la clé service
 * (SUPABASE_SERVICE_ROLE_KEY), côté serveur.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ForecastRow } from "./googleSheets";

export interface ForecastDbRow {
  id?: string;
  client_key: string;
  reference: string;
  month: string; // "YYYY-MM"
  quantity_cartons: number;
  updated_at?: string;
}

function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Variable d'environnement manquante : SUPABASE_SERVICE_ROLE_KEY (clé service Supabase — requise pour le Prévisionnel)."
    );
  }
  return createClient(url, key);
}

export async function listForecasts(clientKey: string): Promise<ForecastDbRow[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("forecasts")
    .select("*")
    .eq("client_key", clientKey)
    .order("month")
    .order("reference");
  if (error) throw new Error(`Supabase forecasts: ${error.message}`);
  return (data ?? []) as ForecastDbRow[];
}

export async function upsertForecast(row: ForecastDbRow): Promise<ForecastDbRow> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("forecasts")
    .upsert(
      {
        client_key: row.client_key,
        reference: row.reference.trim(),
        month: row.month,
        quantity_cartons: row.quantity_cartons,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_key,reference,month" }
    )
    .select()
    .single();
  if (error) throw new Error(`Supabase forecasts (upsert): ${error.message}`);
  return data as ForecastDbRow;
}

export async function deleteForecast(id: string): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from("forecasts").delete().eq("id", id);
  if (error) throw new Error(`Supabase forecasts (delete): ${error.message}`);
}

/** Import en masse (bouton "Importer depuis Google Sheets" — une passe par
 * client). Upsert ligne à ligne sur (client, référence, mois). */
export async function bulkUpsertForecasts(
  clientKey: string,
  rows: ForecastRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const sb = getServiceSupabase();
  const payload = rows.map((r) => ({
    client_key: clientKey,
    reference: r.reference.trim(),
    month: r.month,
    quantity_cartons: r.quantity_cartons,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb
    .from("forecasts")
    .upsert(payload, { onConflict: "client_key,reference,month" });
  if (error) throw new Error(`Supabase forecasts (import): ${error.message}`);
  return payload.length;
}

/**
 * Prévisions du client pour le moteur de rapport (même forme que l'ancien
 * readForecast Google Sheets). Vide si rien n'est saisi — l'import initial ou
 * la saisie via /prevision remplit la table.
 */
export async function readForecastFromDb(clientKey: string): Promise<ForecastRow[]> {
  const rows = await listForecasts(clientKey);
  return rows.map((r) => ({
    reference: r.reference,
    month: r.month,
    quantity_cartons: Number(r.quantity_cartons),
  }));
}
