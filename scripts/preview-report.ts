/**
 * Génère un aperçu du rapport avec les données Pokawa Février 2026
 * (valeurs du rapport de référence) — usage: npx tsx scripts/preview-report.ts [out.pdf]
 */
import * as fs from "fs";
import * as path from "path";
import { buildReportData } from "../lib/reportData";
import { renderDesignReportPdf } from "../lib/renderDesignPdf";
import type { ReportContext } from "../lib/types";

const A = (code: string, forecast: number, consumption: number, rate: number | null) => ({
  code, description: "", forecast, consumption, rate,
  ca_forecast: 0, ca_consumption: 0,
});

const ctx: ReportContext = {
  generated_at: "03/08/2026 18:05",
  client: {
    display_name: "Pokawa", brand_color: "#1B1F5E", accent_color: "#F6C9CE",
    background_color: "#EEF0FA", data_feb_file_pattern: "", breakdown_sheet_name: "",
    financial_column: "Pokawa", logo_text: "POKAWA", restaurant_name_matches: ["POKAWA"],
    restaurant_name_aliases: [], corner_wasabi_count_manual: 2, netsuite_parent_id: 188607,
  } as any,
  month_label: "Février 2026",
  kpi: {
    sku_count: 32, pieces_consumed: 3568, ca_actual: 224315.17, ca_forecast: 248166.19,
    performance_rate: 90.39, total_commandes: 528, total_cartons: 4535, taux_reussite: 100,
  },
  articles: [
    A("BAG01PO", 0, 131, null), A("BAG01POKOH", 772, 679, 88), A("BAGLUX01PO", 14, 11, 81),
    A("BL1000PO", 105, 96, 92), A("BL500PO", 366, 336, 92), A("BL750PO", 400, 326, 82),
    A("BMBCS1PO", 27, 17, 64), A("BOT250PET62", 297, 246, 83), A("BOT500PET65", 56, 55, 99),
    A("BOX225PO", 2, 2, 120), A("FILM01NBPG", 0, 0, null), A("KNF002NB", 5, 5, 108),
    A("LID006PO", 0, 1, null), A("LID007PO", 0, 3, null), A("LID02PET64", 12, 11, 90),
    A("LID115PP", 236, 175, 74), A("LID149PET", 633, 585, 92), A("LID149PP", 61, 71, 117),
    A("NAP003PO", 96, 91, 95), A("POT016PO97", 3, 0, null), A("POT02PAPER", 12, 9, 76),
    A("POT350LID115TEMP", 0, 39, null), A("POT350PO115", 260, 198, 76), A("PPK016CPO2", 10, 13, 135),
    A("PPK04CPO2", 6, 6, 109), A("PPK08CPO2", 15, 15, 101), A("STR02NB", 37, 36, 97),
    A("TRAY1200NBPET", 29, 31, 108),
  ],
  stock_status: [
    { code: "BAG01PO", on_hand: 12, weeks: [
      { week: 10, forecast: 0, stock: 12, in_transit: 0 }, { week: 11, forecast: 0, stock: 408, in_transit: 396 },
      { week: 12, forecast: 0, stock: 1056, in_transit: 648 }, { week: 13, forecast: 0, stock: 1056, in_transit: 0 },
      { week: 14, forecast: 228, stock: 1548, in_transit: 720 }, { week: 15, forecast: 228, stock: 1320, in_transit: 0 },
      { week: 16, forecast: 228, stock: 1091, in_transit: 0 }, { week: 17, forecast: 228, stock: 863, in_transit: 0 },
    ]},
    { code: "BAG01POKOH", on_hand: 407, weeks: [
      { week: 10, forecast: 155, stock: 407, in_transit: 0 }, { week: 11, forecast: 155, stock: 360, in_transit: 108 },
      { week: 12, forecast: 155, stock: 206, in_transit: 0 }, { week: 13, forecast: 155, stock: 51, in_transit: 0 },
      { week: 14, forecast: 0, stock: 51, in_transit: 0 }, { week: 15, forecast: 0, stock: 51, in_transit: 0 },
      { week: 16, forecast: 0, stock: 51, in_transit: 0 }, { week: 17, forecast: 0, stock: 51, in_transit: 0 },
    ]},
    { code: "BL1000PO", on_hand: 54, weeks: [
      { week: 10, forecast: 30, stock: 54, in_transit: 0 }, { week: 11, forecast: 30, stock: 24, in_transit: 0 },
      { week: 12, forecast: 30, stock: 94, in_transit: 100 }, { week: 13, forecast: 30, stock: 65, in_transit: 0 },
      { week: 14, forecast: 31, stock: 33, in_transit: 0 }, { week: 15, forecast: 31, stock: 2, in_transit: 0 },
      { week: 16, forecast: 31, stock: 171, in_transit: 200 }, { week: 17, forecast: 31, stock: 140, in_transit: 0 },
    ]},
    { code: "BL500PO", on_hand: 408, weeks: [
      { week: 10, forecast: 104, stock: 408, in_transit: 48 }, { week: 11, forecast: 104, stock: 303, in_transit: 0 },
      { week: 12, forecast: 104, stock: 199, in_transit: 0 }, { week: 13, forecast: 104, stock: 446, in_transit: 352 },
      { week: 14, forecast: 109, stock: 338, in_transit: 0 }, { week: 15, forecast: 109, stock: 229, in_transit: 0 },
      { week: 16, forecast: 109, stock: 120, in_transit: 0 }, { week: 17, forecast: 109, stock: 12, in_transit: 0 },
    ]},
    { code: "BL750PO", on_hand: 621, weeks: [
      { week: 10, forecast: 114, stock: 621, in_transit: 160 }, { week: 11, forecast: 114, stock: 507, in_transit: 0 },
      { week: 12, forecast: 114, stock: 393, in_transit: 0 }, { week: 13, forecast: 114, stock: 487, in_transit: 208 },
      { week: 14, forecast: 119, stock: 368, in_transit: 0 }, { week: 15, forecast: 119, stock: 250, in_transit: 0 },
      { week: 16, forecast: 119, stock: 131, in_transit: 0 }, { week: 17, forecast: 119, stock: 13, in_transit: 0 },
    ]},
    { code: "BOT250PET62", on_hand: 187, weeks: [
      { week: 10, forecast: 70, stock: 187, in_transit: 0 }, { week: 11, forecast: 70, stock: 116, in_transit: 0 },
      { week: 12, forecast: 70, stock: 546, in_transit: 500 }, { week: 13, forecast: 70, stock: 476, in_transit: 0 },
      { week: 14, forecast: 73, stock: 403, in_transit: 0 }, { week: 15, forecast: 73, stock: 329, in_transit: 0 },
      { week: 16, forecast: 73, stock: 256, in_transit: 0 }, { week: 17, forecast: 73, stock: 183, in_transit: 0 },
    ]},
  ],
  logistics: {
    restaurants_livres: 145, corner_wasabi: 2, total_commandes: 528, total_cartons: 4535,
    total_poids: 32915.65, geodis_share: 48, gls_share: 52,
    geodis: {
      restaurant_names: new Set(), restaurants_livres: 103, total_commandes: 251,
      total_cartons: 2704, total_poids: 24596.53, taux_reussite: 100,
      france: { total_commandes: 244, livrees: 243, rate: 100,
        delay_buckets: { total: 244, le_48h: 190, le_48h_rate: 78, j_72h: 42, j_72h_rate: 17, plus_72h: 12, plus_72h_rate: 5 } },
      belgique_lux: { total_commandes: 7, livrees: 7, rate: 100, by_country: { BE: 6, LU: 0, CH: 1 },
        delay_buckets: { total: 7, le_48h: 4, le_48h_rate: 57, j_72h: 0, j_72h_rate: 0, plus_72h: 3, plus_72h_rate: 43 } },
      express: { total_commandes: 20, livrees: 20, rate: 100 },
      affretement: { total_commandes: 0, livrees: 0, rate: null },
      express_delay: { total: 20, within_24h: 19, rate: 95 },
      moyenne_jours: 12.6, moyenne_cmds_cartons: 10.77, moyenne_cmds_poids: 97.99,
      corner_wasabi_count: 0, respect_horaires_12h: 84, respect_horaires_11h: 68.89,
    },
    gls: {
      restaurant_names: new Set(), restaurants_livres: 77, total_commandes: 275,
      total_cartons: 1831, total_poids: 8319.12, by_country: { FR: 1578, BE: 253, LU: 0 },
      moyenne_jours: 13.8, moyenne_cmds_cartons: 6.66, moyenne_cmds_poids: 30.25,
      corner_wasabi_count: 2,
    },
  },
  financials: {
    ca_total: 224315.17, reglement_livraison: null, reglement_commande: null,
    reglement_30_classique: 12867.92, reglement_escompte_2: 41993.52,
    reglement_30_sepa: 163369.55, reglement_45_sepa: 6084.18,
    commissions: 60512.13, commissions_pkg: 0, nombre_commande: 528,
  },
};

async function main() {
  const out = process.argv[2] || "/tmp/preview-pokawa.pdf";
  const pdf = await renderDesignReportPdf(buildReportData(ctx));
  fs.writeFileSync(out, pdf);
  console.log("PDF:", out, (pdf.length / 1024).toFixed(0), "KB");
}
main().catch((e) => { console.error(e); process.exit(1); });
