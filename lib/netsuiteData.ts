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
 * Lignes de PO en transit par code article (date d'échéance + qté cartons).
 * "En transit" = reliquat non reçu (`quantity - quantityshiprecv > 0`) de PO
 * dont la date de réception attendue est dans une fenêtre récente/proche
 * (−90 j / +270 j) — écarte les vieilles lignes ouvertes jamais soldées, qui
 * fausseraient le bucketing par numéro de semaine ISO fait dans compute.ts
 * (le numéro de semaine ne porte pas l'année).
 */
export async function fetchTransitByItem(
  itemCodes: string[]
): Promise<Map<string, { dueDate: string; qtyCartons: number }[]>> {
  const out = new Map<string, { dueDate: string; qtyCartons: number }[]>();
  if (itemCodes.length === 0) return out;
  const rows = await suiteql<{
    itemcode: string;
    due: string | null;
    qty_pieces: number;
    per_carton: number | null;
  }>(
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
       AND NVL(tl.expectedreceiptdate, t.duedate) >= SYSDATE - 90
       AND NVL(tl.expectedreceiptdate, t.duedate) <= SYSDATE + 270
       AND i.itemid IN (${inList(itemCodes)})
     GROUP BY i.itemid, TO_CHAR(NVL(tl.expectedreceiptdate, t.duedate), 'YYYY-MM-DD')`
  );
  for (const r of rows) {
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
