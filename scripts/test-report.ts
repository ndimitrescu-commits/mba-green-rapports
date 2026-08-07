/**
 * scripts/test-report.ts
 * ----------------------
 * Harnais de test : génère un rapport PDF complet à partir de lignes
 * GEODIS/GLS réelles exportées de Supabase (fichiers JSON), en passant par
 * exactement le même pipeline que /api/generate :
 *   computeGeodisResult + computeGlsResult → buildReportContextWithLogistics
 *   → buildReportData → renderDesignReportPdf.
 *
 * Usage : npx tsx scripts/test-report.ts <client> "<Mois Année>" <geodis.json> <gls.json> <out.pdf>
 */
import { readFileSync, writeFileSync } from "fs";
import { computeGeodisResult, computeGlsResult, GeodisRow, GlsRow } from "../lib/supabaseLogistics";
import { buildReportContextWithLogistics } from "../lib/compute";
import { buildReportData } from "../lib/reportData";
import { renderDesignReportPdf } from "../lib/renderDesignPdf";

async function main() {
  const [client, monthLabel, geodisPath, glsPath, outPath] = process.argv.slice(2);
  const geodisRows: GeodisRow[] = JSON.parse(readFileSync(geodisPath, "utf8"));
  const glsRows: GlsRow[] = JSON.parse(readFileSync(glsPath, "utf8"));
  const year = Number(monthLabel.trim().split(/\s+/).pop());

  const geodis = computeGeodisResult(geodisRows, year);
  const gls = computeGlsResult(glsRows, year);

  console.log("=== GEODIS ===");
  console.log("commandes:", geodis.total_commandes, "cartons:", geodis.total_cartons,
    "poids:", geodis.total_poids, "restaurants:", geodis.restaurants_livres);
  console.log("respect 12h:", geodis.respect_horaires_12h, "% | 11h:", geodis.respect_horaires_11h,
    "% | conformes:", geodis.respect_horaires_conformes, "%");
  console.log("horaires:", JSON.stringify(geodis.horaires));
  console.log("=== GLS ===");
  console.log("commandes:", gls.total_commandes, "cartons(colis):", gls.total_cartons, "poids:", gls.total_poids);

  const context = await buildReportContextWithLogistics(client, monthLabel, geodis, gls);
  const data = buildReportData(context);
  const pdf = await renderDesignReportPdf(data);
  writeFileSync(outPath, Buffer.from(pdf));
  console.log(`PDF écrit : ${outPath} (${pdf.length} octets)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
