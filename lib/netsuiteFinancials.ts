/**
 * lib/netsuiteFinancials.ts
 * =========================
 * Données financières live depuis NetSuite via SuiteQL (REST) avec
 * Token-Based Authentication (OAuth 1.0a, HMAC-SHA256).
 *
 * Variables d'environnement requises :
 *   NETSUITE_ACCOUNT_ID       ex. 7402717
 *   NETSUITE_CONSUMER_KEY / NETSUITE_CONSUMER_SECRET   (Integration record)
 *   NETSUITE_TOKEN_ID / NETSUITE_TOKEN_SECRET          (Access Token)
 *
 * Règles validées sur les données réelles (juillet 2026) :
 * - CA HT = somme des lignes de factures (CustInvc) hors taxe et hors mainline
 *   du mois, clients = enfants du parent NetSuite du client (ex. 188607).
 * - La ventilation "Règlements" du rapport = CA HT groupé par condition de
 *   règlement (term). La somme des règlements = CA HT total (vérifié sur la
 *   référence Février 2026 : 41 993,52 + 163 369,55 + 6 084,18 + 12 867,92
 *   = 224 315,17 exactement).
 * - "Nombre de commande" = nb de Sales Orders du mois.
 */

import crypto from "crypto";

export interface NetsuiteFinancials {
  caHtTotal: number | null;
  salesOrderCount: number | null;
  /** CA HT ventilé par libellé (clés attendues par compute.ts). */
  caHtByLabel: Record<string, number>;
}

/** Mapping term NetSuite -> libellé du rapport (validé sur Février/Juillet 2026). */
const TERM_LABELS: Record<number, string> = {
  2: "Règlement net 30 jours (SEPA)", // "Net 30" (prélèvement SEPA)
  10: "Règlement escompte 2% (SEPA)", // "Prélèvement" (escompte 2%)
  9: "Règlement net 45 jours (SEPA)", // "Net 45"
  13: "Règlement net 30 jours (classique)", // "Net 30 (virement)"
};

// ---------------------------------------------------------------------------
// Client SuiteQL (OAuth 1.0a TBA)
// ---------------------------------------------------------------------------
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement NetSuite manquante : ${name}`);
  return v;
}

function pctEnc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// ---------------------------------------------------------------------------
// Garde-fou de concurrence : l'integration record NetSuite est plafonné à
// 4 requêtes simultanées (Setup > Integration > Integration Governance).
// La génération d'un rapport lance ~10 requêtes SuiteQL en parallèle
// (financier, conso, prix, stock, transit, commission...) → 429 sans limite.
// On sérialise à MAX_CONCURRENT (marge sous le plafond), avec file d'attente,
// et on retente avec backoff si un 429 passe quand même.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT = 3;
let activeRequests = 0;
const requestQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => requestQueue.push(resolve));
}

function releaseSlot(): void {
  const next = requestQueue.shift();
  if (next) next(); // le slot passe directement au suivant
  else activeRequests--;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function suiteql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  await acquireSlot();
  try {
    return await suiteqlInner<T>(query);
  } finally {
    releaseSlot();
  }
}

async function suiteqlInner<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const account = env("NETSUITE_ACCOUNT_ID");
  const consumerKey = env("NETSUITE_CONSUMER_KEY");
  const consumerSecret = env("NETSUITE_CONSUMER_SECRET");
  const tokenId = env("NETSUITE_TOKEN_ID");
  const tokenSecret = env("NETSUITE_TOKEN_SECRET");
  const realm = account.toUpperCase().replace("-", "_");
  const host = `${account.toLowerCase().replace("_", "-")}.suitetalk.api.netsuite.com`;

  const rows: T[] = [];
  let url: string | null = `https://${host}/services/rest/query/v1/suiteql?limit=1000`;

  while (url) {
    let res: Response | null = null;
    const maxTries = 4;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      // La signature est reconstruite à chaque tentative (nonce/timestamp frais).
      const oauth: Record<string, string> = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString("hex"),
        oauth_signature_method: "HMAC-SHA256",
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_token: tokenId,
        oauth_version: "1.0",
      };
      // Base string : méthode + URL sans query + params (query + oauth) triés
      const u = new URL(url);
      const params: [string, string][] = [...u.searchParams.entries(), ...Object.entries(oauth)];
      const paramStr = params
        .map(([k, v]) => [pctEnc(k), pctEnc(v)] as [string, string])
        .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
      const base = `POST&${pctEnc(`${u.origin}${u.pathname}`)}&${pctEnc(paramStr)}`;
      const signKey = `${pctEnc(consumerSecret)}&${pctEnc(tokenSecret)}`;
      const signature = crypto.createHmac("sha256", signKey).update(base).digest("base64");

      const authHeader =
        `OAuth realm="${realm}", ` +
        Object.entries({ ...oauth, oauth_signature: signature })
          .map(([k, v]) => `${k}="${pctEnc(v)}"`)
          .join(", ");

      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Prefer: "transient",
        },
        body: JSON.stringify({ q: query }),
      });
      if (res.status !== 429) break;
      if (attempt < maxTries) await sleep(400 * attempt + Math.floor(Math.random() * 250));
    }
    if (!res) throw new Error("NetSuite SuiteQL : aucune réponse");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NetSuite SuiteQL ${res.status}: ${body.slice(0, 300)}`);
    }
    const json: any = await res.json();
    rows.push(...(json.items ?? []));
    const next = (json.links ?? []).find((l: any) => l.rel === "next");
    url = next ? next.href : null;
  }
  return rows;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export async function fetchFinancials(
  parentId: number,
  dateFrom: string,
  dateTo: string
): Promise<NetsuiteFinancials> {
  const toExcl = nextDay(dateTo);
  const [byTerm, soCount] = await Promise.all([
    suiteql<{ terms: number | null; termname: string | null; total_ht: number }>(
      `SELECT t.terms AS terms, tm.name AS termname,
              SUM(CASE WHEN tl.taxline = 'F' AND tl.mainline = 'F' THEN -tl.foreignamount ELSE 0 END) AS total_ht
       FROM transaction t
       JOIN transactionline tl ON tl.transaction = t.id
       LEFT JOIN term tm ON tm.id = t.terms
       WHERE t.type = 'CustInvc'
         AND t.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
         AND t.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
         AND t.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})
       GROUP BY t.terms, tm.name`
    ),
    // "Nombre de commande" = commandes du mois FACTURÉES uniquement (au moins
    // une ligne de facture liée). Exclut de fait les commandes annulées/closed
    // et celles pas encore facturées — règle métier confirmée par Nicolas
    // (05/08/2026) : les commissions aux groupes sont dues sur le facturé.
    // Validé Krousty juillet 2026 : 146 (vs 151 commandes datées du mois,
    // dont 2 annulées et 3 en attente de facturation au moment du calcul).
    suiteql<{ nb: number }>(
      `SELECT COUNT(DISTINCT so.id) AS nb
       FROM transaction so
       JOIN transactionline til ON til.createdfrom = so.id
       JOIN transaction inv ON inv.id = til.transaction
       WHERE so.type = 'SalesOrd'
         AND inv.type = 'CustInvc'
         AND so.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
         AND so.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
         AND so.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})`
    ),
  ]);

  const caHtByLabel: Record<string, number> = {};
  let total = 0;
  for (const row of byTerm) {
    const ht = Math.round(Number(row.total_ht) * 100) / 100;
    total += ht;
    const label =
      (row.terms !== null && TERM_LABELS[Number(row.terms)]) ||
      `Règlement ${row.termname ?? "inconnu"}`;
    caHtByLabel[label] = Math.round(((caHtByLabel[label] ?? 0) + ht) * 100) / 100;
  }

  return {
    caHtTotal: byTerm.length > 0 ? Math.round(total * 100) / 100 : null,
    salesOrderCount: soCount.length > 0 ? Number(soCount[0].nb) : null,
    caHtByLabel,
  };
}

/** Agrégat facturé par article (lignes de factures liées aux Sales Orders du
 * mois) : pièces, pièces/colis (unité de vente NetSuite) et montant HT, plus
 * — si `fieldId` est fourni — la valeur du champ NetSuite libre portant le
 * taux de commission (€/carton) pour cet article.
 * Base commune du calcul de commission. */
async function fetchInvoicedByItem(
  parentId: number,
  dateFrom: string,
  dateTo: string,
  fieldId?: string | null
): Promise<
  { item_id: number; itemid: string; qty_pieces: number; per_carton: number; total_ht: number; ns_rate: number | null }[]
> {
  const toExcl = nextDay(dateTo);
  // fieldId vient d'une variable d'environnement qu'on contrôle (jamais
  // d'entrée utilisateur) — on valide quand même le format d'un ID de champ
  // custitem NetSuite avant de l'interpoler dans le SELECT.
  const safeFieldId = fieldId && /^custitem[a-z0-9_]*$/i.test(fieldId) ? fieldId : null;
  const rows = await suiteql<{
    item_id: number;
    itemid: string;
    qty_pieces: number;
    per_carton: number;
    total_ht: number;
    ns_rate: number | null;
  }>(
    `SELECT i.id AS item_id,
            i.itemid AS itemid,
            SUM(-til.quantity) AS qty_pieces,
            MAX(NVL(u.conversionrate, 1)) AS per_carton,
            SUM(CASE WHEN til.taxline = 'F' AND til.mainline = 'F' THEN -til.foreignamount ELSE 0 END) AS total_ht
            ${safeFieldId ? `, MAX(i.${safeFieldId}) AS ns_rate` : ", NULL AS ns_rate"}
     FROM transaction so
     JOIN transactionline til ON til.createdfrom = so.id
     JOIN transaction inv ON inv.id = til.transaction
     JOIN item i ON i.id = til.item
     LEFT JOIN unitstypeuom u
       ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
     WHERE so.type = 'SalesOrd'
       AND inv.type = 'CustInvc'
       AND til.mainline = 'F' AND til.taxline = 'F'
       AND til.itemtype = 'InvtPart'
       AND so.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
       AND so.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
       AND so.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})
     GROUP BY i.id, i.itemid`
  );
  return rows;
}

/**
 * Table d'exceptions de commission par client (custom record NetSuite
 * "Commission par client (MBA)", customrecordmba_commission_client — décision
 * Nicolas, 08/09/2026) : cas où la même référence a un taux de commission
 * différent selon le client (ex. LID149PP, WDFK02PO). Consultée en priorité,
 * avant le champ général custitem_mba_commission_carton. Une valeur 0 est un
 * taux explicite (pas de commission pour ce client sur cette référence), à
 * distinguer d'une absence de ligne (on retombe alors sur le champ général).
 * Le "Client" de la table d'exceptions est le client parent NetSuite
 * (parentId — même valeur que clients.json:netsuite_parent_id).
 */
async function fetchClientExceptionRates(parentId: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  try {
    const rows = await suiteql<{ item_id: number; rate: number }>(
      `SELECT custrecordmba_comm_article AS item_id, custrecordmba_comm_rate AS rate
       FROM customrecordmba_commission_client
       WHERE custrecordmba_comm_client = ${Number(parentId)}`
    );
    for (const r of rows) {
      if (r.item_id !== null && r.item_id !== undefined) {
        out.set(Number(r.item_id), Number(r.rate));
      }
    }
  } catch {
    // Table d'exceptions indisponible (ex. pas encore créée) : on retombe
    // silencieusement sur le champ général custitem_mba_commission_carton.
  }
  return out;
}

/**
 * Commission de référencement — décision Nicolas (08/09/2026) : source
 * PRINCIPALE = champ NetSuite libre `fieldId` sur la fiche article
 * (€/carton), multiplié par les cartons FACTURÉS du mois (même base
 * "facturé uniquement" que le reste du rapport). Plus de repli sur l'ancien
 * référentiel Supabase `rfa_rates` (décision Nicolas, 08/09/2026 : "pas de
 * repli", cet ancien référentiel doit disparaître).
 * Décision Nicolas (08/09/2026, cas LID149PP / WDFK02PO) : quand une même
 * référence a un taux différent selon le client, la table d'exceptions
 * NetSuite "Commission par client (MBA)" (fetchClientExceptionRates) est
 * consultée EN PRIORITÉ, avant le champ général — cas normalement rares.
 * Renvoie aussi la liste des références facturées sans taux (exception ou
 * NetSuite) renseigné, pour signalement.
 */
export async function fetchReferencingCommissionUnified(
  parentId: number,
  dateFrom: string,
  dateTo: string,
  fieldId: string | null | undefined
): Promise<{ commission: number | null; missingRate: string[] }> {
  const [rows, exceptions] = await Promise.all([
    fetchInvoicedByItem(parentId, dateFrom, dateTo, fieldId ?? null),
    fetchClientExceptionRates(parentId),
  ]);
  let commission = 0;
  let matched = false;
  const missingRate: string[] = [];
  for (const row of rows) {
    const perCarton = Number(row.per_carton) > 0 ? Number(row.per_carton) : 1;
    const cartons = (Number(row.qty_pieces) || 0) / perCarton;
    const exceptionRate = exceptions.get(Number(row.item_id));
    if (exceptionRate !== undefined && Number.isFinite(exceptionRate)) {
      matched = true;
      commission += cartons * exceptionRate;
      continue;
    }
    const nsRate = row.ns_rate !== null && row.ns_rate !== undefined ? Number(row.ns_rate) : null;
    if (nsRate !== null && Number.isFinite(nsRate) && nsRate > 0) {
      matched = true;
      commission += cartons * nsRate;
    } else {
      missingRate.push(String(row.itemid));
    }
  }
  return { commission: matched ? Math.round(commission * 100) / 100 : null, missingRate };
}

export interface ClientRateRow {
  ref: string;
  rate: number | null;
  source: "exception" | "netsuite" | "aucun";
}

/**
 * Aperçu lecture-seule des taux réellement appliqués à un client — décision
 * Nicolas (09/09/2026) : l'onglet /rfa n'édite plus rien (l'ancien
 * référentiel Supabase rfa_rates n'est lu par aucun calcul depuis le passage
 * sur NetSuite), il affiche juste ce que le calcul utilise vraiment. Sur les
 * références facturées à ce client sur les `monthsBack` derniers mois :
 * taux d'exception (table "Commission par client (MBA)") si présent, sinon
 * champ général NetSuite sur la fiche article, sinon "aucun".
 */
export async function fetchClientRatesOverview(
  parentId: number,
  fieldId: string | null | undefined,
  monthsBack = 12
): Promise<ClientRateRow[]> {
  const now = new Date();
  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - monthsBack);
  const dateFrom = from.toISOString().slice(0, 10);

  const [rows, exceptions] = await Promise.all([
    fetchInvoicedByItem(parentId, dateFrom, dateTo, fieldId ?? null),
    fetchClientExceptionRates(parentId),
  ]);

  const out: ClientRateRow[] = rows.map((r) => {
    const exceptionRate = exceptions.get(Number(r.item_id));
    if (exceptionRate !== undefined && Number.isFinite(exceptionRate)) {
      return { ref: r.itemid, rate: exceptionRate, source: "exception" };
    }
    const nsRate = r.ns_rate !== null && r.ns_rate !== undefined ? Number(r.ns_rate) : null;
    if (nsRate !== null && Number.isFinite(nsRate) && nsRate > 0) {
      return { ref: r.itemid, rate: nsRate, source: "netsuite" };
    }
    return { ref: r.itemid, rate: null, source: "aucun" };
  });
  out.sort((a, b) => a.ref.localeCompare(b.ref));
  return out;
}

/**
 * Price Levels NetSuite identifiant chaque client MBA Green (voir onglet
 * Pricing d'un article — vérifié par inspection DOM, 08/09/2026). Pokawa a
 * 5 zones (un seul client "Pokawa" pour la détection multi-client).
 * La Kazdalerie n'a pas de Price Level connu : exclue de la détection (pas
 * de faux négatif silencieux — mieux vaut ne rien signaler que se tromper).
 */
const CLIENT_PRICE_LEVELS_BY_PARENT: Record<number, number[]> = {
  188607: [9, 10, 11, 12, 13], // Pokawa (France/Espagne/Luxembourg/Belgique/Portugal)
  189320: [16], // Krousty
  194089: [30], // Black & White Burger
  189319: [25], // Lüks Kebab
};
const PRICE_LEVEL_CLIENT_NAME: Record<number, string> = {
  9: "Pokawa", 10: "Pokawa", 11: "Pokawa", 12: "Pokawa", 13: "Pokawa",
  16: "Krousty",
  25: "Lüks Kebab",
  30: "Black & White Burger",
};

export interface MultiClientGap {
  ref: string;
  otherClients: string[];
}

/**
 * Détecte, parmi les références facturées à un client ce mois-ci, celles qui
 * sont vendues à un AUTRE client MBA Green (signal : un Price Level d'un
 * autre client est renseigné sur l'article) et qui ne sont PAS couvertes par
 * une ligne de la table d'exceptions (customrecordmba_commission_client) pour
 * CE client — donc à risque d'utiliser le mauvais taux (celui de l'autre
 * client, via le champ général NetSuite). Décision Nicolas (09/09/2026) :
 * signal réservé à l'outil (encart interne) — jamais dans le rapport PDF
 * client, jamais bloquant. Repli silencieux sur [] en cas d'erreur SuiteQL
 * (vérification annexe, ne doit jamais empêcher la génération du rapport).
 */
export async function detectMultiClientGaps(
  parentId: number,
  itemCodes: string[]
): Promise<MultiClientGap[]> {
  const myLevels = new Set(CLIENT_PRICE_LEVELS_BY_PARENT[Number(parentId)] ?? []);
  if (myLevels.size === 0 || itemCodes.length === 0) return [];
  try {
    const codes = [...new Set(itemCodes.map((c) => String(c).trim().toUpperCase()))];
    const list = codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(", ");
    const items = await suiteql<{ id: number; itemid: string }>(
      `SELECT id, itemid FROM item WHERE itemid IN (${list})`
    );
    if (items.length === 0) return [];
    const idToCode = new Map(items.map((i) => [Number(i.id), i.itemid]));
    const ids = items.map((i) => Number(i.id));
    const allLevels = Object.keys(PRICE_LEVEL_CLIENT_NAME).join(",");

    const [priceRows, exceptions] = await Promise.all([
      suiteql<{ item: number; pricelevel: number }>(
        `SELECT item, pricelevel FROM pricing WHERE item IN (${ids.join(",")}) AND pricelevel IN (${allLevels})`
      ),
      fetchClientExceptionRates(parentId),
    ]);

    const levelsByItem = new Map<number, Set<number>>();
    for (const r of priceRows) {
      const it = Number(r.item);
      if (!levelsByItem.has(it)) levelsByItem.set(it, new Set());
      levelsByItem.get(it)!.add(Number(r.pricelevel));
    }

    const out: MultiClientGap[] = [];
    for (const [itemId, levels] of levelsByItem) {
      const otherLevels = [...levels].filter((l) => !myLevels.has(l));
      if (otherLevels.length === 0) continue; // pas multi-client
      if (exceptions.has(itemId)) continue; // déjà couvert par une exception
      const otherClients = [...new Set(otherLevels.map((l) => PRICE_LEVEL_CLIENT_NAME[l]))];
      out.push({ ref: idToCode.get(itemId) ?? String(itemId), otherClients });
    }
    out.sort((a, b) => a.ref.localeCompare(b.ref));
    return out;
  } catch {
    return [];
  }
}

/**
 * Taux de commission (€/carton) pour un jeu de références données, pour un
 * client donné (`parentId`) : table d'exceptions par client en priorité
 * (fetchClientExceptionRates), sinon champ NetSuite libre `fieldId` sur la
 * fiche article. Utilisé par lib/commissionsXlsx.ts pour afficher le même
 * taux que celui utilisé dans le calcul du rapport
 * (fetchReferencingCommissionUnified ci-dessus). `source` indique l'origine
 * du taux affiché ("exception client" vs "NetSuite").
 */
export async function fetchItemFieldRates(
  parentId: number,
  itemCodes: string[],
  fieldId: string | null | undefined
): Promise<Map<string, { rate: number; source: "exception" | "netsuite" }>> {
  const out = new Map<string, { rate: number; source: "exception" | "netsuite" }>();
  if (itemCodes.length === 0) return out;
  const safeFieldId = fieldId && /^custitem[a-z0-9_]*$/i.test(fieldId) ? fieldId : null;
  const list = itemCodes.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(", ");
  const [rows, exceptions] = await Promise.all([
    suiteql<{ id: number; itemid: string; rate: number | null }>(
      `SELECT id${safeFieldId ? `, ${safeFieldId} AS rate` : ""}, itemid FROM item WHERE itemid IN (${list})`
    ),
    fetchClientExceptionRates(parentId),
  ]);
  for (const r of rows) {
    const key = String(r.itemid).trim().toUpperCase();
    const exceptionRate = exceptions.get(Number(r.id));
    if (exceptionRate !== undefined && Number.isFinite(exceptionRate)) {
      out.set(key, { rate: exceptionRate, source: "exception" });
      continue;
    }
    const v = r.rate !== null && r.rate !== undefined ? Number(r.rate) : null;
    if (v !== null && Number.isFinite(v) && v > 0) out.set(key, { rate: v, source: "netsuite" });
  }
  return out;
}
