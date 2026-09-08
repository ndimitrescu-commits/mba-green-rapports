/**
 * lib/googleSheets.ts
 * ===================
 * Lecture du classeur "Forecast Clients 2026" (Google Sheets) — SOURCE
 * UNIQUE du prévisionnel, partagée avec l'autre outil MBA Green (le Demand
 * Planning) : un onglet par enseigne (POKAWA, BLACK & WHITE, KROUSTY,
 * KAZDALERIE, LUKS KEBAB, ...), colonnes ITEMS | Description | January ..
 * December | Total. Décision Nicolas (08/09/2026) : on remplace l'ancien
 * classeur "MBA Green - Prévisionnel Clients" (onglets par client au format
 * long + onglets "Prix"/"Commission") par celui-ci, pour n'avoir plus qu'une
 * seule source de prévisionnel entre les deux outils.
 *
 * Pas d'onglet "Prix" dans ce classeur : le prix carton du rapport retombe
 * désormais uniquement sur le catalogue NetSuite / prix moyen réalisé (voir
 * netsuiteData.ts) — décision Nicolas, confirmée le 08/09/2026.
 * Pas d'onglet "Commission" non plus : le calcul de la commission de
 * référencement est passé au champ NetSuite (voir netsuiteFinancials.ts,
 * fetchReferencingCommissionUnified) — readPrices/readCommissions ont donc
 * disparu de ce module.
 *
 * ⚠️ Ce classeur est nommé par année ("Forecast Clients 2026") et n'a pas de
 * colonne Année — l'année utilisée pour construire les clés "YYYY-MM" est
 * extraite du TITRE du classeur (regex \b(20\d{2})\b), pour ne pas avoir à
 * retoucher le code lors du renouvellement annuel : il suffira de dupliquer
 * le classeur en "Forecast Clients 2027" (même structure) et de mettre à
 * jour FORECAST_SHEET_ID sur Vercel.
 *
 * Auth : service account Google, clé JSON en base64 dans
 * GOOGLE_SERVICE_ACCOUNT_KEY_B64 (déjà provisionnée sur Vercel).
 * ⚠️ Le classeur doit être partagé (lecteur) avec le `client_email` du
 * service account, sinon l'API renvoie 403 — l'erreur levée ici le rappelle.
 *
 * ID du classeur : FORECAST_SHEET_ID (env) avec repli sur l'ID connu.
 */
import { google, sheets_v4 } from "googleapis";

const DEFAULT_FORECAST_SHEET_ID = "1NOL4v--4TqCWjznykTrQ2dk1Pz1_nrMpydKUp8-Yfm4";

function forecastSheetId(): string {
  return process.env.FORECAST_SHEET_ID || DEFAULT_FORECAST_SHEET_ID;
}

export interface ForecastRow {
  month: string; // "YYYY-MM"
  reference: string;
  quantity_cartons: number;
}

let cachedClient: { sheets: sheets_v4.Sheets; email: string } | null = null;

function getSheetsClient(): { sheets: sheets_v4.Sheets; email: string } {
  if (cachedClient) return cachedClient;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) {
    throw new Error(
      "Variable d'environnement manquante : GOOGLE_SERVICE_ACCOUNT_KEY_B64 (clé JSON du service account Google en base64)."
    );
  }
  let credentials: { client_email?: string };
  try {
    credentials = JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf8"));
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY_B64 illisible : la valeur doit être la clé JSON du service account encodée en base64."
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials: credentials as Record<string, string>,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cachedClient = {
    sheets: google.sheets({ version: "v4", auth }),
    email: credentials.client_email ?? "(client_email inconnu)",
  };
  return cachedClient;
}

function throwFriendly(spreadsheetId: string, context: string, e: unknown): never {
  const { email } = getSheetsClient();
  const err = e as { code?: number; message?: string };
  if (err.code === 403 || err.code === 404) {
    throw new Error(
      `Google Sheets ${err.code} sur ${context} : vérifier que le classeur ` +
        `(${spreadsheetId}) est partagé en lecteur avec ${email}.`
    );
  }
  throw new Error(`Google Sheets — échec (${context}) : ${err.message ?? String(e)}`);
}

interface SheetMeta {
  title: string;
  year: number;
  tabTitles: string[];
}

let cachedMeta: SheetMeta | null = null;

/** Compare deux libellés d'enseigne en tolérant les variantes d'écriture
 * ("Black & White", "BLACK AND WHITE", "BLACK_WHITE" → même enseigne). */
function normalize(s: string): string {
  return s
    .toUpperCase()
    .replace(/\bAND\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** Titre du classeur + liste des onglets (mis en cache le temps de la
 * requête). L'année du prévisionnel est extraite du titre du classeur
 * (ex. "Forecast Clients 2026" -> 2026). */
async function getSheetMeta(): Promise<SheetMeta> {
  if (cachedMeta) return cachedMeta;
  const { sheets } = getSheetsClient();
  const spreadsheetId = forecastSheetId();
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties.title",
    });
    const title = res.data.properties?.title ?? "";
    const yearMatch = /\b(20\d{2})\b/.exec(title);
    const tabTitles = (res.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => !!t);
    cachedMeta = {
      title,
      year: yearMatch ? Number(yearMatch[1]) : new Date().getUTCFullYear(),
      tabTitles,
    };
    return cachedMeta;
  } catch (e) {
    throwFriendly(spreadsheetId, "liste des onglets", e);
  }
}

/** Onglet du classeur correspondant à l'enseigne (match sur
 * clients.json:breakdown_sheet_name, tolérant aux variantes d'écriture). */
async function tabForClient(clientKey: string, breakdownSheetName: string): Promise<string | null> {
  const meta = await getSheetMeta();
  const target = normalize(breakdownSheetName || clientKey);
  return meta.tabTitles.find((t) => normalize(t) === target) ?? null;
}

/** Toute enseigne présente dans lib/clients.json est considérée comme ayant
 * un prévisionnel dans ce classeur — l'absence réelle de l'onglet est
 * détectée (et journalisée) au moment de la lecture, sans faire échouer le
 * rapport (voir readForecast). */
export function hasForecastTab(_clientKey: string): boolean {
  return true;
}

// Préfixes à 3 lettres : le classeur mélange noms complets ("January") et
// abréviations ("Aug", "Sept", "Oct", "Nov", "Dec" — vérifié sur l'onglet
// Pokawa) ; matcher sur les 3 premières lettres couvre les deux cas.
const MONTHS_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/\s/g, "").replace(",", "."));
  return NaN;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

async function readRange(range: string): Promise<unknown[][]> {
  const { sheets } = getSheetsClient();
  const spreadsheetId = forecastSheetId();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (res.data.values ?? []) as unknown[][];
  } catch (e) {
    throwFriendly(spreadsheetId, `"${range}"`, e);
  }
}

/**
 * Prévisions mensuelles (cartons) du client pour l'année du classeur, à
 * partir de son onglet "ITEMS | Description | January .. December | Total".
 * `scopeRefs` est conservé pour compatibilité de signature (ancien repli
 * hebdomadaire, désormais inutile puisque chaque enseigne a son onglet dans
 * ce classeur) mais n'est plus utilisé.
 */
/**
 * Parseur pur (sans appel réseau) de la table brute d'un onglet enseigne :
 * ligne d'en-tête "ITEMS | Description | January .. December | Total" suivie
 * d'une ligne par référence. Extrait pour être testable indépendamment de
 * l'accès Google Sheets (voir scripts/test-forecast-parse.ts).
 */
export function parseWideForecastRows(rows: unknown[][], year: number): ForecastRow[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((c) => str(c).toLowerCase());
  const monthCols: { col: number; month: number }[] = [];
  header.forEach((h, col) => {
    const idx = MONTHS_EN.indexOf(h.slice(0, 3));
    if (idx !== -1) monthCols.push({ col, month: idx + 1 });
  });
  if (monthCols.length === 0) {
    throw new Error(`En-têtes de mois introuvables (attendu "January".."December").`);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const out: ForecastRow[] = [];
  for (const raw of rows.slice(1)) {
    const reference = str(raw[0]);
    if (!reference || ["ITEMS", "TOTAL"].includes(reference.toUpperCase())) continue;
    for (const { col, month } of monthCols) {
      const qty = num(raw[col]);
      if (!Number.isFinite(qty)) continue;
      out.push({ reference, month: `${year}-${pad(month)}`, quantity_cartons: qty });
    }
  }
  return out;
}

export async function readForecast(clientKey: string, _scopeRefs?: Set<string>): Promise<ForecastRow[]> {
  const cfg = (await import("./clients.json")).default as Record<string, { breakdown_sheet_name?: string }>;
  const breakdownName = cfg[clientKey]?.breakdown_sheet_name ?? clientKey;
  const meta = await getSheetMeta();
  const tab = await tabForClient(clientKey, breakdownName);
  if (!tab) {
    throw new Error(
      `Aucun onglet "${breakdownName}" trouvé dans le classeur Forecast Clients (onglets disponibles : ${meta.tabTitles.join(", ")}).`
    );
  }
  const rows = await readRange(`'${tab}'!A1:P`);
  return parseWideForecastRows(rows, meta.year);
}
