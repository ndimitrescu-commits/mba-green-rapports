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

/** Onglet du Prévisionnel pour chaque clé client de clients.json. */
const CLIENT_TABS: Record<string, string> = {
  POKAWA: "Pokawa",
  KROUSTY: "Krousty",
  LUKS_KEBAB: "Luks Kebab",
  KAZDALERIE: "La Kazdalerie",
};

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
async function readRange(range: string): Promise<unknown[][]> {
  const { sheets, email } = getSheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
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
        `Google Sheets ${err.code} sur "${range}" : vérifier que le classeur Prévisionnel ` +
          `(${sheetId()}) est partagé en lecteur avec ${email}.`
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

/** Prévisions mensuelles (cartons) du client, tous mois présents dans l'onglet. */
export async function readForecast(clientKey: string): Promise<ForecastRow[]> {
  const rows = await readRange(`'${tabForClient(clientKey)}'!A1:C`);
  const out: ForecastRow[] = [];
  for (const raw of rows) {
    const cells = raw.map(str);
    if (isHeaderOrEmpty(cells)) continue;
    const reference = cells[0];
    const month = cells[1];
    const qty = num(raw[2]);
    if (!reference || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(qty)) continue;
    out.push({ reference, month, quantity_cartons: qty });
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
    if (cells[0].toUpperCase() !== clientKey.toUpperCase()) continue;
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
    if (cells[0].toUpperCase() !== clientKey.toUpperCase()) continue;
    const reference = cells[1];
    const rate = num(raw[2]);
    if (!reference || !Number.isFinite(rate)) continue;
    rates[reference] = rate;
  }
  return rates;
}
