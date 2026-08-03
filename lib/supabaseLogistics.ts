/**
 * lib/supabaseLogistics.ts
 * =======================
 * Fetch GEODIS and GLS data directly from Supabase
 * (populated by Railway workers)
 */

import { createClient } from "@supabase/supabase-js";
export interface DelayBuckets {
  on_time: number;
  late_1_3: number;
  late_4_7: number;
  late_7plus: number;
}

export interface SupabaseGeodisResult {
  total_cartons: number;
  total_poids: number;
  moyenne_jours: number;
  corner_wasabi_count: number;
  delay_buckets: DelayBuckets;
  by_country: Record<string, { count: number; poids: number }>;
}

export interface SupabaseGlsResult {
  total_parcels: number;
  total_poids: number;
  moyenne_jours: number;
  corner_wasabi_count: number;
  delay_buckets: DelayBuckets;
  by_country: Record<string, { count: number; poids: number }>;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Variables d'environnement Supabase manquantes (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }
  return createClient(url, key);
}

// ============================================================
// UTILITY FUNCTIONS (shared with parsers.ts)
// ============================================================

function toNum(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function round(n: number, decimals = 2): number {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function parseDateFlexible(dateStr: any): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function countDistinctWeekdays(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function countCornerWasabi(
  startDate: Date,
  endDate: Date,
  frenchHolidaysList: Date[]
): number {
  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    const isHoliday = frenchHolidaysList.some(
      (h) => h.toDateString() === current.toDateString()
    );
    if (day !== 0 && day !== 6 && !isHoliday) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function frenchHolidays(year: number): Date[] {
  return [
    new Date(year, 0, 1), // New Year
    easterDate(year), // Easter (Sunday)
    new Date(easterDate(year).getTime() + 1 * 24 * 60 * 60 * 1000), // Easter Monday
    new Date(year, 4, 1), // Labour Day
    new Date(year, 4, 8), // WWII Victory
    new Date(easterDate(year).getTime() + 39 * 24 * 60 * 60 * 1000), // Ascension
    new Date(easterDate(year).getTime() + 50 * 24 * 60 * 60 * 1000), // Pentecost Monday
    new Date(year, 6, 14), // Bastille Day
    new Date(year, 7, 15), // Assumption
    new Date(year, 10, 1), // All Saints
    new Date(year, 10, 11), // Armistice
    new Date(year, 11, 25), // Christmas
  ];
}

function isFrenchHoliday(date: Date, holidays: Date[]): boolean {
  return holidays.some((h) => h.toDateString() === date.toDateString());
}

function businessDaysBetween(
  startDate: Date,
  endDate: Date,
  holidays: Date[]
): number {
  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6 && !isFrenchHoliday(current, holidays)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// ============================================================
// GEODIS (SHIPMENTS)
// ============================================================

export async function fetchGeodisFromSupabase(
  clientCfg: any,
  startDate: Date,
  endDate: Date
): Promise<SupabaseGeodisResult> {
  const holidays = frenchHolidays(startDate.getFullYear());

  try {
    const { data, error } = await getSupabase()
      .from("shipments")
      .select("*")
      .eq("code_client", clientCfg.code_geodis)
      .gte("date_depart", startDate.toISOString())
      .lte("date_depart", endDate.toISOString());

    if (error) {
      console.error("Error fetching GEODIS from Supabase:", error);
      return {
        total_cartons: 0,
        total_poids: 0,
        moyenne_jours: 0,
        corner_wasabi_count: 0,
        delay_buckets: { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 },
        by_country: {},
      };
    }

    if (!data || data.length === 0) {
      return {
        total_cartons: 0,
        total_poids: 0,
        moyenne_jours: 0,
        corner_wasabi_count: 0,
        delay_buckets: { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 },
        by_country: {},
      };
    }

    let total_cartons = 0;
    let total_poids = 0;
    let total_days = 0;
    let corner_wasabi_count = 0;
    const delay_buckets = { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 };
    const by_country: Record<string, any> = {};

    for (const row of data) {
      total_cartons += toNum(row.nb_colis);
      total_poids += toNum(row.poids);

      const dateDepart = parseDateFlexible(row.date_depart);
      const dateLivraisonReelle = parseDateFlexible(row.date_livraison_reelle);

      if (dateDepart && dateLivraisonReelle && dateLivraisonReelle > dateDepart) {
        const deliveryDays = businessDaysBetween(
          dateDepart,
          dateLivraisonReelle,
          holidays
        );
        total_days += deliveryDays;

        if (deliveryDays <= 2) delay_buckets.on_time++;
        else if (deliveryDays <= 3) delay_buckets.late_1_3++;
        else if (deliveryDays <= 7) delay_buckets.late_4_7++;
        else delay_buckets.late_7plus++;

        if (deliveryDays <= 1) {
          corner_wasabi_count++;
        }
      }

      const country = row.code_pays_dest || "UNKNOWN";
      if (!by_country[country]) {
        by_country[country] = { count: 0, poids: 0 };
      }
      by_country[country].count++;
      by_country[country].poids += toNum(row.poids);
    }

    const moyenne_jours = data.length > 0 ? round(total_days / data.length) : 0;

    return {
      total_cartons,
      total_poids: round(total_poids),
      moyenne_jours,
      corner_wasabi_count,
      delay_buckets,
      by_country,
    };
  } catch (e) {
    console.error("Exception in fetchGeodisFromSupabase:", e);
    return {
      total_cartons: 0,
      total_poids: 0,
      moyenne_jours: 0,
      corner_wasabi_count: 0,
      delay_buckets: { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 },
      by_country: {},
    };
  }
}

// ============================================================
// GLS
// ============================================================

export async function fetchGlsFromSupabase(
  clientCfg: any,
  startDate: Date,
  endDate: Date
): Promise<SupabaseGlsResult> {
  const holidays = frenchHolidays(startDate.getFullYear());

  try {
    const { data, error } = await getSupabase()
      .from("gls_parcels")
      .select("*")
      .eq("code_client", clientCfg.code_gls)
      .gte("date_depart", startDate.toISOString())
      .lte("date_depart", endDate.toISOString());

    if (error) {
      console.error("Error fetching GLS from Supabase:", error);
      return {
        total_parcels: 0,
        total_poids: 0,
        moyenne_jours: 0,
        corner_wasabi_count: 0,
        delay_buckets: { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 },
        by_country: {},
      };
    }

    if (!data || data.length === 0) {
      return {
        total_parcels: 0,
        total_poids: 0,
        moyenne_jours: 0,
        corner_wasabi_count: 0,
        delay_buckets: { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 },
        by_country: {},
      };
    }

    let total_parcels = data.length;
    let total_poids = 0;
    let total_days = 0;
    let corner_wasabi_count = 0;
    const delay_buckets = { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 };
    const by_country: Record<string, any> = {};

    for (const row of data) {
      total_poids += toNum(row.poids);

      const dateDepart = parseDateFlexible(row.date_depart);
      const dateLivraisonReelle = parseDateFlexible(row.date_livraison_reelle);

      if (dateDepart && dateLivraisonReelle && dateLivraisonReelle > dateDepart) {
        const deliveryDays = businessDaysBetween(
          dateDepart,
          dateLivraisonReelle,
          holidays
        );
        total_days += deliveryDays;

        if (deliveryDays <= 2) delay_buckets.on_time++;
        else if (deliveryDays <= 3) delay_buckets.late_1_3++;
        else if (deliveryDays <= 7) delay_buckets.late_4_7++;
        else delay_buckets.late_7plus++;

        if (deliveryDays <= 1) {
          corner_wasabi_count++;
        }
      }

      const country = row.pays || "UNKNOWN";
      if (!by_country[country]) {
        by_country[country] = { count: 0, poids: 0 };
      }
      by_country[country].count++;
      by_country[country].poids += toNum(row.poids);
    }

    const moyenne_jours = data.length > 0 ? round(total_days / data.length) : 0;

    return {
      total_parcels,
      total_poids: round(total_poids),
      moyenne_jours,
      corner_wasabi_count,
      delay_buckets,
      by_country,
    };
  } catch (e) {
    console.error("Exception in fetchGlsFromSupabase:", e);
    return {
      total_parcels: 0,
      total_poids: 0,
      moyenne_jours: 0,
      corner_wasabi_count: 0,
      delay_buckets: { on_time: 0, late_1_3: 0, late_4_7: 0, late_7plus: 0 },
      by_country: {},
    };
  }
}

// ============================================================
// ADAPTATEURS -> types complets du rapport (GeodisResult / GlsResult)
// Les fonctions Supabase ne fournissent qu'un sous-ensemble des champs ;
// le reste est neutre (0 / null / vide) tant que les colonnes
// correspondantes n'existent pas dans Supabase.
// ============================================================

import type { GeodisResult, GlsResult, CountryStats, ServiceStats } from "./types";

const emptyCountryStats = (): CountryStats => ({ total_commandes: 0, livrees: 0, rate: null });
const emptyServiceStats = (): ServiceStats => ({ total_commandes: 0, livrees: 0, rate: null });

export function toGeodisResult(s: SupabaseGeodisResult): GeodisResult {
  return {
    restaurant_names: new Set<string>(),
    restaurants_livres: 0,
    total_commandes: 0,
    total_cartons: s.total_cartons,
    total_poids: s.total_poids,
    taux_reussite: null,
    france: emptyCountryStats(),
    belgique_lux: emptyCountryStats(),
    express: emptyServiceStats(),
    affretement: emptyServiceStats(),
    express_delay: { total: 0, within_24h: 0, rate: null },
    moyenne_jours: s.moyenne_jours,
    moyenne_cmds_cartons: null,
    moyenne_cmds_poids: null,
    corner_wasabi_count: s.corner_wasabi_count,
    respect_horaires_12h: null,
    respect_horaires_11h: null,
  };
}

export function toGlsResult(s: SupabaseGlsResult): GlsResult {
  const by_country: Record<string, number> = {};
  for (const [country, v] of Object.entries(s.by_country)) by_country[country] = v.count;
  return {
    restaurant_names: new Set<string>(),
    restaurants_livres: 0,
    // GLS: 1 colis = 1 carton dans les exports d'origine
    total_commandes: null,
    total_cartons: s.total_parcels,
    total_poids: s.total_poids,
    by_country,
    moyenne_jours: s.moyenne_jours,
    moyenne_cmds_cartons: null,
    moyenne_cmds_poids: null,
    corner_wasabi_count: s.corner_wasabi_count,
  };
}
