/**
 * parsers.ts
 * ----------
 * TypeScript port of the Python parsers.py. Reads each raw source file
 * (Excel / CSV, provided as ArrayBuffer/Buffer since this runs in a
 * serverless API route rather than off local disk) and turns it into
 * clean, client-scoped data structures.
 */
import * as XLSX from "xlsx";
import Papa from "papaparse";
import type {
  ArticleItem,
  ArticlePerformance,
  ClientConfig,
  CountryStats,
  DelayBuckets,
  FinancialsResult,
  GeodisResult,
  GlsResult,
  StockItem,
  StockWeek,
} from "./types";

// ---------------------------------------------------------------------------
// normalize_restaurant_name
// ---------------------------------------------------------------------------
export function normalizeRestaurantName(name: string | null | undefined): string {
  let n = (name || "").toUpperCase();
  n = n.replace(/\bRESTAURANT\b/g, "");
  n = n.replace(/[^A-Z0-9]/g, "");
  return n.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sheetToRows(buffer: ArrayBuffer, sheetIndex = 0, sheetName?: string): unknown[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const name = sheetName ?? wb.SheetNames[sheetIndex];
  const ws = wb.Sheets[name];
  if (!ws) {
    throw new Error(`Sheet '${name}' not found. Available sheets: ${wb.SheetNames.join(", ")}`);
  }
  // header:1 => array-of-arrays, raw values (like openpyxl values_only=True)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  });
  return rows;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** Parses "DD/MM/YYYY" (GEODIS "Départ"/"Date"), "DD.MM.YYYY" (GLS "Date jour"),
 * or a JS Date already produced by SheetJS's cellDates:true. Returns null on
 * anything unparseable rather than throwing -- date columns are only used
 * for secondary stats (moyenne/jours, delay buckets), never for totals. */
function parseDateFlexible(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      const dt = new Date(Number(y), Number(mo) - 1, Number(d));
      return isNaN(dt.getTime()) ? null : dt;
    }
  }
  return null;
}

/** Nombre de jours ouvrés (lundi-vendredi) distincts parmi une liste de dates.
 * Confirmé contre les fichiers réels Février 2026 : GEODIS 252 commandes /
 * 20 jours ouvrés = 12,6 ; GLS 276 commandes / 20 jours ouvrés = 13,8 --
 * les deux correspondent exactement aux valeurs "Moyenne/jours" du rapport
 * de référence. */
function countDistinctWeekdays(dates: (Date | null)[]): number {
  const keys = new Set<string>();
  for (const d of dates) {
    if (!d) continue;
    const day = d.getDay(); // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) continue;
    keys.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return keys.size;
}

/** "Corner Wasabi" restaurants are identifiable directly in the source
 * files: their destination name contains "WASABI" (e.g. "POKAWA WASABI
 * AGEN"). Confirmed against the real Février 2026 files: 0 such names in
 * GEODIS, 2 distinct ones in GLS ("POKAWA WASABI AGEN", "POKAWA WASABI
 * CAPBRETON") -- matches the reference report's "Dont Corner Wasabi: 2"
 * exactly. Replaces the manual clients.json count where possible. */
function countCornerWasabi(names: Iterable<string>): number {
  const set = new Set<string>();
  for (const n of names) {
    if (/WASABI/i.test(n)) set.add(n.toUpperCase());
  }
  return set.size;
}

/** Date de Pâques (algorithme de Gauss/Meeus) -- sert de base aux jours
 * fériés mobiles français (Lundi de Pâques = Pâques+1, Ascension =
 * Pâques+39, Lundi de Pentecôte = Pâques+50). */
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

/** Jours fériés légaux français (fixes + mobiles dérivés de Pâques) pour
 * l'année de la date fournie. Utilisé pour exclure les jours fériés du
 * calcul "jours ouvrés" -- demandé par Nicolas pour la règle Express
 * "livré en 24h" (qui doit exclure week-ends ET jours fériés). */
function frenchHolidays(year: number): Set<string> {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const set = new Set<string>();
  const fixed: [number, number][] = [
    [0, 1], // Jour de l'an
    [4, 1], // Fête du travail
    [4, 8], // Victoire 1945
    [6, 14], // Fête nationale
    [7, 15], // Assomption
    [10, 1], // Toussaint
    [10, 11], // Armistice
    [11, 25], // Noël
  ];
  for (const [month, day] of fixed) set.add(key(new Date(year, month, day)));
  const easter = easterDate(year);
  const addOffset = (offset: number) => {
    const d = new Date(easter);
    d.setDate(d.getDate() + offset);
    set.add(key(d));
  };
  addOffset(1); // Lundi de Pâques
  addOffset(39); // Ascension
  addOffset(50); // Lundi de Pentecôte
  return set;
}

function isFrenchHoliday(d: Date): boolean {
  return frenchHolidays(d.getFullYear()).has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
}

/** Nombre de jours ouvrés (hors week-ends ET jours fériés français) entre
 * deux dates, en comptant à partir du lendemain de `start` jusqu'à `end`
 * inclus. Ex: vendredi -> lundi suivant = 1 (seul le lundi est ouvré,
 * samedi/dimanche exclus) ; lundi -> mardi = 1. */
function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  cur.setDate(cur.getDate() + 1);
  while (cur.getTime() <= last.getTime()) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6 && !isFrenchHoliday(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1. Article performance (Prevision vs Consommation) -- "XXX_DATA_FEB" files
// ---------------------------------------------------------------------------
export function parseArticlePerformance(buffer: ArrayBuffer): ArticlePerformance {
  const rows = sheetToRows(buffer, 0);
  const headerRow = rows[0] || [];
  const header = headerRow.map((h) => (h !== null && h !== undefined ? String(h).trim() : ""));

  function col(...names: string[]): number | null {
    for (const n of names) {
      for (let i = 0; i < header.length; i++) {
        if (header[i].toLowerCase().startsWith(n.toLowerCase())) {
          return i;
        }
      }
    }
    return null;
  }

  const cItem = col("Article");
  const cDesc = col("Description");
  const cPrev = col("Prévision", "Prévisions");
  const cCons = col("Cons.");
  const cCaPrev = col("Prévison - C.A", "Prévision - C.A");
  const cCaCons = col("Consommation - C.A");

  if (cItem === null) {
    throw new Error("Colonne 'Article' introuvable dans le fichier DATA");
  }

  const items: ArticleItem[] = [];
  let totalPrev = 0;
  let totalCons = 0;
  let totalCaPrev = 0;
  let totalCaCons = 0;

  for (const r of rows.slice(1)) {
    if (!r || r[cItem] === null || r[cItem] === undefined) continue;
    if (String(r[cItem]).trim().toLowerCase() === "total") continue;

    const prev = cPrev !== null ? r[cPrev] ?? 0 : 0;
    const cons = cCons !== null ? r[cCons] ?? 0 : 0;
    const caPrev = cCaPrev !== null ? r[cCaPrev] ?? 0 : 0;
    const caCons = cCaCons !== null ? r[cCaCons] ?? 0 : 0;

    const prevNum = toNum(prev);
    const consNum = toNum(cons);
    const caPrevNum = toNum(caPrev);
    const caConsNum = toNum(caCons);

    const rate = prevNum ? consNum / prevNum : null;

    items.push({
      code: String(r[cItem]),
      description: cDesc !== null ? String(r[cDesc] ?? "") : "",
      forecast: round(prevNum, 1),
      consumption: round(consNum, 1),
      rate: rate !== null ? round(rate * 100, 0) : null,
      ca_forecast: caPrevNum,
      ca_consumption: caConsNum,
    });

    totalPrev += prevNum;
    totalCons += consNum;
    totalCaPrev += caPrevNum;
    totalCaCons += caConsNum;
  }

  items.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  return {
    items,
    sku_count: items.length,
    total_pieces_consumed: totalCons,
    ca_forecast: round(totalCaPrev, 2),
    ca_actual: round(totalCaCons, 2),
    performance_rate: totalCaPrev ? round((totalCaCons / totalCaPrev) * 100, 2) : null,
  };
}

// ---------------------------------------------------------------------------
// 2. Weekly stock status -- "Client_Report_Breakdown" workbook, one sheet/client
// ---------------------------------------------------------------------------
export function parseStockStatus(buffer: ArrayBuffer, sheetName: string, maxItems = 6): StockItem[] {
  const rows = sheetToRows(buffer, 0, sheetName);

  const weekHeaders = rows[1] || [];
  const weekCols: [number, number][] = [];
  weekHeaders.forEach((v, i) => {
    if (typeof v === "number") {
      weekCols.push([i, Math.trunc(v)]);
    }
  });

  const items: StockItem[] = [];
  let current: StockItem | null = null;

  for (const r of rows.slice(2)) {
    if (!r) continue;
    const label = r[0];
    let kind = r[1];
    if (label !== null && label !== undefined && label !== "") {
      if (current) items.push(current);
      current = { code: String(label), on_hand: (r[2] as number) ?? null, weeks: [] };
      kind = "Forecast";
    }
    if (current === null) continue;
    if (kind === "Forecast" || kind === "Stock" || kind === "In Transit") {
      for (const [colIdx, weekNo] of weekCols) {
        const val = colIdx < r.length ? r[colIdx] : null;
        let weekEntry: StockWeek | undefined = current.weeks.find((w) => w.week === weekNo);
        if (!weekEntry) {
          weekEntry = { week: weekNo };
          current.weeks.push(weekEntry);
        }
        const key = kind === "Forecast" ? "forecast" : kind === "Stock" ? "stock" : "in_transit";
        const numeric = typeof val === "number";
        weekEntry[key] = numeric ? Math.round(val as number) : (val as number | null);
      }
    }
  }
  if (current) items.push(current);

  for (const it of items) {
    it.weeks.sort((a, b) => a.week - b.week);
  }

  return items.slice(0, maxItems);
}

/** Catégorise une ligne GEODIS d'après le texte de la colonne "Prestation"
 * (ex: "Messagerie France Standard", "Express France J+1", "Affrètement
 * France"). Confirmé contre le fichier réel Février 2026 : c'est la colonne
 * la plus fiable pour distinguer Express / Affrètement / Messagerie
 * (le "Code produit" à 3 lettres encode la même info mais de façon moins
 * lisible et potentiellement variable d'un mois à l'autre). */
function categorizePrestation(prestation: unknown): "express" | "affretement" | "messagerie" {
  const p = String(prestation ?? "").toLowerCase();
  if (p.includes("express")) return "express";
  if (p.includes("affrètement") || p.includes("affretement")) return "affretement";
  return "messagerie";
}

/** Minutes since midnight, from a GEODIS "Heure" cell -- which SheetJS may
 * hand back as a JS Date (cellDates:true), a raw Excel time fraction
 * (0..1), or a "HH:MM"/"HH:MM:SS" string depending on how the cell was
 * formatted in the source workbook. Returns null if unparseable. */
function extractTimeMinutes(v: unknown): number | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getHours() * 60 + v.getMinutes();
  }
  if (typeof v === "number" && v >= 0 && v < 1) {
    return Math.round(v * 24 * 60);
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. GEODIS export file
// ---------------------------------------------------------------------------
export function parseGeodis(buffer: ArrayBuffer, clientCfg: ClientConfig): GeodisResult {
  const rows = sheetToRows(buffer, 0);

  // The header row position varies between GEODIS exports (some have a
  // banner/title row before it, others -- like the real Février 2026 file --
  // have it directly on row 0). Search the first few rows for whichever one
  // actually contains the required "Nom du destinataire" column instead of
  // hardcoding row 1, which silently produced 0 matches (undefined column
  // index) against the real file.
  const REQUIRED_COL = "Nom du destinataire";
  const SEARCH_ROWS = Math.min(5, rows.length);
  let headerRowIdx = 0;
  for (let r = 0; r < SEARCH_ROWS; r++) {
    const row = (rows[r] || []) as unknown[];
    if (row.some((v) => String(v ?? "").trim() === REQUIRED_COL)) {
      headerRowIdx = r;
      break;
    }
  }
  const header = (rows[headerRowIdx] || []) as unknown[];
  const data = rows.slice(headerRowIdx + 1);

  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h !== null && h !== undefined) idx[String(h)] = i;
  });

  const names = clientCfg.restaurant_name_matches;
  const aliases = new Set((clientCfg.restaurant_name_aliases || []).map((a) => normalizeRestaurantName(a)));
  const normalizedNames = names.map((n) => normalizeRestaurantName(n));

  function isClientRow(row: unknown[]): boolean {
    const dest = String(row[idx["Nom du destinataire"]] ?? "");
    const normalized = normalizeRestaurantName(dest);
    if (aliases.has(normalized)) return true;
    return normalizedNames.some((n) => normalized.includes(n));
  }

  const clientRows = data.filter((r) => r && isClientRow(r));

  let totalCartons = 0;
  for (const r of clientRows) {
    const ref1 = String(r[idx["Référence1"]] ?? "");
    const m = ref1.match(/-\s*(\d+)/);
    totalCartons += m ? parseInt(m[1], 10) : 0;
  }

  const totalPoids = clientRows.reduce((sum, r) => {
    const v = r[idx["Poids"]];
    return v ? sum + toNum(v) : sum;
  }, 0);

  const restaurants = new Set<string>(clientRows.map((r) => String(r[idx["Nom du destinataire"]])));
  const delivered = clientRows.filter((r) => r[idx["Etat"]] === "Livrée");

  const byCountry: Record<string, unknown[][]> = {};
  for (const r of clientRows) {
    const pays = String(r[idx["Pays du destinataire"]] ?? "");
    if (!byCountry[pays]) byCountry[pays] = [];
    byCountry[pays].push(r);
  }

  const dateLivraisonCol = idx["Date"];

  /** Ecart en jours calendaires entre "Départ" et "Date" (livraison).
   * Confirmé par Nicolas avec un exemple réel : Départ 02/02, livré 04/02
   * (écart de 2 jours) = "A pour C" (48h). Donc 1 jour = A->B (24h),
   * 2 jours = A->C (48h), 3 jours = A->D (72h). */
  function computeDelayBuckets(rowsArr: unknown[][]): DelayBuckets {
    const livrees = rowsArr.filter((r) => r[idx["Etat"]] === "Livrée");
    let le48 = 0;
    let j72 = 0;
    let plus72 = 0;
    let counted = 0;
    for (const r of livrees) {
      const depart = parseDateFlexible(r[departCol]);
      const arrivee = parseDateFlexible(r[dateLivraisonCol]);
      if (!depart || !arrivee) continue;
      const diffDays = Math.round((arrivee.getTime() - depart.getTime()) / 86400000);
      counted++;
      if (diffDays <= 2) le48++;
      else if (diffDays === 3) j72++;
      else plus72++;
    }
    return {
      total: counted,
      le_48h: le48,
      le_48h_rate: counted ? round((le48 / counted) * 100, 2) : null,
      j_72h: j72,
      j_72h_rate: counted ? round((j72 / counted) * 100, 2) : null,
      plus_72h: plus72,
      plus_72h_rate: counted ? round((plus72 / counted) * 100, 2) : null,
    };
  }

  function countryStats(rowsArr: unknown[][], withBreakdown = false, withDelayBuckets = false): CountryStats {
    const total = rowsArr.length;
    const liv = rowsArr.filter((r) => r[idx["Etat"]] === "Livrée").length;
    const stats: CountryStats = {
      total_commandes: total,
      livrees: liv,
      rate: total ? Math.round((liv / total) * 100) : null,
    };
    if (withBreakdown) {
      const breakdown: Record<string, number> = {};
      for (const r of rowsArr) {
        const p = String(r[idx["Pays du destinataire"]] ?? "");
        breakdown[p] = (breakdown[p] || 0) + 1;
      }
      stats.by_country = breakdown;
    }
    if (withDelayBuckets) {
      stats.delay_buckets = computeDelayBuckets(rowsArr);
    }
    return stats;
  }

  const belgiqueLuxRows = [
    ...(byCountry["BE"] || []),
    ...(byCountry["LU"] || []),
    ...(byCountry["CH"] || []),
  ];

  // Express / Affrètement / Messagerie split via the "Prestation" column.
  const byService: Record<"express" | "affretement" | "messagerie", unknown[][]> = {
    express: [],
    affretement: [],
    messagerie: [],
  };
  for (const r of clientRows) {
    byService[categorizePrestation(r[idx["Prestation"]])].push(r);
  }
  function serviceStats(rowsArr: unknown[][]) {
    const total = rowsArr.length;
    const liv = rowsArr.filter((r) => r[idx["Etat"]] === "Livrée").length;
    return { total_commandes: total, livrees: liv, rate: total ? Math.round((liv / total) * 100) : null };
  }

  // Moyenne/jours = total commandes / nb de jours ouvrés distincts d'expédition.
  const departCol = idx["Départ"] ?? idx["Date"];
  const departDates = clientRows.map((r) => parseDateFlexible(r[departCol]));
  const nbJoursOuvres = countDistinctWeekdays(departDates);
  const moyenneJours = nbJoursOuvres ? round(clientRows.length / nbJoursOuvres, 1) : null;
  const moyenneCmdsCartons = clientRows.length ? round(totalCartons / clientRows.length, 2) : null;
  const moyenneCmdsPoids = clientRows.length ? round(totalPoids / clientRows.length, 2) : null;

  const cornerWasabiCount = countCornerWasabi(restaurants);

  // Respect horaires : parmi les livraisons "Messagerie France", part de
  // celles remises avant 12h / 11h (colonne "Heure"). <=12:00 confirmé
  // exact contre la référence ; <=11:00 est une approximation (~1pt d'écart,
  // cause exacte non identifiée -- possiblement un cas limite arrondi
  // différemment côté GEODIS).
  const heureCol = idx["Heure"];
  const messagerieFranceLivrees = byService.messagerie.filter(
    (r) => r[idx["Pays du destinataire"]] === "FR" && r[idx["Etat"]] === "Livrée"
  );
  function respectHoraires(thresholdMinutes: number): number | null {
    if (!messagerieFranceLivrees.length || heureCol === undefined) return null;
    const onTime = messagerieFranceLivrees.filter((r) => {
      const mins = extractTimeMinutes(r[heureCol]);
      return mins !== null && mins <= thresholdMinutes;
    }).length;
    return round((onTime / messagerieFranceLivrees.length) * 100, 2);
  }

  // Livraison "conforme" = avant 12h OU après 14h (exclut service de midi 12h-14h)
  function respectHorairesConformes(): number | null {
    if (!messagerieFranceLivrees.length || heureCol === undefined) return null;
    const conforme = messagerieFranceLivrees.filter((r) => {
      const mins = extractTimeMinutes(r[heureCol]);
      return mins !== null && (mins < 12 * 60 || mins >= 14 * 60);
    }).length;
    return round((conforme / messagerieFranceLivrees.length) * 100, 2);
  }

  // Express "livré en 24h" : confirmé par Nicolas -- doit se baser sur les
  // jours OUVRÉS (hors week-ends ET jours fériés français), pas sur l'écart
  // calendaire brut. 1 jour ouvré sans traversée de week-end/férié = 24h
  // quelle que soit l'heure. 1 jour ouvré AVEC traversée d'un week-end/férié
  // (ex: départ vendredi, livré lundi) = 24h seulement si livré avant 11:00
  // ce jour-là -- confirmé donner 19/20 = 95% sur le fichier réel de février.
  function computeExpressDelay(rowsArr: unknown[][]) {
    const livrees = rowsArr.filter((r) => r[idx["Etat"]] === "Livrée");
    let within24 = 0;
    let counted = 0;
    for (const r of livrees) {
      const depart = parseDateFlexible(r[departCol]);
      const arrivee = parseDateFlexible(r[dateLivraisonCol]);
      if (!depart || !arrivee) continue;
      counted++;
      const businessDays = businessDaysBetween(depart, arrivee);
      const rawCalendarDays = Math.round((arrivee.getTime() - depart.getTime()) / 86400000);
      let within = false;
      if (businessDays === 1) {
        if (rawCalendarDays === 1) {
          within = true;
        } else if (heureCol !== undefined) {
          const mins = extractTimeMinutes(r[heureCol]);
          within = mins !== null && mins <= 11 * 60;
        }
      }
      if (within) within24++;
    }
    return { total: counted, within_24h: within24, rate: counted ? round((within24 / counted) * 100, 2) : null };
  }

  return {
    restaurant_names: restaurants,
    restaurants_livres: restaurants.size,
    total_commandes: clientRows.length,
    total_cartons: totalCartons,
    // L'export Excel GEODIS ne porte pas de colonne palettes exploitable ici —
    // la voie live (Supabase shipments.nb_palettes) fournit la vraie valeur.
    total_palettes: 0,
    total_poids: round(totalPoids, 2),
    taux_reussite: clientRows.length ? Math.round((delivered.length / clientRows.length) * 100) : null,
    france: countryStats(byCountry["FR"] || [], false, true),
    belgique_lux: countryStats(belgiqueLuxRows, true, true),
    express: serviceStats(byService.express),
    express_delay: computeExpressDelay(byService.express),
    affretement: serviceStats(byService.affretement),
    moyenne_jours: moyenneJours,
    moyenne_cmds_cartons: moyenneCmdsCartons,
    moyenne_cmds_poids: moyenneCmdsPoids,
    corner_wasabi_count: cornerWasabiCount,
    respect_horaires_12h: respectHoraires(12 * 60),
    respect_horaires_11h: respectHoraires(11 * 60),
    respect_horaires_conformes: respectHorairesConformes(),
  };
}

// ---------------------------------------------------------------------------
// 4. GLS export file (CSV, semicolon or comma separated)
// ---------------------------------------------------------------------------
export function parseGls(buffer: ArrayBuffer, clientCfg: ClientConfig): GlsResult {
  const text = new TextDecoder("utf-8").decode(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    // auto-detect delimiter (comma or semicolon), mirroring pandas sep=None
    delimiter: "",
  });

  const nameCol = "adresse de destination NOM";
  const weightCol = "Poids pour le traitement commande vente";
  const paysCol = "Pays";

  const names = clientCfg.restaurant_name_matches;
  const aliases = new Set((clientCfg.restaurant_name_aliases || []).map((a) => normalizeRestaurantName(a)));
  const normalizedNames = names.map((n) => normalizeRestaurantName(n));

  const clientRows = (parsed.data || []).filter((row) => {
    const v = row[nameCol];
    if (v === undefined || v === null || v === "") return false;
    const normalized = normalizeRestaurantName(v);
    if (aliases.has(normalized)) return true;
    return normalizedNames.some((n) => normalized.includes(n));
  });

  let totalPoids = 0;
  for (const row of clientRows) {
    const raw = row[weightCol];
    if (raw !== undefined && raw !== null && raw !== "") {
      totalPoids += toNum(String(raw).replace(",", "."));
    }
  }

  const restaurantNames = new Set<string>(clientRows.map((r) => r[nameCol]));

  const byCountry: Record<string, number> = {};
  for (const row of clientRows) {
    const pays = row[paysCol];
    if (pays === undefined || pays === null || pays === "") continue;
    byCountry[pays] = (byCountry[pays] || 0) + 1;
  }

  // total_commandes : nb de valeurs distinctes de "Client Référence 2"
  // (confirmé -- 276 pour Pokawa Février 2026, correspond exactement à la
  // référence ; le fichier GLS a une ligne par colis, pas par commande, d'où
  // le besoin de dédupliquer sur la référence commande plutôt que de
  // compter les lignes).
  const orderRefCol = "Client Référence 2";
  const orderRefs = new Set<string>();
  for (const row of clientRows) {
    const ref = row[orderRefCol];
    if (ref !== undefined && ref !== null && ref !== "") orderRefs.add(String(ref).trim());
  }
  const totalCommandes = orderRefs.size || null;

  // Moyenne/jours = total commandes / nb de jours ouvrés distincts
  // d'expédition (colonne "Date jour", format DD.MM.YYYY).
  const dateCol = "Date jour";
  const shipDates = clientRows.map((r) => parseDateFlexible(r[dateCol]));
  const nbJoursOuvres = countDistinctWeekdays(shipDates);
  const moyenneJours =
    nbJoursOuvres && totalCommandes ? round(totalCommandes / nbJoursOuvres, 1) : null;
  const moyenneCmdsCartons = totalCommandes ? round(clientRows.length / totalCommandes, 2) : null;
  const moyenneCmdsPoids = totalCommandes ? round(totalPoids / totalCommandes, 2) : null;

  const cornerWasabiCount = countCornerWasabi(restaurantNames);

  return {
    restaurant_names: restaurantNames,
    restaurants_livres: restaurantNames.size,
    total_commandes: totalCommandes,
    total_cartons: clientRows.length,
    total_poids: round(totalPoids, 2),
    by_country: byCountry,
    moyenne_jours: moyenneJours,
    moyenne_cmds_cartons: moyenneCmdsCartons,
    moyenne_cmds_poids: moyenneCmdsPoids,
    corner_wasabi_count: cornerWasabiCount,
  };
}

// ---------------------------------------------------------------------------
// 5. Financial summary -- "Rapports_Clients_-_Mensuel_" workbook
// ---------------------------------------------------------------------------
export function parseFinancials(
  buffer: ArrayBuffer,
  monthSheet: string,
  clientColumn: string
): FinancialsResult {
  const rows = sheetToRows(buffer, 0, monthSheet);
  const target = clientColumn.trim().toLowerCase();

  // The original engine assumed the header (client names) sits on the 2nd row
  // (index 1) of the sheet. Real-world workbooks vary (title rows, spacer
  // rows, extra banner rows), so scan the first several rows for whichever
  // one actually contains the client column, instead of hardcoding index 1.
  const SEARCH_ROWS = Math.min(10, rows.length);
  let headerRowIdx: number | null = null;
  let colIdx: number | null = null;
  for (let r = 0; r < SEARCH_ROWS; r++) {
    const row = (rows[r] || []) as unknown[];
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (v && String(v).trim().toLowerCase() === target) {
        headerRowIdx = r;
        colIdx = i;
        break;
      }
    }
    if (headerRowIdx !== null) break;
  }

  if (headerRowIdx === null || colIdx === null) {
    const preview = rows
      .slice(0, SEARCH_ROWS)
      .map((row, i) => {
        const cells = ((row || []) as unknown[])
          .map((v) => (v !== null && v !== undefined ? String(v).trim() : ""))
          .filter((v) => v !== "");
        return `  ligne ${i + 1}: ${cells.length ? cells.join(" | ") : "(vide)"}`;
      })
      .join("\n");
    throw new Error(
      `Client column '${clientColumn}' not found in sheet '${monthSheet}'. Contenu des ${SEARCH_ROWS} premières lignes de l'onglet (pour diagnostic) :\n${preview}`
    );
  }

  const result: FinancialsResult = {};
  for (const r of rows.slice(headerRowIdx + 1)) {
    if (!r) continue;
    const label = r[0];
    if (!label) continue;
    const value = r[colIdx];
    result[String(label).trim()] = value;
  }

  return result;
}
