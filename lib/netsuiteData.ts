/**
 * lib/netsuiteData.ts
 * ===================
 * Données articles/stock/transit live depuis NetSuite (SuiteQL, même client
 * TBA que lib/netsuiteFinancials.ts).
 *
 * Unités — règles validées sur le compte (03/08/2026, connecteur MCP) :
 *  - `transactionline.quantity` et `inventoryitemlocations.quantityavailable`
 *    sont toujours en UNITÉS DE BASE (pièces), quelle que soit l'unité saisie
 *    sur la ligne.
 *  - 1 carton = `unitstypeuom.conversionrate` pièces, via l'unité de vente de
 *    l'article (`item.saleunit`, repli `item.stockunit`) — ex. WDFK02PO :
 *    Pack (1000) → 214 000 pièces = 214 cartons (= rapport Février 2026) ;
 *    BOT250PET62 : Pack (224) → 55 104 pièces = 246 cartons (= rapport).
 *  - Périmètre articles : lignes d'articles stockés uniquement
 *    (`itemtype = 'InvtPart'`) — exclut Shipping_, Escompte (2%), etc.
 *    Février 2026 : 31 SKU, comme le rapport de référence.
 */
import { suiteql } from "./netsuiteFinancials";

/** Échappe et assemble une liste de codes article pour un IN (...) SuiteQL. */
function inList(itemCodes: string[]): string {
  return itemCodes.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(", ");
}

/** Consommation par référence (cartons + pièces) sur la période (factures). */
export async function fetchConsumptionCartons(
  parentId: number,
  dateFrom: string,
  dateTo: string
): Promise<{ itemCode: string; description: string; qtyCartons: number; qtyPieces?: number }[]> {
  const toExcl = nextDay(dateTo);
  const rows = await suiteql<{
    itemcode: string;
    description: string | null;
    qty_pieces: number;
    per_carton: number | null;
  }>(
    `SELECT i.itemid AS itemcode,
            MAX(i.displayname) AS description,
            SUM(-tl.quantity) AS qty_pieces,
            MAX(NVL(u.conversionrate, 1)) AS per_carton
     FROM transaction t
     JOIN transactionline tl ON tl.transaction = t.id
     JOIN item i ON i.id = tl.item
     LEFT JOIN unitstypeuom u
       ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
     WHERE t.type = 'CustInvc'
       AND tl.mainline = 'F' AND tl.taxline = 'F'
       AND tl.itemtype = 'InvtPart'
       AND t.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
       AND t.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
       AND t.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})
     GROUP BY i.itemid`
  );
  return rows.map((r) => {
    const pieces = Number(r.qty_pieces) || 0;
    const perCarton = Number(r.per_carton) || 1;
    return {
      itemCode: String(r.itemcode),
      description: r.description ?? "",
      qtyCartons: Math.round(pieces / perCarton),
      qtyPieces: pieces,
    };
  });
}

/**
 * Prix unitaire carton moyen réalisé (€ HT / carton) par article sur la
 * période, d'après les factures. Sert de repli quand l'onglet "Prix" du
 * Prévisionnel n'a pas de ligne pour l'article : le "CA attendu" (prévisions
 * × prix unitaire) reste alors calculable avec le prix effectivement facturé.
 */
export async function fetchAvgPriceByCarton(
  parentId: number,
  dateFrom: string,
  dateTo: string
): Promise<Map<string, number>> {
  const toExcl = nextDay(dateTo);
  const rows = await suiteql<{
    itemcode: string;
    total_ht: number;
    qty_pieces: number;
    per_carton: number | null;
  }>(
    `SELECT i.itemid AS itemcode,
            SUM(-tl.foreignamount) AS total_ht,
            SUM(-tl.quantity) AS qty_pieces,
            MAX(NVL(u.conversionrate, 1)) AS per_carton
     FROM transaction t
     JOIN transactionline tl ON tl.transaction = t.id
     JOIN item i ON i.id = tl.item
     LEFT JOIN unitstypeuom u
       ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
     WHERE t.type = 'CustInvc'
       AND tl.mainline = 'F' AND tl.taxline = 'F'
       AND tl.itemtype = 'InvtPart'
       AND t.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
       AND t.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
       AND t.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})
     GROUP BY i.itemid`
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const pieces = Number(r.qty_pieces) || 0;
    const perCarton = Number(r.per_carton) || 1;
    const cartons = pieces / perCarton;
    const ht = Number(r.total_ht) || 0;
    if (cartons > 0 && ht > 0) out.set(String(r.itemcode), Math.round((ht / cartons) * 100) / 100);
  }
  return out;
}

/** Stock disponible (cartons) par code article, toutes localisations. */
export async function fetchStockOnHand(itemCodes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemCodes.length === 0) return out;
  const rows = await suiteql<{ itemcode: string; qty_pieces: number | null; per_carton: number | null }>(
    `SELECT i.itemid AS itemcode,
            SUM(NVL(iil.quantityavailable, 0)) AS qty_pieces,
            MAX(NVL(u.conversionrate, 1)) AS per_carton
     FROM item i
     LEFT JOIN inventoryitemlocations iil ON iil.item = i.id
     LEFT JOIN unitstypeuom u
       ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
     WHERE i.itemid IN (${inList(itemCodes)})
     GROUP BY i.itemid`
  );
  for (const r of rows) {
    const perCarton = Number(r.per_carton) || 1;
    out.set(String(r.itemcode), (Number(r.qty_pieces) || 0) / perCarton);
  }
  return out;
}

/**
 * Arrivées par code article (date + qté cartons), pour la ligne « En transit »
 * de la page 4. Sémantique validée avec Nicolas (03/08/2026) — la page couvre
 * les semaines du mois du rapport, donc :
 *  - semaines PASSÉES : réceptions RÉELLES (transactions ItemRcpt, datées du
 *    jour de réception) — fenêtre SYSDATE − 120 j ;
 *  - semaines FUTURES : reliquats de PO ouverts (`quantity − quantityshiprecv
 *    > 0`) à leur date de réception attendue — fenêtre SYSDATE + 270 j.
 * Un PO en retard (attendu dans le passé, non reçu) n'apparaît pas : il n'est
 * pas arrivé, il ne doit pas gonfler une semaine passée.
 * Les fenêtres bornées évitent aussi les collisions de numéros de semaine ISO
 * (le bucketing de compute.ts ne porte pas l'année).
 */
export async function fetchTransitByItem(
  itemCodes: string[]
): Promise<Map<string, { dueDate: string; qtyCartons: number }[]>> {
  const out = new Map<string, { dueDate: string; qtyCartons: number }[]>();
  if (itemCodes.length === 0) return out;

  const [receipts, openPos] = await Promise.all([
    // 1) Réceptions réelles récentes (semaines passées).
    suiteql<{ itemcode: string; due: string | null; qty_pieces: number; per_carton: number | null }>(
      `SELECT i.itemid AS itemcode,
              TO_CHAR(t.trandate, 'YYYY-MM-DD') AS due,
              SUM(tl.quantity) AS qty_pieces,
              MAX(NVL(u.conversionrate, 1)) AS per_carton
       FROM transaction t
       JOIN transactionline tl ON tl.transaction = t.id
       JOIN item i ON i.id = tl.item
       LEFT JOIN unitstypeuom u
         ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
       WHERE t.type = 'ItemRcpt'
         AND tl.mainline = 'F'
         AND tl.quantity > 0
         AND t.trandate >= SYSDATE - 120
         AND i.itemid IN (${inList(itemCodes)})
       GROUP BY i.itemid, TO_CHAR(t.trandate, 'YYYY-MM-DD')`
    ),
    // 2) Reliquats de PO attendus (semaines futures).
    suiteql<{ itemcode: string; due: string | null; qty_pieces: number; per_carton: number | null }>(
      `SELECT i.itemid AS itemcode,
              TO_CHAR(NVL(tl.expectedreceiptdate, t.duedate), 'YYYY-MM-DD') AS due,
              SUM(tl.quantity - NVL(tl.quantityshiprecv, 0)) AS qty_pieces,
              MAX(NVL(u.conversionrate, 1)) AS per_carton
       FROM transaction t
       JOIN transactionline tl ON tl.transaction = t.id
       JOIN item i ON i.id = tl.item
       LEFT JOIN unitstypeuom u
         ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
       WHERE t.type = 'PurchOrd'
         AND tl.mainline = 'F'
         AND tl.quantity - NVL(tl.quantityshiprecv, 0) > 0
         AND NVL(tl.expectedreceiptdate, t.duedate) >= SYSDATE
         AND NVL(tl.expectedreceiptdate, t.duedate) <= SYSDATE + 270
         AND i.itemid IN (${inList(itemCodes)})
       GROUP BY i.itemid, TO_CHAR(NVL(tl.expectedreceiptdate, t.duedate), 'YYYY-MM-DD')`
    ),
  ]);

  for (const r of [...receipts, ...openPos]) {
    if (!r.due) continue;
    const perCarton = Number(r.per_carton) || 1;
    const entry = { dueDate: r.due, qtyCartons: (Number(r.qty_pieces) || 0) / perCarton };
    const list = out.get(String(r.itemcode));
    if (list) list.push(entry);
    else out.set(String(r.itemcode), [entry]);
  }
  return out;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
