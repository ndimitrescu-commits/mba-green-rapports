/**
 * lib/supabaseLogistics.ts
 * =======================
 * Fetch GEODIS and GLS data directly from Supabase
 * (populated by Railway workers)
 */

import { createClient } from "@supabase/supabase-js";
import type { GeodisResult, GlsResult } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let supabase: any = null;

function getSupabaseClient() {
  if (!supabase && SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
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
): Promise<GeodisResult> {
  const holidays = frenchHolidays(startDate.getFullYear());

  try {
    const { data, error } = await getSupabaseClient()
      .from("shipments")
      .select("*")
      .eq("code_client", clientCfg.code_geodis)
      .gte("date_depart", startDate.toISOString())
      .lte("date_depart", endDate.toISOString());

    if (error) {
      console.error("Error fetching GEODIS from Supabase:", error);
      return {
        restaurant_names: new Set<string>(),
        restaurants_livres: 0,
        total_commandes: 0,
        total_cartons: 0,
        total_poids: 0,
        taux_reussite: null,
        france: { total_commandes: 0, livrees: 0, rate: null },
        belgique_lux: { total_commandes: 0, livrees: 0, rate: null },
        express: { total_commandes: 0, livrees: 0, rate: null },
        affretement: { total_commandes: 0, livrees: 0, rate: null },
        express_delay: { total: 0, within_24h: 0, rate: null },
        moyenne_jours: null,
        moyenne_cmds_cartons: null,
        moyenne_cmds_poids: null,
        corner_wasabi_count: 0,
        respect_horaires_12h: null,
        respect_horaires_11h: null,
        respect_horaires_conformes: null,
        delay_buckets: { total: 0, le_48h: 0, le_48h_rate: null, j_72h: 0, j_72h_rate: null, plus_72h: 0, plus_72h_rate: null },
      };
    }

    if (!data || data.length === 0) {
      return {
        restaurant_names: new Set<string>(),
        restaurants_livres: 0,
        total_commandes: 0,
        total_cartons: 0,
        total_poids: 0,
        taux_reussite: null,
        france: { total_commandes: 0, livrees: 0, rate: null },
        belgique_lux: { total_commandes: 0, livrees: 0, rate: null },
        express: { total_commandes: 0, livrees: 0, rate: null },
        affretement: { total_commandes: 0, livrees: 0, rate: null },
        express_delay: { total: 0, within_24h: 0, rate: null },
        moyenne_jours: null,
        moyenne_cmds_cartons: null,
        moyenne_cmds_poids: null,
        corner_wasabi_count: 0,
        respect_horaires_12h: null,
        respect_horaires_11h: null,
        respect_horaires_conformes: null,
        delay_buckets: { total: 0, le_48h: 0, le_48h_rate: null, j_72h: 0, j_72h_rate: null, plus_72h: 0, plus_72h_rate: null },
      };
    }

    let total_cartons = 0;
    let total_poids = 0;
    let total_days = 0;
    let corner_wasabi_count = 0;
    const delay_buckets = { total: 0, le_48h: 0, le_48h_rate: null as number | null, j_72h: 0, j_72h_rate: null as number | null, plus_72h: 0, plus_72h_rate: null as number | null };
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
        delay_buckets.total++;

        if (deliveryDays <= 2) delay_buckets.le_48h++;
        else if (deliveryDays === 3) delay_buckets.j_72h++;
        else delay_buckets.plus_72h++;

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

    // Calculate rates for delay buckets
    if (delay_buckets.total > 0) {
      delay_buckets.le_48h_rate = round((delay_buckets.le_48h / delay_buckets.total) * 100);
      delay_buckets.j_72h_rate = round((delay_buckets.j_72h / delay_buckets.total) * 100);
      delay_buckets.plus_72h_rate = round((delay_buckets.plus_72h / delay_buckets.total) * 100);
    }

    return {
      restaurant_names: new Set<string>(),
      restaurants_livres: 0,
      total_commandes: 0,
      total_cartons,
      total_poids: round(total_poids),
      taux_reussite: null,
      france: { total_commandes: 0, livrees: 0, rate: null },
      belgique_lux: { total_commandes: 0, livrees: 0, rate: null },
      express: { total_commandes: 0, livrees: 0, rate: null },
      affretement: { total_commandes: 0, livrees: 0, rate: null },
      express_delay: { total: 0, within_24h: 0, rate: null },
      moyenne_jours,
      moyenne_cmds_cartons: null,
      moyenne_cmds_poids: null,
      corner_wasabi_count,
      respect_horaires_12h: null,
      respect_horaires_11h: null,
      respect_horaires_conformes: null,
      delay_buckets,
    };
  } catch (e) {
    console.error("Exception in fetchGeodisFromSupabase:", e);
    return {
      restaurant_names: new Set<string>(),
      restaurants_livres: 0,
      total_commandes: 0,
      total_cartons: 0,
      total_poids: 0,
      taux_reussite: null,
      france: { total_commandes: 0, livrees: 0, rate: null },
      belgique_lux: { total_commandes: 0, livrees: 0, rate: null },
      express: { total_commandes: 0, livrees: 0, rate: null },
      affretement: { total_commandes: 0, livrees: 0, rate: null },
      express_delay: { total: 0, within_24h: 0, rate: null },
      moyenne_jours: null,
      moyenne_cmds_cartons: null,
      moyenne_cmds_poids: null,
      corner_wasabi_count: 0,
      respect_horaires_12h: null,
      respect_horaires_11h: null,
      respect_horaires_conformes: null,
      delay_buckets: { total: 0, le_48h: 0, le_48h_rate: null, j_72h: 0, j_72h_rate: null, plus_72h: 0, plus_72h_rate: null },
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
): Promise<GlsResult> {
  const holidays = frenchHolidays(startDate.getFullYear());

  try {
    const { data, error } = await getSupabaseClient()
      .from("gls_parcels")
      .select("*")
      .eq("code_client", clientCfg.code_gls)
      .gte("date_depart", startDate.toISOString())
      .lte("date_depart", endDate.toISOString());

    if (error) {
      console.error("Error fetching GLS from Supabase:", error);
      return {
        restaurant_names: new Set<string>(),
        restaurants_livres: 0,
        total_commandes: 0,
        total_cartons: 0,
        total_poids: 0,
        by_country: {},
        moyenne_jours: null,
        moyenne_cmds_cartons: null,
        moyenne_cmds_poids: null,
        corner_wasabi_count: 0,
      };
    }

    if (!data || data.length === 0) {
      return {
        restaurant_names: new Set<string>(),
        restaurants_livres: 0,
        total_commandes: 0,
        total_cartons: 0,
        total_poids: 0,
        by_country: {},
        moyenne_jours: null,
        moyenne_cmds_cartons: null,
        moyenne_cmds_poids: null,
        corner_wasabi_count: 0,
      };
    }

    let total_parcels = data.length;
    let total_poids = 0;
    let total_days = 0;
    let corner_wasabi_count = 0;
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
      restaurant_names: new Set<string>(),
      restaurants_livres: 0,
      total_commandes: data.length,
      total_cartons: total_parcels,
      total_poids: round(total_poids),
      by_country: {},
      moyenne_jours,
      moyenne_cmds_cartons: null,
      moyenne_cmds_poids: null,
      corner_wasabi_count,
    };
  } catch (e) {
    console.error("Exception in fetchGlsFromSupabase:", e);
    return {
      restaurant_names: new Set<string>(),
      restaurants_livres: 0,
      total_commandes: 0,
      total_cartons: 0,
      total_poids: 0,
      by_country: {},
      moyenne_jours: null,
      moyenne_cmds_cartons: null,
      moyenne_cmds_poids: null,
      corner_wasabi_count: 0,
    };
  }
}
