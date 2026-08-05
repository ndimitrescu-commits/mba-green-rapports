/**
 * lib/commissionsXlsx.ts
 * ======================
 * Génère le fichier de commissions mensuel d'une enseigne (format du fichier
 * "Commissions {Client} {Mois}" préparé jusqu'ici à la main par Heather) :
 *   - onglet "Ventes {Mois}" : le détail des lignes de factures liées aux
 *     commandes du mois (base "facturé uniquement", la même que le rapport) ;
 *   - onglet "RFAs" : colis facturés par référence x taux du référentiel
 *     Supabase rfa_rates (€/colis ou % du CA HT), avec formules et total.
 * Le total de l'onglet RFAs est par construction identique à la
 * "Commission à payer - référencement" du rapport PDF généré au même moment.
 */
import * as XLSX from "xlsx";
import { suiteql } from "./netsuiteFinancials";
import { readRfaRatesForCalc, type RfaRate } from "./rfaRates";
import { loadClientConfig, parseMonthLabel } from "./compute";

interface InvoicedLine {
  invoice_ref: string;
  invoice_date: string;
  so_ref: string;
  so_date: string;
  restaurant: string;
  itemid: string;
  designation: string | null;
  qty_pieces: number;
  per_carton: number;
  amount_ht: number;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Lignes de factures liées aux Sales Orders du mois (détail par ligne). */
async function fetchInvoicedLines(
  parentId: number,
  dateFrom: string,
  dateTo: string
): Promise<InvoicedLine[]> {
  const toExcl = nextDay(dateTo);
  return suiteql<InvoicedLine>(
    `SELECT inv.tranid AS invoice_ref,
            inv.trandate AS invoice_date,
            so.tranid AS so_ref,
            so.trandate AS so_date,
            c.entityid AS restaurant,
            i.itemid AS itemid,
            MAX(i.displayname) AS designation,
            SUM(-til.quantity) AS qty_pieces,
            MAX(NVL(u.conversionrate, 1)) AS per_carton,
            SUM(-til.foreignamount) AS amount_ht
     FROM transaction so
     JOIN transactionline til ON til.createdfrom = so.id
     JOIN transaction inv ON inv.id = til.transaction
     JOIN item i ON i.id = til.item
     JOIN customer c ON c.id = so.entity
     LEFT JOIN unitstypeuom u
       ON u.internalid = NVL(i.saleunit, i.stockunit) AND u.unitstype = i.unitstype
     WHERE so.type = 'SalesOrd'
       AND inv.type = 'CustInvc'
       AND til.mainline = 'F' AND til.taxline = 'F'
       AND til.itemtype = 'InvtPart'
       AND so.trandate >= TO_DATE('${dateFrom}','YYYY-MM-DD')
       AND so.trandate < TO_DATE('${toExcl}','YYYY-MM-DD')
       AND so.entity IN (SELECT id FROM customer WHERE parent = ${Number(parentId)})
     GROUP BY inv.tranid, inv.trandate, so.tranid, so.trandate, c.entityid, i.itemid
     ORDER BY so.tranid, i.itemid`
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Construit le classeur de commissions. Renvoie le buffer xlsx et le total de
 * commission calculé (identique au rapport).
 */
export async function buildCommissionsXlsx(
  clientKey: string,
  monthLabel: string
): Promise<{ buffer: Buffer; filename: string; totalCommission: number | null }> {
  const cfg = loadClientConfig(clientKey);
  const month = parseMonthLabel(monthLabel);
  const [lines, rfaRates] = await Promise.all([
    fetchInvoicedLines(cfg.netsuite_parent_id, month.dateFrom, month.dateTo),
    readRfaRatesForCalc(clientKey),
  ]);

  const rfaByRef = new Map<string, RfaRate>();
  for (const r of rfaRates ?? []) rfaByRef.set(r.reference.trim().toUpperCase(), r);

  // ------------------------------------------------------------------ ventes
  const ventes = lines.map((l) => {
    const perCarton = Number(l.per_carton) > 0 ? Number(l.per_carton) : 1;
    const pieces = Number(l.qty_pieces) || 0;
    const colis = r2(pieces / perCarton);
    const ht = r2(Number(l.amount_ht) || 0);
    return {
      "Facture": l.invoice_ref,
      "Date facture": l.invoice_date,
      "Commande": l.so_ref,
      "Date commande": l.so_date,
      "Restaurant": l.restaurant,
      "Référence": l.itemid,
      "Désignation": l.designation ?? "",
      "Quantité (pièces)": pieces,
      "Pièces / colis": perCarton,
      "Colis": colis,
      "Prix colis € HT": colis > 0 ? r2(ht / colis) : null,
      "Montant € HT": ht,
    };
  });

  // -------------------------------------------------------------------- RFAs
  // Agrégat par référence (colis + HT facturés), croisé avec le référentiel.
  const byRef = new Map<string, { colis: number; ht: number }>();
  for (const l of lines) {
    const perCarton = Number(l.per_carton) > 0 ? Number(l.per_carton) : 1;
    const key = String(l.itemid).trim().toUpperCase();
    const cur = byRef.get(key) ?? { colis: 0, ht: 0 };
    cur.colis += (Number(l.qty_pieces) || 0) / perCarton;
    cur.ht += Number(l.amount_ht) || 0;
    byRef.set(key, cur);
  }
  const refs = [...byRef.keys()].sort();

  interface RfaLine {
    ref: string;
    colis: number;
    ht: number;
    rate: number | null;
    mode: "€/colis" | "% CA HT" | "sans taux";
  }
  const rfaLines: RfaLine[] = refs.map((ref) => {
    const agg = byRef.get(ref)!;
    const rate = rfaByRef.get(ref);
    if (rate && rate.rfa_par_colis !== null && rate.rfa_par_colis !== undefined) {
      return { ref, colis: r2(agg.colis), ht: r2(agg.ht), rate: Number(rate.rfa_par_colis), mode: "€/colis" };
    }
    if (rate && rate.commission_pct !== null && rate.commission_pct !== undefined) {
      return { ref, colis: r2(agg.colis), ht: r2(agg.ht), rate: Number(rate.commission_pct), mode: "% CA HT" };
    }
    return { ref, colis: r2(agg.colis), ht: r2(agg.ht), rate: null, mode: "sans taux" };
  });

  let totalCommission: number | null = null;
  for (const l of rfaLines) {
    if (l.rate === null) continue;
    const c = l.mode === "€/colis" ? l.colis * l.rate : l.ht * l.rate;
    totalCommission = (totalCommission ?? 0) + c;
  }
  if (totalCommission !== null) totalCommission = r2(totalCommission);

  // ------------------------------------------------------------------ classeur
  const wb = XLSX.utils.book_new();

  const wsVentes = XLSX.utils.json_to_sheet(ventes);
  wsVentes["!cols"] = [
    { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 34 },
    { wch: 20 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
    { wch: 12 }, { wch: 12 },
  ];
  const { month: monthName } = ((l: string) => {
    const p = l.trim().split(/\s+/);
    return { month: p[0] ?? l };
  })(monthLabel);
  XLSX.utils.book_append_sheet(wb, wsVentes, `Ventes ${monthName} ${month.year}`.slice(0, 31));

  // Onglet RFAs avec formules (Commission = colis x taux OU HT x taux ; total = SUM).
  const header = ["Référence", "Colis facturés", "Montant € HT", "Taux", "Mode", "Commission €"];
  const aoa: (string | number | null)[][] = [header];
  rfaLines.forEach((l) => aoa.push([l.ref, l.colis, l.ht, l.rate, l.mode, null]));
  aoa.push([]);
  aoa.push(["Total", null, null, null, null, null]);
  const wsRfa = XLSX.utils.aoa_to_sheet(aoa);
  rfaLines.forEach((l, i) => {
    const row = i + 2; // 1-based, après l'en-tête
    if (l.rate !== null) {
      wsRfa[`F${row}`] = {
        t: "n",
        f: l.mode === "€/colis" ? `B${row}*D${row}` : `C${row}*D${row}`,
      };
    }
  });
  const totalRow = rfaLines.length + 3;
  wsRfa[`F${totalRow}`] = { t: "n", f: `SUM(F2:F${rfaLines.length + 1})` };
  wsRfa["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsRfa, "RFAs");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `Commissions ${cfg.display_name} ${monthLabel}.xlsx`;
  return { buffer, filename, totalCommission };
}
