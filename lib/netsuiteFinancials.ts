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

/** Taux RFA minimal attendu par le calcul de commission (voir lib/rfaRates.ts). */
export interface RfaRateForCalc {
  reference: string;
  rfa_par_colis: number | null;
  commission_pct: number | null;
}

/**
 * Commission de référencement, base "facturé uniquement" (règle métier
 * confirmée par Nicolas, 05/08/2026 : les commissions aux groupes sont dues
 * sur ce qui a été facturé). Pour chaque article, sur les lignes de factures
 * liées aux Sales Orders du mois :
 *  1. taux Supabase `rfa_par_colis` (€ / colis) : colis facturés x montant —
 *     colis = pièces facturées / conversion carton (saleunit NetSuite) ;
 *  2. sinon taux Supabase `commission_pct` : % x CA HT facturé ;
 *  3. sinon taux de l'onglet "Commission" du Google Sheet (repli historique,
 *     fraction x CA HT facturé).
 * Une commande annulée ou pas encore facturée ne contribue pas ; une commande
 * partiellement facturée contribue à hauteur du facturé.
 * Renvoie null tant qu'aucun taux n'est configuré.
 */
export async function fetchReferencingCommission(
  parentId: number,
  dateFrom: string,
  dateTo: string,
  commissionRates: Record<string, number> | null | undefined,
  rfaRates?: RfaRateForCalc[] | null
): Promise<number | null> {
  const hasSheet = !!commissionRates && Object.keys(commissionRates).length > 0;
  const hasRfa = !!rfaRates && rfaRates.length > 0;
  if (!hasSheet && !hasRfa) return null;
  const toExcl = nextDay(dateTo);
  const rows = await suiteql<{
    itemid: string;
    qty_pieces: number;
    per_carton: number | null;
    total_ht: number;
  }>(
    `SELECT i.itemid AS itemid,
            SUM(-til.quantity) AS qty_pieces,
            MAX(NVL(u.conversionrate, 1)) AS per_carton,
            SUM(CASE WHEN til.taxline = 'F' AND til.mainline = 'F' THEN -til.foreignamount ELSE 0 END) AS total_ht
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
     GROUP BY i.itemid`
  );

  const rfaByRef = new Map<string, RfaRateForCalc>();
  for (const r of rfaRates ?? []) rfaByRef.set(r.reference.trim().toUpperCase(), r);

  let commission = 0;
  let matched = false;
  for (const r of rows) {
    const ref = String(r.itemid).trim().toUpperCase();
    const ht = Number(r.total_ht) || 0;
    const rfa = rfaByRef.get(ref);
    if (rfa && rfa.rfa_par_colis !== null && rfa.rfa_par_colis !== undefined) {
      const perCarton = Number(r.per_carton) > 0 ? Number(r.per_carton) : 1;
      const colis = (Number(r.qty_pieces) || 0) / perCarton;
      commission += colis * Number(rfa.rfa_par_colis);
      matched = true;
    } else if (rfa && rfa.commission_pct !== null && rfa.commission_pct !== undefined) {
      commission += ht * Number(rfa.commission_pct);
      matched = true;
    } else {
      const rate =
        commissionRates?.[String(r.itemid).toUpperCase()] ?? commissionRates?.[String(r.itemid)];
      if (rate !== undefined) {
        commission += ht * Number(rate);
        matched = true;
      }
    }
  }
  return matched ? Math.round(commission * 100) / 100 : null;
}
