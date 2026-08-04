/**
 * Aperçu local du gabarit compact (Krousty / Black & White) avec des données
 * proches des rapports de référence de juin 2026 — pour valider le rendu sans
 * accès aux sources live.
 * Usage : npx tsx scripts/preview-compact.ts [KROUSTY|BLACK_WHITE] [out.pdf]
 */
import * as fs from "fs";
import clients from "../lib/clients.json";
import { buildReportData } from "../lib/reportData";
import { renderDesignReportPdf } from "../lib/renderDesignPdf";
import type { ReportContext } from "../lib/types";

const A = (code: string, forecast: number, consumption: number, rate: number | null) => ({
  code, description: "", forecast, consumption, rate,
  ca_forecast: 0, ca_consumption: 0,
});

function makeCtx(clientKey: "KROUSTY" | "BLACK_WHITE"): ReportContext {
  const cfg = (clients as any)[clientKey];
  const kr = clientKey === "KROUSTY";
  return {
    generated_at: "04/08/2026 10:00",
    client: cfg,
    month_label: "Juin 2026",
    kpi: {
      sku_count: kr ? 11 : 36,
      pieces_consumed: kr ? 777050 : 1391340,
      cartons_consumed: kr ? 1854 : 2239,
      ca_actual: kr ? 84841.44 : 115099.1,
      ca_forecast: kr ? 172617.06 : 137610.07,
      performance_rate: kr ? 49.15 : 83.64,
      total_commandes: kr ? 113 : 134,
      total_cartons: kr ? 1854 : 2239,
      taux_reussite: 100,
    },
    articles: kr
      ? [
          A("BAG03KRSTY", 662, 545, 82), A("BOL1100KRSTY2", 845, 244, 29),
          A("BOL1300KRSTY2", 171, 62, 36), A("BOLS600KRSTY", 95, 46, 48),
          A("BOL750KRSTY2", 521, 277, 53), A("LID149PP", 278, 682, 245),
          A("LID189PP", 721, 331, 46), A("BOX420KRSTY", 183, 8, 4),
          A("BOXFRIES1KRSTY", 43, 26, 60), A("PPRO01KRSTY", 12, 7, 58),
          A("BOXFRIES2KRSTY", 141, 62, 44),
        ]
      : [
          A("BAG003B&W", 665, 620, 93), A("BAG003DB&W", 80, 33, 41),
          A("BOXFRIES1DB&W", 216, 290, 134), A("BOXFRIES2DB&W", 177, 296, 167),
          A("BOKKIDSB&W", 27, 9, 33), A("BOXMENUB&W", 27, 305, 1130),
          A("CAN330B&W", 270, 296, 110), A("CAN500B&W", 232, 332, 143),
          A("PAPERO03B&W", 74, 79, 107), A("SKEWERO01BAMB", 60, 51, 85),
          A("STEELTRAY", 80, 51, 64),
        ],
    stock_status: [],
    logistics: {
      restaurants_livres: kr ? 40 : 42,
      corner_wasabi: 0,
      total_commandes: kr ? 113 : 134,
      total_cartons: kr ? 1854 : 2239,
      total_palettes: kr ? 166 : 170,
      total_poids: kr ? 15908.65 : 20296.7,
      geodis_share: 100,
      gls_share: 0,
      geodis: {
        restaurant_names: new Set(),
        restaurants_livres: kr ? 40 : 42,
        total_commandes: kr ? 113 : 134,
        total_cartons: kr ? 1854 : 2239,
        total_palettes: kr ? 166 : 170,
        total_poids: kr ? 15908.65 : 20296.7,
        taux_reussite: 100,
        france: {
          total_commandes: kr ? 113 : 120,
          livrees: kr ? 113 : 120,
          rate: 100,
          delay_buckets: {
            total: kr ? 113 : 120,
            le_48h: kr ? 100 : 109,
            le_48h_rate: kr ? 88 : 91,
            j_72h: kr ? 13 : 11,
            j_72h_rate: 12,
            plus_72h: 0,
            plus_72h_rate: 0,
          },
        },
        belgique_lux: {
          total_commandes: kr ? 0 : 14,
          livrees: kr ? 0 : 14,
          rate: kr ? null : 100,
          by_country: kr ? {} : { BE: 14, LU: 0, CH: 0 },
          delay_buckets: {
            total: kr ? 0 : 14,
            le_48h: kr ? 0 : 13,
            le_48h_rate: kr ? null : 93,
            j_72h: kr ? 0 : 1,
            j_72h_rate: kr ? null : 7,
            plus_72h: 0,
            plus_72h_rate: kr ? null : 0,
          },
        },
        express: { total_commandes: 0, livrees: 0, rate: null },
        affretement: { total_commandes: 0, livrees: 0, rate: null },
        express_delay: { total: 0, within_24h: 0, rate: null },
        moyenne_jours: 5.4,
        moyenne_cmds_cartons: 16.4,
        moyenne_cmds_poids: 140.8,
        corner_wasabi_count: 0,
        respect_horaires_12h: kr ? 69 : null,
        respect_horaires_11h: null,
        horaires: kr
          ? { total: 113, avant_12: 78, h12_14: 14, apres_14: 21, conformes: 99, conformes_total: 113 }
          : null,
      },
      gls: {
        restaurant_names: new Set(),
        restaurants_livres: 0,
        total_commandes: null,
        total_cartons: 0,
        total_poids: 0,
        by_country: {},
        moyenne_jours: null,
        moyenne_cmds_cartons: null,
        moyenne_cmds_poids: null,
        corner_wasabi_count: 0,
      },
    },
    financials: {
      ca_total: kr ? 84841.44 : 115099.1,
      reglement_livraison: null,
      reglement_commande: null,
      reglement_30_classique: kr ? 20841.44 : 30099.1,
      reglement_escompte_2: kr ? 30000 : 40000,
      reglement_30_sepa: kr ? 30000 : 40000,
      reglement_45_sepa: kr ? 4000 : 5000,
      commissions: kr ? 12653.5 : 6717.92,
      commissions_pkg: null,
      nombre_commande: kr ? 113 : 134,
    },
  };
}

async function main() {
  const key = (process.argv[2] as "KROUSTY" | "BLACK_WHITE") || "KROUSTY";
  const out = process.argv[3] || `/tmp/preview-${key.toLowerCase()}.pdf`;
  const pdf = await renderDesignReportPdf(buildReportData(makeCtx(key)));
  fs.writeFileSync(out, pdf);
  console.log("PDF:", out, (pdf.length / 1024).toFixed(0), "KB");
}
main().catch((e) => { console.error(e); process.exit(1); });
