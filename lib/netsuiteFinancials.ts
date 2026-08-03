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

export async function suiteql<T = Record<string, unknown>>(query: string): Promise<T[]> {
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

    const res: Response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify({ q: query }),
    });
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
    suiteql<{ nb: number }>(
      `SELECT COUNT(*) AS nb FROM transaction
       WHERE type = 'SalesOrd'
         AND trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
         AND trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
         AND entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})`
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

/**
 * Commission de référencement = quantités des Sales Orders du mois par article
 * x taux par article (fournis par l'onglet "Commission" du Sheet client).
 * Renvoie null tant qu'aucun taux n'est configuré.
 */
export async function fetchReferencingCommission(
  parentId: number,
  dateFrom: string,
  dateTo: string,
  commissionRates: Record<string, number> | null | undefined
): Promise<number | null> {
  if (!commissionRates || Object.keys(commissionRates).length === 0) return null;
  const toExcl = nextDay(dateTo);
  const rows = await suiteql<{ itemid: string; total_ht: number }>(
    `SELECT i.itemid AS itemid,
            SUM(CASE WHEN tl.taxline = 'F' AND tl.mainline = 'F' THEN -tl.foreignamount ELSE 0 END) AS total_ht
     FROM transaction t
     JOIN transactionline tl ON tl.transaction = t.id
     JOIN item i ON i.id = tl.item
     WHERE t.type = 'SalesOrd'
       AND t.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
       AND t.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
       AND t.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})
     GROUP BY i.itemid`
  );
  let commission = 0;
  let matched = false;
  for (const r of rows) {
    const rate = commissionRates[String(r.itemid).toUpperCase()] ?? commissionRates[String(r.itemid)];
    if (rate !== undefined) {
      matched = true;
      commission += Number(r.total_ht) * Number(rate);
    }
  }
  return matched ? Math.round(commission * 100) / 100 : null;
}
