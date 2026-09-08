/**
 * scripts/test-forecast-parse.ts
 * ===============================
 * Test rapide (sans réseau, sans credentials Google) du parseur de l'onglet
 * "Forecast Clients 2026" : ligne d'en-tête "ITEMS | Description | January
 * .. December | Total", avec abréviations possibles ("Aug", "Sept", "Oct",
 * "Nov", "Dec" — vu sur l'onglet Pokawa). Sert de garde-fou si le format du
 * classeur change (colonnes réordonnées, en-têtes renommés, etc.).
 *
 * Usage : npx tsx scripts/test-forecast-parse.ts
 */
import { parseWideForecastRows } from "../lib/googleSheets";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`ÉCHEC : ${msg}`);
    process.exit(1);
  }
}

// En-tête réel observé sur l'onglet Pokawa du classeur (08/09/2026).
const header = [
  "ITEMS",
  "Description",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
  "Total",
];
const row = ["BAG01PO", "White Paper Bag Flat Handles 270x170x290mm - POKAWA", 750, 772, 619, 913, 1073, 1203, 1124, 1049, 1067, 972, 838, 838, 11219];
const totalRowShouldBeIgnored = ["Total", "", 0]; // ligne "Total" éventuelle en bas de tableau -> pas une référence

const out = parseWideForecastRows([header, row, totalRowShouldBeIgnored], 2026);

assert(out.length === 12, `12 lignes mensuelles attendues pour 1 référence, obtenu ${out.length}`);
assert(out[0].reference === "BAG01PO", "référence BAG01PO attendue en premier");
assert(out[0].month === "2026-01" && out[0].quantity_cartons === 750, "janvier 2026 = 750 cartons attendu");
assert(out[7].month === "2026-08" && out[7].quantity_cartons === 1049, "août (abrégé 'Aug') = 1049 cartons attendu");
assert(out[8].month === "2026-09" && out[8].quantity_cartons === 1067, "septembre (abrégé 'Sept') = 1067 cartons attendu");
assert(out[11].month === "2026-12" && out[11].quantity_cartons === 838, "décembre (abrégé 'Dec') = 838 cartons attendu");
assert(
  !out.some((r) => r.reference === "Total" || r.reference === "TOTAL"),
  "la ligne de sous-total ne doit pas être lue comme une référence"
);

console.log(`OK — ${out.length} lignes générées, tous les mois (dont abréviations) correctement mappés.`);
