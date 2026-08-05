/**
 * lib/rfaRates.ts
 * ===============
 * Référentiel RFA / commissions de référencement, stocké dans Supabase
 * (table `rfa_rates`, RLS activée sans policy anon : lecture/écriture
 * uniquement via la clé service, côté serveur).
 *
 * Deux modèles de rémunération coexistent (fichier "RFAs Clients MBA") :
 *  - € par colis (`rfa_par_colis`) : Krousty, Lüks Kebab ;
 *  - % du CA HT facturé (`commission_pct`, fraction : 0.1 = 10 %) :
 *    Black & White, Pokawa (markup).
 * Si les deux sont renseignés pour une référence, le € / colis prime.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface RfaRate {
  id?: string;
  client_key: string;
  reference: string;
  prix_centrale: number | null;
  prix_restaurant: number | null;
  rfa_par_colis: number | null;
  commission_pct: number | null;
  updated_at?: string;
}

function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Variable d'environnement manquante : SUPABASE_SERVICE_ROLE_KEY (clé service Supabase, requise pour lire/écrire les RFAs — à ajouter sur Vercel)."
    );
  }
  return createClient(url, key);
}

export async function listRfaRates(clientKey?: string): Promise<RfaRate[]> {
  const sb = getServiceSupabase();
  let q = sb.from("rfa_rates").select("*").order("reference");
  if (clientKey) q = q.eq("client_key", clientKey);
  const { data, error } = await q;
  if (error) throw new Error(`Supabase rfa_rates: ${error.message}`);
  return (data ?? []) as RfaRate[];
}

export async function upsertRfaRate(rate: RfaRate): Promise<RfaRate> {
  const sb = getServiceSupabase();
  const row = {
    client_key: rate.client_key,
    reference: rate.reference.trim(),
    prix_centrale: rate.prix_centrale,
    prix_restaurant: rate.prix_restaurant,
    rfa_par_colis: rate.rfa_par_colis,
    commission_pct: rate.commission_pct,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("rfa_rates")
    .upsert(row, { onConflict: "client_key,reference" })
    .select()
    .single();
  if (error) throw new Error(`Supabase rfa_rates (upsert): ${error.message}`);
  return data as RfaRate;
}

export async function deleteRfaRate(id: string): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from("rfa_rates").delete().eq("id", id);
  if (error) throw new Error(`Supabase rfa_rates (delete): ${error.message}`);
}

/**
 * Taux RFA du client pour le calcul du rapport. Renvoie null (au lieu de
 * lever) si la clé service n'est pas configurée ou si la table est vide pour
 * ce client — le calcul retombe alors sur l'onglet Commission du Google
 * Sheet (comportement historique).
 */
export async function readRfaRatesForCalc(clientKey: string): Promise<RfaRate[] | null> {
  try {
    const rates = await listRfaRates(clientKey);
    return rates.length > 0 ? rates : null;
  } catch {
    return null;
  }
}
