/**
 * lib/supabaseLogistics.ts
 * ========================
 * Source logistique live : tables Supabase alimentées par les workers Railway
 * (GEODIS `shipments`, GLS `gls_parcels`). Le compte transporteur (code_client
 * 617252) est commun à tous les clients MBA Green : le rattachement à une
 * enseigne se fait par correspondance sur le nom du restaurant (nom_dest /
 * client_nom), comme dans le pipeline d'origine (restaurant_name_matches).
 *
 * Les définitions métriques suivent les règles confirmées dans lib/types.ts
 * (jours ouvrés hors fériés FR, règle 11:00 pour l'express 24h, Wasabi = noms
 * contenant WASABI, respect horaires sur la Messagerie France).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientConfig,
  CountryStats,
  DelayBuckets,
  GeodisResult,
  GlsResult,
  GlsZoneStats,
} from "./types";

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Variables d'environnement Supabase manquantes (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}
function round(n: number, d = 2): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}
function up(s: unknown): string {
  return String(s ?? "").toUpperCase();
}

function namePatterns(cfg: ClientConfig): string[] {
  return [...(cfg.restaurant_name_matches ?? []), ...(cfg.restaurant_name_aliases ?? [])]
    .map((p) => up(p).trim())
    .filter(Boolean);
}
function matchesClient(row: { nom_dest?: unknown; client_nom?: unknown }, patterns: string[]): boolean {
  const hay = `${up(row.nom_dest)} | ${up(row.client_nom)}`;
  return patterns.some((p) => hay.includes(p));
}

/** Jours fériés France (fixes + mobiles basés sur Pâques). */
function frenchHolidays(year: number): Set<string> {
  const d = (m: number, day: number) =>
    `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Pâques (algorithme de Meeus)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  const plus = (days: number) => {
    const t = new Date(easter.getTime() + days * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
      t.getUTCDate()
    ).padStart(2, "0")}`;
  };
  return new Set([
    d(1, 1), d(5, 1), d(5, 8), d(7, 14), d(8, 15), d(11, 1), d(11, 11), d(12, 25),
    plus(1), // lundi de Pâques
    plus(39), // Ascension
    plus(50), // lundi de Pentecôte
  ]);
}

/** Date (YYYY-MM-DD) et heure décimale en Europe/Paris. */
function parisParts(iso: string | null): { date: string; hour: number; dow: number } | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  const dowMap: Record<string, number> = { "dim.": 0, "lun.": 1, "mar.": 2, "mer.": 3, "jeu.": 4, "ven.": 5, "sam.": 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: toNum(parts.hour) + toNum(parts.minute) / 60,
    dow: dowMap[parts.weekday] ?? new Date(iso).getUTCDay(),
  };
}

/**
 * Heure de livraison GEODIS : le worker (backfill juillet 2026 + flux
 * prospectif "recherche-envoi") ecrit l'heure LOCALE de livraison dans le
 * champ horaire du timestamp, stocke en UTC (13:30 locale -> "13:30Z").
 * Il faut donc lire l'horloge UTC SANS conversion de fuseau — une conversion
 * Europe/Paris decalerait tout de +2 h (valide sur juillet 2026 : 81 % avant
 * 12 h / 11 % / 7,5 %, moyenne ~10:25, coherent avec les heures GEODIS).
 * Renvoie null si pas de timestamp ; hour = 0 pour les anciennes lignes a
 * minuit (pas d'heure reelle).
 */
function utcClockParts(iso: string | null): { date: string; hour: number } | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    date: dt.toISOString().slice(0, 10),
    hour: dt.getUTCHours() + dt.getUTCMinutes() / 60,
  };
}

function isBusinessDay(dateStr: string, dow: number, holidays: Set<string>): boolean {
  return dow >= 1 && dow <= 5 && !holidays.has(dateStr);
}

/** Nb de jours ouvrés entre deux dates (exclusif départ, inclusif arrivée). */
function businessDaysBetween(fromDate: string, toDate: string, holidays: Set<string>): number {
  if (toDate <= fromDate) return 0;
  let n = 0;
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const ds = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    if (isBusinessDay(ds, dow, holidays)) n++;
  }
  return n;
}

export interface GeodisRow {
  nom_dest: string | null;
  client_nom: string | null;
  type_prestation: string | null;
  code_produit: string | null;
  code_pays_dest: string | null;
  outcome: string | null;
  poids: number | null;
  nb_colis: number | null;
  /** Nombre de palettes de l'expédition (envois palettisés 2026). */
  nb_palettes?: number | null;
  /** Référence expéditeur GEODIS, ex. "SO48234 - 7 COLIS" — porte le nombre
   * de cartons pour les envois palettisés où nb_colis vaut 0. */
  reference1?: string | null;
  date_depart: string | null;
  date_livraison_prevue: string | null;
  date_livraison_reelle: string | null;
}

const GEODIS_COLS =
  "nom_dest,client_nom,type_prestation,code_produit,code_pays_dest,outcome,poids,nb_colis,nb_palettes,reference1,date_depart,date_livraison_prevue,date_livraison_reelle";

/**
 * Cartons d'une expédition GEODIS : nb_colis quand il est renseigné, sinon le
 * nombre porté par la référence "SOxxxxx - N COLIS" (les envois palettisés de
 * 2026 ont nb_colis = 0 mais la référence est fiable — validé juillet 2026 :
 * 350/351 lignes, 4 312 cartons, cohérent avec les 4 535 de février).
 */
function geodisCartons(r: GeodisRow): number {
  const direct = toNum(r.nb_colis);
  if (direct > 0) return direct;
  const m = /(\d+)\s*COLIS/i.exec(String(r.reference1 ?? ""));
  return m ? Number(m[1]) : 0;
}

async function fetchAll<T>(query: () => any): Promise<T[]> {
  const rows: T[] = [];
  const page = 1000;
  for (let fromIdx = 0; fromIdx < 10000; fromIdx += page) {
    const { data, error } = await query().range(fromIdx, fromIdx + page - 1);
    if (error) throw new Error(`Supabase: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return rows;
}

function emptyBuckets(): DelayBuckets {
  return { total: 0, le_48h: 0, le_48h_rate: null, j_72h: 0, j_72h_rate: null, plus_72h: 0, plus_72h_rate: null };
}

function computeBuckets(rows: GeodisRow[]): DelayBuckets {
  const b = emptyBuckets();
  for (const r of rows) {
    if (!r.date_depart || !r.date_livraison_reelle) continue;
    const dep = new Date(r.date_depart).getTime();
    const del = new Date(r.date_livraison_reelle).getTime();
    if (Number.isNaN(dep) || Number.isNaN(del) || del < dep) continue;
    const days = Math.round((del - dep) / 86400000);
    b.total++;
    if (days <= 2) b.le_48h++;
    else if (days <= 3) b.j_72h++;
    else b.plus_72h++;
  }
  if (b.total > 0) {
    b.le_48h_rate = round((b.le_48h / b.total) * 100, 0);
    b.j_72h_rate = round((b.j_72h / b.total) * 100, 0);
    b.plus_72h_rate = round((b.plus_72h / b.total) * 100, 0);
  }
  return b;
}

function countryStats(rows: GeodisRow[], withCountries: boolean): CountryStats {
  const livrees = rows.filter((r) => r.outcome === "livre").length;
  const decided = rows.filter((r) => r.outcome !== null).length;
  const stats: CountryStats = {
    total_commandes: rows.length,
    livrees,
    rate: decided > 0 ? round((livrees / decided) * 100, 0) : null,
    delay_buckets: computeBuckets(rows),
  };
  if (withCountries) {
    const by: Record<string, number> = {};
    for (const r of rows) {
      const p = up(r.code_pays_dest) || "?";
      by[p] = (by[p] ?? 0) + 1;
    }
    stats.by_country = by;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// GEODIS
// ---------------------------------------------------------------------------
export async function fetchGeodisFromSupabase(
  cfg: ClientConfig,
  dateFrom: string,
  dateTo: string
): Promise<GeodisResult> {
  const sb = getSupabase();
  const patterns = namePatterns(cfg);
  const all = await fetchAll<GeodisRow>(() =>
    sb
      .from("shipments")
      .select(GEODIS_COLS)
      .gte("date_depart", dateFrom)
      .lt("date_depart", dateTo)
  );
  const rows = all.filter((r) => matchesClient(r, patterns));
  return computeGeodisResult(rows, new Date(dateFrom).getUTCFullYear());
}

/** Calcul pur (testable) sur des lignes déjà filtrées pour le client. */
export function computeGeodisResult(rows: GeodisRow[], year: number): GeodisResult {
  const holidays = frenchHolidays(year);
  const names = new Set(rows.map((r) => up(r.nom_dest).trim()).filter(Boolean));
  const totalCartons = rows.reduce((s, r) => s + geodisCartons(r), 0);
  const totalPalettes = rows.reduce((s, r) => s + toNum(r.nb_palettes), 0);
  const totalPoids = round(rows.reduce((s, r) => s + toNum(r.poids), 0));
  const livrees = rows.filter((r) => r.outcome === "livre").length;
  const decided = rows.filter((r) => r.outcome !== null).length;

  const isMessagerie = (r: GeodisRow) => ["MES", "MEI"].includes(up(r.type_prestation));
  const isExpress = (r: GeodisRow) =>
    ["COU", "OVE", "EXP"].includes(up(r.type_prestation)) || up(r.code_produit) === "T24";
  const isAffretement = (r: GeodisRow) => up(r.type_prestation) === "AFF";

  const messagerie = rows.filter(isMessagerie);
  const franceRows = messagerie.filter((r) => up(r.code_pays_dest) === "FR");
  const beluxRows = messagerie.filter((r) => up(r.code_pays_dest) !== "FR");
  const expressRows = rows.filter(isExpress);
  const affRows = rows.filter(isAffretement);

  // Express 24h : 1 jour ouvré (hors fériés FR) ; si week-end/férié traversé,
  // livré avant 11:00 le jour de livraison (règle confirmée).
  let exTotal = 0, ex24 = 0;
  for (const r of expressRows) {
    const dep = parisParts(r.date_depart);
    const del = parisParts(r.date_livraison_reelle);
    if (!dep || !del) continue;
    exTotal++;
    const bd = businessDaysBetween(dep.date, del.date, holidays);
    const calendarDays = Math.round(
      (Date.parse(del.date) - Date.parse(dep.date)) / 86400000
    );
    const crossedNonBusiness = calendarDays > bd;
    // Regle "avant 11:00" : heure locale lue sur l'horloge UTC (meme
    // convention de stockage que le respect horaires — voir utcClockParts).
    const delHour = utcClockParts(r.date_livraison_reelle)?.hour ?? del.hour;
    if (bd <= 1 && (!crossedNonBusiness || delHour <= 11)) ex24++;
  }

  // Respect horaires : Messagerie France livrée, heure locale de livraison
  // (lue sur l'horloge UTC — voir utcClockParts).
  const allHours = franceRows
    .map((r) => utcClockParts(r.date_livraison_reelle))
    .filter((p): p is NonNullable<ReturnType<typeof utcClockParts>> => p !== null)
    .filter((p) => p.hour > 0.01);
  // Les lignes sans heure réelle (anciens envois : timestamp à minuit) sont
  // écartées ; si aucune ligne n'a d'heure, le respect horaires n'est pas
  // calculable.
  const hasRealHours = allHours.length > 0;
  const withHour = hasRealHours ? allHours : [];
  const before12 = withHour.filter((p) => p.hour <= 12).length;
  const before11 = withHour.filter((p) => p.hour <= 11).length;

  // Page "Horaires livraisons" (gabarit compact) : répartition <12h / 12-14h /
  // >14h sur la Messagerie France + "conformes" (= livrées <=48h ouvrées, même
  // définition que delay_buckets.le_48h). Null tant que la source ne porte pas
  // d'heure réelle (flux tracking GEODIS actuel : dates à minuit).
  const franceBuckets = computeBuckets(franceRows);
  const horaires =
    withHour.length > 0
      ? {
          total: withHour.length,
          avant_12: before12,
          h12_14: withHour.filter((p) => p.hour > 12 && p.hour <= 14).length,
          apres_14: withHour.filter((p) => p.hour > 14).length,
          conformes: franceBuckets.le_48h,
          conformes_total: franceBuckets.total,
        }
      : null;

  // Moyenne/jours : commandes / jours ouvrés distincts avec expédition.
  const departDays = new Set(
    rows
      .map((r) => parisParts(r.date_depart))
      .filter((p): p is NonNullable<ReturnType<typeof parisParts>> => p !== null)
      .filter((p) => isBusinessDay(p.date, p.dow, holidays))
      .map((p) => p.date)
  );

  const totalCmds = rows.length;
  return {
    restaurant_names: names,
    restaurants_livres: names.size,
    total_commandes: totalCmds,
    total_cartons: totalCartons,
    total_palettes: totalPalettes,
    total_poids: totalPoids,
    taux_reussite: decided > 0 ? round((livrees / decided) * 100, 0) : null,
    france: countryStats(franceRows, false),
    belgique_lux: countryStats(beluxRows, true),
    express: {
      total_commandes: expressRows.length,
      livrees: expressRows.filter((r) => r.outcome === "livre").length,
      rate:
        expressRows.filter((r) => r.outcome !== null).length > 0
          ? round(
              (expressRows.filter((r) => r.outcome === "livre").length /
                expressRows.filter((r) => r.outcome !== null).length) *
                100,
              0
            )
          : null,
    },
    affretement: {
      total_commandes: affRows.length,
      livrees: affRows.filter((r) => r.outcome === "livre").length,
      rate:
        affRows.filter((r) => r.outcome !== null).length > 0
          ? round(
              (affRows.filter((r) => r.outcome === "livre").length /
                affRows.filter((r) => r.outcome !== null).length) *
                100,
              0
            )
          : null,
    },
    express_delay: {
      total: exTotal,
      within_24h: ex24,
      rate: exTotal > 0 ? round((ex24 / exTotal) * 100, 0) : null,
    },
    moyenne_jours: departDays.size > 0 ? round(totalCmds / departDays.size, 1) : null,
    moyenne_cmds_cartons: totalCmds > 0 ? round(totalCartons / totalCmds, 2) : null,
    moyenne_cmds_poids: totalCmds > 0 ? round(totalPoids / totalCmds, 2) : null,
    corner_wasabi_count: [...names].filter((n) => n.includes("WASABI")).length,
    respect_horaires_12h: withHour.length > 0 ? round((before12 / withHour.length) * 100, 0) : null,
    respect_horaires_11h: withHour.length > 0 ? round((before11 / withHour.length) * 100, 2) : null,
    horaires,
  };
}

// ---------------------------------------------------------------------------
// GLS
// ---------------------------------------------------------------------------
export interface GlsRow {
  nom_dest: string | null;
  numero_so: string | null;
  ref_colis: string | null;
  pays: string | null;
  poids: number | null;
  date_depart: string | null;
  /** "livre" | "en_cours" | "probleme_gls" | ... (colonne statut de gls_parcels). */
  statut?: string | null;
  date_livraison_prevue?: string | null;
  date_livraison_reelle?: string | null;
}

export async function fetchGlsFromSupabase(
  cfg: ClientConfig,
  dateFrom: string,
  dateTo: string
): Promise<GlsResult> {
  const sb = getSupabase();
  const patterns = namePatterns(cfg);
  const all = await fetchAll<GlsRow>(() =>
    sb
      .from("gls_parcels")
      .select(
        "nom_dest,numero_so,ref_colis,pays,poids,date_depart,statut,date_livraison_prevue,date_livraison_reelle"
      )
      .gte("date_depart", dateFrom)
      .lt("date_depart", dateTo)
  );
  const rows = all.filter((r) => matchesClient({ nom_dest: r.nom_dest }, patterns));
  return computeGlsResult(rows, new Date(dateFrom).getUTCFullYear());
}

/**
 * Stats "Respect délais jour" d'une zone GLS. Délais en JOURS OUVRÉS entre la
 * date de départ et la livraison (réelle pour les barres "Livrée", prévue pour
 * les barres "Prévu"), fériés français exclus — même convention que GEODIS.
 * `bucketMaxDays` = bornes hautes des paliers (France [1,2] → 24H/48H/>48H,
 * Europe [2,3] → 48H/72H/>72H) ; au-delà de la dernière borne, dernier palier.
 */
function glsZoneStats(
  rows: GlsRow[],
  holidays: Set<string>,
  bucketMaxDays: number[],
  labels: string[]
): GlsZoneStats | null {
  if (rows.length === 0) return null;
  const livres = rows.filter((r) => r.statut === "livre");
  const decides = rows.filter((r) => r.statut && r.statut !== "en_cours").length;

  const bucketOf = (from: string | null | undefined, to: string | null | undefined): number | null => {
    const f = parisParts(from ?? null);
    const t = parisParts(to ?? null);
    if (!f || !t) return null;
    const d = businessDaysBetween(f.date, t.date, holidays);
    for (let i = 0; i < bucketMaxDays.length; i++) if (d <= bucketMaxDays[i]) return i;
    return bucketMaxDays.length;
  };

  const buckets = labels.map((label) => ({ label, livre: 0, prevu: 0 }));
  const last = buckets.length - 1;
  for (const r of rows) {
    if (r.statut === "livre") {
      const b = bucketOf(r.date_depart, r.date_livraison_reelle);
      if (b !== null) buckets[Math.min(b, last)].livre++;
    }
    const p = bucketOf(r.date_depart, r.date_livraison_prevue);
    if (p !== null) buckets[Math.min(p, last)].prevu++;
  }

  return {
    total: rows.length,
    livrees: livres.length,
    rate: decides > 0 ? round((livres.length / decides) * 100, 0) : null,
    buckets,
  };
}

/** Calcul pur (testable) sur des lignes déjà filtrées pour le client. */
export function computeGlsResult(rows: GlsRow[], year: number): GlsResult {
  const holidays = frenchHolidays(year);
  const names = new Set(rows.map((r) => up(r.nom_dest).trim()).filter(Boolean));
  const commandes = new Set(
    rows.map((r) => r.numero_so || r.ref_colis || "").filter(Boolean)
  );
  const totalPoids = round(rows.reduce((s, r) => s + toNum(r.poids), 0));
  const byCountry: Record<string, number> = {};
  for (const r of rows) {
    const p = up(r.pays) || "?";
    byCountry[p] = (byCountry[p] ?? 0) + 1;
  }
  const departDays = new Set(
    rows
      .map((r) => parisParts(r.date_depart))
      .filter((p): p is NonNullable<ReturnType<typeof parisParts>> => p !== null)
      .filter((p) => isBusinessDay(p.date, p.dow, holidays))
      .map((p) => p.date)
  );

  // Zones page 10 : France (FR ou pays inconnu) vs Europe (reste).
  const frRows = rows.filter((r) => {
    const p = up(r.pays).trim();
    return !p || p === "FR" || p === "?";
  });
  const euRows = rows.filter((r) => !frRows.includes(r));

  const nCmds = commandes.size;
  return {
    restaurant_names: names,
    restaurants_livres: names.size,
    total_commandes: nCmds > 0 ? nCmds : null,
    total_cartons: rows.length,
    total_poids: totalPoids,
    by_country: byCountry,
    moyenne_jours: departDays.size > 0 && nCmds > 0 ? round(nCmds / departDays.size, 1) : null,
    moyenne_cmds_cartons: nCmds > 0 ? round(rows.length / nCmds, 2) : null,
    moyenne_cmds_poids: nCmds > 0 ? round(totalPoids / nCmds, 2) : null,
    corner_wasabi_count: [...names].filter((n) => n.includes("WASABI")).length,
    fr: glsZoneStats(frRows, holidays, [1, 2], ["24H", "48H", ">48H"]),
    europe: glsZoneStats(euRows, holidays, [2, 3], ["48H", "72H", ">72H"]),
  };
}
