/**
 * compute.ts
 * ----------
 * Orchestrates the parsers and builds the final `context` object consumed
 * by the HTML renderer. This is the only place that knows how the
 * individual data sources combine into the report's headline numbers.
 *
 * Ported faithfully from compute.py, including Python's dict.get(key, default)
 * semantics: return the dict's value if the key exists (even if falsy/0),
 * otherwise the default. We replicate this with an explicit `dget` helper
 * rather than `??`/`||`, which would incorrectly fall through on 0.
 */
import clientsConfig from "./clients.json";
import * as parsers from "./parsers";
import {
  fetchAvgPriceByCarton,
  fetchConsumptionCartons,
  fetchStockOnHand,
  fetchTransitByItem,
} from "./netsuiteData";
import { fetchFinancials, fetchReferencingCommission } from "./netsuiteFinancials";
import { readForecast, readPrices, readCommissions, type ForecastRow } from "./googleSheets";
import type {
  ArticleItem,
  ClientConfig,
  ClientsConfig,
  ReportContext,
  ReportFiles,
  StockItem,
  StockWeek,
  GeodisResult,
  GlsResult,
} from "./types";

const CLIENTS = clientsConfig as unknown as ClientsConfig;

// ---------------------------------------------------------------------------
// Month-label parsing -- the UI's "month_label" field is free text like
// "Février 2026", used both for display and (now) to derive the date range
// queried against NetSuite and the "YYYY-MM" key looked up in the
// Prévisionnel Sheet. Handles accented/non-accented French month names,
// case-insensitively.
// ---------------------------------------------------------------------------
const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  "février": 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  "août": 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  "décembre": 12,
};

export interface ParsedMonth {
  year: number;
  month: number; // 1-12
  yyyymm: string; // "2026-02"
  dateFrom: string; // "2026-02-01"
  dateTo: string; // "2026-02-28"
}

export function parseMonthLabel(label: string): ParsedMonth {
  const parts = label.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) {
    throw new Error(
      `Impossible d'interpréter le mois "${label}" -- format attendu : "Février 2026".`
    );
  }
  const monthName = parts[0];
  const year = Number(parts[parts.length - 1]);
  const month = FRENCH_MONTHS[monthName];
  if (!month || !Number.isFinite(year)) {
    throw new Error(
      `Impossible d'interpréter le mois "${label}" -- format attendu : "Février 2026" (mois en français + année).`
    );
  }
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year,
    month,
    yyyymm: `${year}-${pad(month)}`,
    dateFrom: `${year}-${pad(month)}-01`,
    dateTo: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

export function loadClientConfig(clientKey: string): ClientConfig {
  const cfg = CLIENTS[clientKey];
  if (!cfg) {
    throw new Error(`Unknown client '${clientKey}'. Available: ${Object.keys(CLIENTS).join(", ")}`);
  }
  return cfg;
}

export function getClientsConfig(): ClientsConfig {
  return CLIENTS;
}

/** Python dict.get(key, default) semantics: key-presence check, not truthiness. */
function dget<T = unknown>(obj: Record<string, unknown>, key: string, def: T): T {
  return key in obj && obj[key] !== undefined ? (obj[key] as T) : def;
}

interface ArticlesResult {
  items: ArticleItem[];
  sku_count: number;
  total_cartons_consumed: number;
  total_pieces_consumed: number;
  ca_forecast: number;
}

/**
 * Replaces parsers.parseArticlePerformance(dataFebFile) with live sources:
 * consumption from NetSuite (cartons, see netsuiteData.ts), forecast + unit
 * prices from the Prévisionnel Google Sheet (see googleSheets.ts). Union of
 * every reference seen in either source, so a SKU forecast-only (nothing
 * shipped yet) or consumption-only (not in this month's forecast) both show
 * up rather than being silently dropped.
 *
 * ca_forecast (money) requires a price per reference -- if the "Prix" tab
 * has no entry for a given reference, that reference contributes 0 to the
 * total rather than throwing, and the aggregate "CA prévisionnel" figure
 * degrades to "-" in the PDF if no prices are configured at all yet (see
 * reportData.ts's money() helper, and the "Créer une table de prix"
 * decision Nicolas made for this).
 */
async function buildArticles(
  clientKey: string,
  cfg: ClientConfig,
  month: ParsedMonth,
  forecastRows: ForecastRow[]
): Promise<ArticlesResult> {
  // Prix unitaire carton : onglet "Prix" du Prévisionnel prioritaire, repli
  // sur le prix moyen réalisé du mois (factures NetSuite) — ainsi le
  // "CA attendu" (= prévisions × prix unitaire) est calculable même tant que
  // la table de prix n'est pas remplie.
  const [consumption, prices, avgPrices] = await Promise.all([
    fetchConsumptionCartons(cfg.netsuite_parent_id, month.dateFrom, month.dateTo),
    readPrices(clientKey),
    fetchAvgPriceByCarton(cfg.netsuite_parent_id, month.dateFrom, month.dateTo),
  ]);

  const forecastMap = new Map<string, number>();
  for (const row of forecastRows) {
    if (row.month === month.yyyymm) forecastMap.set(row.reference, row.quantity_cartons);
  }

  const consumptionMap = new Map<string, { description: string; qty: number }>();
  let totalPieces = 0;
  for (const row of consumption) {
    consumptionMap.set(row.itemCode, { description: row.description, qty: row.qtyCartons });
    totalPieces += Number(row.qtyPieces) || 0;
  }

  const allCodes = new Set<string>([...forecastMap.keys(), ...consumptionMap.keys()]);

  const items: ArticleItem[] = [];
  let totalCons = 0;
  let totalCaPrev = 0;

  for (const code of allCodes) {
    const forecastCartons = forecastMap.get(code) ?? 0;
    const cons = consumptionMap.get(code);
    const consCartons = cons?.qty ?? 0;
    const price = prices.get(code) ?? avgPrices.get(code) ?? 0;
    const rate = forecastCartons ? Math.round((consCartons / forecastCartons) * 100) : null;

    items.push({
      code,
      description: cons?.description ?? "",
      forecast: forecastCartons,
      consumption: consCartons,
      rate,
      ca_forecast: Math.round(forecastCartons * price * 100) / 100,
      ca_consumption: Math.round(consCartons * price * 100) / 100,
    });

    totalCons += consCartons;
    totalCaPrev += forecastCartons * price;
  }

  items.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  return {
    items,
    sku_count: items.length,
    total_cartons_consumed: totalCons,
    total_pieces_consumed: totalPieces,
    ca_forecast: Math.round(totalCaPrev * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Stock/transit weekly projection -- replaces the manual "Client Report
// Breakdown" upload. Per Nicolas's explicit spec (2026-07-20 conversation):
//  - Weekly forecast = monthly Prévisionnel figure / 4.2 (his chosen
//    approximation for "weeks per month", flat across every week of the
//    month rather than weighted by how many days of that week fall in it).
//  - "In transit" is bucketed by calendar (ISO 8601) week of the PO line's
//    due date.
//  - "Stock" is a running projection, not a real NetSuite figure per week:
//    starting from today's on-hand cartons, each week subtracts that week's
//    forecast and adds that week's arrivals. This is the same logic the old
//    manually-maintained file encoded, just computed instead of typed in.
//  - Items shown are the top `maxItems` references by monthly forecast
//    volume for this client/month (the old file's item list was a manual
//    selection by Nicolas's team; this is the closest automatic proxy --
//    flagged to Nicolas rather than assumed permanently correct).
// ---------------------------------------------------------------------------
const WEEKLY_FORECAST_DIVISOR = 4.2;

/** ISO-8601 week number (1-53) for a given date, UTC-based to avoid
 * timezone-boundary edge cases. */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

/** Every distinct ISO week number that has at least one day within the
 * given month, in chronological order. */
function weeksInMonth(month: ParsedMonth): number[] {
  const weeks: number[] = [];
  const seen = new Set<number>();
  const daysInMonth = new Date(month.year, month.month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const w = isoWeekNumber(new Date(month.year, month.month - 1, day));
    if (!seen.has(w)) {
      seen.add(w);
      weeks.push(w);
    }
  }
  return weeks;
}

async function buildStockStatus(
  cfg: ClientConfig,
  month: ParsedMonth,
  forecastRows: ForecastRow[],
  maxItems = 6
): Promise<StockItem[]> {
  const monthlyForecast = new Map<string, number>();
  for (const row of forecastRows) {
    if (row.month === month.yyyymm) monthlyForecast.set(row.reference, row.quantity_cartons);
  }

  const topCodes = Array.from(monthlyForecast.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([code]) => code);

  if (topCodes.length === 0) return [];

  const [onHandMap, transitMap] = await Promise.all([
    fetchStockOnHand(topCodes),
    fetchTransitByItem(topCodes),
  ]);

  const weeks = weeksInMonth(month);

  return topCodes.map((code) => {
    const onHand = onHandMap.get(code) ?? 0;
    const weeklyForecast = (monthlyForecast.get(code) ?? 0) / WEEKLY_FORECAST_DIVISOR;
    const transitLines = transitMap.get(code) ?? [];

    let running = onHand;
    const weekEntries: StockWeek[] = weeks.map((weekNo) => {
      const transitThisWeek = transitLines
        .filter((l) => isoWeekNumber(new Date(l.dueDate)) === weekNo)
        .reduce((sum, l) => sum + l.qtyCartons, 0);
      running = running - weeklyForecast + transitThisWeek;
      return {
        week: weekNo,
        forecast: Math.round(weeklyForecast),
        stock: Math.round(running),
        in_transit: Math.round(transitThisWeek),
      };
    });

    return { code, on_hand: Math.round(onHand), weeks: weekEntries };
  });
}

function formatDateFr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export async function buildReportContext(
  clientKey: string,
  monthLabel: string,
  files: ReportFiles
): Promise<ReportContext> {
  const cfg = loadClientConfig(clientKey);
  const parsedMonth = parseMonthLabel(monthLabel);
  const [forecastRows, commissionRates] = await Promise.all([
    readForecast(clientKey),
    readCommissions(clientKey),
  ]);

  const [articles, stockStatus, finData, referencingCommission] = await Promise.all([
    buildArticles(clientKey, cfg, parsedMonth, forecastRows),
    buildStockStatus(cfg, parsedMonth, forecastRows),
    fetchFinancials(cfg.netsuite_parent_id, parsedMonth.dateFrom, parsedMonth.dateTo),
    fetchReferencingCommission(
      cfg.netsuite_parent_id,
      parsedMonth.dateFrom,
      parsedMonth.dateTo,
      commissionRates
    ),
  ]);
  const geodis = parsers.parseGeodis(files.geodis, cfg);
  const gls = parsers.parseGls(files.gls, cfg);
  // "RFAs / Commissions" (= "Commission à payer - référencement") is
  // computed from NetSuite Sales Orders x the "Commission" Sheet tab's
  // per-item rates -- see fetchReferencingCommission. Null (no rates
  // configured yet for this client, e.g. Krousty/Lüks Kebab/Kazdalerie for
  // now) is treated as "not available" and the key is simply omitted, same
  // convention as before, so dget() falls back to "-".
  // "RFAs / Commissions PGK" (stock PKG) still has no known source
  // (confirmed by Nicolas) and is deliberately never set here.
  const fin: Record<string, unknown> = {
    "Chiffre d'Affaires H.T.": finData.caHtTotal,
    "Nombre de commande": finData.salesOrderCount,
    ...finData.caHtByLabel,
  };
  if (referencingCommission !== null) {
    fin["RFAs / Commissions"] = referencingCommission;
  }

  // GLS export has one row per parcel line, not one per sales order, so the
  // authoritative "total commandes" comes from the financial sheet (itself
  // sourced from the ERP). GEODIS's order count is reliable (one Référence1
  // per order) and is used to split GEODIS/GLS share.
  let orderCountTotal = dget<number | null>(fin, "Nombre de commande", null);
  if (orderCountTotal === null || orderCountTotal === undefined) {
    orderCountTotal = geodis.total_commandes;
  }

  // A restaurant delivered by both carriers in the same month must only be
  // counted once in the combined total. GEODIS and GLS spell the same
  // restaurant differently, so we dedupe on a normalized key rather than
  // the raw name (see parsers.normalizeRestaurantName for caveats).
  const normalizedGeodis = new Set(
    Array.from(geodis.restaurant_names).map((n) => parsers.normalizeRestaurantName(n))
  );
  const normalizedGls = new Set(
    Array.from(gls.restaurant_names).map((n) => parsers.normalizeRestaurantName(n))
  );
  const unionRestaurants = new Set<string>([...normalizedGeodis, ...normalizedGls]);
  const totalRestaurants = unionRestaurants.size;

  // Corner Wasabi count: auto-detected from restaurant names containing
  // "WASABI" across both carriers (confirmed exact match vs. reference --
  // see parsers.countCornerWasabi). Falls back to the manual clients.json
  // value only if the auto-detection finds nothing, in case a future
  // client's naming convention doesn't include "WASABI" in the export.
  const autoCornerWasabi = geodis.corner_wasabi_count + gls.corner_wasabi_count;
  const totalCornerWasabi = autoCornerWasabi || cfg.corner_wasabi_count_manual || 0;

  const totalCartons = geodis.total_cartons + gls.total_cartons;
  const totalPoids = Math.round((geodis.total_poids + gls.total_poids) * 100) / 100;

  const geodisShare =
    orderCountTotal !== null && orderCountTotal !== undefined && orderCountTotal
      ? Math.round((geodis.total_commandes / orderCountTotal) * 100)
      : null;
  const glsShare = geodisShare !== null ? 100 - geodisShare : null;

  // "CA actual" is now always sourced from the financial file (Rapports
  // Clients Mensuel, still required) -- previously fell back to the DATA
  // file's own consumption*price total when the financial column was
  // missing, but that DATA-file total no longer exists. Falls back to 0
  // rather than throwing if the financial column is genuinely absent.
  const caActualFin = dget<number | null>(fin, "Chiffre d'Affaires H.T.", null);
  const caActual = caActualFin !== null && caActualFin !== undefined ? caActualFin : 0;

  const caActualForRate = dget<number>(fin, "Chiffre d'Affaires H.T.", 0);
  const performanceRate = articles.ca_forecast
    ? Math.round(((Number(caActualForRate) || 0) / articles.ca_forecast) * 100 * 100) / 100
    : null;

  const context: ReportContext = {
    generated_at: formatDateFr(new Date()),
    client: cfg,
    month_label: monthLabel,
    kpi: {
      sku_count: articles.sku_count,
      // NOTE: this is now a CARTONS figure (sourced from NetSuite, unit-
      // converted), not pieces -- the old DATA file's "Cons." column was in
      // pieces. Field name kept as-is to avoid touching reportData.ts's
      // mapping, but the number/unit shown on page 1 changes as a result.
      // Flagged explicitly to Nicolas, not a silent change.
      pieces_consumed: Math.trunc(articles.total_cartons_consumed),
      ca_actual: Number(caActual),
      ca_forecast: articles.ca_forecast,
      performance_rate: performanceRate,
      total_commandes: orderCountTotal,
      total_cartons: totalCartons,
      taux_reussite: geodis.taux_reussite,
    },
    articles: articles.items,
    stock_status: stockStatus,
    logistics: {
      restaurants_livres: totalRestaurants,
      corner_wasabi: totalCornerWasabi,
      total_commandes: orderCountTotal,
      total_cartons: totalCartons,
      total_poids: totalPoids,
      geodis_share: geodisShare,
      gls_share: glsShare,
      geodis,
      gls,
    },
    financials: {
      ca_total: dget<number | null>(fin, "Chiffre d'Affaires H.T.", null),
      reglement_livraison: dget(fin, "Règlement à la livraison", null),
      reglement_commande: dget(fin, "Règlement à la commande", null),
      reglement_30_classique: dget(fin, "Règlement net 30 jours (classique)", null),
      reglement_escompte_2: dget(fin, "Règlement escompte 2% (SEPA)", null),
      reglement_30_sepa: dget(fin, "Règlement net 30 jours (SEPA)", null),
      reglement_45_sepa: dget(fin, "Règlement net 45 jours (SEPA)", null),
      commissions: dget(fin, "RFAs / Commissions", null),
      commissions_pkg: dget(fin, "RFAs / Commissions PGK", null),
      nombre_commande: dget(fin, "Nombre de commande", null),
    },
  };

  return context;
}

/**
 * buildReportContextWithLogistics()
 * --------------------------------
 * Variant of buildReportContext() that accepts pre-parsed GEODIS/GLS results
 * instead of file buffers. Used when fetching data from Supabase instead of
 * uploading files.
 */
export async function buildReportContextWithLogistics(
  clientKey: string,
  monthLabel: string,
  geodis: GeodisResult,
  gls: GlsResult
): Promise<ReportContext> {
  const cfg = loadClientConfig(clientKey);
  const parsedMonth = parseMonthLabel(monthLabel);
  const [forecastRows, commissionRates] = await Promise.all([
    readForecast(clientKey),
    readCommissions(clientKey),
  ]);

  const [articles, stockStatus, finData, referencingCommission] = await Promise.all([
    buildArticles(clientKey, cfg, parsedMonth, forecastRows),
    buildStockStatus(cfg, parsedMonth, forecastRows),
    fetchFinancials(cfg.netsuite_parent_id, parsedMonth.dateFrom, parsedMonth.dateTo),
    fetchReferencingCommission(
      cfg.netsuite_parent_id,
      parsedMonth.dateFrom,
      parsedMonth.dateTo,
      commissionRates
    ),
  ]);

  // Use pre-parsed results instead of parsing from buffers
  // (geodis and gls are already GeodisResult / GlsResult)

  const fin: Record<string, unknown> = {
    "Chiffre d'Affaires H.T.": finData.caHtTotal,
    "Nombre de commande": finData.salesOrderCount,
    ...finData.caHtByLabel,
  };
  if (referencingCommission !== null) {
    fin["RFAs / Commissions"] = referencingCommission;
  }

  let orderCountTotal = dget<number | null>(fin, "Nombre de commande", null);
  if (orderCountTotal === null || orderCountTotal === undefined) {
    orderCountTotal = geodis.total_commandes;
  }

  const normalizedGeodis = new Set(
    Array.from(geodis.restaurant_names).map((n) => parsers.normalizeRestaurantName(n))
  );
  const normalizedGls = new Set(
    Array.from(gls.restaurant_names).map((n) => parsers.normalizeRestaurantName(n))
  );
  const unionRestaurants = new Set<string>([...normalizedGeodis, ...normalizedGls]);
  const totalRestaurants = unionRestaurants.size;

  const autoCornerWasabi = geodis.corner_wasabi_count + gls.corner_wasabi_count;
  const totalCornerWasabi = autoCornerWasabi || cfg.corner_wasabi_count_manual || 0;

  const totalCartons = geodis.total_cartons + gls.total_cartons;
  const totalPoids = Math.round((geodis.total_poids + gls.total_poids) * 100) / 100;

  const geodisShare =
    orderCountTotal !== null && orderCountTotal !== undefined && orderCountTotal
      ? Math.round((geodis.total_commandes / orderCountTotal) * 100)
      : null;
  const glsShare = geodisShare !== null ? 100 - geodisShare : null;

  const caActualFin = dget<number | null>(fin, "Chiffre d'Affaires H.T.", null);
  const caActual = caActualFin !== null && caActualFin !== undefined ? caActualFin : 0;

  const caActualForRate = dget<number>(fin, "Chiffre d'Affaires H.T.", 0);
  const performanceRate = articles.ca_forecast
    ? Math.round(((Number(caActualForRate) || 0) / articles.ca_forecast) * 100 * 100) / 100
    : null;

  const context: ReportContext = {
    generated_at: formatDateFr(new Date()),
    client: cfg,
    month_label: monthLabel,
    kpi: {
      sku_count: articles.sku_count,
      pieces_consumed: articles.total_pieces_consumed,
      ca_actual: caActual,
      ca_forecast: articles.ca_forecast,
      performance_rate: performanceRate,
      total_commandes: orderCountTotal,
      total_cartons: totalCartons,
      taux_reussite: geodis.taux_reussite,
    },
    articles: articles.items,
    stock_status: stockStatus,
    logistics: {
      restaurants_livres: totalRestaurants,
      corner_wasabi: totalCornerWasabi,
      total_commandes: orderCountTotal,
      total_cartons: totalCartons,
      total_poids: totalPoids,
      geodis_share: geodisShare,
      gls_share: glsShare,
      geodis: geodis,
      gls: gls,
    },
    financials: {
      ca_total: dget(fin, "Chiffre d'Affaires H.T.", null),
      // Clés alignées sur TERM_LABELS (lib/netsuiteFinancials.ts) — mêmes
      // libellés que dans buildReportContext() plus haut. Les anciennes clés
      // "Règlements/..." ne matchaient jamais caHtByLabel → cartes p.11 à "-".
      reglement_livraison: dget(fin, "Règlement à la livraison", null),
      reglement_commande: dget(fin, "Règlement à la commande", null),
      reglement_30_classique: dget(fin, "Règlement net 30 jours (classique)", null),
      reglement_escompte_2: dget(fin, "Règlement escompte 2% (SEPA)", null),
      reglement_30_sepa: dget(fin, "Règlement net 30 jours (SEPA)", null),
      reglement_45_sepa: dget(fin, "Règlement net 45 jours (SEPA)", null),
      commissions: dget(fin, "RFAs / Commissions", null),
      commissions_pkg: dget(fin, "RFAs / Commissions PGK", null),
      nombre_commande: dget(fin, "Nombre de commande", null),
    },
  };

  return context;
}
