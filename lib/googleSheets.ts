/**
 * lib/googleSheets.ts
 * ===================
 * Lecture du classeur "MBA Green - Prévisionnel Clients" (Google Sheets) :
 *   - un onglet par client (Pokawa, Krousty, Luks Kebab, La Kazdalerie) :
 *     Référence | Mois (YYYY-MM) | Quantité (cartons) | MàJ le
 *   - onglet "Prix"       : Client | Référence | Prix unitaire carton (€ HT) | MàJ le
 *   - onglet "Commission" : Client | Référence | Commission % | MàJ le
 *     (taux en fraction : 0.3 = 30 %)
 *
 * Auth : service account Google, clé JSON en base64 dans
 * GOOGLE_SERVICE_ACCOUNT_KEY_B64 (déjà provisionnée sur Vercel).
 * ⚠️ Le classeur doit être partagé (lecteur) avec le `client_email` du
 * service account, sinon l'API renvoie 403 — l'erreur levée ici le rappelle.
 *
 * ID du classeur : PREVISIONNEL_SHEET_ID (env) avec repli sur l'ID connu.
 */
import { google, sheets_v4 } from "googleapis";

const DEFAULT_SHEET_ID = "1fOrdej1AT9bVbf1-McY3Xtgnf_QPwnFuOekucQAvyog";

/**
 * Classeur "MBA_Green_Demand_Planning_v2.6" — onglet "Forecast_Client" :
 * prévisions HEBDOMADAIRES par SKU (colonnes S1..S53 = semaines ISO de
 * l'année en cours), tous clients confondus. Sert de repli quand un mois
 * n'a pas été importé dans le Prévisionnel Clients (ex. juillet 2026,
 * l'import du 20/07 ne couvrant qu'août→décembre).
 */
const DEFAULT_DEMAND_PLANNING_SHEET_ID = "1s1U_ANuVhp39ADUl0JYbT6w84OQSO98EwVCEENs0MS8";

function demandPlanningSheetId(): string {
  return process.env.DEMAND_PLANNING_SHEET_ID || DEFAULT_DEMAND_PLANNING_SHEET_ID;
}

/** Onglet du Prévisionnel pour chaque clé client de clients.json. */
const CLIENT_TABS: Record<string, string> = {
  POKAWA: "Pokawa",
  KROUSTY: "Krousty",
  LUKS_KEBAB: "Luks Kebab",
  KAZDALERIE: "La Kazdalerie",
  // BLACK_WHITE : pas d'onglet Prévisionnel à ce jour — readForecast passe
  // directement au repli hebdomadaire (Forecast_Client) restreint aux
  // références du catalogue NetSuite de l'enseigne (scopeRefs).
};

/** L'enseigne a-t-elle un onglet Prévisionnel dédié ? (sinon, prévoir un
 * `scopeRefs` pour le repli hebdomadaire de readForecast). */
export function hasForecastTab(clientKey: string): boolean {
  return clientKey in CLIENT_TABS;
}

export interface ForecastRow {
  month: string;
  reference: string;
  quantity_cartons: number;
}

function sheetId(): string {
  return process.env.PREVISIONNEL_SHEET_ID || DEFAULT_SHEET_ID;
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

/**
 * Lit une plage et renvoie les lignes. Deux tolérances :
 *  - valeurs non formatées (nombres JS, pas de séparateurs de milliers) ;
 *  - lignes collées dans une seule cellule avec des tabulations (cas observé
 *    sur l'en-tête de l'onglet "Prix") : re-découpées sur "\t".
 */
async function readRange(range: string, spreadsheetId: string = sheetId()): Promise<unknown[][]> {
  const { sheets, email } = getSheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = (res.data.values ?? []) as unknown[][];
    return rows.map((row) =>
      row.length === 1 && typeof row[0] === "string" && (row[0] as string).includes("\t")
        ? (row[0] as string).split("\t")
        : row
    );
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err.code === 403 || err.code === 404) {
      throw new Error(
        `Google Sheets ${err.code} sur "${range}" : vérifier que le classeur ` +
          `(${spreadsheetId}) est partagé en lecteur avec ${email}.`
      );
    }
    throw new Error(`Google Sheets — échec de lecture de "${range}" : ${err.message ?? String(e)}`);
  }
}

/** "12,34" | "12.34" | 12.34 -> 12.34 ; sinon NaN. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/\s/g, "").replace(",", "."));
  return NaN;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Compare la colonne "Client" des onglets Prix/Commission à la clé client,
 * en tolérant les variantes d'écriture ("Black & White", "BLACK AND WHITE",
 * "BLACK_WHITE" → même enseigne). */
function sameClient(cell: string, clientKey: string): boolean {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/\bAND\b/g, "")
      .replace(/[^A-Z0-9]/g, "");
  return norm(cell) === norm(clientKey);
}

/** Ligne d'en-tête ou vide -> à ignorer. */
function isHeaderOrEmpty(cells: string[]): boolean {
  const first = (cells[0] ?? "").toLowerCase();
  return cells.every((c) => c === "") || first === "client" || first === "référence" || first === "reference";
}

function tabForClient(clientKey: string): string {
  const tab = CLIENT_TABS[clientKey];
  if (!tab) {
    throw new Error(
      `Client '${clientKey}' sans onglet Prévisionnel connu (onglets configurés : ${Object.keys(CLIENT_TABS).join(", ")}).`
    );
  }
  return tab;
}

/** Jeudi de la semaine ISO `week` de l'année `year` (le jeudi détermine le
 * mois d'appartenance d'une semaine ISO). */
function isoWeekThursday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + (week - 1) * 7 + 3);
  return thursday;
}

/**
 * Prévisions hebdomadaires globales (tous clients) du Demand Planning,
 * onglet "Forecast_Client" : Map référence -> Map semaine ISO -> cartons.
 * Les SKU avec Active = FALSE sont ignorés.
 */
async function readGlobalWeeklyForecast(): Promise<Map<string, Map<number, number>>> {
  const rows = await readRange(`'Forecast_Client'!A2:BE`, demandPlanningSheetId());
  const out = new Map<string, Map<number, number>>();
  if (rows.length === 0) return out;

  // Ligne d'en-tête : SKU | Active | Client | Notes | S1 | S2 | ...
  const headerIdx = rows.findIndex((r) => str(r[0]).toUpperCase() === "SKU");
  if (headerIdx === -1) return out;
  const header = rows[headerIdx].map(str);
  const weekCols: { col: number; week: number }[] = [];
  header.forEach((h, col) => {
    const m = /^S(\d{1,2})$/i.exec(h);
    if (m) weekCols.push({ col, week: Number(m[1]) });
  });

  for (const raw of rows.slice(headerIdx + 1)) {
    const cells = raw.map(str);
    const sku = cells[0];
    // Écarte lignes vides et lignes d'info (un vrai SKU n'a pas d'espace).
    if (!sku || /\s/.test(sku)) continue;
    if (cells[1].toUpperCase() === "FALSE") continue;
    const weeks = new Map<number, number>();
    for (const { col, week } of weekCols) {
      const qty = num(raw[col]);
      if (Number.isFinite(qty) && qty !== 0) weeks.set(week, qty);
    }
    if (weeks.size > 0) out.set(sku, weeks);
  }
  return out;
}

/**
 * Prévisions mensuelles (cartons) du client.
 * Source primaire : l'onglet client du Prévisionnel (mensuel, par client).
 * Repli : pour les mois absents de l'onglet (ex. juillet 2026), agrégation
 * mensuelle des prévisions hebdomadaires du Demand Planning
 * ("Forecast_Client", semaines ISO de l'année en cours), restreinte aux
 * références déjà listées pour ce client dans le Prévisionnel.
 * ⚠️ Limite connue : la colonne "Client" de Forecast_Client étant vide, une
 * référence partagée entre clients (ex. LID149PP Pokawa/Krousty) y porte le
 * volume global tous clients — le repli surestime alors ce SKU.
 *
 * `scopeRefs` (optionnel) : univers de références de l'enseigne (typiquement
 * les références du catalogue NetSuite de son niveau de prix). Utilisé comme
 * périmètre du repli hebdomadaire pour les enseignes SANS onglet Prévisionnel
 * (ex. Black & White) — sans lui, ces enseignes n'auraient aucune prévision.
 */
export async function readForecast(
  clientKey: string,
  scopeRefs?: Set<string>
): Promise<ForecastRow[]> {
  const out: ForecastRow[] = [];
  if (hasForecastTab(clientKey)) {
    const rows = await readRange(`'${tabForClient(clientKey)}'!A1:C`);
    for (const raw of rows) {
      const cells = raw.map(str);
      if (isHeaderOrEmpty(cells)) continue;
      const reference = cells[0];
      const month = cells[1];
      const qty = num(raw[2]);
      if (!reference || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(qty)) continue;
      out.push({ reference, month, quantity_cartons: qty });
    }
  } else if (!scopeRefs || scopeRefs.size === 0) {
    throw new Error(
      `Client '${clientKey}' sans onglet Prévisionnel et sans références de repli (scopeRefs) — prévisions indisponibles.`
    );
  }

  // Repli hebdomadaire pour les mois non couverts par le Prévisionnel.
  const clientRefs = out.length > 0 ? new Set(out.map((r) => r.reference)) : (scopeRefs ?? new Set<string>());
  if (clientRefs.size === 0) return out; // pas d'univers client -> pas de repli scoping possible
  const monthsCovered = new Set(out.map((r) => r.month));

  let weekly: Map<string, Map<number, number>>;
  try {
    weekly = await readGlobalWeeklyForecast();
  } catch {
    return out; // le repli ne doit jamais faire échouer la génération
  }

  const year = new Date().getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fallback = new Map<string, number>(); // `${month}|${ref}` -> cartons
  for (const ref of clientRefs) {
    const weeks = weekly.get(ref);
    if (!weeks) continue;
    for (const [week, qty] of weeks) {
      const th = isoWeekThursday(year, week);
      const month = `${th.getUTCFullYear()}-${pad(th.getUTCMonth() + 1)}`;
      if (monthsCovered.has(month)) continue;
      const key = `${month}|${ref}`;
      fallback.set(key, (fallback.get(key) ?? 0) + qty);
    }
  }
  for (const [key, qty] of fallback) {
    const [month, reference] = key.split("|");
    out.push({ reference, month, quantity_cartons: Math.round(qty) });
  }
  return out;
}

/** Prix unitaire carton (€ HT) par référence (onglet "Prix" du Prévisionnel). */
export async function readPrices(clientKey: string): Promise<Map<string, number>> {
  const rows = await readRange(`'Prix'!A1:D`);
  const prices = new Map<string, number>();
  for (const raw of rows) {
    const cells = raw.map(str);
    if (isHeaderOrEmpty(cells)) continue;
    if (!sameClient(cells[0], clientKey)) continue;
    const reference = cells[1];
    const price = num(raw[2]);
    if (!reference || !Number.isFinite(price)) continue;
    prices.set(reference, price);
  }
  return prices;
}

/**
 * Taux de commission de référencement par référence (onglet "Commission",
 * fraction : 0.3 = 30 %). Les taux à 0 sont conservés : une référence listée
 * à 0 % participe au calcul (contribution nulle) au lieu d'être "sans taux".
 */
export async function readCommissions(clientKey: string): Promise<Record<string, number>> {
  const rows = await readRange(`'Commission'!A1:D`);
  const rates: Record<string, number> = {};
  for (const raw of rows) {
    const cells = raw.map(str);
    if (isHeaderOrEmpty(cells)) continue;
    if (!sameClient(cells[0], clientKey)) continue;
    const reference = cells[1];
    const rate = num(raw[2]);
    if (!reference || !Number.isFinite(rate)) continue;
    rates[reference] = rate;
  }
  return rates;
}
